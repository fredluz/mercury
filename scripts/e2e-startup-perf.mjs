#!/usr/bin/env node
/* eslint-disable no-console */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");
const electronPath = require("electron");

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(repoRoot, "prompt-exports", "perf-runs");
const mainEntry = path.join(repoRoot, "out", "main", "index.js");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const options = {
  samples: Math.max(1, Number(args.get("samples") || 5)),
  warmups: Math.max(0, Number(args.get("warmups") || 0)),
  timeoutMs: Math.max(1000, Number(args.get("timeout-ms") || 30000)),
  runId: args.get("run-id") || `startup-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  keepHomes: args.get("keep-homes") === "1" || args.get("keep-homes") === "true",
};

if (!fs.existsSync(mainEntry)) {
  console.error("Missing built app at out/main/index.js. Run `npm run build` first.");
  process.exit(2);
}

function summarize(samples) {
  const values = samples.filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted[sorted.length - 1],
    mean,
    stddev: Math.sqrt(variance),
  };
}

function safeRm(dir) {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function writeBaseConfig(hermesHome) {
  fs.mkdirSync(hermesHome, { recursive: true, mode: 0o700 });
  const hermesRepo = path.join(hermesHome, "hermes-agent");
  const venvBin = path.join(hermesRepo, "venv", "bin");
  fs.mkdirSync(venvBin, { recursive: true });
  fs.writeFileSync(path.join(venvBin, "python"), "#!/bin/sh\necho hermes-synthetic 0.0.0\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(hermesRepo, "hermes"), "# synthetic hermes script\n", { mode: 0o755 });
  fs.writeFileSync(path.join(hermesHome, ".env"), "OPENCODE_GO_API_KEY=synthetic\n", { mode: 0o600 });
  fs.writeFileSync(
    path.join(hermesHome, "desktop.json"),
    `${JSON.stringify({ connectionMode: "local" }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    [
      "model:",
      "  provider: synthetic",
      "  default: synthetic-model",
      '  base_url: ""',
      "streaming: true",
      "max_turns: 20",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(hermesHome, "auth.json"), JSON.stringify({ active_provider: "synthetic" }, null, 2));
}

function createHome() {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-startup-perf-"));
  fs.chmodSync(hermesHome, 0o700);
  writeBaseConfig(hermesHome);
  return hermesHome;
}

async function launchApp(hermesHome, diagFile, runId) {
  return electron.launch({
    executablePath: electronPath,
    args: [mainEntry],
    cwd: repoRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      NODE_ENV: "production",
      MERCURY_PERF_DIAG: "1",
      MERCURY_PERF_RUN_ID: runId,
      MERCURY_PERF_DIAG_FILE: diagFile,
    },
  });
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function eventEpochMs(event) {
  if (typeof event.timeOriginMs === "number" && typeof event.nowMs === "number") {
    return event.timeOriginMs + event.nowMs;
  }
  return null;
}

function eventNowMs(event) {
  return typeof event?.nowMs === "number" ? event.nowMs : null;
}

function firstEvent(records, name, source) {
  return records.find((event) => event.name === name && (!source || event.source === source));
}

function deriveTelemetry(records) {
  const mainModule = firstEvent(records, "main.module.evaluated", "main");
  const readyToShow = firstEvent(records, "window.ready-to-show", "main");
  const didFinishLoad = firstEvent(records, "window.did-finish-load", "main");
  const rendererEntry = firstEvent(records, "renderer.entry", "renderer");
  const layoutMounted = firstEvent(records, "layout.mounted", "renderer");
  const installMeasure = records.find(
    (event) => event.name === "app.install-check" && event.source === "renderer",
  );

  const mainStart = eventNowMs(mainModule);
  const ready = eventNowMs(readyToShow);
  const load = eventNowMs(didFinishLoad);
  const rendererStart = eventEpochMs(rendererEntry);
  const layout = eventEpochMs(layoutMounted);

  return {
    eventCount: records.length,
    mainDidFinishLoadMs: mainStart !== null && load !== null ? load - mainStart : null,
    mainReadyToShowMs: mainStart !== null && ready !== null ? ready - mainStart : null,
    rendererEntryToLayoutMountedMs:
      rendererStart !== null && layout !== null ? layout - rendererStart : null,
    installCheckMs:
      typeof installMeasure?.durationMs === "number" ? installMeasure.durationMs : null,
    memorySnapshots: records
      .filter((event) => event.scope === "startup" && event.phase === "memory")
      .map((event) => ({ name: event.name, meta: event.meta ?? {} })),
  };
}

async function collectSample(index, kind) {
  const sampleRunId = `${options.runId}-${kind}-${index}`;
  const diagFile = path.join(outputDir, `${sampleRunId}.ndjson`);
  const hermesHome = createHome();
  let app;
  const launchStart = performance.now();

  try {
    app = await launchApp(hermesHome, diagFile, sampleRunId);
    const page = await app.firstWindow();
    page.setDefaultTimeout(options.timeoutMs);
    const launchToFirstWindowMs = performance.now() - launchStart;

    await page.waitForLoadState("domcontentloaded", { timeout: options.timeoutMs });
    const launchToDomContentLoadedMs = performance.now() - launchStart;

    await page.waitForSelector(".chat-container", {
      state: "visible",
      timeout: options.timeoutMs,
    });
    const launchToChatVisibleMs = performance.now() - launchStart;

    await page.waitForTimeout(50);
    const records = readNdjson(diagFile);
    return {
      index,
      kind,
      status: "PASS",
      diagFile: path.relative(repoRoot, diagFile),
      launchToFirstWindowMs,
      launchToDomContentLoadedMs,
      launchToChatVisibleMs,
      telemetry: deriveTelemetry(records),
    };
  } catch (error) {
    return {
      index,
      kind,
      status: "FAIL",
      error: error instanceof Error ? error.message : String(error),
      diagFile: path.relative(repoRoot, diagFile),
    };
  } finally {
    if (app) await app.close().catch(() => {});
    if (!options.keepHomes) safeRm(hermesHome);
  }
}

fs.mkdirSync(outputDir, { recursive: true });

const samples = [];
for (let i = 0; i < options.warmups; i++) {
  const warmup = await collectSample(i, "warmup");
  console.log(`[startup] warmup ${i + 1}/${options.warmups}: ${warmup.status}`);
}

for (let i = 0; i < options.samples; i++) {
  const sample = await collectSample(i, "sample");
  samples.push(sample);
  console.log(
    `[startup] sample ${i + 1}/${options.samples}: ${sample.status}` +
      (sample.launchToChatVisibleMs ? ` chat=${sample.launchToChatVisibleMs.toFixed(1)}ms` : ""),
  );
}

const passed = samples.filter((sample) => sample.status === "PASS");
const summary = {
  launchToFirstWindowMs: summarize(passed.map((sample) => sample.launchToFirstWindowMs)),
  launchToDomContentLoadedMs: summarize(passed.map((sample) => sample.launchToDomContentLoadedMs)),
  launchToChatVisibleMs: summarize(passed.map((sample) => sample.launchToChatVisibleMs)),
  mainReadyToShowMs: summarize(passed.map((sample) => sample.telemetry.mainReadyToShowMs)),
  rendererEntryToLayoutMountedMs: summarize(
    passed.map((sample) => sample.telemetry.rendererEntryToLayoutMountedMs),
  ),
  installCheckMs: summarize(passed.map((sample) => sample.telemetry.installCheckMs)),
};

const artifact = {
  runId: options.runId,
  kind: "startup-perf",
  date: new Date().toISOString(),
  repoRoot,
  options: {
    samples: options.samples,
    warmups: options.warmups,
    timeoutMs: options.timeoutMs,
  },
  summary,
  samples,
};

const artifactPath = path.join(outputDir, `${options.runId}.json`);
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`[startup] wrote ${path.relative(repoRoot, artifactPath)}`);

if (passed.length !== samples.length) process.exit(1);

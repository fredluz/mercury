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

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const options = {
  samples: Number(args.get("samples") || 3),
  warmups: Number(args.get("warmups") || 0),
  chunks: Number(args.get("chunks") || 80),
  intervalMs: Number(args.get("interval-ms") || 8),
  payload: args.get("payload") || "plain",
  promptLength: Number(args.get("prompt-length") || 32),
  keepHomes: args.get("keep-homes") === "1" || args.get("keep-homes") === "true",
};

if (!["plain", "markdown", "code"].includes(options.payload)) {
  console.error(`Unsupported --payload=${options.payload}; use plain, markdown, or code.`);
  process.exit(2);
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, value) => acc + value, 0);
  const mean = sum / samples.length;
  const variance = samples.reduce((acc, value) => acc + (value - mean) ** 2, 0) / samples.length;
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
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-chat-render-"));
  fs.chmodSync(hermesHome, 0o700);
  writeBaseConfig(hermesHome);
  return hermesHome;
}

async function launchApp(hermesHome, diagFile, runId) {
  return electron.launch({
    executablePath: electronPath,
    args: [path.join(repoRoot, "out", "main", "index.js")],
    cwd: repoRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      NODE_ENV: "production",
      MERCURY_PERF_DIAG: "1",
      MERCURY_PERF_RUN_ID: runId,
      MERCURY_PERF_DIAG_FILE: diagFile,
      MERCURY_CHAT_SYNTHETIC_STREAM: "1",
      MERCURY_CHAT_SYNTHETIC_CHUNKS: String(options.chunks),
      MERCURY_CHAT_SYNTHETIC_INTERVAL_MS: String(options.intervalMs),
      MERCURY_CHAT_SYNTHETIC_PAYLOAD: options.payload,
    },
  });
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function syntheticPrompt(index) {
  const body = "x".repeat(Math.max(0, options.promptLength));
  return `Synthetic render latency sample ${index}: ${body}`;
}

function finalChunkNeedle() {
  const ordinal = String(options.chunks).padStart(3, "0");
  if (options.payload === "markdown") {
    return options.chunks === 1
      ? `chunk ${ordinal} of ${options.chunks}`
      : `deterministic markdown chunk ${ordinal} of ${options.chunks}`;
  }
  if (options.payload === "code") return `syntheticChunk${ordinal}`;
  return `Synthetic chat chunk ${ordinal} of ${options.chunks}.`;
}

async function installRenderProbe(page) {
  await page.evaluate(() => {
    const existing = window.__mercuryChatRenderProbe;
    if (existing?.observer) existing.observer.disconnect();
    if (existing?.longTaskObserver) existing.longTaskObserver.disconnect();

    const probe = {
      startMs: 0,
      firstAgentTextMs: 0,
      lastMutationMs: 0,
      mutationCount: 0,
      finalTextLength: 0,
      longTasks: [],
      observer: null,
      longTaskObserver: null,
    };

    const readAgentText = () =>
      Array.from(document.querySelectorAll(".chat-message-agent .chat-bubble-agent"))
        .map((node) => node.textContent || "")
        .join("\n");

    const target = document.querySelector(".chat-messages");
    if (target) {
      const observer = new MutationObserver(() => {
        const now = performance.now();
        const text = readAgentText();
        probe.mutationCount += 1;
        probe.lastMutationMs = now;
        probe.finalTextLength = text.length;
        if (!probe.firstAgentTextMs && text.trim()) probe.firstAgentTextMs = now;
      });
      observer.observe(target, { childList: true, characterData: true, subtree: true });
      probe.observer = observer;
    }

    if ("PerformanceObserver" in window) {
      try {
        const longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            probe.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        longTaskObserver.observe({ entryTypes: ["longtask"] });
        probe.longTaskObserver = longTaskObserver;
      } catch {
        // Long task entries are not available in all Electron/Chromium contexts.
      }
    }

    window.__mercuryChatRenderProbe = probe;
  });
}

async function measureSample(runId, index) {
  const hermesHome = createHome();
  const diagFile = path.join(outputDir, `${runId}-sample-${index}.ndjson`);
  let app;
  try {
    app = await launchApp(hermesHome, diagFile, runId);
    const page = await app.firstWindow();
    page.setDefaultTimeout(45_000);
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".chat-container").waitFor({ timeout: 45_000 });
    await page.locator(".chat-input").waitFor({ timeout: 45_000 });
    await installRenderProbe(page);

    const prompt = syntheticPrompt(index);
    const start = performance.now();
    await page.evaluate(() => {
      window.__mercuryChatRenderProbe.startMs = performance.now();
    });
    await page.locator(".chat-input").fill(prompt);
    await page.locator(".chat-send-btn").last().click();
    await page.locator(".chat-stop-btn").waitFor({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForFunction(
      (needle) =>
        Array.from(document.querySelectorAll(".chat-message-agent .chat-bubble-agent"))
          .map((node) => node.textContent || "")
          .join("\n")
          .includes(needle),
      finalChunkNeedle(),
      { timeout: 45_000 },
    );
    await page.waitForFunction(() => !document.querySelector(".chat-stop-btn"), null, { timeout: 45_000 });

    const wallCompleteMs = performance.now() - start;
    const probe = await page.evaluate(() => {
      const current = window.__mercuryChatRenderProbe;
      current?.observer?.disconnect();
      current?.longTaskObserver?.disconnect();
      return {
        startMs: current?.startMs || 0,
        firstAgentTextMs: current?.firstAgentTextMs || 0,
        lastMutationMs: current?.lastMutationMs || 0,
        mutationCount: current?.mutationCount || 0,
        finalTextLength: current?.finalTextLength || 0,
        longTasks: current?.longTasks || [],
      };
    });

    const longTaskDurations = probe.longTasks.map((task) => task.duration);
    return {
      ok: true,
      wallCompleteMs,
      inputToFirstAgentTextMs: probe.firstAgentTextMs ? probe.firstAgentTextMs - probe.startMs : null,
      inputToLastMutationMs: probe.lastMutationMs ? probe.lastMutationMs - probe.startMs : null,
      mutationCount: probe.mutationCount,
      finalTextLength: probe.finalTextLength,
      longTaskCount: probe.longTasks.length,
      longTaskTotalMs: longTaskDurations.reduce((acc, value) => acc + value, 0),
      longTaskMaxMs: longTaskDurations.length ? Math.max(...longTaskDurations) : 0,
      diagFile,
      hermesHome,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      diagFile,
      hermesHome,
    };
  } finally {
    if (app) await app.close();
    if (!options.keepHomes) safeRm(hermesHome);
  }
}

function summarizeTelemetry(files) {
  const rows = files.flatMap(readNdjson).filter((row) => row.scope === "chat-render");
  const byName = {};
  for (const name of [
    "chat.send.intent",
    "chat.chunk.first_callback",
    "chat.chunk.callback_sample",
    "chat.done.callback",
    "chat.send.ipc.resolved",
  ]) {
    const matches = rows.filter((row) => row.name === name);
    byName[name] = {
      samples: matches.length,
      elapsedMs: matches.some((row) => typeof row.meta?.elapsedMs === "number")
        ? summarize(matches.map((row) => row.meta?.elapsedMs).filter((value) => typeof value === "number"))
        : null,
    };
  }
  return byName;
}

function publicSample(sample) {
  const { hermesHome: _hermesHome, diagFile, ...rest } = sample;
  return {
    ...rest,
    diagFile: diagFile ? path.relative(repoRoot, diagFile) : undefined,
    hermesHome: options.keepHomes ? sample.hermesHome : undefined,
  };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const runId = `chat-render-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const artifactPath = path.join(outputDir, `${runId}-chat-render.json`);

  const totalRuns = options.warmups + options.samples;
  const samples = [];
  for (let i = 0; i < totalRuns; i++) {
    console.log(`Chat render sample ${i + 1}/${totalRuns}`);
    const sample = await measureSample(runId, i);
    if (i >= options.warmups) samples.push(sample);
  }

  const okSamples = samples.filter((sample) => sample.ok);
  const diagFiles = samples.map((sample) => sample.diagFile).filter(Boolean);
  const summary = {
    inputToFirstAgentTextMs: okSamples.length
      ? summarize(okSamples.map((sample) => sample.inputToFirstAgentTextMs).filter((value) => typeof value === "number"))
      : null,
    inputToLastMutationMs: okSamples.length
      ? summarize(okSamples.map((sample) => sample.inputToLastMutationMs).filter((value) => typeof value === "number"))
      : null,
    wallCompleteMs: okSamples.length ? summarize(okSamples.map((sample) => sample.wallCompleteMs)) : null,
    longTaskCount: okSamples.length ? summarize(okSamples.map((sample) => sample.longTaskCount)) : null,
    longTaskTotalMs: okSamples.length ? summarize(okSamples.map((sample) => sample.longTaskTotalMs)) : null,
    telemetry: summarizeTelemetry(diagFiles),
  };

  const artifact = {
    runId,
    date: new Date().toISOString(),
    options,
    synthetic: {
      envFlag: "MERCURY_CHAT_SYNTHETIC_STREAM=1",
      chunks: options.chunks,
      intervalMs: options.intervalMs,
      payload: options.payload,
    },
    samples: samples.map(publicSample),
    summary,
    diagFiles: diagFiles.map((file) => path.relative(repoRoot, file)),
  };

  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`Chat render latency artifact: ${artifactPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

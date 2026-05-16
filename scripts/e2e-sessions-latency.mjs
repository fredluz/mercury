#!/usr/bin/env node
/* eslint-disable no-console */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright");
const electronPath = require("electron");

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(repoRoot, "prompt-exports", "sessions-latency-runs");
const DEFAULT_QUERY = "latencyneedle";
const UI_SEARCH_DEBOUNCE_MS = 300;

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const options = {
  caseName: args.get("case") || "synthetic-local",
  cache: args.get("cache") || "warm",
  mountSamples: Number(args.get("mount-samples") || 5),
  searchSamples: Number(args.get("search-samples") || 10),
  warmups: Number(args.get("warmups") || 0),
  query: args.get("query") || DEFAULT_QUERY,
  sessions: Number(args.get("sessions") || 5),
  messagesPerSession: Number(args.get("messages-per-session") || 6),
  largeMessages: args.get("large-messages") === "1" || args.get("large-messages") === "true",
  keepHomes: args.get("keep-homes") === "1" || args.get("keep-homes") === "true",
};

if (!["synthetic-local", "current-config"].includes(options.caseName)) {
  console.error(`Unsupported --case=${options.caseName}; use synthetic-local or current-config.`);
  process.exit(2);
}

if (options.caseName === "synthetic-local") {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore" });
  } catch {
    console.error("Missing sqlite3 CLI, required for Electron-compatible synthetic DB seeding.");
    process.exit(2);
  }
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

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function seedDb(hermesHome) {
  const seedStart = performance.now();
  writeBaseConfig(hermesHome);
  const dbPath = path.join(hermesHome, "state.db");
  const now = Math.floor(Date.now() / 1000);
  const filler = options.largeMessages ? ` ${"filler ".repeat(2000)}` : "";
  const statements = [`
    DROP TABLE IF EXISTS messages_fts;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS sessions;
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      message_count INTEGER,
      model TEXT,
      title TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      content TEXT,
      timestamp INTEGER
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(content);
  `];

  let messageRowId = 1;
  for (let i = 0; i < options.sessions; i++) {
    const id = `session-${i}`;
    const title = i % 2 === 0 ? null : `Title ${i}`;
    statements.push(
      `INSERT INTO sessions (id, source, started_at, ended_at, message_count, model, title) VALUES (${sqlString(id)}, 'cli', ${now - i * 60}, NULL, ${options.messagesPerSession}, 'gpt-4o', ${sqlString(title)});`,
    );
    for (let j = 0; j < options.messagesPerSession; j++) {
      const role = j % 2 === 0 ? "user" : "assistant";
      const content = j === 0 ? `Find ${options.query} in session ${i}.${filler}` : `Message ${j} in session ${i}.${filler}`;
      statements.push(
        `INSERT INTO messages (id, session_id, role, content, timestamp) VALUES (${messageRowId}, ${sqlString(id)}, ${sqlString(role)}, ${sqlString(content)}, ${now - i * 60 + j});`,
        `INSERT INTO messages_fts (rowid, content) VALUES (${messageRowId}, ${sqlString(content)});`,
      );
      messageRowId += 1;
    }
  }
  execFileSync("sqlite3", [dbPath], { input: statements.join("\n") });

  if (options.cache === "warm") {
    const sessions = Array.from({ length: options.sessions }, (_, i) => ({
      id: `session-${i}`,
      title: i % 2 === 0 ? `Find ${options.query} in session ${i}.` : `Title ${i}`,
      startedAt: now - i * 60,
      source: "cli",
      messageCount: options.messagesPerSession,
      model: "gpt-4o",
    }));
    const desktopDir = path.join(hermesHome, "desktop");
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(
      path.join(desktopDir, "sessions.json"),
      `${JSON.stringify({ sessions, lastSync: now }, null, 2)}\n`,
    );
  }

  return {
    seedMs: performance.now() - seedStart,
    dbSizeBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    sessions: options.sessions,
    messagesPerSession: options.messagesPerSession,
    largeMessages: options.largeMessages,
    fts: true,
    cache: options.cache,
  };
}

function createHome() {
  if (options.caseName === "current-config") {
    return {
      hermesHome: process.env.HERMES_HOME?.trim() || path.join(os.homedir(), ".hermes"),
      seed: null,
    };
  }
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-sessions-latency-"));
  fs.chmodSync(hermesHome, 0o700);
  const seed = seedDb(hermesHome);
  return { hermesHome, seed };
}

function shouldCleanupHome() {
  return options.caseName === "synthetic-local" && !options.keepHomes;
}

function queryLabel() {
  if (options.caseName === "current-config") {
    return {
      redacted: true,
      length: options.query.length,
      sha256_12: createHash("sha256").update(options.query).digest("hex").slice(0, 12),
    };
  }
  return options.query;
}

async function launchApp(hermesHome, diagFile) {
  return electron.launch({
    executablePath: electronPath,
    args: [path.join(repoRoot, "out", "main", "index.js")],
    cwd: repoRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      NODE_ENV: "production",
      MERCURY_SESSIONS_DIAG: "1",
      MERCURY_SESSIONS_DIAG_FILE: diagFile,
    },
  });
}

async function clickSessions(page) {
  await page.locator(".sidebar-nav-item").filter({ hasText: "Sessions" }).click();
}

async function waitForSessionsContent(page) {
  await page.locator(".sessions-container").waitFor({ timeout: 45_000 });
  await page.waitForFunction(() => !document.querySelector(".sessions-loading"), null, { timeout: 45_000 });
  await page.locator(".sessions-list, .sessions-empty").first().waitFor({ timeout: 45_000 });
}

async function measureMount(runId, index) {
  const home = createHome();
  const { hermesHome, seed } = home;
  const diagFile = path.join(outputDir, `${runId}-mount-${index}.ndjson`);
  let app;
  try {
    app = await launchApp(hermesHome, diagFile);
    const page = await app.firstWindow();
    page.setDefaultTimeout(45_000);
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".sidebar-nav-item").filter({ hasText: "Sessions" }).waitFor({ timeout: 45_000 });
    const start = performance.now();
    await clickSessions(page);
    await waitForSessionsContent(page);
    const ms = performance.now() - start;
    await waitForDiagCount(diagFile, "sync-session-cache", 1);
    return { ok: true, ms, diagFile, hermesHome, seed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), diagFile, hermesHome, seed };
  } finally {
    if (app) await app.close();
    if (shouldCleanupHome()) safeRm(hermesHome);
  }
}

async function measureSearches(runId) {
  const home = createHome();
  const { hermesHome, seed } = home;
  const diagFile = path.join(outputDir, `${runId}-search.ndjson`);
  const samples = [];
  let app;
  try {
    app = await launchApp(hermesHome, diagFile);
    const page = await app.firstWindow();
    page.setDefaultTimeout(45_000);
    await page.waitForLoadState("domcontentloaded");
    await page.locator(".sidebar-nav-item").filter({ hasText: "Sessions" }).waitFor({ timeout: 45_000 });
    await clickSessions(page);
    await waitForSessionsContent(page);
    const input = page.locator(".sessions-searchbar-input");
    await input.waitFor();

    const totalSearchRuns = options.warmups + options.searchSamples;
    for (let i = 0; i < totalSearchRuns; i++) {
      await input.fill("");
      await page.waitForFunction(
        () => document.querySelector(".sessions-searchbar-input")?.value === "",
        null,
        { timeout: 45_000 },
      );
      await page.waitForFunction(() => !document.querySelector(".sessions-loading"), null, { timeout: 45_000 });
      await page.waitForTimeout(UI_SEARCH_DEBOUNCE_MS + 50);

      const query = options.query;
      const beforeSearchRecords = readNdjson(diagFile).filter(
        (row) => row.scope === "sessions-ipc" && row.channel === "search-sessions",
      ).length;
      const start = performance.now();
      await input.fill(query);
      await page.waitForFunction(
        (expected) => document.querySelector(".sessions-searchbar-input")?.value === expected,
        query,
        { timeout: 45_000 },
      );
      await waitForDiagCount(diagFile, "search-sessions", beforeSearchRecords + 1);
      await page.waitForFunction(() => !document.querySelector(".sessions-loading"), null, { timeout: 45_000 });
      await page.locator(".sessions-result-snippet mark, .sessions-empty").first().waitFor({ timeout: 45_000 });
      if (i >= options.warmups) {
        samples.push({ ok: true, ms: performance.now() - start });
      }
    }
    return { samples, diagFile, hermesHome, seed };
  } catch (error) {
    samples.push({ ok: false, error: error instanceof Error ? error.message : String(error) });
    return { samples, diagFile, hermesHome, seed };
  } finally {
    if (app) await app.close();
    if (shouldCleanupHome()) safeRm(hermesHome);
  }
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

async function waitForDiagCount(file, channel, count, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const matches = readNdjson(file).filter(
      (row) => row.scope === "sessions-ipc" && row.channel === channel,
    );
    if (matches.length >= count) return matches;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${count} ${channel} diagnostic records in ${file}`);
}

function publicSample(sample) {
  const { hermesHome: _hermesHome, diagFile, ...rest } = sample;
  return {
    ...rest,
    diagFile: diagFile ? path.relative(repoRoot, diagFile) : undefined,
    hermesHome: options.keepHomes ? sample.hermesHome : undefined,
  };
}

function summarizeIpc(files) {
  const rows = files.flatMap(readNdjson).filter((row) => row.scope === "sessions-ipc" && row.ok);
  const byChannel = {};
  for (const channel of ["list-cached-sessions", "sync-session-cache", "search-sessions"]) {
    const channelRows = rows.filter((row) => row.channel === channel);
    byChannel[channel] = {
      totalMs: channelRows.length ? summarize(channelRows.map((row) => row.totalMs)) : null,
      configMs: channelRows.length ? summarize(channelRows.map((row) => row.configMs || 0)) : null,
      implMs: channelRows.length ? summarize(channelRows.map((row) => row.implMs || 0)) : null,
      samples: channelRows.length,
    };
  }
  return byChannel;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const runId = `ui-${new Date().toISOString().replace(/[:.]/g, "-")}-${options.caseName}-${options.cache}`;
  const artifactPath = path.join(outputDir, `${runId}.json`);

  const mount = [];
  if (options.mountSamples > 0) {
    for (let i = 0; i < options.mountSamples; i++) {
      console.log(`Mount sample ${i + 1}/${options.mountSamples}`);
      mount.push(await measureMount(runId, i));
    }
  }

  console.log(`Search samples ${options.searchSamples} (+${options.warmups} warmups)`);
  const search = await measureSearches(runId);

  const diagFiles = [
    ...mount.map((sample) => sample.diagFile).filter(Boolean),
    search.diagFile,
  ];
  const mountMs = mount.filter((sample) => sample.ok).map((sample) => sample.ms);
  const searchMs = search.samples.filter((sample) => sample.ok).map((sample) => sample.ms);
  const summary = {
    mountToFirstRenderableMs: mountMs.length ? summarize(mountMs) : null,
    rendererInputToResultsMs: searchMs.length ? summarize(searchMs) : null,
    ipc: summarizeIpc(diagFiles),
  };

  const artifact = {
    runId,
    date: new Date().toISOString(),
    options: {
      ...options,
      query: queryLabel(),
    },
    queryLabel: queryLabel(),
    visibleSpinnerPath: "active search after Sessions mount/content is visible",
    debounceMs: UI_SEARCH_DEBOUNCE_MS,
    dataset: {
      sessions: options.caseName === "synthetic-local" ? options.sessions : "unknown-current-config",
      messagesPerSession:
        options.caseName === "synthetic-local"
          ? options.messagesPerSession
          : "unknown-current-config",
      fts: options.caseName === "synthetic-local" ? true : "unknown",
      largeMessages: options.caseName === "synthetic-local" ? options.largeMessages : "unknown",
      cache: options.caseName === "synthetic-local" ? options.cache : "current",
      seed: options.caseName === "synthetic-local" ? search.seed : null,
    },
    mount: mount.map(publicSample),
    search: {
      ...search,
      diagFile: path.relative(repoRoot, search.diagFile),
      hermesHome: options.keepHomes ? search.hermesHome : undefined,
    },
    summary,
    diagFiles: diagFiles.map((file) => path.relative(repoRoot, file)),
  };
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`Sessions latency artifact: ${artifactPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

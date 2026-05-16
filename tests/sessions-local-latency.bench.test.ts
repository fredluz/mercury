import { describe, it, expect, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, statSync, writeFileSync } from "fs";
import { performance } from "perf_hooks";

const { TEST_HOME, RUN_ID, ARTIFACT_PATH } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  const runId = `local-functions-${Date.now()}`;
  const repoRoot = process.cwd();
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-sessions-latency-${Date.now()}`),
    RUN_ID: runId,
    ARTIFACT_PATH: path.join(
      repoRoot,
      "prompt-exports",
      "sessions-latency-runs",
      `${runId}.json`,
    ),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("../src/shared/i18n", () => ({
  t: (key: string) => key,
}));
vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

import Database from "better-sqlite3";
import { listCachedSessions, syncSessionCache } from "../src/main/session-cache";
import { searchSessions } from "../src/main/sessions";

interface SampleSummary {
  min: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
  stddev: number;
}

interface TimedSamples {
  samples: number[];
  summary: SampleSummary;
}

interface SeedResult {
  sessions: number;
  messagesPerSession: number;
  largeMessages: boolean;
  fts: true;
  query: string;
  seedMs: number;
  dbSizeBytes: number;
}

const DB_PATH = join(TEST_HOME, "state.db");
const QUERY = "latencyneedle";
const WARMUPS = Number(process.env.MERCURY_SESSIONS_BENCH_WARMUPS || 5);
const SAMPLES = Number(process.env.MERCURY_SESSIONS_BENCH_SAMPLES || 30);
const SCALE_SESSIONS = Number(process.env.MERCURY_SESSIONS_BENCH_SESSIONS || 1000);
const SCALE_MESSAGES = Number(process.env.MERCURY_SESSIONS_BENCH_MESSAGES || 8);
const SCALE_LARGE_MESSAGES =
  process.env.MERCURY_SESSIONS_BENCH_LARGE_MESSAGES === "1" ||
  process.env.MERCURY_SESSIONS_BENCH_LARGE_MESSAGES === "true";
const RUN_SCALE =
  process.env.MERCURY_SESSIONS_BENCH_SCALE === "1" ||
  (process.env.MERCURY_SESSIONS_BENCH_SCALE === undefined &&
    (process.env.MERCURY_SESSIONS_BENCH_SESSIONS !== undefined ||
      process.env.MERCURY_SESSIONS_BENCH_MESSAGES !== undefined ||
      process.env.MERCURY_SESSIONS_BENCH_LARGE_MESSAGES !== undefined));
const describeBench = process.env.MERCURY_SESSIONS_BENCH === "1" ? describe : describe.skip;

function summarize(samples: number[]): SampleSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((acc, value) => acc + value, 0);
  const mean = sum / samples.length;
  const variance =
    samples.reduce((acc, value) => acc + (value - mean) ** 2, 0) /
    samples.length;
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted[sorted.length - 1],
    mean,
    stddev: Math.sqrt(variance),
  };
}

function timeSamples(fn: () => unknown): TimedSamples {
  for (let i = 0; i < WARMUPS; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return { samples, summary: summarize(samples) };
}

function seedDb(options: { sessions: number; messagesPerSession: number; largeMessages?: boolean }): SeedResult {
  const seedStart = performance.now();
  mkdirSync(TEST_HOME, { recursive: true });
  const db = new Database(DB_PATH);
  try {
    db.exec(`
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
    `);

    const insertSession = db.prepare(
      `INSERT INTO sessions (id, source, started_at, ended_at, message_count, model, title)
       VALUES (?, 'cli', ?, NULL, ?, 'gpt-4o', ?)`,
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
    );
    const insertFts = db.prepare(`INSERT INTO messages_fts (rowid, content) VALUES (?, ?)`);
    const now = Math.floor(Date.now() / 1000);
    const filler = options.largeMessages ? ` ${"filler ".repeat(2000)}` : "";

    const insertAll = db.transaction(() => {
      for (let i = 0; i < options.sessions; i++) {
        const id = `session-${i}`;
        insertSession.run(
          id,
          now + i,
          options.messagesPerSession,
          i % 2 === 0 ? null : `Title ${i}`,
        );
        for (let j = 0; j < options.messagesPerSession; j++) {
          const role = j % 2 === 0 ? "user" : "assistant";
          const content =
            j === 0
              ? `Find ${QUERY} in session ${i}.${filler}`
              : `Message ${j} in session ${i}.${filler}`;
          const result = insertMessage.run(id, role, content, now + i + j);
          insertFts.run(result.lastInsertRowid, content);
        }
      }
    });
    insertAll();
  } finally {
    db.close();
  }

  return {
    sessions: options.sessions,
    messagesPerSession: options.messagesPerSession,
    largeMessages: Boolean(options.largeMessages),
    fts: true,
    query: QUERY,
    seedMs: performance.now() - seedStart,
    dbSizeBytes: statSync(DB_PATH).size,
  };
}

function removeHome(): void {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true, force: true });
}

function writeArtifact(data: unknown): void {
  mkdirSync(join(process.cwd(), "prompt-exports", "sessions-latency-runs"), {
    recursive: true,
  });
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

describeBench("Sessions local latency benchmark", () => {
  it("captures local list/sync/search baseline samples", () => {
    removeHome();
    const smallSeed = seedDb({ sessions: 5, messagesPerSession: 6 });

    const emptyCacheSyncStart = performance.now();
    const initialSync = syncSessionCache();
    const emptyCacheSyncMs = performance.now() - emptyCacheSyncStart;
    expect(initialSync).toHaveLength(5);

    const listCached = timeSamples(() => listCachedSessions(50));
    const warmSync = timeSamples(() => syncSessionCache());
    const searchSmall = timeSamples(() => searchSessions(QUERY, 20));
    expect(searchSessions(QUERY, 20)).toHaveLength(5);

    removeHome();
    const largeSeed = seedDb({ sessions: 5, messagesPerSession: 6, largeMessages: true });
    syncSessionCache();
    const searchLarge = timeSamples(() => searchSessions(QUERY, 20));
    expect(searchSessions(QUERY, 20)).toHaveLength(5);

    let scale:
      | {
          seed: SeedResult;
          emptyCacheSyncMs: number;
          listCached: TimedSamples;
          warmSync: TimedSamples;
          search: TimedSamples;
          resultCount: number;
        }
      | undefined;
    if (RUN_SCALE) {
      removeHome();
      const scaleSeed = seedDb({
        sessions: SCALE_SESSIONS,
        messagesPerSession: SCALE_MESSAGES,
        largeMessages: SCALE_LARGE_MESSAGES,
      });
      const scaleSyncStart = performance.now();
      const scaleInitialSync = syncSessionCache();
      const scaleEmptyCacheSyncMs = performance.now() - scaleSyncStart;
      const scaleListCached = timeSamples(() => listCachedSessions(50));
      const scaleWarmSync = timeSamples(() => syncSessionCache());
      const scaleSearch = timeSamples(() => searchSessions(QUERY, 20));
      const scaleResultCount = searchSessions(QUERY, 20).length;

      expect(scaleInitialSync.length).toBeGreaterThan(0);
      expect(scaleResultCount).toBeGreaterThan(0);
      scale = {
        seed: scaleSeed,
        emptyCacheSyncMs: scaleEmptyCacheSyncMs,
        listCached: scaleListCached,
        warmSync: scaleWarmSync,
        search: scaleSearch,
        resultCount: scaleResultCount,
      };
    }

    const artifact = {
      runId: RUN_ID,
      kind: "local-functions",
      date: new Date().toISOString(),
      samples: SAMPLES,
      warmups: WARMUPS,
      dataset: {
        small: smallSeed,
        large: largeSeed,
        scale: scale?.seed || null,
      },
      metrics: {
        emptyCacheSyncMs,
        listCached,
        warmSync,
        searchSmall,
        searchLarge,
        scale: scale
          ? {
              emptyCacheSyncMs: scale.emptyCacheSyncMs,
              listCached: scale.listCached,
              warmSync: scale.warmSync,
              search: scale.search,
              resultCount: scale.resultCount,
            }
          : null,
      },
    };
    writeArtifact(artifact);
    console.log(`Sessions latency artifact: ${ARTIFACT_PATH}`);
    console.log(JSON.stringify(artifact.metrics, null, 2));

    expect(listCached.summary.median).toBeGreaterThanOrEqual(0);
    expect(warmSync.summary.median).toBeGreaterThanOrEqual(0);
    expect(searchSmall.summary.median).toBeGreaterThanOrEqual(0);
    expect(searchLarge.summary.median).toBeGreaterThanOrEqual(0);
    if (scale) {
      expect(scale.listCached.summary.median).toBeGreaterThanOrEqual(0);
      expect(scale.warmSync.summary.median).toBeGreaterThanOrEqual(0);
      expect(scale.search.summary.median).toBeGreaterThanOrEqual(0);
    }
  });
});

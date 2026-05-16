import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { performance } from "perf_hooks";

const { TEST_HOME, RUN_ID, ARTIFACT_PATH, TELEMETRY_PATH } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  const runId = `trace-store-${Date.now()}`;
  const repoRoot = process.cwd();
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-trace-store-stress-${Date.now()}`),
    RUN_ID: runId,
    ARTIFACT_PATH: path.join(
      repoRoot,
      "prompt-exports",
      "perf-runs",
      `${runId}-trace-store.json`,
    ),
    TELEMETRY_PATH: path.join(
      repoRoot,
      "prompt-exports",
      "perf-runs",
      `${runId}-trace-store.ndjson`,
    ),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

import {
  createTraceRun,
  finishTraceRun,
  getTraceRun,
  listTraceRuns,
  recordTraceEvent,
  recordTraceUsage,
} from "../src/main/trace-store";

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

const describeBench = process.env.MERCURY_TRACE_STORE_BENCH === "1" ? describe : describe.skip;
const SINGLE_RUN_EVENTS = Number(process.env.MERCURY_TRACE_STORE_BENCH_EVENTS || 120);
const RUN_CAP_EXERCISE_RUNS = Number(process.env.MERCURY_TRACE_STORE_BENCH_RUNS || 220);
const DELTA_EVENTS = Number(process.env.MERCURY_TRACE_STORE_BENCH_DELTAS || 120);
const STORE_PATH = join(TEST_HOME, "desktop-traces.json");

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

function time<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

function readNdjson(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function summarizeTelemetry(name: string): TimedSamples | null {
  const samples = readNdjson(TELEMETRY_PATH)
    .filter((row) => row.scope === "trace-store" && row.name === name)
    .map((row) => Number(row.durationMs))
    .filter((value) => Number.isFinite(value));
  return samples.length ? { samples, summary: summarize(samples) } : null;
}

function writeArtifact(data: unknown): void {
  mkdirSync(join(process.cwd(), "prompt-exports", "perf-runs"), {
    recursive: true,
  });
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

beforeEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
  mkdirSync(TEST_HOME, { recursive: true });
  rmSync(TELEMETRY_PATH, { force: true });
  process.env.MERCURY_PERF_DIAG = "1";
  process.env.MERCURY_PERF_DIAG_FILE = TELEMETRY_PATH;
  process.env.MERCURY_PERF_RUN_ID = RUN_ID;
});

afterEach(() => {
  delete process.env.MERCURY_PERF_DIAG;
  delete process.env.MERCURY_PERF_DIAG_FILE;
  delete process.env.MERCURY_PERF_RUN_ID;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describeBench("trace-store stress benchmark", () => {
  it("captures trace persistence costs and cap behavior", () => {
    const create = time(() => createTraceRun("Stress trace run", "benchmark"));
    const appendSamples: number[] = [];
    for (let i = 0; i < SINGLE_RUN_EVENTS; i++) {
      const sample = time(() =>
        recordTraceEvent(
          create.value.id,
          "tool.progress",
          `Progress ${i}`,
          `Synthetic detail ${i}`,
          { index: i, payloadBytes: 18 },
        ),
      );
      appendSamples.push(sample.ms);
    }

    const deltaRun = createTraceRun("Delta cap stress", "benchmark");
    for (let i = 0; i < DELTA_EVENTS; i++) {
      recordTraceEvent(
        deltaRun.id,
        "message.agent.delta",
        "Agent delta",
        `chunk ${i}`,
        { index: i },
      );
    }
    const storedDeltaRun = getTraceRun(deltaRun.id);
    const storedDeltaEvents =
      storedDeltaRun?.events.filter((event) => event.type === "message.agent.delta")
        .length || 0;

    const usage = time(() =>
      recordTraceUsage(create.value.id, {
        promptTokens: 100,
        completionTokens: 25,
        totalTokens: 125,
        cost: 0.001,
      }),
    );
    const finish = time(() =>
      finishTraceRun(create.value.id, "completed", "session-stress", "done"),
    );

    const createRunCapSamples: number[] = [];
    for (let i = 0; i < RUN_CAP_EXERCISE_RUNS; i++) {
      createRunCapSamples.push(time(() => createTraceRun(`Capped run ${i}`)).ms);
    }

    const list = time(() => listTraceRuns());
    const finalRuns = list.value;
    const finalEventCount = finalRuns.reduce(
      (total, run) => total + run.events.length,
      0,
    );
    const finalFileSizeBytes = existsSync(STORE_PATH) ? statSync(STORE_PATH).size : 0;

    const telemetry = {
      writeStore: summarizeTelemetry("writeStore"),
      recordTraceEvent: summarizeTelemetry("recordTraceEvent"),
      createTraceRun: summarizeTelemetry("createTraceRun"),
      recordTraceUsage: summarizeTelemetry("recordTraceUsage"),
      finishTraceRun: summarizeTelemetry("finishTraceRun"),
      listTraceRuns: summarizeTelemetry("listTraceRuns"),
    };

    const artifact = {
      runId: RUN_ID,
      kind: "trace-store-stress",
      date: new Date().toISOString(),
      artifactPath: ARTIFACT_PATH,
      telemetryPath: TELEMETRY_PATH,
      options: {
        singleRunEvents: SINGLE_RUN_EVENTS,
        runCapExerciseRuns: RUN_CAP_EXERCISE_RUNS,
        deltaEvents: DELTA_EVENTS,
      },
      finalStore: {
        fileSizeBytes: finalFileSizeBytes,
        runCount: finalRuns.length,
        eventCount: finalEventCount,
        storedDeltaEvents,
      },
      metrics: {
        createRunMs: create.ms,
        appendEventMs: { samples: appendSamples, summary: summarize(appendSamples) },
        createRunCapMs: {
          samples: createRunCapSamples,
          summary: summarize(createRunCapSamples),
        },
        usageMs: usage.ms,
        finishMs: finish.ms,
        listTraceRunsMs: list.ms,
        telemetry,
      },
    };

    writeArtifact(artifact);
    console.log(`Trace-store stress artifact: ${ARTIFACT_PATH}`);
    console.log(JSON.stringify(artifact.finalStore, null, 2));

    expect(finalRuns.length).toBeLessThanOrEqual(200);
    expect(storedDeltaEvents).toBeLessThanOrEqual(80);
    expect(finalFileSizeBytes).toBeGreaterThan(0);
    expect(create.ms).toBeGreaterThanOrEqual(0);
    expect(list.ms).toBeGreaterThanOrEqual(0);
    expect(telemetry.writeStore).not.toBeNull();
    expect(telemetry.recordTraceEvent).not.toBeNull();
    expect(telemetry.createTraceRun).not.toBeNull();
  });
});

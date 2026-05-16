import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getPerfTelemetryConfig,
  isPerfTelemetryEnabled,
  recordPerfEvent,
  withPerfSpanSync,
} from "../src/main/perf/telemetry";

const ENV_KEYS = [
  "MERCURY_PERF_DIAG",
  "MERCURY_PERF_DIAG_FILE",
  "MERCURY_PERF_RUN_ID",
  "MERCURY_PERF_SAMPLE_EVERY",
  "MERCURY_SESSIONS_DIAG",
  "MERCURY_SESSIONS_DIAG_FILE",
  "MERCURY_SESSIONS_DIAG_RUN_ID",
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

const originalEnv = new Map<EnvKey, string | undefined>();
let tempDir: string;

function readNdjson(file: string): Array<Record<string, unknown>> {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mercury-perf-test-"));
  for (const key of ENV_KEYS) {
    originalEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("performance telemetry foundation", () => {
  it("is disabled by default and does not create a telemetry file", () => {
    const file = join(tempDir, "disabled.ndjson");
    process.env.MERCURY_PERF_DIAG_FILE = file;

    expect(isPerfTelemetryEnabled()).toBe(false);
    expect(getPerfTelemetryConfig()).toEqual({ enabled: false });
    expect(
      recordPerfEvent({ scope: "startup", name: "startup.default-off", phase: "mark" }),
    ).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it("reports enabled config and writes valid NDJSON when opted in", () => {
    const file = join(tempDir, "enabled.ndjson");
    process.env.MERCURY_PERF_DIAG = "1";
    process.env.MERCURY_PERF_DIAG_FILE = file;
    process.env.MERCURY_PERF_RUN_ID = "perf-test-run";
    process.env.MERCURY_PERF_SAMPLE_EVERY = "3";

    expect(getPerfTelemetryConfig()).toEqual({
      enabled: true,
      runId: "perf-test-run",
      sampleEvery: 3,
    });
    expect(
      recordPerfEvent({
        scope: "benchmark",
        name: "bench.sample",
        phase: "measure",
        durationMs: 12.5,
        meta: { count: 2 },
      }),
    ).toBe(true);

    const [event] = readNdjson(file);
    expect(event).toMatchObject({
      scope: "benchmark",
      name: "bench.sample",
      phase: "measure",
      durationMs: 12.5,
      runId: "perf-test-run",
      pid: process.pid,
    });
    expect(typeof event.ts).toBe("string");
    expect(event.meta).toEqual({ count: 2 });
  });

  it("supports legacy session diagnostic enablement for session telemetry", () => {
    const file = join(tempDir, "sessions.ndjson");
    process.env.MERCURY_SESSIONS_DIAG = "1";
    process.env.MERCURY_SESSIONS_DIAG_FILE = file;

    expect(isPerfTelemetryEnabled("sessions-ipc")).toBe(true);
    expect(getPerfTelemetryConfig()).toEqual({ enabled: true });
    expect(recordPerfEvent({ scope: "sessions-ipc", name: "sessions.list" })).toBe(true);
    expect(readNdjson(file)[0]).toMatchObject({
      scope: "sessions-ipc",
      name: "sessions.list",
    });
  });

  it("redacts secrets and prompt/response content before writing", () => {
    const file = join(tempDir, "redacted.ndjson");
    process.env.MERCURY_PERF_DIAG = "1";
    process.env.MERCURY_PERF_DIAG_FILE = file;

    recordPerfEvent({
      scope: "ipc",
      name: "redaction.sample",
      meta: {
        apiKey: "sk-secret",
        authorization: "Bearer hidden",
        prompt: "user prompt must not be logged",
        response: "assistant response must not be logged",
        message: "chat message must not be logged",
        promptPreview: "prompt preview must not be logged",
        messageContent: "message content must not be logged",
        responseText: "response text must not be logged",
        contentSnippet: "content snippet must not be logged",
        input: "input must not be logged",
        messageLength: 42,
        inputBytes: 100,
        nested: {
          password: "nested-password",
          safe: "safe-value",
        },
      },
    });

    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("sk-secret");
    expect(raw).not.toContain("Bearer hidden");
    expect(raw).not.toContain("user prompt must not be logged");
    expect(raw).not.toContain("assistant response must not be logged");
    expect(raw).not.toContain("chat message must not be logged");
    expect(raw).not.toContain("prompt preview must not be logged");
    expect(raw).not.toContain("message content must not be logged");
    expect(raw).not.toContain("response text must not be logged");
    expect(raw).not.toContain("content snippet must not be logged");
    expect(raw).not.toContain("input must not be logged");
    expect(raw).not.toContain("nested-password");

    const [event] = readNdjson(file);
    expect(event.meta).toMatchObject({
      messageLength: 42,
      inputBytes: 100,
      nested: JSON.stringify({ safe: "safe-value" }),
    });
  });

  it("records failed spans but still rethrows the original error", () => {
    const file = join(tempDir, "span-error.ndjson");
    process.env.MERCURY_PERF_DIAG = "1";
    process.env.MERCURY_PERF_DIAG_FILE = file;
    const error = new TypeError("operation failed");

    expect(() =>
      withPerfSpanSync("ipc", "failing.operation", { apiKey: "secret" }, () => {
        throw error;
      }),
    ).toThrow(error);

    const [event] = readNdjson(file);
    expect(event).toMatchObject({
      scope: "ipc",
      name: "failing.operation",
      phase: "span",
      ok: false,
      error: "TypeError",
    });
    expect(typeof event.durationMs).toBe("number");
    expect(JSON.stringify(event)).not.toContain("secret");
  });
});

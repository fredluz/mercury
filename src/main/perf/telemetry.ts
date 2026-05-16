import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { performance } from "perf_hooks";
import { tmpdir } from "os";
import type {
  MainPerfEvent,
  PerfScope,
  PerfTelemetryConfig,
  RendererPerfEvent,
} from "../../shared/perf";

const MAX_STRING_LENGTH = 2_048;
const SENSITIVE_KEY_RE =
  /api[_-]?key|authorization|credential|password|secret|token/i;
const CONTENT_KEY_RE = /content|message|prompt|response|input|output|completion/i;
const SAFE_CONTENT_METRIC_KEY_RE = /(length|count|bytes|size|ms|duration)$/i;

let warnedAboutWriteFailure = false;

function envEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function getSampleEvery(): number | undefined {
  const raw = process.env.MERCURY_PERF_SAMPLE_EVERY;
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.floor(parsed);
}

function getRunId(): string | undefined {
  return process.env.MERCURY_PERF_RUN_ID || process.env.MERCURY_SESSIONS_DIAG_RUN_ID;
}

function getPerfTelemetryFile(scope?: string): string {
  if (process.env.MERCURY_PERF_DIAG_FILE) return process.env.MERCURY_PERF_DIAG_FILE;
  if (
    (scope === "sessions-ipc" || scope === "sessions") &&
    process.env.MERCURY_SESSIONS_DIAG_FILE
  ) {
    return process.env.MERCURY_SESSIONS_DIAG_FILE;
  }
  return join(tmpdir(), "mercury-perf-diag.ndjson");
}

export function isPerfTelemetryEnabled(scope?: string): boolean {
  if (envEnabled(process.env.MERCURY_PERF_DIAG)) return true;
  return (
    (scope === "sessions-ipc" || scope === "sessions") &&
    envEnabled(process.env.MERCURY_SESSIONS_DIAG)
  );
}

export function getPerfTelemetryConfig(): PerfTelemetryConfig {
  const config: PerfTelemetryConfig = {
    enabled: isPerfTelemetryEnabled() || isPerfTelemetryEnabled("sessions-ipc"),
  };
  const runId = getRunId();
  const sampleEvery = getSampleEvery();
  if (runId) config.runId = runId;
  if (sampleEvery !== undefined) config.sampleEvery = sampleEvery;
  return config;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function capString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
}

function sanitizePrimitive(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === "string") return capString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean" || value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return capString(value.name || "Error");
  return undefined;
}

function sanitizeNestedValue(value: unknown): unknown {
  const primitive = sanitizePrimitive(value);
  if (primitive !== undefined || value === undefined) return primitive;

  try {
    return capString(JSON.stringify(sanitizeObject(value)));
  } catch {
    return String(value);
  }
}

function shouldDropMetaKey(key: string): boolean {
  if (SENSITIVE_KEY_RE.test(key)) return true;
  if (SAFE_CONTENT_METRIC_KEY_RE.test(key)) return false;
  return CONTENT_KEY_RE.test(key);
}

function sanitizeObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeNestedValue);
  if (!isPlainObject(value)) return sanitizePrimitive(value) ?? String(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (shouldDropMetaKey(key)) continue;
    sanitized[key] = sanitizeNestedValue(entryValue);
  }
  return sanitized;
}

function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const sanitized = sanitizeObject(meta);
  return isPlainObject(sanitized) ? sanitized : undefined;
}

function isPerfScope(value: unknown): value is PerfScope {
  return (
    value === "startup" ||
    value === "ipc" ||
    value === "chat-render" ||
    value === "trace-store" ||
    value === "ssh" ||
    value === "build" ||
    value === "benchmark" ||
    value === "sessions-ipc"
  );
}

function isPerfEvent(value: unknown): value is RendererPerfEvent | MainPerfEvent {
  return isPlainObject(value) && isPerfScope(value.scope) && typeof value.name === "string";
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return typeof error === "string" ? "Error" : typeof error;
}

function toRecord(event: RendererPerfEvent | MainPerfEvent): MainPerfEvent & {
  runId?: string;
  pid: number;
} {
  const record: MainPerfEvent & { runId?: string; pid: number } = {
    ts: new Date().toISOString(),
    source: "source" in event ? event.source : "main",
    scope: event.scope,
    name: capString(event.name),
    pid: process.pid,
  };

  if (event.phase) record.phase = event.phase;
  if (typeof event.nowMs === "number" && Number.isFinite(event.nowMs)) record.nowMs = event.nowMs;
  if (typeof event.timeOriginMs === "number" && Number.isFinite(event.timeOriginMs)) {
    record.timeOriginMs = event.timeOriginMs;
  }
  if (typeof event.durationMs === "number" && Number.isFinite(event.durationMs)) {
    record.durationMs = event.durationMs;
  }
  if ("ok" in event && typeof event.ok === "boolean") record.ok = event.ok;
  if ("error" in event && event.error) record.error = capString(event.error);

  const runId = getRunId();
  if (runId) record.runId = capString(runId);
  const meta = sanitizeMeta(event.meta);
  if (meta) record.meta = meta;

  return record;
}

export function recordPerfEvent(event: RendererPerfEvent | MainPerfEvent | unknown): boolean {
  if (!isPerfEvent(event) || !isPerfTelemetryEnabled(event.scope)) return false;

  try {
    const file = getPerfTelemetryFile(event.scope);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(toRecord(event))}\n`, "utf8");
    return true;
  } catch (error) {
    if (!warnedAboutWriteFailure) {
      warnedAboutWriteFailure = true;
      console.warn("[perf] failed to write telemetry event", normalizeError(error));
    }
    return false;
  }
}

export async function withPerfSpan<T>(
  scope: PerfScope,
  name: string,
  meta: Record<string, unknown> | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await run();
    recordPerfEvent({
      scope,
      name,
      phase: "span",
      durationMs: performance.now() - start,
      ok: true,
      meta,
    });
    return result;
  } catch (error) {
    recordPerfEvent({
      scope,
      name,
      phase: "span",
      durationMs: performance.now() - start,
      ok: false,
      error: normalizeError(error),
      meta,
    });
    throw error;
  }
}

export function withPerfSpanSync<T>(
  scope: PerfScope,
  name: string,
  meta: Record<string, unknown> | undefined,
  run: () => T,
): T {
  const start = performance.now();
  try {
    const result = run();
    recordPerfEvent({
      scope,
      name,
      phase: "span",
      durationMs: performance.now() - start,
      ok: true,
      meta,
    });
    return result;
  } catch (error) {
    recordPerfEvent({
      scope,
      name,
      phase: "span",
      durationMs: performance.now() - start,
      ok: false,
      error: normalizeError(error),
      meta,
    });
    throw error;
  }
}

export function recordMemorySnapshot(
  scope: PerfScope,
  name: string,
  meta?: Record<string, unknown>,
): boolean {
  const memory = process.memoryUsage();
  return recordPerfEvent({
    scope,
    name,
    phase: "memory",
    meta: {
      ...meta,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
  });
}

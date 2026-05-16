import type { PerfScope, PerfTelemetryConfig, RendererPerfEvent } from "../../shared/perf";

const disabledConfig: PerfTelemetryConfig = { enabled: false };

let configPromise: Promise<PerfTelemetryConfig> | null = null;
let cachedConfig: PerfTelemetryConfig | null = null;
let queue: RendererPerfEvent[] = [];

function hasPerfApi(): boolean {
  return typeof window !== "undefined" && Boolean(window.hermesAPI?.getPerfTelemetryConfig);
}

function stampEvent(event: RendererPerfEvent): RendererPerfEvent {
  if (typeof performance === "undefined") return event;
  return {
    ...event,
    nowMs: event.nowMs ?? performance.now(),
    timeOriginMs: event.timeOriginMs ?? performance.timeOrigin,
  };
}

async function loadPerfTelemetryConfig(): Promise<PerfTelemetryConfig> {
  if (!hasPerfApi()) return disabledConfig;
  if (!configPromise) {
    configPromise = window.hermesAPI
      .getPerfTelemetryConfig()
      .then((config) => {
        cachedConfig = config;
        return config;
      })
      .catch(() => {
        cachedConfig = disabledConfig;
        return disabledConfig;
      });
  }
  return configPromise;
}

function sendPerfEvent(event: RendererPerfEvent): Promise<boolean> {
  if (!window.hermesAPI?.recordPerfEvent) return Promise.resolve(false);
  return window.hermesAPI.recordPerfEvent(event).catch(() => false);
}

async function flushPerfQueue(): Promise<void> {
  const config = await loadPerfTelemetryConfig();
  const events = queue;
  queue = [];

  if (!config.enabled) return;
  await Promise.allSettled(events.map((event) => sendPerfEvent(event)));
}

export async function getRendererPerfTelemetryConfig(): Promise<PerfTelemetryConfig> {
  return loadPerfTelemetryConfig();
}

export function recordRendererPerfEvent(event: RendererPerfEvent): void {
  const stamped = stampEvent(event);

  if (cachedConfig?.enabled) {
    void sendPerfEvent(stamped);
    return;
  }

  if (cachedConfig && !cachedConfig.enabled) return;

  queue.push(stamped);
  void flushPerfQueue();
}

export function markRendererPerf(
  scope: PerfScope,
  name: string,
  meta?: Record<string, unknown>,
): void {
  recordRendererPerfEvent({ scope, name, phase: "mark", meta });
}

export function measureRendererPerf(
  scope: PerfScope,
  name: string,
  durationMs: number,
  meta?: Record<string, unknown>,
): void {
  recordRendererPerfEvent({ scope, name, phase: "measure", durationMs, meta });
}

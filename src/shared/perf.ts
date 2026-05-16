export type PerfScope =
  | "startup"
  | "ipc"
  | "chat-render"
  | "trace-store"
  | "ssh"
  | "build"
  | "benchmark"
  | "sessions-ipc";

export type PerfEventPhase =
  | "mark"
  | "measure"
  | "summary"
  | "span"
  | "memory";

export interface PerfTelemetryConfig {
  enabled: boolean;
  runId?: string;
  sampleEvery?: number;
}

export interface RendererPerfEvent {
  scope: PerfScope;
  name: string;
  phase?: PerfEventPhase;
  nowMs?: number;
  timeOriginMs?: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

export interface MainPerfEvent extends RendererPerfEvent {
  ts?: string;
  ok?: boolean;
  error?: string;
  source?: "main" | "renderer";
}

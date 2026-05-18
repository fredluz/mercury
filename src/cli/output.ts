import type { CliConnectionMode, CliContext } from "./context";
import type { NormalizedCliError } from "./errors";

export interface CliWarning {
  code: string;
  message: string;
}

export interface CliSuccess<T> {
  ok: true;
  command: string;
  profile?: string;
  mode?: CliConnectionMode;
  data: T;
  warnings?: CliWarning[];
}

export interface CliErrorEnvelope {
  ok: false;
  command: string;
  profile?: string;
  mode?: CliConnectionMode;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type CliStreamEvent =
  | { type: "start"; command: string; profile?: string; ts: number }
  | { type: "chunk"; text: string; ts: number }
  | { type: "trace"; event: unknown; ts: number }
  | { type: "tool"; text: string; ts: number }
  | { type: "usage"; usage: unknown; ts: number }
  | { type: "progress"; progress: unknown; ts: number }
  | { type: "done"; data: unknown; ts: number }
  | { type: "error"; error: { code: string; message: string; details?: unknown }; ts: number };

export function successEnvelope<T>(
  command: string,
  context: CliContext,
  data: T,
  warnings?: CliWarning[],
): CliSuccess<T> {
  return {
    ok: true,
    command,
    profile: context.profile,
    mode: context.connectionMode,
    data,
    warnings: warnings && warnings.length > 0 ? warnings : undefined,
  };
}

export function errorEnvelope(
  command: string,
  context: Pick<CliContext, "profile" | "connectionMode">,
  error: NormalizedCliError,
): CliErrorEnvelope {
  return {
    ok: false,
    command,
    profile: context.profile,
    mode: context.connectionMode,
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  };
}

export function formatJsonSuccess<T>(envelope: CliSuccess<T>): string {
  return JSON.stringify(envelope);
}

export function formatJsonError(envelope: CliErrorEnvelope): string {
  return JSON.stringify(envelope);
}

export function formatNdjsonEvent(event: CliStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function formatNdjsonError(envelope: CliErrorEnvelope, ts = Date.now()): string {
  return formatNdjsonEvent({ type: "error", error: envelope.error, ts });
}

export function renderTextSuccess(data: unknown): string {
  if (typeof data === "string") return data;
  if (data === undefined) return "";
  return JSON.stringify(data, null, 2);
}

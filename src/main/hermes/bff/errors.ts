import type { HermesBffFamily } from "./types";

export type HermesBffErrorCode =
  | "http-error"
  | "network-error"
  | "timeout"
  | "invalid-json"
  | "malformed-response"
  | "aborted"
  | "sse-error";

export interface HermesBffErrorInit {
  code: HermesBffErrorCode;
  family: HermesBffFamily;
  method: string;
  path: string;
  profile: string;
  requestId: string;
  statusCode?: number;
  retryable?: boolean;
  responsePreview?: string;
  cause?: unknown;
}

const MAX_PREVIEW_LENGTH = 800;

const SECRET_PATTERNS: RegExp[] = [
  /(authorization\s*[:=]\s*)[^"'\n\r,}]*/gi,
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/gi,
  /((?:api[_-]?key|token|secret|password)\s*["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
];

export class HermesBffError extends Error {
  readonly code: HermesBffErrorCode;
  readonly family: HermesBffFamily;
  readonly method: string;
  readonly path: string;
  readonly profile: string;
  readonly requestId: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly responsePreview?: string;

  constructor(message: string, init: HermesBffErrorInit) {
    super(message, { cause: init.cause });
    this.name = "HermesBffError";
    this.code = init.code;
    this.family = init.family;
    this.method = init.method;
    this.path = init.path;
    this.profile = init.profile;
    this.requestId = init.requestId;
    this.statusCode = init.statusCode;
    this.retryable = init.retryable ?? false;
    this.responsePreview = init.responsePreview
      ? redactDiagnosticValue(init.responsePreview)
      : undefined;
  }
}

export function responsePreview(raw: string, limit = MAX_PREVIEW_LENGTH): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const capped = trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed;
  return redactDiagnosticValue(capped);
}

export function redactDiagnosticValue(value: string): string {
  let redacted = value;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (_match, prefix: string | undefined) => {
      if (typeof prefix === "string" && prefix.length > 0) return `${prefix}[REDACTED]`;
      return "[REDACTED]";
    });
  }
  return redacted;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

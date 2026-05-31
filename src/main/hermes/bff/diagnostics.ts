import { appendFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { HermesBffErrorCode } from "./errors";
import { redactDiagnosticValue } from "./errors";
import type { HermesBffFamily } from "./types";

export interface HermesBffDiagnosticRecord {
  scope: "hermes-bff";
  requestId: string;
  family: HermesBffFamily;
  method: string;
  path: string;
  profile: string;
  transport: "api" | "ssh-api";
  apiBaseUrl?: string;
  runtimeAuthFingerprint?: string;
  statusCode?: number;
  ok: boolean;
  retryCount: number;
  durationMs: number;
  errorCode?: HermesBffErrorCode;
  errorMessage?: string;
  responsePreview?: string;
  runId?: string;
  sessionId?: string;
  jobId?: string;
  ts: string;
}

const MAX_RECORDS = 200;
const records: HermesBffDiagnosticRecord[] = [];

export function recordHermesBffDiagnostic(record: HermesBffDiagnosticRecord): void {
  const sanitized = sanitizeRecord(record);
  records.push(sanitized);
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);

  if (process.env.MERCURY_BFF_DIAG === "1") {
    const path = process.env.MERCURY_BFF_DIAG_FILE || join(tmpdir(), "mercury-bff-diag.ndjson");
    try {
      appendFileSync(path, `${JSON.stringify(sanitized)}\n`, "utf8");
    } catch {
      // Diagnostics must never affect runtime behavior.
    }
  }
}

export function getHermesBffDiagnostics(): HermesBffDiagnosticRecord[] {
  return [...records];
}

export function clearHermesBffDiagnostics(): void {
  records.splice(0, records.length);
}

function sanitizeRecord(record: HermesBffDiagnosticRecord): HermesBffDiagnosticRecord {
  return {
    ...record,
    apiBaseUrl: record.apiBaseUrl ? redactDiagnosticValue(record.apiBaseUrl) : undefined,
    runtimeAuthFingerprint: record.runtimeAuthFingerprint
      ? redactDiagnosticValue(record.runtimeAuthFingerprint)
      : undefined,
    errorMessage: record.errorMessage ? redactDiagnosticValue(record.errorMessage) : undefined,
    responsePreview: record.responsePreview
      ? redactDiagnosticValue(record.responsePreview)
      : undefined,
  };
}

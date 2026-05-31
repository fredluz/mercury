import type { ClientRequest } from "http";
import type { ProfileHermesBffClient } from "./client";
import type { JsonRecord } from "./types";

const RUN_REQUEST_TIMEOUT_MS = 120_000;

export type RunApprovalChoice =
  | "once"
  | "session"
  | "always"
  | "deny"
  | "approve"
  | "approved"
  | "allow"
  | "reject";

export interface RunApprovalRequest {
  choice: RunApprovalChoice;
  all?: boolean;
  resolveAll?: boolean;
}

export interface RunApprovalResponse {
  runId: string;
  choice: string;
  resolved: number;
}

export interface SubmittedRun {
  runId: string;
  sessionId?: string;
  raw: JsonRecord;
}

export interface RunRequestOptions {
  signal?: AbortSignal;
  setActiveRequest?: (request: ClientRequest | undefined) => void;
}

export class HermesRunsBffClient {
  constructor(private readonly client: ProfileHermesBffClient) {}

  async submit(
    body: JsonRecord,
    options: RunRequestOptions = {},
  ): Promise<SubmittedRun> {
    const payload = await this.client.json<JsonRecord>({
      family: "runs",
      method: "POST",
      path: "/v1/runs",
      body,
      expectedStatuses: [200, 202],
      signal: options.signal,
      setActiveRequest: options.setActiveRequest,
      timeoutMs: RUN_REQUEST_TIMEOUT_MS,
      retry: "none",
    });
    const runId =
      stringField(payload, "run_id") ?? stringField(payload, "runId");
    if (!runId)
      throw new Error(
        "Hermes run submission response did not include a run id.",
      );
    return {
      runId,
      sessionId:
        stringField(payload, "session_id") ?? stringField(payload, "sessionId"),
      raw: payload,
    };
  }

  async streamEvents<TEvent = unknown>(
    runId: string,
    options: RunRequestOptions & {
      onEvent: (event: TEvent) => void | Promise<void>;
    },
  ): Promise<void> {
    await this.client.sse<TEvent>({
      family: "runs",
      path: `/v1/runs/${encodeURIComponent(runId)}/events`,
      runId,
      signal: options.signal,
      setActiveRequest: options.setActiveRequest,
      timeoutMs: RUN_REQUEST_TIMEOUT_MS,
      onEvent: options.onEvent,
    });
  }

  getStatus(
    runId: string,
    options: RunRequestOptions = {},
  ): Promise<JsonRecord> {
    return this.client.json<JsonRecord>({
      family: "runs",
      method: "GET",
      path: `/v1/runs/${encodeURIComponent(runId)}`,
      runId,
      signal: options.signal,
      setActiveRequest: options.setActiveRequest,
      timeoutMs: RUN_REQUEST_TIMEOUT_MS,
    });
  }

  async stop(runId: string, options: RunRequestOptions = {}): Promise<void> {
    await this.client.json({
      family: "runs",
      method: "POST",
      path: `/v1/runs/${encodeURIComponent(runId)}/stop`,
      body: {},
      expectedStatuses: [200, 202, 204],
      runId,
      signal: options.signal,
      setActiveRequest: options.setActiveRequest,
      timeoutMs: RUN_REQUEST_TIMEOUT_MS,
      retry: "none",
    });
  }

  async resolveApproval(
    runId: string,
    request: RunApprovalRequest,
    options: RunRequestOptions = {},
  ): Promise<RunApprovalResponse> {
    const payload = await this.client.json<JsonRecord>({
      family: "runs",
      method: "POST",
      path: `/v1/runs/${encodeURIComponent(runId)}/approval`,
      body: {
        choice: request.choice,
        all: request.all === true,
        resolve_all: request.resolveAll === true,
      },
      expectedStatuses: [200],
      runId,
      signal: options.signal,
      setActiveRequest: options.setActiveRequest,
      timeoutMs: RUN_REQUEST_TIMEOUT_MS,
      retry: "none",
    });
    return {
      runId:
        stringField(payload, "run_id") ??
        stringField(payload, "runId") ??
        runId,
      choice: stringField(payload, "choice") ?? request.choice,
      resolved: numberField(payload, "resolved") ?? 0,
    };
  }
}

function stringField(record: JsonRecord, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(record: JsonRecord, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

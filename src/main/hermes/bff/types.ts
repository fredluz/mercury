import type { ClientRequest } from "http";
import type { RuntimePurpose } from "../types";

export type JsonRecord = Record<string, unknown>;

export type HermesBffFamily =
  | "runs"
  | "sessions"
  | "jobs"
  | "models"
  | "capabilities"
  | "health";

export type HermesBffHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type HermesBffRetryPolicy = "none" | "transient-once";

export interface HermesBffRequestContext {
  family: HermesBffFamily;
  runId?: string;
  sessionId?: string;
  jobId?: string;
}

export interface HermesBffJsonRequest<TBody = unknown> extends HermesBffRequestContext {
  method: HermesBffHttpMethod;
  path: string;
  body?: TBody;
  expectedStatuses?: number[];
  timeoutMs?: number;
  signal?: AbortSignal;
  retry?: HermesBffRetryPolicy;
  requestId?: string;
  headers?: Record<string, string>;
  setActiveRequest?: (request: ClientRequest | undefined) => void;
}

export interface HermesBffSseRequest<TEvent = unknown> extends HermesBffRequestContext {
  method?: "GET";
  path: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  requestId?: string;
  headers?: Record<string, string>;
  setActiveRequest?: (request: ClientRequest | undefined) => void;
  onEvent: (event: TEvent) => void | Promise<void>;
}

export interface HermesBffClientDeps {
  requestId?: () => string;
  now?: () => number;
}

export interface VerifiedRuntimeBffOptions {
  expectedProfile: string;
  purpose: RuntimePurpose;
}

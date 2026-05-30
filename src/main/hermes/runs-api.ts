import http from "http";
import https from "https";
import type { ClientRequest, IncomingMessage } from "http";
import { resolveChatRuntimeModel } from "./chat-model";
import { hermesRunRegistry } from "./run-registry";
import type {
  ChatCallbacks,
  ChatHandle,
  ChatTraceCallbackEvent,
  ProfileRuntimeHandle,
} from "./types";
import {
  assertVerifiedApiRuntimeHandle,
  type VerifiedApiRuntimeHandle,
} from "./runtime/api-runtime";
import {
  detectCodexAuthRecovery,
  type ChatErrorInfo,
} from "../../shared/codex-auth-recovery";
import { classifyChatRemediation } from "../../shared/chat-remediation";

type JsonRecord = Record<string, unknown>;

type RunEventPayload = JsonRecord & {
  event?: string;
  run_id?: string;
  delta?: string;
  output?: string;
  error?: unknown;
  session_id?: string;
  usage?: JsonRecord;
};

type SubmittedRun = {
  runId: string;
  sessionId?: string;
};

class HermesApiRequestError extends Error {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = "HermesApiRequestError";
    this.statusCode = statusCode;
  }
}

export type RunApprovalChoice =
  | "once"
  | "session"
  | "always"
  | "deny"
  | "approve"
  | "approved"
  | "allow";

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

export function sendMessageViaRunsApi(
  message: string,
  cb: ChatCallbacks,
  profile: string | undefined,
  resumeSessionId: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  runtime: ProfileRuntimeHandle,
): ChatHandle {
  const expectedProfile =
    profile?.trim() || runtime?.request.profile || "default";
  assertVerifiedApiRuntimeHandle(runtime, expectedProfile, "chat");

  const controller = new AbortController();
  let activeRunId: string | undefined;
  let activeRequest: ClientRequest | undefined;
  let finished = false;

  const finish = (error?: string, info?: ChatErrorInfo): void => {
    if (finished) return;
    finished = true;
    if (error) cb.onError(error, info);
  };

  const execute = async (): Promise<void> => {
    if (controller.signal.aborted) return;
    await sendMessageViaVerifiedRunsApi(
      message,
      cb,
      expectedProfile,
      resumeSessionId,
      history,
      runtime as VerifiedApiRuntimeHandle,
      controller.signal,
      (req) => {
        activeRequest = req;
      },
      (runId) => {
        activeRunId = runId;
      },
    );
  };

  hermesRunRegistry.schedule(execute, controller.signal).catch((error) => {
    if (controller.signal.aborted) return;
    const message =
      error instanceof Error ? error.message : "Hermes run failed to start.";
    finish(message, buildErrorInfo(message, expectedProfile));
  });

  return {
    abort: () => {
      controller.abort();
      activeRequest?.destroy();
      if (activeRunId) {
        void postRunStop(runtime as VerifiedApiRuntimeHandle, activeRunId).catch(
          () => undefined,
        );
      }
    },
  };
}

async function sendMessageViaVerifiedRunsApi(
  message: string,
  cb: ChatCallbacks,
  profile: string,
  resumeSessionId: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  runtime: VerifiedApiRuntimeHandle,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
  setActiveRunId: (runId: string) => void,
): Promise<void> {
  const mc = await resolveChatRuntimeModel(profile);
  const requestShape = {
    input: "string",
    model: mc.model || "hermes-agent",
    session_id: resumeSessionId ? "present" : "absent",
    conversation_history_count: history?.length ?? 0,
  };
  let submitted: SubmittedRun;
  try {
    submitted = await submitRunWithRetry(
      runtime,
      {
        input: message,
        model: mc.model || "hermes-agent",
        session_id: resumeSessionId,
        conversation_history: normalizeHistory(history),
      },
      signal,
      setActiveRequest,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    cb.onError(
      errorMessage,
      buildErrorInfo(errorMessage, profile, {
        provider: mc.provider,
        model: mc.model,
        source: "run_submission",
        sessionId: resumeSessionId,
        requestShape,
      }),
    );
    return;
  }
  setActiveRunId(submitted.runId);
  await streamRunEvents(
    runtime,
    submitted.runId,
    submitted.sessionId || resumeSessionId,
    cb,
    profile,
    mc.provider,
    mc.model,
    signal,
    setActiveRequest,
  );
}

async function submitRunWithRetry(
  runtime: VerifiedApiRuntimeHandle,
  body: JsonRecord,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
): Promise<SubmittedRun> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await submitRun(runtime, body, signal, setActiveRequest);
    } catch (error) {
      lastError = error;
      if (!isRunCapError(error) || signal.aborted || attempt === 2) break;
      await delay(250 * (attempt + 1), signal);
    }
  }
  throw lastError;
}

function isRunCapError(error: unknown): boolean {
  if (error instanceof HermesApiRequestError && error.statusCode === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /rate[_ -]?limit|too many concurrent|concurrent runs|API error 429/i.test(message);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Run was aborted before retry."));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Run was aborted before retry."));
      },
      { once: true },
    );
  });
}

function normalizeHistory(
  history: Array<{ role: string; content: string }> | undefined,
): Array<{ role: string; content: string }> | undefined {
  const normalized = (history ?? [])
    .filter((msg) => msg.content.trim())
    .map((msg) => ({
      role: msg.role === "agent" ? "assistant" : msg.role,
      content: msg.content,
    }));
  return normalized.length > 0 ? normalized : undefined;
}

async function submitRun(
  runtime: VerifiedApiRuntimeHandle,
  body: JsonRecord,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
): Promise<SubmittedRun> {
  const result = await requestJson(runtime, "/v1/runs", {
    method: "POST",
    body,
    signal,
    setActiveRequest,
    expectedStatuses: [200, 202],
  });
  const runId = stringField(result, "run_id");
  if (!runId) throw new Error("Hermes run submission did not return run_id.");
  return { runId, sessionId: stringField(result, "session_id") };
}

async function streamRunEvents(
  runtime: VerifiedApiRuntimeHandle,
  runId: string,
  sessionId: string | undefined,
  cb: ChatCallbacks,
  profile: string,
  provider: string | undefined,
  model: string | undefined,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
): Promise<void> {
  let output = "";
  let terminal = false;

  const finishDone = (doneSessionId?: string): void => {
    if (terminal) return;
    terminal = true;
    cb.onDone(doneSessionId || sessionId);
  };
  const finishError = (error: string): void => {
    if (terminal) return;
    terminal = true;
    cb.onError(
      error,
      buildErrorInfo(error, profile, {
        provider,
        model,
        source: "run_failed",
        runId,
        sessionId,
      }),
    );
  };

  await requestSse(
    runtime,
    `/v1/runs/${encodeURIComponent(runId)}/events`,
    signal,
    setActiveRequest,
    async (payload) => {
      if (payload.run_id && payload.run_id !== runId) return;
      const event = payload.event;
      if (!event) return;
      if (event === "message.delta") {
        const delta = typeof payload.delta === "string" ? payload.delta : "";
        if (delta) {
          output += delta;
          cb.onChunk(delta);
        }
        return;
      }
      if (event === "run.completed") {
        const finalOutput =
          typeof payload.output === "string" ? payload.output : "";
        if (!output && finalOutput) cb.onChunk(finalOutput);
        emitUsage(cb, payload.usage);
        finishDone(stringField(payload, "session_id"));
        return;
      }
      if (event === "run.failed") {
        finishError(errorMessage(payload.error) || "Hermes run failed.");
        return;
      }
      if (event === "run.cancelled") {
        finishError("Hermes run was cancelled.");
        return;
      }
      const traceEvent = traceEventFromRunEvent(event, payload);
      if (traceEvent) cb.onTraceEvent?.(traceEvent);
      if (event === "tool.started") {
        const tool = stringField(payload, "tool") || "tool";
        cb.onToolProgress?.(tool);
      }
    },
  );

  if (!terminal && !signal.aborted) {
    const status = await requestJson(
      runtime,
      `/v1/runs/${encodeURIComponent(runId)}`,
      { method: "GET", signal, setActiveRequest, expectedStatuses: [200] },
    );
    const statusText = stringField(status, "status");
    if (statusText === "completed") {
      const finalOutput = stringField(status, "output");
      if (!output && finalOutput) cb.onChunk(finalOutput);
      emitUsage(cb, isRecord(status.usage) ? status.usage : undefined);
      finishDone(stringField(status, "session_id"));
    } else if (statusText === "failed") {
      finishError(errorMessage(status.error) || "Hermes run failed.");
    } else if (statusText === "cancelled") {
      finishError("Hermes run was cancelled.");
    } else {
      finishError(`Hermes run ended before a terminal event (${statusText || "unknown"}).`);
    }
  }
}

function requestJson(
  runtime: VerifiedApiRuntimeHandle,
  path: string,
  options: {
    method: "GET" | "POST";
    body?: JsonRecord;
    signal?: AbortSignal;
    setActiveRequest?: (req: ClientRequest | undefined) => void;
    expectedStatuses: number[];
  },
): Promise<JsonRecord> {
  return new Promise((resolve, reject) => {
    const url = `${runtime.apiBaseUrl}${path}`;
    const requester = url.startsWith("https") ? https : http;
    const req = requester.request(
      url,
      {
        method: options.method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(runtime.authHeaders ?? {}),
        },
        signal: options.signal,
        timeout: 120_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          options.setActiveRequest?.(undefined);
          if (!options.expectedStatuses.includes(res.statusCode || 0)) {
            reject(
              new HermesApiRequestError(
                parseApiError(raw) || `API error ${res.statusCode}`,
                res.statusCode,
              ),
            );
            return;
          }
          try {
            const parsed = raw ? JSON.parse(raw) : {};
            if (!isRecord(parsed)) {
              reject(new Error("Hermes API returned a non-object JSON payload."));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    options.setActiveRequest?.(req);
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Hermes API request timed out."));
    });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function requestSse(
  runtime: VerifiedApiRuntimeHandle,
  path: string,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
  onEvent: (payload: RunEventPayload) => Promise<void> | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${runtime.apiBaseUrl}${path}`;
    const requester = url.startsWith("https") ? https : http;
    const req = requester.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(runtime.authHeaders ?? {}),
        },
        signal,
        timeout: 120_000,
      },
      (res: IncomingMessage) => {
        if (res.statusCode !== 200) {
          let raw = "";
          res.on("data", (chunk) => {
            raw += chunk.toString();
          });
          res.on("end", () => {
            setActiveRequest(undefined);
            reject(
              new HermesApiRequestError(
                parseApiError(raw) || `API error ${res.statusCode}`,
                res.statusCode,
              ),
            );
          });
          return;
        }

        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() || "";
          for (const block of blocks) processSseBlock(block, onEvent);
        });
        res.on("end", () => {
          if (buffer.trim()) processSseBlock(buffer, onEvent);
          setActiveRequest(undefined);
          resolve();
        });
        res.on("error", reject);
      },
    );
    setActiveRequest(req);
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Hermes run event stream timed out."));
    });
    req.end();
  });
}

function processSseBlock(
  block: string,
  onEvent: (payload: RunEventPayload) => Promise<void> | void,
): void {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return;
  try {
    const parsed = JSON.parse(dataLines.join("\n"));
    if (isRecord(parsed)) void onEvent(parsed as RunEventPayload);
  } catch {
    /* Ignore malformed stream payloads. */
  }
}

async function postRunStop(
  runtime: VerifiedApiRuntimeHandle,
  runId: string,
): Promise<void> {
  await requestJson(runtime, `/v1/runs/${encodeURIComponent(runId)}/stop`, {
    method: "POST",
    expectedStatuses: [200, 202],
  });
}

export async function resolveRunApproval(
  runtime: ProfileRuntimeHandle,
  runId: string,
  request: RunApprovalRequest,
): Promise<RunApprovalResponse> {
  const expectedProfile = runtime.request.profile || "default";
  assertVerifiedApiRuntimeHandle(runtime, expectedProfile, "chat");
  const cleanRunId = runId.trim();
  if (!cleanRunId) throw new Error("runId is required.");
  if (!isRunApprovalChoice(request.choice)) {
    throw new Error("Invalid Hermes run approval choice.");
  }

  const result = await requestJson(
    runtime as VerifiedApiRuntimeHandle,
    `/v1/runs/${encodeURIComponent(cleanRunId)}/approval`,
    {
      method: "POST",
      body: {
        choice: request.choice,
        all: request.all === true,
        resolve_all: request.resolveAll === true,
      },
      expectedStatuses: [200],
    },
  );

  return {
    runId: stringField(result, "run_id") || cleanRunId,
    choice: stringField(result, "choice") || request.choice,
    resolved: numberField(result, "resolved") ?? 0,
  };
}

function isRunApprovalChoice(value: unknown): value is RunApprovalChoice {
  return (
    value === "once" ||
    value === "session" ||
    value === "always" ||
    value === "deny" ||
    value === "approve" ||
    value === "approved" ||
    value === "allow"
  );
}

function traceEventFromRunEvent(
  event: string,
  payload: RunEventPayload,
): ChatTraceCallbackEvent | undefined {
  const metadata = sanitizeRunMetadata({ ...payload, streamEvent: event });
  if (event === "tool.started") {
    return {
      type: "tool.started",
      title: "Tool started",
      detail: stringField(payload, "preview") || stringField(payload, "tool"),
      metadata,
    };
  }
  if (event === "tool.completed") {
    return {
      type: payload.error ? "tool.failed" : "tool.completed",
      title: payload.error ? "Tool failed" : "Tool completed",
      detail: stringField(payload, "tool"),
      metadata,
    };
  }
  if (event === "reasoning.available") {
    return {
      type: "tool.progress",
      title: "Reasoning available",
      detail: stringField(payload, "text"),
      metadata,
    };
  }
  if (event === "approval.request") {
    return {
      type: "approval.requested",
      title: "Approval requested",
      detail: stringField(payload, "prompt") || stringField(payload, "tool"),
      metadata,
    };
  }
  if (event === "approval.responded") {
    return {
      type: "approval.resolved",
      title: "Approval resolved",
      detail: stringField(payload, "choice"),
      metadata,
    };
  }
  return undefined;
}

function emitUsage(cb: ChatCallbacks, usage: unknown): void {
  if (!cb.onUsage || !isRecord(usage)) return;
  const promptTokens = numberField(usage, "prompt_tokens") ?? numberField(usage, "input_tokens") ?? 0;
  const completionTokens = numberField(usage, "completion_tokens") ?? numberField(usage, "output_tokens") ?? 0;
  const totalTokens = numberField(usage, "total_tokens") ?? promptTokens + completionTokens;
  cb.onUsage({
    promptTokens,
    completionTokens,
    totalTokens,
    cost: numberField(usage, "cost"),
    rateLimitRemaining: numberField(usage, "rate_limit_remaining"),
    rateLimitReset: numberField(usage, "rate_limit_reset"),
  });
}

function parseApiError(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return errorMessage(parsed.error) || "";
  } catch {
    return raw.slice(0, 200);
  }
}

function buildErrorInfo(
  error: string,
  profile: string,
  context?: {
    provider?: string;
    model?: string;
    source?: "run_submission" | "run_failed" | "run_status" | "transport";
    runId?: string;
    sessionId?: string;
    requestShape?: Record<string, unknown>;
  },
): ChatErrorInfo | undefined {
  const codex = detectCodexAuthRecovery({
    error,
    provider: context?.provider,
    profile,
  });
  const remediation = classifyChatRemediation({
    source: context?.source || "transport",
    error,
    profile,
    provider: context?.provider,
    model: context?.model,
    runId: context?.runId,
    sessionId: context?.sessionId,
    requestShape: context?.requestShape,
  });
  if (!codex && !remediation) return undefined;
  return {
    ...codex,
    remediation,
  };
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return "";
}

function stringField(record: unknown, field: string): string | undefined {
  if (!isRecord(record)) return undefined;
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(record: JsonRecord, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeRunMetadata(value: JsonRecord): JsonRecord {
  const metadata: JsonRecord = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/api[_-]?key|token|authorization|secret|password|credential/i.test(key)) {
      continue;
    }
    metadata[key] = raw;
  }
  return metadata;
}

import type { ClientRequest } from "http";
import { resolveChatRuntimeModel } from "./chat-model";
import { profileHermesBffClientForRuntime, HermesBffError } from "./bff";
import type { HermesRunsBffClient } from "./bff";
import { hermesRunRegistry } from "./run-registry";
import { chatSessionActivityTracker } from "./session-activity";
import type {
  ChatCallbacks,
  ChatHandle,
  ChatTraceCallbackEvent,
  ProfileRuntimeHandle,
} from "./types";
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
  const bff = profileHermesBffClientForRuntime(
    runtime,
    expectedProfile,
    "chat",
  );

  const controller = new AbortController();
  const activityToken = chatSessionActivityTracker.beginRun({
    profile: expectedProfile,
    sessionId: resumeSessionId,
    status: "queued",
  });
  let activeRunId: string | undefined;
  let activeRequest: ClientRequest | undefined;
  let finished = false;
  let activityFinished = false;

  const finishActivity = (): void => {
    if (activityFinished) return;
    activityFinished = true;
    chatSessionActivityTracker.finishRun(activityToken);
  };

  const finish = (error?: string, info?: ChatErrorInfo): void => {
    if (finished) return;
    finished = true;
    finishActivity();
    if (error) cb.onError(error, info);
  };

  const execute = async (): Promise<void> => {
    if (controller.signal.aborted) return;
    try {
      await sendMessageViaVerifiedRunsApi(
        message,
        cb,
        expectedProfile,
        resumeSessionId,
        history,
        bff.runs,
        controller.signal,
        (req) => {
          activeRequest = req;
        },
        (runId) => {
          activeRunId = runId;
        },
        activityToken,
      );
    } finally {
      finishActivity();
    }
  };

  hermesRunRegistry.schedule(execute, controller.signal).catch((error) => {
    if (controller.signal.aborted) {
      finishActivity();
      return;
    }
    const message =
      error instanceof Error ? error.message : "Hermes run failed to start.";
    finish(message, buildErrorInfo(message, expectedProfile));
  });

  return {
    abort: () => {
      controller.abort();
      if (activeRunId) chatSessionActivityTracker.markStopping(activityToken);
      activeRequest?.destroy();
      if (activeRunId) {
        void postRunStop(bff.runs, activeRunId).catch(() => undefined);
      }
      finishActivity();
    },
  };
}

async function sendMessageViaVerifiedRunsApi(
  message: string,
  cb: ChatCallbacks,
  profile: string,
  resumeSessionId: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  runs: HermesRunsBffClient,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
  setActiveRunId: (runId: string) => void,
  activityToken: string,
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
      runs,
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
    const errorMessage = transportErrorMessage(error);
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
  chatSessionActivityTracker.attachRun({
    token: activityToken,
    runId: submitted.runId,
    sessionId: submitted.sessionId || resumeSessionId,
  });
  await streamRunEvents(
    runs,
    submitted.runId,
    submitted.sessionId || resumeSessionId,
    cb,
    profile,
    mc.provider,
    mc.model,
    signal,
    setActiveRequest,
    activityToken,
  );
}

async function submitRunWithRetry(
  runs: HermesRunsBffClient,
  body: JsonRecord,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
): Promise<SubmittedRun> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await submitRun(runs, body, signal, setActiveRequest);
    } catch (error) {
      lastError = error;
      if (!isRunCapError(error) || signal.aborted || attempt === 2) break;
      await delay(250 * (attempt + 1), signal);
    }
  }
  throw lastError;
}

function isRunCapError(error: unknown): boolean {
  if (statusCodeField(error) === 429) return true;
  const message = transportErrorMessage(error);
  return /rate[_ -]?limit|too many concurrent|concurrent runs|API error 429/i.test(
    message,
  );
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
  runs: HermesRunsBffClient,
  body: JsonRecord,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
): Promise<SubmittedRun> {
  return runs.submit(body, { signal, setActiveRequest });
}

async function streamRunEvents(
  runs: HermesRunsBffClient,
  runId: string,
  sessionId: string | undefined,
  cb: ChatCallbacks,
  profile: string,
  provider: string | undefined,
  model: string | undefined,
  signal: AbortSignal,
  setActiveRequest: (req: ClientRequest | undefined) => void,
  activityToken: string,
): Promise<void> {
  let output = "";
  let terminal = false;

  const finishDone = (doneSessionId?: string): void => {
    if (terminal) return;
    terminal = true;
    cb.onDone(doneSessionId || sessionId);
  };
  const reportError = (
    error: string,
    source: "run_failed" | "run_status" | "transport",
  ): void => {
    if (terminal) return;
    terminal = true;
    cb.onError(
      error,
      buildErrorInfo(error, profile, {
        provider,
        model,
        source,
        runId,
        sessionId,
      }),
    );
  };
  const finishError = (error: string): void => {
    reportError(error, "run_failed");
  };
  const finishTransportError = (
    error: unknown,
    source: "run_status" | "transport",
  ): void => {
    reportError(transportErrorMessage(error), source);
  };

  try {
    chatSessionActivityTracker.markRunning(activityToken);
    await runs.streamEvents<RunEventPayload>(runId, {
      signal,
      setActiveRequest,
      onEvent: async (payload) => {
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
    });
  } catch (error) {
    if (!signal.aborted) finishTransportError(error, "transport");
    return;
  }

  if (!terminal && !signal.aborted) {
    let status: JsonRecord;
    try {
      status = await runs.getStatus(runId, { signal, setActiveRequest });
    } catch (error) {
      if (!signal.aborted) finishTransportError(error, "run_status");
      return;
    }
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
      finishError(
        `Hermes run ended before a terminal event (${statusText || "unknown"}).`,
      );
    }
  }
}

async function postRunStop(
  runs: HermesRunsBffClient,
  runId: string,
): Promise<void> {
  await runs.stop(runId);
}

export async function resolveRunApproval(
  runtime: ProfileRuntimeHandle,
  runId: string,
  request: RunApprovalRequest,
): Promise<RunApprovalResponse> {
  const expectedProfile = runtime.request.profile || "default";
  const cleanRunId = runId.trim();
  if (!cleanRunId) throw new Error("runId is required.");
  if (!isRunApprovalChoice(request.choice)) {
    throw new Error("Invalid Hermes run approval choice.");
  }

  const bff = profileHermesBffClientForRuntime(
    runtime,
    expectedProfile,
    "chat",
  );
  return bff.runs.resolveApproval(cleanRunId, request);
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
  const promptTokens =
    numberField(usage, "prompt_tokens") ??
    numberField(usage, "input_tokens") ??
    0;
  const completionTokens =
    numberField(usage, "completion_tokens") ??
    numberField(usage, "output_tokens") ??
    0;
  const totalTokens =
    numberField(usage, "total_tokens") ?? promptTokens + completionTokens;
  cb.onUsage({
    promptTokens,
    completionTokens,
    totalTokens,
    cost: numberField(usage, "cost"),
    rateLimitRemaining: numberField(usage, "rate_limit_remaining"),
    rateLimitReset: numberField(usage, "rate_limit_reset"),
  });
}

function transportErrorMessage(error: unknown): string {
  if (error instanceof HermesBffError) {
    const apiMessage = parseApiError(error.responsePreview || "");
    if (apiMessage) return apiMessage;
  }
  return error instanceof Error ? error.message : String(error);
}

function statusCodeField(error: unknown): number | undefined {
  if (error instanceof HermesBffError) return error.statusCode;
  if (!isRecord(error)) return undefined;
  const statusCode = error.statusCode;
  return typeof statusCode === "number" && Number.isFinite(statusCode)
    ? statusCode
    : undefined;
}

function parseApiError(raw: string): string {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw);
    return errorMessage(parsed.error) || stringField(parsed, "message") || "";
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
  if (isRecord(value) && typeof value.message === "string")
    return value.message;
  return "";
}

function stringField(record: unknown, field: string): string | undefined {
  if (!isRecord(record)) return undefined;
  const value = record[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(record: JsonRecord, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeRunMetadata(value: JsonRecord): JsonRecord {
  const metadata: JsonRecord = {};
  for (const [key, raw] of Object.entries(value)) {
    if (
      /api[_-]?key|token|authorization|secret|password|credential/i.test(key)
    ) {
      continue;
    }
    metadata[key] = raw;
  }
  return metadata;
}

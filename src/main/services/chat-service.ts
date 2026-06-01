import {
  sendMessage,
  startGateway,
  isGatewayRunning,
  stopGateway,
  getRuntimeIdentity,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  isRemoteMode,
} from "../hermes";
import { extractArtifactEventsFromText } from "../hermes/trace-events";
import type {
  ChatCallbacks,
  ChatTransportDiagnostic,
  ChatTraceCallbackEvent,
  ProfileRuntimeHandle,
} from "../hermes/types";
import { profileRuntimeManager } from "../hermes/runtime";
import { startSshTunnel, isSshTunnelHealthy } from "../ssh-tunnel";
import { getConnectionConfig } from "../config";
import {
  createTraceRun,
  finishTraceRun,
  recordTraceEvent,
  recordTraceUsage,
} from "../trace-store";
import {
  sshGatewayStatus,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "../ssh-remote";
import {
  updateSessionProfile,
  updateSessionTitle,
  projectCachedSession,
} from "../session-cache";
import {
  cachedSessionFromServerSession,
  createHermesSession,
  readHermesSession,
} from "./hermes-sessions-api";
import {
  resolveRunApproval,
  type RunApprovalChoice,
  type RunApprovalResponse,
} from "../hermes/runs-api";
import { generateChatTitle as resolveChatTitle } from "../hermes/title";
import { isSyntheticChatStreamEnabled } from "../hermes/synthetic-chat";
import type { ChatErrorInfo } from "../../shared/codex-auth-recovery";
import type { AgentChatOptions, AgentDraftChangeEvent } from "../../shared/agents";
import type { TraceEvent, TraceEventType, TraceUsage } from "../../shared/traces";
import {
  normalizeGenerateChatTitleRequest,
  type GenerateChatTitleRequest,
} from "../../shared/chat-metadata";
import { classifyChatRemediation } from "../../shared/chat-remediation";
import { updateAgentDraft } from "./agents-service";

export type ChatResponse = { response: string; sessionId?: string };

type ActiveChatRun = {
  runToken: string;
  traceRunId?: string;
  abort: () => void;
  settleAbort: () => void;
};

export interface RunChatRequest {
  message: string;
  profile?: string;
  resumeSessionId?: string;
  history?: Array<{ role: string; content: string }>;
  callbacks?: ChatServiceCallbacks;
  options?: AgentChatOptions;
}

export interface ChatServiceCallbacks {
  onChunk?: (chunk: string) => void;
  onDone?: (sessionId?: string) => void;
  onError?: (error: string, info?: ChatErrorInfo) => void;
  onLiveTraceEvent?: (event: TraceEvent) => void;
  onAgentDraftChanged?: (event: AgentDraftChangeEvent) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: TraceUsage) => void;
  onCompleted?: (result: ChatResponse & { durationMs: number }) => void;
  onFailed?: (error: string) => void;
}

export interface ResolveChatRunApprovalRequest {
  runId: string;
  choice: RunApprovalChoice;
  profile?: string;
  all?: boolean;
  resolveAll?: boolean;
}

let activeChatRun: ActiveChatRun | null = null;

function isLiveChatActivityEvent(type: TraceEventType): boolean {
  return (
    type.startsWith("tool.") ||
    type.startsWith("delegation.") ||
    type === "artifact.created" ||
    type.startsWith("approval.") ||
    type === "transport.error"
  );
}

function reportBestEffortFailure(label: string, error: unknown): void {
  console.warn(`[chat-service] Non-critical ${label} failed`, error);
}

function runBestEffort<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    reportBestEffortFailure(label, error);
    return undefined;
  }
}

function notify(label: string, fn: () => void): void {
  runBestEffort(label, fn);
}

function emitLiveTrace(
  callbacks: ChatServiceCallbacks | undefined,
  event: TraceEvent | null | undefined,
): void {
  if (!event || !isLiveChatActivityEvent(event.type)) return;
  notify("live trace callback", () => callbacks?.onLiveTraceEvent?.(event));
}

function extractAgentDraftMutationPayload(
  traceEvent: ChatTraceCallbackEvent,
): unknown {
  const metadata = traceEvent.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const candidates = [
    metadata.agentDraftMutationRequest,
    metadata.agentDraftMutation,
    metadata.draftMutation,
    metadata.payload,
    typeof metadata.agentDraft === "object" && metadata.agentDraft !== null
      ? (metadata.agentDraft as Record<string, unknown>).mutation
      : undefined,
  ];
  return candidates.find((candidate) => candidate !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftIdFromPayload(payload: unknown): string | undefined {
  return isRecord(payload) && typeof payload.draftId === "string"
    ? payload.draftId
    : undefined;
}

function abortCurrentRun(detail: string): void {
  if (!activeChatRun) return;
  const run = activeChatRun;
  activeChatRun = null;
  runBestEffort("chat abort", () => run.abort());
  if (run.traceRunId) {
    runBestEffort("trace abort finalization", () =>
      finishTraceRun(run.traceRunId!, "aborted", undefined, detail),
    );
  }
  run.settleAbort();
}

export function abortActiveChatRun(detail = "Mercury shut down the active Hermes run."): void {
  abortCurrentRun(detail);
}

export async function prepareChatBackend(
  profile?: string,
  purpose: "chat" | "title" = "chat",
  sessionId?: string,
): Promise<ProfileRuntimeHandle | undefined> {
  if (isSyntheticChatStreamEnabled()) return undefined;

  const normalizedProfile = profileRuntimeManager.normalizeProfile(profile);
  if (!isRemoteMode()) {
    if (!isGatewayRunning(normalizedProfile)) {
      startGateway(normalizedProfile);
    } else {
      const identity = getRuntimeIdentity(normalizedProfile);
      if (!identity?.startedByMercury) {
        stopGateway(true, normalizedProfile);
        startGateway(normalizedProfile);
      }
    }
  }

  if (!isRemoteMode()) {
    return profileRuntimeManager.resolveRuntime({
      profile: normalizedProfile,
      purpose,
      sessionId,
    });
  }

  await ensureSshTunnelIfNeeded(normalizedProfile);
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const gatewayRunning = await sshGatewayStatus(conn.ssh, normalizedProfile);
    const tunnelHealthy = await isSshTunnelHealthy(conn.ssh, normalizedProfile);
    if (!gatewayRunning || !tunnelHealthy) {
      await sshStartGateway(conn.ssh, normalizedProfile);
      await startSshTunnel(conn.ssh, normalizedProfile);
    }
    const key = await sshReadRemoteApiKey(conn.ssh, normalizedProfile);
    setSshRemoteApiKey(key, normalizedProfile);
  }

  return profileRuntimeManager.resolveRuntime({
    profile: normalizedProfile,
    purpose,
    sessionId,
  });
}

export async function runChatMessage({
  message,
  profile,
  resumeSessionId,
  history,
  callbacks,
  options,
}: RunChatRequest): Promise<ChatResponse> {
  abortCurrentRun("Superseded by a new Hermes message.");
  let effectiveSessionId = resumeSessionId;

  let fullResponse = "";
  let recordedAgentStart = false;
  const chatStartTime = Date.now();
  const traceRun = runBestEffort("trace run creation", () =>
    createTraceRun(message, profile),
  );
  const traceRunId = traceRun?.id;
  const runToken =
    traceRunId ??
    `chat-${chatStartTime}-${Math.random().toString(36).slice(2)}`;
  const recordChatTraceEvent = (
    label: string,
    type: TraceEventType,
    title: string,
    detail?: string,
    metadata?: Record<string, unknown>,
  ): TraceEvent | null | undefined => {
    if (!traceRunId) return undefined;
    return runBestEffort(label, () =>
      recordTraceEvent(traceRunId, type, title, detail, metadata),
    );
  };
  const finishChatTraceRun = (
    label: string,
    status: "completed" | "failed" | "aborted",
    sessionId?: string,
    detail?: string,
  ): void => {
    if (!traceRunId) return;
    runBestEffort(label, () =>
      finishTraceRun(traceRunId, status, sessionId, detail),
    );
  };
  const processAgentDraftTraceEvent = async (
    traceEvent: ChatTraceCallbackEvent,
  ): Promise<void> => {
    if (options?.mode !== "agent-creation" || !options.agentDraftId) return;
    if (!traceEvent.type.startsWith("tool.")) return;

    const payload = extractAgentDraftMutationPayload(traceEvent);
    if (payload === undefined) return;
    if (draftIdFromPayload(payload) !== options.agentDraftId) return;

    const result = await updateAgentDraft(payload, {
      onChange: callbacks?.onAgentDraftChanged,
    });
    if (!result.success) {
      const recordedEvent = recordChatTraceEvent(
        "trace agent draft mutation failed",
        "tool.failed",
        "Agent draft update failed",
        result.error,
        {
          source: "agent-draft",
          code: result.code,
          draftId: options.agentDraftId,
        },
      );
      emitLiveTrace(callbacks, recordedEvent ?? null);
    }
  };

  if (resumeSessionId) {
    recordChatTraceEvent(
      "trace session resume",
      "session.resumed",
      "Session resumed",
      resumeSessionId,
      { sessionId: resumeSessionId },
    );
  }
  if (history?.length) {
    recordChatTraceEvent(
      "trace history loaded",
      "message.history.loaded",
      "History loaded",
      `${history.length} previous messages included.`,
      {
        messageCount: history.length,
        userCount: history.filter((msg) => msg.role === "user").length,
        agentCount: history.filter(
          (msg) => msg.role === "agent" || msg.role === "assistant",
        ).length,
      },
    );
  }

  let settled = false;
  let resolveChat!: (v: ChatResponse) => void;
  let rejectChat!: (reason?: unknown) => void;
  const promise = new Promise<ChatResponse>((res, rej) => {
    resolveChat = res;
    rejectChat = rej;
  });
  const settleResolved = (response: ChatResponse): void => {
    if (settled) return;
    settled = true;
    resolveChat(response);
  };
  const settleRejected = (reason: unknown): void => {
    if (settled) return;
    settled = true;
    rejectChat(reason);
  };
  const isActiveRun = (): boolean => activeChatRun?.runToken === runToken;
  const shouldIgnoreCallback = (): boolean =>
    settled || (activeChatRun !== null && !isActiveRun());
  let skipNextLegacyToolTrace = false;
  let missingSessionDiagnosticRecorded = false;
  const recordMissingSessionDiagnostic = (
    diagnostic?: ChatTransportDiagnostic,
  ): void => {
    if (missingSessionDiagnosticRecorded) return;
    missingSessionDiagnosticRecorded = true;
    const normalizedProfile = profileRuntimeManager.normalizeProfile(
      diagnostic?.profile ?? profile,
    );
    const metadata = {
      code: "missing-session-id",
      severity: "warning",
      source: diagnostic?.source ?? "service",
      profile: normalizedProfile,
      resumed: Boolean(effectiveSessionId),
      transport: diagnostic?.transport,
      apiBaseUrl: diagnostic?.apiBaseUrl,
      headerName: "x-hermes-session-id",
      headerShape: diagnostic?.headerShape ?? "missing",
    };
    console.warn(
      "[chat-service] Chat completed without a durable Hermes session id",
      metadata,
    );
    recordChatTraceEvent(
      "trace missing session id diagnostic",
      "transport.error",
      "Missing durable session id",
      "Chat completed successfully, but Hermes did not return x-hermes-session-id; the chat will remain non-persistent.",
      metadata,
    );
  };

  const transportCallbacks: ChatCallbacks = {
    onChunk: (chunk) => {
      if (shouldIgnoreCallback()) return;
      fullResponse += chunk;
      if (!recordedAgentStart && chunk.trim()) {
        recordedAgentStart = true;
        recordChatTraceEvent(
          "trace agent start",
          "message.agent.delta",
          "Agent response started",
          chunk.trim().slice(0, 180),
        );
      }
      notify("chat chunk callback", () => callbacks?.onChunk?.(chunk));
    },
    onDone: (sessionId) => {
      if (shouldIgnoreCallback()) return;
      const completedSessionId = sessionId || effectiveSessionId;
      if (isActiveRun()) activeChatRun = null;
      if (fullResponse.trim()) {
        recordChatTraceEvent(
          "trace agent completion",
          "message.agent.delta",
          "Agent response completed",
          fullResponse.trim().slice(0, 320),
        );
      }
      const artifactEvents =
        runBestEffort("artifact extraction", () =>
          extractArtifactEventsFromText(fullResponse),
        ) ?? [];
      for (const artifactEvent of artifactEvents) {
        const recordedEvent = recordChatTraceEvent(
          "trace artifact event",
          artifactEvent.type,
          artifactEvent.title,
          artifactEvent.detail,
          artifactEvent.metadata,
        );
        emitLiveTrace(callbacks, recordedEvent ?? null);
      }
      finishChatTraceRun(
        "trace completion finalization",
        "completed",
        completedSessionId,
        "Hermes returned a completed response.",
      );
      if (!completedSessionId) {
        recordMissingSessionDiagnostic();
      }
      if (completedSessionId) {
        const profileUpdated = runBestEffort("session profile update", () =>
          updateSessionProfile(completedSessionId, profile),
        );
        if (profileUpdated === false) {
          console.warn(
            "[chat-service] Hermes returned a session id, but the session cache/profile row was not updated",
            {
              sessionId: completedSessionId,
              profile: profileRuntimeManager.normalizeProfile(profile),
            },
          );
        }
      }
      notify("chat done callback", () => callbacks?.onDone?.(completedSessionId));
      const response = { response: fullResponse, sessionId: completedSessionId };
      settleResolved(response);
      notify("chat completion callback", () =>
        callbacks?.onCompleted?.({
          ...response,
          durationMs: Date.now() - chatStartTime,
        }),
      );
    },
    onError: (error, info) => {
      if (shouldIgnoreCallback()) return;
      if (isActiveRun()) activeChatRun = null;
      const visibleError = info?.displayMessage || error;
      const metadata: Record<string, unknown> = { source: "chat" };
      if (info?.recovery) metadata.recovery = info.recovery;
      if (info?.remediation) metadata.remediation = info.remediation;
      const recordedError = recordChatTraceEvent(
        "trace transport error",
        "transport.error",
        "Transport error",
        visibleError,
        metadata,
      );
      emitLiveTrace(callbacks, recordedError ?? null);
      finishChatTraceRun(
        "trace failure finalization",
        "failed",
        undefined,
        visibleError,
      );
      notify("chat error callback", () => callbacks?.onError?.(visibleError, info));
      settleRejected(new Error(error));
      notify("chat failure callback", () => callbacks?.onFailed?.(visibleError));
    },
    onTraceEvent: (traceEvent) => {
      if (shouldIgnoreCallback()) return;
      if (traceEvent.type.startsWith("tool.") || traceEvent.type.startsWith("delegation.")) {
        skipNextLegacyToolTrace = true;
      }
      const recordedEvent = recordChatTraceEvent(
        "trace callback event",
        traceEvent.type,
        traceEvent.title,
        traceEvent.detail,
        traceEvent.metadata,
      );
      emitLiveTrace(callbacks, recordedEvent ?? null);
      void processAgentDraftTraceEvent(traceEvent);
    },
    onDiagnostic: (diagnostic) => {
      if (shouldIgnoreCallback()) return;
      if (diagnostic.code === "missing-session-id" && !effectiveSessionId) {
        recordMissingSessionDiagnostic(diagnostic);
      }
    },
    onToolProgress: (tool) => {
      if (shouldIgnoreCallback()) return;
      if (skipNextLegacyToolTrace) {
        skipNextLegacyToolTrace = false;
      } else {
        const recordedEvent = recordChatTraceEvent(
          "trace tool progress",
          "tool.progress",
          "Tool progress",
          tool,
        );
        emitLiveTrace(callbacks, recordedEvent ?? null);
      }
      notify("chat tool progress callback", () => callbacks?.onToolProgress?.(tool));
    },
    onUsage: (usage) => {
      if (shouldIgnoreCallback()) return;
      if (traceRunId) {
        runBestEffort("trace usage", () => recordTraceUsage(traceRunId, usage));
      }
      notify("chat usage callback", () => callbacks?.onUsage?.(usage));
    },
  };

  try {
    const runtime = await prepareChatBackend(profile, "chat", effectiveSessionId);
    if (runtime) {
      const serverSession = effectiveSessionId
        ? await readHermesSession(runtime, effectiveSessionId)
        : await createHermesSession(runtime);
      effectiveSessionId = serverSession.id;
      projectCachedSession(cachedSessionFromServerSession(serverSession));
      if (!resumeSessionId) {
        recordChatTraceEvent(
          "trace session create",
          "session.created",
          "Session created",
          effectiveSessionId,
          { sessionId: effectiveSessionId },
        );
      }
    }
    const handle = await sendMessage(
      message,
      transportCallbacks,
      profile,
      effectiveSessionId,
      history,
      runtime,
    );

    if (!settled) {
      activeChatRun = {
        runToken,
        traceRunId,
        abort: handle.abort,
        settleAbort: () => {
          notify("chat abort done callback", () => callbacks?.onDone?.());
          settleResolved({ response: fullResponse });
        },
      };
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const visibleError = code ? `${code}: ${errorMessage}` : errorMessage;
    const info = {
      remediation: classifyChatRemediation({
        source: "chat_setup",
        error: errorMessage,
        profile: profileRuntimeManager.normalizeProfile(profile),
        runtimeErrorCode: code,
      }),
    };
    const recordedError = recordChatTraceEvent(
      "trace send setup error",
      "transport.error",
      "Transport error",
      visibleError,
      { source: "chat-send", code, remediation: info.remediation },
    );
    emitLiveTrace(callbacks, recordedError ?? null);
    finishChatTraceRun(
      "trace send setup failure finalization",
      "failed",
      undefined,
      visibleError,
    );
    notify("chat setup error callback", () =>
      callbacks?.onError?.(visibleError, info.remediation ? info : undefined),
    );
    settleRejected(error);
    notify("chat setup failure callback", () => callbacks?.onFailed?.(visibleError));
  }

  return promise;
}

export async function generateChatTitleForRequest(
  request: GenerateChatTitleRequest,
): Promise<string> {
  const normalizedRequest = normalizeGenerateChatTitleRequest(request);
  if (isSyntheticChatStreamEnabled()) {
    const title = "Synthetic chat benchmark";
    if (normalizedRequest.sessionId) {
      updateSessionTitle(
        normalizedRequest.sessionId,
        title,
        normalizedRequest.profile,
      );
    }
    return title;
  }

  const title = await resolveChatTitle(normalizedRequest);
  if (normalizedRequest.sessionId && title) {
    updateSessionTitle(
      normalizedRequest.sessionId,
      title,
      normalizedRequest.profile,
    );
  }
  return title;
}

export async function resolveChatRunApprovalForRequest({
  runId,
  choice,
  profile,
  all,
  resolveAll,
}: ResolveChatRunApprovalRequest): Promise<RunApprovalResponse> {
  const runtime = await prepareChatBackend(profile, "chat");
  if (!runtime) {
    throw new Error("Synthetic chat mode does not support Hermes run approvals.");
  }
  return resolveRunApproval(runtime, runId, { choice, all, resolveAll });
}

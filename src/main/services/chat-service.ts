import {
  sendMessage,
  startGateway,
  isGatewayRunning,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  isRemoteMode,
} from "../hermes";
import { extractArtifactEventsFromText } from "../hermes/trace-events";
import type { ChatCallbacks, ProfileRuntimeHandle } from "../hermes/types";
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
import { updateSessionProfile, updateSessionTitle } from "../session-cache";
import { generateChatTitle as resolveChatTitle } from "../hermes/title";
import { isSyntheticChatStreamEnabled } from "../hermes/synthetic-chat";
import type { TraceEvent, TraceEventType, TraceUsage } from "../../shared/traces";
import {
  normalizeGenerateChatTitleRequest,
  type GenerateChatTitleRequest,
} from "../../shared/chat-metadata";

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
}

export interface ChatServiceCallbacks {
  onChunk?: (chunk: string) => void;
  onDone?: (sessionId?: string) => void;
  onError?: (error: string) => void;
  onLiveTraceEvent?: (event: TraceEvent) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: TraceUsage) => void;
  onCompleted?: (result: ChatResponse & { durationMs: number }) => void;
  onFailed?: (error: string) => void;
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
  if (!isRemoteMode() && !isGatewayRunning(normalizedProfile)) {
    startGateway(normalizedProfile);
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
}: RunChatRequest): Promise<ChatResponse> {
  const runtime = await prepareChatBackend(profile, "chat", resumeSessionId);

  abortCurrentRun("Superseded by a new Hermes message.");

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
        sessionId,
        "Hermes returned a completed response.",
      );
      if (sessionId) {
        runBestEffort("session profile update", () =>
          updateSessionProfile(sessionId, profile),
        );
      }
      notify("chat done callback", () => callbacks?.onDone?.(sessionId));
      const response = { response: fullResponse, sessionId };
      settleResolved(response);
      notify("chat completion callback", () =>
        callbacks?.onCompleted?.({
          ...response,
          durationMs: Date.now() - chatStartTime,
        }),
      );
    },
    onError: (error) => {
      if (shouldIgnoreCallback()) return;
      if (isActiveRun()) activeChatRun = null;
      const recordedError = recordChatTraceEvent(
        "trace transport error",
        "transport.error",
        "Transport error",
        error,
        { source: "chat" },
      );
      emitLiveTrace(callbacks, recordedError ?? null);
      finishChatTraceRun(
        "trace failure finalization",
        "failed",
        undefined,
        error,
      );
      notify("chat error callback", () => callbacks?.onError?.(error));
      settleRejected(new Error(error));
      notify("chat failure callback", () => callbacks?.onFailed?.(error));
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
    const handle = await sendMessage(
      message,
      transportCallbacks,
      profile,
      resumeSessionId,
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    const recordedError = recordChatTraceEvent(
      "trace send setup error",
      "transport.error",
      "Transport error",
      errorMessage,
      { source: "chat-send" },
    );
    emitLiveTrace(callbacks, recordedError ?? null);
    finishChatTraceRun(
      "trace send setup failure finalization",
      "failed",
      undefined,
      errorMessage,
    );
    notify("chat setup error callback", () => callbacks?.onError?.(errorMessage));
    settleRejected(error);
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

  const runtime = await prepareChatBackend(
    normalizedRequest.profile,
    "title",
    normalizedRequest.sessionId,
  );
  const title = await resolveChatTitle(normalizedRequest, runtime);
  if (normalizedRequest.sessionId && title) {
    updateSessionTitle(
      normalizedRequest.sessionId,
      title,
      normalizedRequest.profile,
    );
  }
  return title;
}

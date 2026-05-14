import { ipcMain, Notification, type WebContents } from "electron";
import {
  sendMessage,
  startGateway,
  isGatewayRunning,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  isRemoteMode,
} from "../hermes";
import { extractArtifactEventsFromText } from "../hermes/trace-events";
import type { TraceEvent, TraceEventType } from "../../shared/traces";
import {
  isGenerateChatTitleRequest,
  normalizeGenerateChatTitleRequest,
} from "../../shared/chat-metadata";
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
import type { IpcRegistrationContext } from "./types";

type ChatResponse = { response: string; sessionId?: string };

type ActiveChatRun = {
  runToken: string;
  traceRunId?: string;
  abort: () => void;
  settleAbort: () => void;
};

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
  console.warn(`[chat-ipc] Non-critical ${label} failed`, error);
}

function runBestEffort<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    reportBestEffortFailure(label, error);
    return undefined;
  }
}

function safeSend(sender: WebContents, channel: string, ...args: unknown[]): void {
  if (sender.isDestroyed()) return;
  try {
    sender.send(channel, ...args);
  } catch (error) {
    reportBestEffortFailure(`IPC send ${channel}`, error);
  }
}

function sendChatTraceEvent(
  sender: WebContents,
  event: TraceEvent | null,
): void {
  if (!event || !isLiveChatActivityEvent(event.type)) return;
  safeSend(sender, "chat-trace-event", event);
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

export function abortActiveChat(): void {
  abortCurrentRun("Mercury shut down the active Hermes run.");
}

async function prepareChatBackend(profile?: string): Promise<void> {
  if (!isRemoteMode() && !isGatewayRunning()) {
    startGateway(profile);
  }

  await ensureSshTunnelIfNeeded();
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const gatewayRunning = await sshGatewayStatus(conn.ssh);
    const tunnelHealthy = await isSshTunnelHealthy();
    if (!gatewayRunning || !tunnelHealthy) {
      await sshStartGateway(conn.ssh);
      await startSshTunnel(conn.ssh);
      const key = await sshReadRemoteApiKey(conn.ssh);
      setSshRemoteApiKey(key);
    }
  }
}

export function registerChatIpc({
  getMainWindow,
}: IpcRegistrationContext): void {
  // Chat — lazy-start gateway on first message
  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
    ) => {
      await prepareChatBackend(profile);

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

      try {
        const handle = await sendMessage(
          message,
          {
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
              safeSend(event.sender, "chat-chunk", chunk);
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
                sendChatTraceEvent(event.sender, recordedEvent ?? null);
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
              safeSend(event.sender, "chat-done", sessionId || "");
              settleResolved({ response: fullResponse, sessionId });
              // Desktop notification when window is not focused and response took >10s
              runBestEffort("completion notification", () => {
                const mainWindow = getMainWindow();
                if (
                  mainWindow &&
                  !mainWindow.isFocused() &&
                  Date.now() - chatStartTime > 10000
                ) {
                  const preview = fullResponse
                    .replace(/[#*_`~\n]+/g, " ")
                    .trim()
                    .slice(0, 80);
                  new Notification({
                    title: "Mercury",
                    body: preview || "Response ready",
                  }).show();
                }
              });
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
              sendChatTraceEvent(event.sender, recordedError ?? null);
              finishChatTraceRun(
                "trace failure finalization",
                "failed",
                undefined,
                error,
              );
              safeSend(event.sender, "chat-error", error);
              settleRejected(new Error(error));
              // Notify on error too if window not focused
              runBestEffort("error notification", () => {
                const mainWindow = getMainWindow();
                if (mainWindow && !mainWindow.isFocused()) {
                  new Notification({
                    title: "Mercury — Error",
                    body: error.slice(0, 100),
                  }).show();
                }
              });
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
              sendChatTraceEvent(event.sender, recordedEvent ?? null);
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
                sendChatTraceEvent(event.sender, recordedEvent ?? null);
              }
              safeSend(event.sender, "chat-tool-progress", tool);
            },
            onUsage: (usage) => {
              if (shouldIgnoreCallback()) return;
              if (traceRunId) {
                runBestEffort("trace usage", () => recordTraceUsage(traceRunId, usage));
              }
              safeSend(event.sender, "chat-usage", usage);
            },
          },
          profile,
          resumeSessionId,
          history,
        );

        if (!settled) {
          activeChatRun = {
            runToken,
            traceRunId,
            abort: handle.abort,
            settleAbort: () => {
              safeSend(event.sender, "chat-done", "");
              settleResolved({ response: fullResponse });
            },
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const recordedError = recordChatTraceEvent(
          "trace send setup error",
          "transport.error",
          "Transport error",
          message,
          { source: "chat-send" },
        );
        sendChatTraceEvent(event.sender, recordedError ?? null);
        finishChatTraceRun(
          "trace send setup failure finalization",
          "failed",
          undefined,
          message,
        );
        safeSend(event.sender, "chat-error", message);
        settleRejected(error);
      }

      return promise;
    },
  );

  ipcMain.handle("generate-chat-title", async (_event, request: unknown) => {
    if (!isGenerateChatTitleRequest(request)) {
      throw new Error("Invalid generate-chat-title request");
    }

    const normalizedRequest = normalizeGenerateChatTitleRequest(request);
    await prepareChatBackend(normalizedRequest.profile);
    const title = await resolveChatTitle(normalizedRequest);
    if (normalizedRequest.sessionId && title) {
      updateSessionTitle(normalizedRequest.sessionId, title);
    }
    return title;
  });

  ipcMain.handle("abort-chat", () => {
    abortCurrentRun("User stopped the active Hermes run.");
  });
}

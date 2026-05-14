import { ipcMain, Notification } from "electron";
import {
  sendMessage,
  startGateway,
  isGatewayRunning,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  isRemoteMode,
} from "../hermes";
import { extractArtifactEventsFromText } from "../hermes/trace-events";
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
import type { IpcRegistrationContext } from "./types";

type ChatResponse = { response: string; sessionId?: string };

type ActiveChatRun = {
  traceRunId: string;
  abort: () => void;
  settleAbort: () => void;
};

let activeChatRun: ActiveChatRun | null = null;

function abortCurrentRun(detail: string): void {
  if (!activeChatRun) return;
  const run = activeChatRun;
  activeChatRun = null;
  run.abort();
  finishTraceRun(run.traceRunId, "aborted", undefined, detail);
  run.settleAbort();
}

export function abortActiveChat(): void {
  abortCurrentRun("Mercury shut down the active Hermes run.");
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

      abortCurrentRun("Superseded by a new Hermes message.");

      let fullResponse = "";
      let recordedAgentStart = false;
      const chatStartTime = Date.now();
      const traceRun = createTraceRun(message, profile);

      if (resumeSessionId) {
        recordTraceEvent(
          traceRun.id,
          "session.resumed",
          "Session resumed",
          resumeSessionId,
          { sessionId: resumeSessionId },
        );
      }
      if (history?.length) {
        recordTraceEvent(
          traceRun.id,
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
      const isActiveRun = (): boolean => activeChatRun?.traceRunId === traceRun.id;
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
                recordTraceEvent(
                  traceRun.id,
                  "message.agent.delta",
                  "Agent response started",
                  chunk.trim().slice(0, 180),
                );
              }
              event.sender.send("chat-chunk", chunk);
            },
            onDone: (sessionId) => {
              if (shouldIgnoreCallback()) return;
              if (isActiveRun()) activeChatRun = null;
              if (fullResponse.trim()) {
                recordTraceEvent(
                  traceRun.id,
                  "message.agent.delta",
                  "Agent response completed",
                  fullResponse.trim().slice(0, 320),
                );
              }
              for (const artifactEvent of extractArtifactEventsFromText(fullResponse)) {
                recordTraceEvent(
                  traceRun.id,
                  artifactEvent.type,
                  artifactEvent.title,
                  artifactEvent.detail,
                  artifactEvent.metadata,
                );
              }
              finishTraceRun(
                traceRun.id,
                "completed",
                sessionId,
                "Hermes returned a completed response.",
              );
              event.sender.send("chat-done", sessionId || "");
              settleResolved({ response: fullResponse, sessionId });
              // Desktop notification when window is not focused and response took >10s
              if (
                getMainWindow() &&
                !getMainWindow()!.isFocused() &&
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
            },
            onError: (error) => {
              if (shouldIgnoreCallback()) return;
              if (isActiveRun()) activeChatRun = null;
              recordTraceEvent(
                traceRun.id,
                "transport.error",
                "Transport error",
                error,
                { source: "chat" },
              );
              finishTraceRun(traceRun.id, "failed", undefined, error);
              event.sender.send("chat-error", error);
              settleRejected(new Error(error));
              // Notify on error too if window not focused
              if (getMainWindow() && !getMainWindow()!.isFocused()) {
                new Notification({
                  title: "Mercury — Error",
                  body: error.slice(0, 100),
                }).show();
              }
            },
            onTraceEvent: (traceEvent) => {
              if (shouldIgnoreCallback()) return;
              if (traceEvent.type.startsWith("tool.") || traceEvent.type.startsWith("delegation.")) {
                skipNextLegacyToolTrace = true;
              }
              recordTraceEvent(
                traceRun.id,
                traceEvent.type,
                traceEvent.title,
                traceEvent.detail,
                traceEvent.metadata,
              );
            },
            onToolProgress: (tool) => {
              if (shouldIgnoreCallback()) return;
              if (skipNextLegacyToolTrace) {
                skipNextLegacyToolTrace = false;
              } else {
                recordTraceEvent(
                  traceRun.id,
                  "tool.progress",
                  "Tool progress",
                  tool,
                );
              }
              event.sender.send("chat-tool-progress", tool);
            },
            onUsage: (usage) => {
              if (shouldIgnoreCallback()) return;
              recordTraceUsage(traceRun.id, usage);
              event.sender.send("chat-usage", usage);
            },
          },
          profile,
          resumeSessionId,
          history,
        );

        activeChatRun = {
          traceRunId: traceRun.id,
          abort: handle.abort,
          settleAbort: () => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("chat-done", "");
            }
            settleResolved({ response: fullResponse });
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordTraceEvent(traceRun.id, "transport.error", "Transport error", message, {
          source: "chat-send",
        });
        finishTraceRun(traceRun.id, "failed", undefined, message);
        event.sender.send("chat-error", message);
        settleRejected(error);
      }

      return promise;
    },
  );

  ipcMain.handle("abort-chat", () => {
    abortCurrentRun("User stopped the active Hermes run.");
  });
}

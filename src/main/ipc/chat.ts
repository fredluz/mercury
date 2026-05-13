import { ipcMain, Notification } from "electron";
import {
  sendMessage,
  startGateway,
  isGatewayRunning,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  isRemoteMode,
} from "../hermes";
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

let currentChatAbort: (() => void) | null = null;
let currentTraceRunId: string | null = null;

export function abortActiveChat(): void {
  if (currentChatAbort) {
    currentChatAbort();
    currentChatAbort = null;
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

      if (currentChatAbort) {
        currentChatAbort();
        if (currentTraceRunId) {
          finishTraceRun(
            currentTraceRunId,
            "aborted",
            undefined,
            "Superseded by a new Hermes message.",
          );
        }
      }

      let fullResponse = "";
      let recordedAgentStart = false;
      const chatStartTime = Date.now();
      const traceRun = createTraceRun(message, profile);
      currentTraceRunId = traceRun.id;
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
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
            if (currentTraceRunId === traceRun.id) {
              currentChatAbort = null;
              currentTraceRunId = null;
            }
            if (fullResponse.trim()) {
              recordTraceEvent(
                traceRun.id,
                "message.agent.delta",
                "Agent response completed",
                fullResponse.trim().slice(0, 320),
              );
            }
            finishTraceRun(
              traceRun.id,
              "completed",
              sessionId,
              "Hermes returned a completed response.",
            );
            event.sender.send("chat-done", sessionId || "");
            resolveChat({ response: fullResponse, sessionId });
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
            if (currentTraceRunId === traceRun.id) {
              currentChatAbort = null;
              currentTraceRunId = null;
            }
            finishTraceRun(traceRun.id, "failed", undefined, error);
            event.sender.send("chat-error", error);
            rejectChat(new Error(error));
            // Notify on error too if window not focused
            if (getMainWindow() && !getMainWindow()!.isFocused()) {
              new Notification({
                title: "Mercury — Error",
                body: error.slice(0, 100),
              }).show();
            }
          },
          onToolProgress: (tool) => {
            recordTraceEvent(
              traceRun.id,
              "tool.progress",
              "Tool progress",
              tool,
            );
            event.sender.send("chat-tool-progress", tool);
          },
          onUsage: (usage) => {
            recordTraceUsage(traceRun.id, usage);
            event.sender.send("chat-usage", usage);
          },
        },
        profile,
        resumeSessionId,
        history,
      );

      currentChatAbort = handle.abort;
      return promise;
    },
  );

  ipcMain.handle("abort-chat", () => {
    if (currentChatAbort) {
      currentChatAbort();
      currentChatAbort = null;
      if (currentTraceRunId) {
        finishTraceRun(
          currentTraceRunId,
          "aborted",
          undefined,
          "User stopped the active Hermes run.",
        );
        currentTraceRunId = null;
      }
    }
  });
}

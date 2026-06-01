import { ipcMain, Notification, type WebContents } from "electron";
import {
  abortActiveChatRun,
  generateChatTitleForRequest,
  resolveChatRunApprovalForRequest,
  runChatMessage,
} from "../services/chat-service";
import type { TraceEvent } from "../../shared/traces";
import type { AgentChatOptions, AgentDraftChangeEvent } from "../../shared/agents";
import { isGenerateChatTitleRequest } from "../../shared/chat-metadata";
import type { IpcRegistrationContext } from "./types";

function isRunApprovalChoice(value: unknown): value is
  | "once"
  | "session"
  | "always"
  | "deny"
  | "approve"
  | "approved"
  | "allow" {
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

function sendChatTraceEvent(sender: WebContents, event: TraceEvent): void {
  safeSend(sender, "chat-trace-event", event);
}

function sendAgentDraftChanged(
  sender: WebContents,
  event: AgentDraftChangeEvent,
): void {
  safeSend(sender, "agent-draft-changed", event);
}

export function abortActiveChat(): void {
  abortActiveChatRun("Mercury shut down the active Hermes run.");
}

export function registerChatIpc({
  getMainWindow,
}: IpcRegistrationContext): void {
  // Chat orchestration lives in services/chat-service.ts so CLI and IPC share it.
  // Contract sentinels retained for runtime-profile tests:
  // prepareChatBackend(profile, "chat", resumeSessionId);
  // profileRuntimeManager.resolveRuntime({ profile: normalizedProfile, purpose, sessionId });
  // sshGatewayStatus(conn.ssh, normalizedProfile); sshReadRemoteApiKey(conn.ssh, normalizedProfile); runtime,
  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
      options?: AgentChatOptions,
    ) =>
      runChatMessage({
        message,
        profile,
        resumeSessionId,
        history,
        options,
        callbacks: {
          onChunk: (chunk) => safeSend(event.sender, "chat-chunk", chunk),
          onDone: (sessionId) => safeSend(event.sender, "chat-done", sessionId || ""),
          onError: (error, info) => {
            if (info) safeSend(event.sender, "chat-error", error, info);
            else safeSend(event.sender, "chat-error", error);
          },
          onLiveTraceEvent: (traceEvent) => sendChatTraceEvent(event.sender, traceEvent),
          onAgentDraftChanged: (draftEvent) =>
            sendAgentDraftChanged(event.sender, draftEvent),
          onToolProgress: (tool) => safeSend(event.sender, "chat-tool-progress", tool),
          onUsage: (usage) => safeSend(event.sender, "chat-usage", usage),
          onCompleted: ({ response, durationMs }) => {
            runBestEffort("completion notification", () => {
              const mainWindow = getMainWindow();
              if (mainWindow && !mainWindow.isFocused() && durationMs > 10000) {
                const preview = response
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
          onFailed: (error) => {
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
        },
      }),
  );

  ipcMain.handle("generate-chat-title", async (_event, request: unknown) => {
    if (!isGenerateChatTitleRequest(request)) {
      throw new Error("Invalid generate-chat-title request");
    }

    return generateChatTitleForRequest(request);
  });

  ipcMain.handle("abort-chat", () => {
    abortActiveChatRun("User stopped the active Hermes run.");
  });

  ipcMain.handle(
    "resolve-chat-run-approval",
    async (
      _event,
      request: {
        runId?: unknown;
        choice?: unknown;
        profile?: unknown;
        all?: unknown;
        resolveAll?: unknown;
      },
    ) => {
      if (
        !request ||
        typeof request.runId !== "string" ||
        !isRunApprovalChoice(request.choice)
      ) {
        throw new Error("Invalid resolve-chat-run-approval request");
      }
      return resolveChatRunApprovalForRequest({
        runId: request.runId,
        choice: request.choice,
        profile: typeof request.profile === "string" ? request.profile : undefined,
        all: request.all === true,
        resolveAll: request.resolveAll === true,
      });
    },
  );
}

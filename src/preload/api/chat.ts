import { ipcRenderer } from "electron";
import type { GenerateChatTitleRequest } from "../../shared/chat-metadata";
import type { ChatErrorInfo } from "../../shared/codex-auth-recovery";
import type { LocalChatTraceRequest, TraceEvent, TraceRun } from "../../shared/traces";
import type { AgentChatOptions } from "../../shared/agents";

export const chatApi = {
  // Chat
  sendMessage: (
    message: string,
    profile?: string,
    resumeSessionId?: string,
    history?: Array<{ role: string; content: string }>,
    options?: AgentChatOptions,
  ): Promise<{ response: string; sessionId?: string }> =>
    ipcRenderer.invoke(
      "send-message",
      message,
      profile,
      resumeSessionId,
      history,
      options,
    ),

  abortChat: (): Promise<void> => ipcRenderer.invoke("abort-chat"),

  resolveChatRunApproval: (request: {
    runId: string;
    choice:
      | "once"
      | "session"
      | "always"
      | "deny"
      | "approve"
      | "approved"
      | "allow";
    profile?: string;
    all?: boolean;
    resolveAll?: boolean;
  }): Promise<{ runId: string; choice: string; resolved: number }> =>
    ipcRenderer.invoke("resolve-chat-run-approval", request),

  generateChatTitle: (request: GenerateChatTitleRequest): Promise<string> =>
    ipcRenderer.invoke("generate-chat-title", request),

  recordLocalChatTrace: (request: LocalChatTraceRequest): Promise<TraceRun> =>
    ipcRenderer.invoke("record-local-chat-trace", request),

  onChatChunk: (callback: (chunk: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: string): void =>
      callback(chunk);
    ipcRenderer.on("chat-chunk", handler);
    return () => ipcRenderer.removeListener("chat-chunk", handler);
  },

  onChatDone: (callback: (sessionId?: string) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      sessionId?: string,
    ): void => callback(sessionId);
    ipcRenderer.on("chat-done", handler);
    return () => ipcRenderer.removeListener("chat-done", handler);
  },

  onChatToolProgress: (callback: (tool: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, tool: string): void =>
      callback(tool);
    ipcRenderer.on("chat-tool-progress", handler);
    return () => ipcRenderer.removeListener("chat-tool-progress", handler);
  },

  onChatTraceEvent: (callback: (event: TraceEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, traceEvent: TraceEvent): void =>
      callback(traceEvent);
    ipcRenderer.on("chat-trace-event", handler);
    return () => ipcRenderer.removeListener("chat-trace-event", handler);
  },

  onChatUsage: (
    callback: (usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cost?: number;
      rateLimitRemaining?: number;
      rateLimitReset?: number;
    }) => void,
  ): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, usage: unknown): void =>
      callback(
        usage as {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
          cost?: number;
          rateLimitRemaining?: number;
          rateLimitReset?: number;
        },
      );
    ipcRenderer.on("chat-usage", handler);
    return () => ipcRenderer.removeListener("chat-usage", handler);
  },

  onChatError: (
    callback: (error: string, info?: ChatErrorInfo) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      error: string,
      info?: ChatErrorInfo,
    ): void => callback(error, info);
    ipcRenderer.on("chat-error", handler);
    return () => ipcRenderer.removeListener("chat-error", handler);
  },
};

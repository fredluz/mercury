import { useEffect } from "react";
import type React from "react";
import type { MutableRefObject } from "react";
import type { ContextWindowInfo } from "../../../../../shared/chat-metadata";
import {
  detectCodexAuthRecovery,
  type ChatAuthRecovery,
  type ChatErrorInfo,
} from "../../../../../shared/codex-auth-recovery";
import type { TraceEvent } from "../../../../../shared/traces";
import type { ChatActivityGroupStatus, ChatMessage, ChatUsage } from "../types";
import type { ChatPerfTracker } from "./chatPerf";

interface UseChatIpcListenersArgs {
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  appendActivityEvent: (traceEvent: TraceEvent) => void;
  finalizeActiveChatRun: (status: ChatActivityGroupStatus) => void;
  setHermesSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  setUsage: React.Dispatch<React.SetStateAction<ChatUsage | null>>;
  currentContextInfoRef: MutableRefObject<ContextWindowInfo>;
  currentModelRef: MutableRefObject<string>;
  currentProviderRef: MutableRefObject<string>;
  profileRef: MutableRefObject<string | undefined>;
  onAuthRecovery?: (recovery: ChatAuthRecovery, displayMessage: string) => void;
  formatChatErrorMessage?: (error: string, info?: ChatErrorInfo) => string;
  perf: ChatPerfTracker;
}

export function useChatIpcListeners({
  setMessages,
  appendActivityEvent,
  finalizeActiveChatRun,
  setHermesSessionId,
  setUsage,
  currentContextInfoRef,
  currentModelRef,
  currentProviderRef,
  profileRef,
  onAuthRecovery,
  formatChatErrorMessage,
  perf,
}: UseChatIpcListenersArgs): void {
  useEffect(() => {
    const cleanupChunk = window.hermesAPI.onChatChunk((chunk) => {
      perf.markChunkCallback(chunk);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "agent") return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        if (!chunk || !chunk.trim()) return prev;
        return [...prev, { id: `agent-${Date.now()}`, role: "agent", content: chunk }];
      });
    });
    const cleanupTraceEvent = window.hermesAPI.onChatTraceEvent(appendActivityEvent);
    const cleanupDone = window.hermesAPI.onChatDone((sessionId) => {
      perf.markDoneCallback(sessionId);
      if (sessionId) setHermesSessionId(sessionId);
      finalizeActiveChatRun("completed");
    });
    const cleanupError = window.hermesAPI.onChatError((error, info) => {
      perf.markErrorCallback(error);
      const detectedInfo =
        info?.recovery
          ? info
          : (detectCodexAuthRecovery({
              error,
              provider: currentProviderRef.current,
              profile: profileRef.current,
            }) ?? undefined);
      const recovery = detectedInfo?.recovery;
      if (recovery) {
        onAuthRecovery?.(
          recovery,
          detectedInfo.displayMessage ||
            "Codex sign-in needs to be refreshed. Re-authenticate with Mercury's in-app Codex login.",
        );
      }
      const content = formatChatErrorMessage
        ? formatChatErrorMessage(error, detectedInfo)
        : `Error: ${detectedInfo?.displayMessage || error}`;
      setMessages((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, role: "agent", content },
      ]);
      finalizeActiveChatRun("failed");
    });
    const cleanupUsage = window.hermesAPI.onChatUsage((u) => {
      const contextInfo = currentContextInfoRef.current;
      const contextModel = currentModelRef.current || currentProviderRef.current;
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
        lastPromptTokens: u.promptTokens,
        lastCompletionTokens: u.completionTokens,
        lastTotalTokens: u.totalTokens,
        contextWindow: contextInfo.tokens,
        contextWindowSource: contextInfo.source,
        contextModel,
      }));
    });
    return () => {
      cleanupChunk();
      cleanupTraceEvent();
      cleanupDone();
      cleanupError();
      cleanupUsage();
    };
    // Model/context/profile refs are intentionally read lazily in callbacks so
    // model selection does not churn terminal IPC listeners.
  }, [
    appendActivityEvent,
    finalizeActiveChatRun,
    formatChatErrorMessage,
    onAuthRecovery,
    perf.markChunkCallback,
    perf.markDoneCallback,
    perf.markErrorCallback,
    setHermesSessionId,
    setMessages,
    setUsage,
  ]);
}

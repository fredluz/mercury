import { useEffect } from "react";
import type React from "react";
import type { MutableRefObject } from "react";
import type { ContextWindowInfo } from "../../../../../shared/chat-metadata";
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
    const cleanupError = window.hermesAPI.onChatError((error) => {
      perf.markErrorCallback(error);
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: "agent", content: `Error: ${error}` }]);
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
    // Model/context refs are intentionally read lazily in the usage callback so
    // model selection does not churn terminal IPC listeners.
  }, [
    appendActivityEvent,
    finalizeActiveChatRun,
    perf.markChunkCallback,
    perf.markDoneCallback,
    perf.markErrorCallback,
    setHermesSessionId,
    setMessages,
    setUsage,
  ]);
}

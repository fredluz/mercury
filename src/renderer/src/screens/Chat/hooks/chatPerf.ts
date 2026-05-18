import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import { markRendererPerf } from "../../../perf";

interface ChatPerfRun {
  runSeq: number;
  kind: string;
  messageLength: number;
  historyCount: number;
  startedAtMs: number;
  hasResumeSession: boolean;
}

interface IpcResolvedMeta {
  runSeq: number;
  kind: string;
  messageLength: number;
  historyCount: number;
  responseLength: number;
  sessionIdPresent: boolean;
}

interface IpcRejectedMeta {
  runSeq: number;
  kind: string;
  messageLength: number;
  historyCount: number;
  errorType: string;
}

export interface ChatPerfTracker {
  currentChatPerfRef: MutableRefObject<ChatPerfRun | null>;
  chunkCallbackCountRef: MutableRefObject<number>;
  firstChunkMarkedRunSeqRef: MutableRefObject<number | null>;
  reset: () => void;
  elapsedMs: (startedAtMs: number) => number;
  markRunStart: (
    kind: string,
    runSeq: number,
    messageLength: number,
    historyCount: number,
    hasResumeSession: boolean,
  ) => void;
  markChunkCallback: (chunk: string) => void;
  markDoneCallback: (sessionId?: string) => void;
  markErrorCallback: (error: string) => void;
  markIpcResolved: (meta: IpcResolvedMeta) => void;
  markIpcRejected: (meta: IpcRejectedMeta) => void;
  markAbortIntent: () => void;
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function useChatPerfTracker(): ChatPerfTracker {
  const currentChatPerfRef = useRef<ChatPerfRun | null>(null);
  const chunkCallbackCountRef = useRef(0);
  const firstChunkMarkedRunSeqRef = useRef<number | null>(null);

  const reset = useCallback((): void => {
    currentChatPerfRef.current = null;
    chunkCallbackCountRef.current = 0;
    firstChunkMarkedRunSeqRef.current = null;
  }, []);

  const elapsedMs = useCallback((startedAtMs: number): number => nowMs() - startedAtMs, []);

  const markRunStart = useCallback(
    (kind: string, runSeq: number, messageLength: number, historyCount: number, hasResumeSession: boolean): void => {
      currentChatPerfRef.current = {
        runSeq,
        kind,
        messageLength,
        historyCount,
        startedAtMs: nowMs(),
        hasResumeSession,
      };
      chunkCallbackCountRef.current = 0;
      firstChunkMarkedRunSeqRef.current = null;
      markRendererPerf("chat-render", "chat.send.intent", {
        runSeq,
        kind,
        messageLength,
        historyCount,
        hasResumeSession,
      });
    },
    [],
  );

  const markChunkCallback = useCallback(
    (chunk: string): void => {
      const perfRun = currentChatPerfRef.current;
      if (!perfRun) return;
      chunkCallbackCountRef.current += 1;
      const chunkCount = chunkCallbackCountRef.current;
      const meta = {
        runSeq: perfRun.runSeq,
        kind: perfRun.kind,
        messageLength: perfRun.messageLength,
        historyCount: perfRun.historyCount,
        chunkLength: chunk.length,
        chunkCount,
        elapsedMs: elapsedMs(perfRun.startedAtMs),
      };
      if (firstChunkMarkedRunSeqRef.current !== perfRun.runSeq && chunk.trim()) {
        firstChunkMarkedRunSeqRef.current = perfRun.runSeq;
        markRendererPerf("chat-render", "chat.chunk.first_callback", meta);
      } else if (chunkCount === 1 || chunkCount % 20 === 0) {
        markRendererPerf("chat-render", "chat.chunk.callback_sample", meta);
      }
    },
    [elapsedMs],
  );

  const markDoneCallback = useCallback(
    (sessionId?: string): void => {
      const perfRun = currentChatPerfRef.current;
      if (!perfRun) return;
      markRendererPerf("chat-render", "chat.done.callback", {
        runSeq: perfRun.runSeq,
        kind: perfRun.kind,
        messageLength: perfRun.messageLength,
        historyCount: perfRun.historyCount,
        chunkCount: chunkCallbackCountRef.current,
        elapsedMs: elapsedMs(perfRun.startedAtMs),
        sessionIdPresent: Boolean(sessionId),
      });
    },
    [elapsedMs],
  );

  const markErrorCallback = useCallback(
    (error: string): void => {
      const perfRun = currentChatPerfRef.current;
      if (!perfRun) return;
      markRendererPerf("chat-render", "chat.error.callback", {
        runSeq: perfRun.runSeq,
        kind: perfRun.kind,
        messageLength: perfRun.messageLength,
        historyCount: perfRun.historyCount,
        chunkCount: chunkCallbackCountRef.current,
        elapsedMs: elapsedMs(perfRun.startedAtMs),
        errorLength: error.length,
      });
    },
    [elapsedMs],
  );

  const markIpcResolved = useCallback(
    ({ runSeq, kind, messageLength, historyCount, responseLength, sessionIdPresent }: IpcResolvedMeta): void => {
      const perfRun = currentChatPerfRef.current;
      markRendererPerf("chat-render", "chat.send.ipc.resolved", {
        runSeq,
        kind,
        messageLength,
        historyCount,
        chunkCount: perfRun?.runSeq === runSeq ? chunkCallbackCountRef.current : undefined,
        elapsedMs: perfRun?.runSeq === runSeq ? elapsedMs(perfRun.startedAtMs) : undefined,
        responseLength,
        sessionIdPresent,
      });
    },
    [elapsedMs],
  );

  const markIpcRejected = useCallback(
    ({ runSeq, kind, messageLength, historyCount, errorType }: IpcRejectedMeta): void => {
      const perfRun = currentChatPerfRef.current;
      markRendererPerf("chat-render", "chat.send.ipc.rejected", {
        runSeq,
        kind,
        messageLength,
        historyCount,
        chunkCount: perfRun?.runSeq === runSeq ? chunkCallbackCountRef.current : undefined,
        elapsedMs: perfRun?.runSeq === runSeq ? elapsedMs(perfRun.startedAtMs) : undefined,
        errorType,
      });
    },
    [elapsedMs],
  );

  const markAbortIntent = useCallback((): void => {
    const perfRun = currentChatPerfRef.current;
    if (!perfRun) return;
    markRendererPerf("chat-render", "chat.abort.intent", {
      runSeq: perfRun.runSeq,
      kind: perfRun.kind,
      messageLength: perfRun.messageLength,
      historyCount: perfRun.historyCount,
      chunkCount: chunkCallbackCountRef.current,
      elapsedMs: elapsedMs(perfRun.startedAtMs),
    });
  }, [elapsedMs]);

  return {
    currentChatPerfRef,
    chunkCallbackCountRef,
    firstChunkMarkedRunSeqRef,
    reset,
    elapsedMs,
    markRunStart,
    markChunkCallback,
    markDoneCallback,
    markErrorCallback,
    markIpcResolved,
    markIpcRejected,
    markAbortIntent,
  };
}

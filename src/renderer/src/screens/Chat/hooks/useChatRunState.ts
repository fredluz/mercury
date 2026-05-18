import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ChatActivityGroupStatus } from "../types";

interface ResetRunStateOptions {
  cancelActive?: boolean;
}

interface UseChatRunStateArgs {
  markActiveActivityGroup: (status: ChatActivityGroupStatus) => void;
}

interface UseChatRunStateResult {
  isLoading: boolean;
  isLoadingRef: MutableRefObject<boolean>;
  beginChatRun: () => number;
  finalizeChatRun: (runSeq: number, status: ChatActivityGroupStatus) => boolean;
  finalizeActiveChatRun: (status: ChatActivityGroupStatus) => void;
  cancelActiveChatRun: (status: ChatActivityGroupStatus) => void;
  isSendRunCurrentOrFinalized: (runSeq: number) => boolean;
  resetRunState: (options?: ResetRunStateOptions) => void;
}

export function useChatRunState({
  markActiveActivityGroup,
}: UseChatRunStateArgs): UseChatRunStateResult {
  const [isLoading, setIsLoading] = useState(false);
  const isLoadingRef = useRef(false);
  const sendRunSeqRef = useRef(0);
  const activeSendRunSeqRef = useRef<number | null>(null);
  const finalizedSendRunSeqRef = useRef<number | null>(null);
  const cancelledSendRunSeqsRef = useRef<Set<number>>(new Set());

  isLoadingRef.current = isLoading;

  const beginChatRun = useCallback((): number => {
    const runSeq = sendRunSeqRef.current + 1;
    sendRunSeqRef.current = runSeq;
    activeSendRunSeqRef.current = runSeq;
    finalizedSendRunSeqRef.current = null;
    cancelledSendRunSeqsRef.current.delete(runSeq);
    setIsLoading(true);
    return runSeq;
  }, []);

  const finalizeChatRun = useCallback(
    (runSeq: number, status: ChatActivityGroupStatus): boolean => {
      if (activeSendRunSeqRef.current !== runSeq) return false;
      activeSendRunSeqRef.current = null;
      finalizedSendRunSeqRef.current = runSeq;
      markActiveActivityGroup(status);
      setIsLoading(false);
      return true;
    },
    [markActiveActivityGroup],
  );

  const finalizeActiveChatRun = useCallback(
    (status: ChatActivityGroupStatus): void => {
      const runSeq = activeSendRunSeqRef.current;
      activeSendRunSeqRef.current = null;
      if (runSeq != null) finalizedSendRunSeqRef.current = runSeq;
      markActiveActivityGroup(status);
      setIsLoading(false);
    },
    [markActiveActivityGroup],
  );

  const cancelActiveChatRun = useCallback(
    (status: ChatActivityGroupStatus): void => {
      const runSeq = activeSendRunSeqRef.current;
      if (runSeq != null) cancelledSendRunSeqsRef.current.add(runSeq);
      finalizeActiveChatRun(status);
    },
    [finalizeActiveChatRun],
  );

  const isSendRunCurrentOrFinalized = useCallback((runSeq: number): boolean => {
    if (cancelledSendRunSeqsRef.current.has(runSeq)) return false;
    return activeSendRunSeqRef.current === runSeq || finalizedSendRunSeqRef.current === runSeq;
  }, []);

  const resetRunState = useCallback((options: ResetRunStateOptions = {}): void => {
    const activeRunSeq = activeSendRunSeqRef.current;
    if (options.cancelActive && activeRunSeq != null) {
      cancelledSendRunSeqsRef.current.add(activeRunSeq);
    }
    activeSendRunSeqRef.current = null;
    finalizedSendRunSeqRef.current = null;
    setIsLoading(false);
  }, []);

  return {
    isLoading,
    isLoadingRef,
    beginChatRun,
    finalizeChatRun,
    finalizeActiveChatRun,
    cancelActiveChatRun,
    isSendRunCurrentOrFinalized,
    resetRunState,
  };
}

import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ChatMessage } from "../types";

interface UseChatTitleGenerationArgs {
  profileRef: MutableRefObject<string | undefined>;
  sessionIdRef: MutableRefObject<string | null>;
  sessionTitleRef: MutableRefObject<string | null>;
  messagesRef: MutableRefObject<ChatMessage[]>;
  onSessionTitleChange?: (title: string) => void;
}

interface UseChatTitleGenerationResult {
  titleGenerationPending: boolean;
  titleRequestSeqRef: MutableRefObject<number>;
  resetTitleGeneration: (bumpSeq?: boolean) => void;
  requestGeneratedTitleOnce: (
    resolvedSessionId: string | undefined,
    conversationMessages: ChatMessage[],
    requestSeq: number,
  ) => Promise<void>;
}

function isEligibleTitleUserMessage(message: ChatMessage): boolean {
  return message.role === "user" && !message.content.trim().startsWith("/");
}

export function useChatTitleGeneration({
  profileRef,
  sessionIdRef,
  sessionTitleRef,
  messagesRef,
  onSessionTitleChange,
}: UseChatTitleGenerationArgs): UseChatTitleGenerationResult {
  const [titleGenerationPending, setTitleGenerationPending] = useState(false);
  const titleRequestSeqRef = useRef(0);

  const resetTitleGeneration = useCallback((bumpSeq = false): void => {
    if (bumpSeq) titleRequestSeqRef.current += 1;
    setTitleGenerationPending(false);
  }, []);

  const requestGeneratedTitleOnce = useCallback(
    async (
      resolvedSessionId: string | undefined,
      conversationMessages: ChatMessage[],
      requestSeq: number,
    ): Promise<void> => {
      if (!resolvedSessionId || sessionTitleRef.current) return;
      const eligibleUserMessages = conversationMessages.filter(isEligibleTitleUserMessage);
      if (eligibleUserMessages.length !== 1) return;

      setTitleGenerationPending(true);
      try {
        const firstEligibleIndex = conversationMessages.findIndex(isEligibleTitleUserMessage);
        const titleMessages = conversationMessages
          .slice(firstEligibleIndex)
          .filter((message) => message.role !== "user" || !message.content.trim().startsWith("/"));
        const title = await window.hermesAPI.generateChatTitle({
          profile: profileRef.current,
          sessionId: resolvedSessionId,
          messages: titleMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });
        if (
          title &&
          requestSeq === titleRequestSeqRef.current &&
          !sessionTitleRef.current &&
          (sessionIdRef.current === resolvedSessionId || !sessionIdRef.current) &&
          messagesRef.current.length > 0
        ) {
          onSessionTitleChange?.(title);
        }
      } catch {
        // The main process already falls back to heuristic titles where possible;
        // if IPC itself fails, keep the visible untitled state.
      } finally {
        if (requestSeq === titleRequestSeqRef.current) {
          setTitleGenerationPending(false);
        }
      }
    },
    [messagesRef, onSessionTitleChange, profileRef, sessionIdRef, sessionTitleRef],
  );

  return {
    titleGenerationPending,
    titleRequestSeqRef,
    resetTitleGeneration,
    requestGeneratedTitleOnce,
  };
}

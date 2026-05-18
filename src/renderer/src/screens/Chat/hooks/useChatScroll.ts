import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ChatActivityGroup, ChatMessage } from "../types";

interface UseChatScrollArgs {
  messages: ChatMessage[];
  activityGroups: ChatActivityGroup[];
  isLoading: boolean;
  onNewChat?: () => void;
}

interface UseChatScrollResult {
  messagesEndRef: MutableRefObject<HTMLDivElement | null>;
  messagesContainerRef: MutableRefObject<HTMLDivElement | null>;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  userScrolledUpRef: MutableRefObject<boolean>;
  scrollToBottom: (force?: boolean) => void;
}

export function useChatScroll({
  messages,
  activityGroups,
  isLoading,
  onNewChat,
}: UseChatScrollArgs): UseChatScrollResult {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);

  const scrollToBottom = useCallback((force?: boolean): void => {
    if (!force && userScrolledUpRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    function handleScroll(): void {
      const el = container!;
      userScrolledUpRef.current = !(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
    }
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => scrollToBottom(), [messages, activityGroups, scrollToBottom]);

  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (messages.length > prevCount && messages[messages.length - 1]?.role === "user") {
      userScrolledUpRef.current = false;
      scrollToBottom(true);
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
  }, [isLoading]);

  useEffect(() => {
    function handleShortcut(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        onNewChat?.();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [onNewChat]);

  return {
    messagesEndRef,
    messagesContainerRef,
    inputRef,
    userScrolledUpRef,
    scrollToBottom,
  };
}

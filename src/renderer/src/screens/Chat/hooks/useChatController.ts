import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateContextUsage,
  inferContextWindow,
  type ContextWindowInfo,
} from "../../../../../shared/chat-metadata";
import type { TraceEvent } from "../../../../../shared/traces";
import { PROVIDERS } from "../../../constants";
import { useI18n } from "../../../components/useI18n";
import { SLASH_COMMANDS } from "../chat.constants";
import { isChatActivityEvent } from "../chatActivity";
import { executeLocalCommand, isLocalSlashCommand } from "../chatCommands";
import type {
  ChatActivityGroup,
  ChatActivityGroupStatus,
  ChatController,
  ChatMessage,
  ChatUsage,
  ModelGroup,
  SlashCommand,
} from "../types";

interface UseChatControllerArgs {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  sessionId?: string | null;
  sessionTitle?: string | null;
  conversationVersion: number;
  profile?: string;
  onSessionStarted?: () => void;
  onSessionResolved?: (sessionId: string) => void;
  onSessionTitleChange?: (title: string) => void;
  onNewChat?: () => void;
}

export function useChatController({
  messages,
  setMessages,
  sessionId,
  sessionTitle,
  conversationVersion,
  profile,
  onSessionStarted,
  onSessionResolved,
  onSessionTitleChange,
  onNewChat,
}: UseChatControllerArgs): ChatController {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [activityGroups, setActivityGroups] = useState<ChatActivityGroup[]>([]);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [titleGenerationPending, setTitleGenerationPending] = useState(false);
  const [fastMode, setFastMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoadingRef = useRef(false);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);
  const activeActivityGroupIdRef = useRef<string | null>(null);

  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [currentContextInfo, setCurrentContextInfo] = useState<ContextWindowInfo>(() =>
    inferContextWindow("auto", ""),
  );
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  const profileRef = useRef(profile);
  const sessionIdRef = useRef<string | null>(sessionId ?? null);
  const sessionTitleRef = useRef<string | null>(sessionTitle ?? null);
  const titleRequestSeqRef = useRef(0);
  const sendRunSeqRef = useRef(0);
  const activeSendRunSeqRef = useRef<number | null>(null);
  const finalizedSendRunSeqRef = useRef<number | null>(null);
  const cancelledSendRunSeqsRef = useRef<Set<number>>(new Set());
  const currentContextInfoRef = useRef(currentContextInfo);
  const currentModelRef = useRef(currentModel);
  const currentProviderRef = useRef(currentProvider);

  isLoadingRef.current = isLoading;
  messagesRef.current = messages;
  profileRef.current = profile;
  sessionIdRef.current = sessionId ?? hermesSessionId;
  sessionTitleRef.current = sessionTitle ?? null;
  currentContextInfoRef.current = currentContextInfo;
  currentModelRef.current = currentModel;
  currentProviderRef.current = currentProvider;

  const filteredSlashCommands = useMemo(
    () =>
      slashMenuOpen
        ? SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(slashFilter.toLowerCase()))
        : [],
    [slashMenuOpen, slashFilter],
  );

  useEffect(() => {
    setHermesSessionId(sessionId ?? null);
  }, [sessionId]);

  useEffect(() => {
    titleRequestSeqRef.current += 1;
    setTitleGenerationPending(false);
    setUsage(null);
    setActivityGroups([]);
    activeActivityGroupIdRef.current = null;
    const activeRunSeq = activeSendRunSeqRef.current;
    if (activeRunSeq != null) cancelledSendRunSeqsRef.current.add(activeRunSeq);
    activeSendRunSeqRef.current = null;
    finalizedSendRunSeqRef.current = null;
    setIsLoading(false);
  }, [conversationVersion, profile]);

  useEffect(() => {
    sessionTitleRef.current = sessionTitle ?? null;
  }, [sessionTitle]);

  const scrollToBottom = useCallback((force?: boolean) => {
    if (!force && userScrolledUpRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const beginActivityGroup = useCallback((anchorMessageId: string): void => {
    const now = Date.now();
    const id = `activity-${now}-${Math.random().toString(36).slice(2, 8)}`;
    activeActivityGroupIdRef.current = id;
    setActivityGroups((prev) => [
      ...prev,
      {
        id,
        anchorMessageId,
        status: "running",
        startedAt: now,
        updatedAt: now,
        expanded: false,
        events: [],
      },
    ]);
  }, []);

  const appendActivityEvent = useCallback((traceEvent: TraceEvent): void => {
    if (!isChatActivityEvent(traceEvent)) return;
    setActivityGroups((prev) => {
      let targetIndex = traceEvent.runId
        ? prev.findIndex((group) => group.runId === traceEvent.runId)
        : -1;
      if (targetIndex < 0 && activeActivityGroupIdRef.current) {
        targetIndex = prev.findIndex((group) => group.id === activeActivityGroupIdRef.current);
      }
      if (targetIndex < 0) return prev;

      const target = prev[targetIndex];
      if (target.events.some((event) => event.id === traceEvent.id)) return prev;

      const next = [...prev];
      next[targetIndex] = {
        ...target,
        runId: target.runId || traceEvent.runId,
        status: traceEvent.type === "transport.error" || traceEvent.type.endsWith(".failed") ? "failed" : target.status,
        updatedAt: traceEvent.timestamp,
        events: [...target.events, traceEvent],
      };
      return next;
    });
  }, []);

  const markActiveActivityGroup = useCallback((status: ChatActivityGroupStatus): void => {
    const activeId = activeActivityGroupIdRef.current;
    if (!activeId) return;
    setActivityGroups((prev) =>
      prev
        .map((group) =>
          group.id === activeId
            ? { ...group, status, updatedAt: Date.now() }
            : group,
        )
        .filter((group) => group.id !== activeId || group.events.length > 0),
    );
    activeActivityGroupIdRef.current = null;
  }, []);

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

  const appendFallbackSendError = useCallback(
    (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error || "Unknown error");
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: "agent", content: `Error: ${message}` }]);
    },
    [setMessages],
  );

  const toggleActivityGroup = useCallback((groupId: string): void => {
    setActivityGroups((prev) =>
      prev.map((group) =>
        group.id === groupId ? { ...group, expanded: !group.expanded } : group,
      ),
    );
  }, []);

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);
    const selectedSavedModel = savedModels.find(
      (m) => m.provider === mc.provider && m.model === mc.model,
    );
    setCurrentContextInfo(
      inferContextWindow(mc.provider, mc.model, selectedSavedModel?.contextWindow),
    );

    const groupMap = new Map<string, ModelGroup>();
    for (const m of savedModels) {
      if (!groupMap.has(m.provider)) {
        groupMap.set(m.provider, {
          provider: m.provider,
          providerLabel: PROVIDERS.labels[m.provider] || m.provider,
          models: [],
        });
      }
      groupMap.get(m.provider)!.models.push({
        provider: m.provider,
        model: m.model,
        label: m.name,
        baseUrl: m.baseUrl || "",
        contextWindow: m.contextWindow,
      });
    }
    setModelGroups(Array.from(groupMap.values()));
  }, [profile]);

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

  useEffect(() => {
    if (messages.length === 0) {
      setHermesSessionId(null);
      setUsage(null);
      setActivityGroups([]);
      activeActivityGroupIdRef.current = null;
      titleRequestSeqRef.current += 1;
      setTitleGenerationPending(false);
    }
  }, [messages]);

  useEffect(() => {
    loadModelConfig();
  }, [loadModelConfig]);

  useEffect(() => {
    window.hermesAPI.getConfig("agent.service_tier", profile).then((val) => {
      setFastMode(val === "fast" || val === "priority");
    });
  }, [profile]);

  useEffect(() => {
    if (!showModelPicker) return;
    function handleClickOutside(e: MouseEvent): void {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowModelPicker(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showModelPicker]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) setSlashMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [slashMenuOpen]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashMenuRef.current?.querySelector(".slash-menu-item-active")?.scrollIntoView({ block: "nearest" });
  }, [slashSelectedIndex, slashMenuOpen]);

  useEffect(() => {
    const cleanupChunk = window.hermesAPI.onChatChunk((chunk) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === "agent") return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        if (!chunk || !chunk.trim()) return prev;
        return [...prev, { id: `agent-${Date.now()}`, role: "agent", content: chunk }];
      });
    });
    const cleanupTraceEvent = window.hermesAPI.onChatTraceEvent(appendActivityEvent);
    const cleanupDone = window.hermesAPI.onChatDone((sessionId) => {
      if (sessionId) setHermesSessionId(sessionId);
      finalizeActiveChatRun("completed");
    });
    const cleanupError = window.hermesAPI.onChatError((error) => {
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
  }, [appendActivityEvent, finalizeActiveChatRun, setMessages]);

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

  async function selectModel(
    provider: string,
    model: string,
    baseUrl: string,
    contextWindow?: number,
  ): Promise<void> {
    await window.hermesAPI.setModelConfig(provider, model, baseUrl, profile);
    setCurrentModel(model);
    setCurrentProvider(provider);
    setCurrentBaseUrl(baseUrl);
    setCurrentContextInfo(inferContextWindow(provider, model, contextWindow));
    setShowModelPicker(false);
    setCustomModelInput("");
  }

  async function handleCustomModelSubmit(): Promise<void> {
    const model = customModelInput.trim();
    if (model) await selectModel(currentProvider === "auto" ? "auto" : currentProvider, model, currentBaseUrl);
  }

  async function requestGeneratedTitleOnce(
    resolvedSessionId: string | undefined,
    conversationMessages: ChatMessage[],
    requestSeq: number,
  ): Promise<void> {
    if (!resolvedSessionId || sessionTitleRef.current) return;
    const eligibleUserMessages = conversationMessages.filter(
      (message) => message.role === "user" && !message.content.trim().startsWith("/"),
    );
    if (eligibleUserMessages.length !== 1) return;

    setTitleGenerationPending(true);
    try {
      const firstEligibleIndex = conversationMessages.findIndex(
        (message) => message.role === "user" && !message.content.trim().startsWith("/"),
      );
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
  }

  function handleClear(): void {
    if (isLoading) {
      window.hermesAPI.abortChat();
      cancelActiveChatRun("aborted");
    }
    setMessages([]);
    setHermesSessionId(null);
    setUsage(null);
    setTitleGenerationPending(false);
    setActivityGroups([]);
    activeActivityGroupIdRef.current = null;
    activeSendRunSeqRef.current = null;
    finalizedSendRunSeqRef.current = null;
  }

  async function handleSend(): Promise<void> {
    const text = input.trim();
    if (!text || isLoading) return;
    setSlashMenuOpen(false);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";

    if (text.startsWith("/")) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      if (isLocalSlashCommand(cmd)) {
        if (cmd !== "/new" && cmd !== "/clear") {
          setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: "user", content: text }]);
        }
        await executeLocalCommand(text, { profile, usage, t, onNewChat, handleClear, setFastMode, setMessages });
        return;
      }
    }

    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: text };
    const requestSeq = titleRequestSeqRef.current;
    const historyMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const runSeq = beginChatRun();
    setMessages((prev) => [...prev, userMessage]);
    beginActivityGroup(userMessage.id);
    onSessionStarted?.();
    try {
      const result = await window.hermesAPI.sendMessage(
        text,
        profile,
        hermesSessionId || undefined,
        historyMessages,
      );
      const resolvedSessionId = result.sessionId || hermesSessionId || undefined;
      const shouldApplyResult = isSendRunCurrentOrFinalized(runSeq);
      if (shouldApplyResult && resolvedSessionId) {
        setHermesSessionId(resolvedSessionId);
        sessionIdRef.current = resolvedSessionId;
        onSessionResolved?.(resolvedSessionId);
      }
      const titleMessages: ChatMessage[] = [
        ...messages,
        userMessage,
        ...(result.response.trim()
          ? [
              {
                id: `agent-title-${Date.now()}`,
                role: "agent" as const,
                content: result.response,
              },
            ]
          : []),
      ];
      finalizeChatRun(runSeq, "completed");
      if (shouldApplyResult) await requestGeneratedTitleOnce(resolvedSessionId, titleMessages, requestSeq);
    } catch (error) {
      // Error is usually handled by onChatError IPC listener; only show fallback when no terminal IPC arrived.
      if (finalizeChatRun(runSeq, "failed")) appendFallbackSendError(error);
    }
  }

  async function handleQuickAsk(): Promise<void> {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const userMessage: ChatMessage = { id: `user-btw-${Date.now()}`, role: "user", content: `💭 ${text}` };
    const runSeq = beginChatRun();
    setMessages((prev) => [...prev, userMessage]);
    beginActivityGroup(userMessage.id);
    try {
      await window.hermesAPI.sendMessage(
        `/btw ${text}`,
        profile,
        hermesSessionId || undefined,
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
      finalizeChatRun(runSeq, "completed");
    } catch (error) {
      // Error is usually handled by onChatError IPC listener; only show fallback when no terminal IPC arrived.
      if (finalizeChatRun(runSeq, "failed")) appendFallbackSendError(error);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashSelectedIndex((i) => (i < filteredSlashCommands.length - 1 ? i + 1 : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashSelectedIndex((i) => (i > 0 ? i - 1 : filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleSlashSelect(filteredSlashCommands[slashSelectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    const value = e.target.value;
    setInput(value);
    const target = e.target;
    requestAnimationFrame(() => {
      target.style.height = "auto";
      target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
    });
    if (value.startsWith("/") && !value.includes(" ")) {
      setSlashMenuOpen(true);
      setSlashFilter(value.split(" ")[0]);
      setSlashSelectedIndex(0);
    } else if (slashMenuOpen) {
      setSlashMenuOpen(false);
    }
  }

  function handleSlashSelect(cmd: SlashCommand): void {
    setSlashMenuOpen(false);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    if (cmd.local || ["info"].includes(cmd.category)) {
      if (cmd.name !== "/new" && cmd.name !== "/clear") {
        setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: "user", content: cmd.name }]);
      }
      executeLocalCommand(cmd.name, { profile, usage, t, onNewChat, handleClear, setFastMode, setMessages });
      return;
    }
    setInput(cmd.name + " ");
    inputRef.current?.focus();
  }

  function handleAbort(): void {
    window.hermesAPI.abortChat();
    cancelActiveChatRun("aborted");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const handleApprove = useCallback(() => {
    const userMessage: ChatMessage = { id: `user-approve-${Date.now()}`, role: "user", content: "/approve" };
    setInput("");
    const runSeq = beginChatRun();
    setMessages((prev) => [...prev, userMessage]);
    beginActivityGroup(userMessage.id);
    window.hermesAPI
      .sendMessage("/approve", profile, hermesSessionId || undefined, messages.map((m) => ({ role: m.role, content: m.content })))
      .then(() => finalizeChatRun(runSeq, "completed"))
      .catch((error) => {
        if (finalizeChatRun(runSeq, "failed")) appendFallbackSendError(error);
      });
  }, [appendFallbackSendError, beginActivityGroup, beginChatRun, finalizeChatRun, profile, hermesSessionId, setMessages, messages]);

  const handleDeny = useCallback(() => {
    const userMessage: ChatMessage = { id: `user-deny-${Date.now()}`, role: "user", content: "/deny" };
    setInput("");
    const runSeq = beginChatRun();
    setMessages((prev) => [...prev, userMessage]);
    beginActivityGroup(userMessage.id);
    window.hermesAPI
      .sendMessage("/deny", profile, hermesSessionId || undefined, messages.map((m) => ({ role: m.role, content: m.content })))
      .then(() => finalizeChatRun(runSeq, "completed"))
      .catch((error) => {
        if (finalizeChatRun(runSeq, "failed")) appendFallbackSendError(error);
      });
  }, [appendFallbackSendError, beginActivityGroup, beginChatRun, finalizeChatRun, profile, hermesSessionId, setMessages, messages]);

  const contextUsage = useMemo(() => {
    const usedTokens = usage?.lastTotalTokens ?? 0;
    const contextWindow = usage?.contextWindow ?? currentContextInfo.tokens;
    if (!usedTokens || !contextWindow) return null;
    return {
      usedTokens,
      contextWindow,
      percent: calculateContextUsage(usedTokens, contextWindow),
      source: usage?.contextWindowSource ?? currentContextInfo.source,
      model: usage?.contextModel || currentModel || currentProvider,
    };
  }, [usage, currentContextInfo, currentModel, currentProvider]);

  return {
    input,
    setInput,
    isLoading,
    activityGroups,
    toggleActivityGroup,
    usage,
    contextUsage,
    titleGenerationPending,
    fastMode,
    setFastMode,
    messagesEndRef,
    messagesContainerRef,
    inputRef,
    pickerRef,
    slashMenuRef,
    slashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    setSlashSelectedIndex,
    currentModel,
    currentProvider,
    modelGroups,
    showModelPicker,
    setShowModelPicker,
    customModelInput,
    setCustomModelInput,
    displayModel: currentModel ? currentModel.split("/").pop() || currentModel : currentProvider === "auto" ? t("chat.auto") : t("chat.noModel"),
    visibleMessages: messages.filter((m) => (m.content || "").trim()),
    lastMessageIsAgent: messages.length > 0 && messages[messages.length - 1].role === "agent",
    hermesSessionId,
    loadModelConfig,
    selectModel,
    handleCustomModelSubmit,
    handleSend,
    handleQuickAsk,
    handleKeyDown,
    handleInputChange,
    handleSlashSelect,
    handleAbort,
    handleClear,
    handleApprove,
    handleDeny,
  };
}

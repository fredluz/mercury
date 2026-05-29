import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { calculateContextUsage } from "../../../../../shared/chat-metadata";
import {
  detectCodexAuthRecovery,
  type ChatAuthRecovery,
  type ChatErrorInfo,
} from "../../../../../shared/codex-auth-recovery";
import { useI18n } from "../../../components/useI18n";
import { executeLocalCommand, isLocalSlashCommand } from "../chatCommands";
import type {
  ChatController,
  ChatMessage,
  ChatUsage,
  SlashCommand,
} from "../types";
import { useChatActivityGroups } from "./useChatActivityGroups";
import { useChatIpcListeners } from "./useChatIpcListeners";
import { useChatModelConfig } from "./useChatModelConfig";
import { useChatPerfTracker } from "./chatPerf";
import { useChatRunState } from "./useChatRunState";
import { useChatScroll } from "./useChatScroll";
import { useChatSlashMenu } from "./useChatSlashMenu";
import { useChatTitleGeneration } from "./useChatTitleGeneration";
import {
  sendApprovalCommand,
  sendNormalMessage,
  sendQuickAskMessage,
} from "./chatSendFlows";

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
  onSessionReset?: () => void;
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
  onSessionReset,
  onNewChat,
}: UseChatControllerArgs): ChatController {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [fastMode, setFastMode] = useState(false);
  const [codexAuthRecovery, setCodexAuthRecovery] = useState<
    ChatController["codexAuthRecovery"]
  >(null);
  const messagesRef = useRef(messages);
  const profileRef = useRef(profile);
  const sessionIdRef = useRef<string | null>(sessionId ?? null);
  const sessionTitleRef = useRef<string | null>(sessionTitle ?? null);

  const activity = useChatActivityGroups();
  const runState = useChatRunState({
    markActiveActivityGroup: activity.markActiveActivityGroup,
  });
  const perf = useChatPerfTracker();
  const modelConfig = useChatModelConfig({
    profile,
  });
  const scroll = useChatScroll({
    messages,
    activityGroups: activity.activityGroups,
    isLoading: runState.isLoading,
    onNewChat,
  });
  const slash = useChatSlashMenu({ inputRef: scroll.inputRef, setInput });
  const titleGeneration = useChatTitleGeneration({
    profileRef,
    sessionIdRef,
    sessionTitleRef,
    messagesRef,
    onSessionTitleChange,
  });

  messagesRef.current = messages;
  profileRef.current = profile;
  sessionIdRef.current = sessionId ?? hermesSessionId;
  sessionTitleRef.current = sessionTitle ?? null;

  useEffect(() => {
    setHermesSessionId(sessionId ?? null);
  }, [sessionId]);

  useEffect(() => {
    titleGeneration.resetTitleGeneration(true);
    setUsage(null);
    activity.resetActivityGroups();
    runState.resetRunState({ cancelActive: true });
    perf.reset();
    setCodexAuthRecovery(null);
  }, [
    activity.resetActivityGroups,
    conversationVersion,
    perf.reset,
    profile,
    runState.resetRunState,
    titleGeneration.resetTitleGeneration,
  ]);

  useEffect(() => {
    sessionTitleRef.current = sessionTitle ?? null;
  }, [sessionTitle]);

  useEffect(() => {
    if (messages.length === 0) {
      if (!sessionId) setHermesSessionId(null);
      setUsage(null);
      setCodexAuthRecovery(null);
      activity.resetActivityGroups();
      titleGeneration.resetTitleGeneration(true);
    }
  }, [
    activity.resetActivityGroups,
    messages,
    sessionId,
    titleGeneration.resetTitleGeneration,
  ]);

  useEffect(() => {
    window.hermesAPI.getConfig("agent.service_tier", profile).then((val) => {
      setFastMode(val === "fast" || val === "priority");
    });
  }, [profile]);

  const showCodexAuthRecovery = useCallback(
    (recovery: ChatAuthRecovery, displayMessage?: string): void => {
      setCodexAuthRecovery({
        id: `codex-auth-${Date.now()}`,
        recovery,
        displayMessage:
          displayMessage ||
          "Codex sign-in needs to be refreshed. Re-authenticate with Mercury's in-app Codex login.",
        receivedAt: Date.now(),
      });
    },
    [],
  );

  const dismissCodexAuthRecovery = useCallback((): void => {
    setCodexAuthRecovery(null);
  }, []);

  const formatChatErrorMessage = useCallback(
    (error: string, info?: ChatErrorInfo): string => {
      if (info?.recovery) return t("chat.codexAuthRecoveryTranscript");
      return `Error: ${error}`;
    },
    [t],
  );

  useChatIpcListeners({
    setMessages,
    appendActivityEvent: activity.appendActivityEvent,
    finalizeActiveChatRun: runState.finalizeActiveChatRun,
    setHermesSessionId,
    setUsage,
    currentContextInfoRef: modelConfig.currentContextInfoRef,
    currentModelRef: modelConfig.currentModelRef,
    currentProviderRef: modelConfig.currentProviderRef,
    profileRef,
    onAuthRecovery: showCodexAuthRecovery,
    formatChatErrorMessage,
    perf,
  });

  const getResumeSessionId = useCallback(
    (): string | undefined =>
      hermesSessionId || sessionIdRef.current || undefined,
    [hermesSessionId],
  );

  const appendFallbackSendError = useCallback(
    (error: unknown): void => {
      const message =
        error instanceof Error
          ? error.message
          : String(error || "Unknown error");
      const recoveryInfo = detectCodexAuthRecovery({
        error: message,
        provider: modelConfig.currentProviderRef.current,
        profile: profileRef.current,
      });
      if (recoveryInfo?.recovery) {
        showCodexAuthRecovery(recoveryInfo.recovery, recoveryInfo.displayMessage);
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "agent",
          content: recoveryInfo?.recovery
            ? t("chat.codexAuthRecoveryTranscript")
            : `Error: ${message}`,
        },
      ]);
    },
    [modelConfig.currentProviderRef, setMessages, showCodexAuthRecovery, t],
  );

  const handleClear = useCallback((): void => {
    if (runState.isLoading) {
      window.hermesAPI.abortChat();
      runState.cancelActiveChatRun("aborted");
    }
    setMessages([]);
    setHermesSessionId(null);
    setUsage(null);
    setCodexAuthRecovery(null);
    titleGeneration.resetTitleGeneration(false);
    activity.resetActivityGroups();
    runState.resetRunState();
    perf.reset();
    sessionIdRef.current = null;
    onSessionReset?.();
  }, [activity, onSessionReset, perf, runState, setMessages, titleGeneration]);

  const runLocalCommand = useCallback(
    async (commandText: string): Promise<void> => {
      await executeLocalCommand(commandText, {
        profile,
        usage,
        t,
        onNewChat,
        handleClear,
        setFastMode,
        setMessages,
      });
    },
    [handleClear, onNewChat, profile, setMessages, t, usage],
  );

  const handleSend = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!text || runState.isLoading) return;
    slash.setSlashMenuOpen(false);
    setCodexAuthRecovery(null);
    setInput("");
    slash.resetInputHeight();

    if (text.startsWith("/")) {
      const cmd = text.split(/\s+/)[0].toLowerCase();
      if (isLocalSlashCommand(cmd)) {
        if (cmd !== "/new" && cmd !== "/clear") {
          setMessages((prev) => [
            ...prev,
            { id: `user-${Date.now()}`, role: "user", content: text },
          ]);
        }
        await runLocalCommand(text);
        return;
      }
    }

    await sendNormalMessage({
      text,
      messages,
      setMessages,
      profile,
      beginChatRun: runState.beginChatRun,
      finalizeChatRun: runState.finalizeChatRun,
      beginActivityGroup: activity.beginActivityGroup,
      getResumeSessionId,
      appendFallbackSendError,
      perf,
      titleRequestSeqRef: titleGeneration.titleRequestSeqRef,
      isSendRunCurrentOrFinalized: runState.isSendRunCurrentOrFinalized,
      setHermesSessionId,
      sessionIdRef,
      requestGeneratedTitleOnce: titleGeneration.requestGeneratedTitleOnce,
      onSessionStarted,
      onSessionResolved,
    });
  }, [
    activity.beginActivityGroup,
    appendFallbackSendError,
    getResumeSessionId,
    input,
    messages,
    onSessionResolved,
    onSessionStarted,
    perf,
    profile,
    runLocalCommand,
    runState.beginChatRun,
    runState.finalizeChatRun,
    runState.isLoading,
    runState.isSendRunCurrentOrFinalized,
    setMessages,
    slash,
    titleGeneration,
  ]);

  const handleQuickAsk = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!text || runState.isLoading) return;
    setInput("");
    setCodexAuthRecovery(null);
    slash.resetInputHeight();
    await sendQuickAskMessage({
      text,
      messages,
      setMessages,
      profile,
      beginChatRun: runState.beginChatRun,
      finalizeChatRun: runState.finalizeChatRun,
      beginActivityGroup: activity.beginActivityGroup,
      getResumeSessionId,
      appendFallbackSendError,
      perf,
      isSendRunCurrentOrFinalized: runState.isSendRunCurrentOrFinalized,
      setHermesSessionId,
      sessionIdRef,
      onSessionResolved,
    });
  }, [
    activity.beginActivityGroup,
    appendFallbackSendError,
    getResumeSessionId,
    input,
    messages,
    onSessionResolved,
    perf,
    profile,
    runState.beginChatRun,
    runState.finalizeChatRun,
    runState.isLoading,
    runState.isSendRunCurrentOrFinalized,
    setMessages,
    slash,
  ]);

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand): void => {
      slash.setSlashMenuOpen(false);
      setInput("");
      slash.resetInputHeight();
      if (cmd.local || ["info"].includes(cmd.category)) {
        if (cmd.name !== "/new" && cmd.name !== "/clear") {
          setMessages((prev) => [
            ...prev,
            { id: `user-${Date.now()}`, role: "user", content: cmd.name },
          ]);
        }
        void runLocalCommand(cmd.name);
        return;
      }
      setInput(`${cmd.name} `);
      scroll.inputRef.current?.focus();
    },
    [runLocalCommand, scroll.inputRef, setMessages, slash],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (slash.handleSlashKeyDown(e, handleSlashSelect)) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend, handleSlashSelect, slash],
  );

  const handleAbort = useCallback((): void => {
    perf.markAbortIntent();
    window.hermesAPI.abortChat();
    runState.cancelActiveChatRun("aborted");
    setTimeout(() => scroll.inputRef.current?.focus(), 50);
  }, [perf, runState, scroll.inputRef]);

  const handleApprove = useCallback((): void => {
    setInput("");
    setCodexAuthRecovery(null);
    perf.reset();
    sendApprovalCommand({
      command: "/approve",
      messages,
      setMessages,
      profile,
      beginChatRun: runState.beginChatRun,
      finalizeChatRun: runState.finalizeChatRun,
      beginActivityGroup: activity.beginActivityGroup,
      getResumeSessionId,
      appendFallbackSendError,
    });
  }, [
    activity.beginActivityGroup,
    appendFallbackSendError,
    getResumeSessionId,
    messages,
    perf.reset,
    profile,
    runState.beginChatRun,
    runState.finalizeChatRun,
    setMessages,
  ]);

  const handleDeny = useCallback((): void => {
    setInput("");
    setCodexAuthRecovery(null);
    perf.reset();
    sendApprovalCommand({
      command: "/deny",
      messages,
      setMessages,
      profile,
      beginChatRun: runState.beginChatRun,
      finalizeChatRun: runState.finalizeChatRun,
      beginActivityGroup: activity.beginActivityGroup,
      getResumeSessionId,
      appendFallbackSendError,
    });
  }, [
    activity.beginActivityGroup,
    appendFallbackSendError,
    getResumeSessionId,
    messages,
    perf.reset,
    profile,
    runState.beginChatRun,
    runState.finalizeChatRun,
    setMessages,
  ]);

  const contextUsage = useMemo(() => {
    const usedTokens = usage?.lastTotalTokens ?? 0;
    const contextWindow =
      usage?.contextWindow ?? modelConfig.currentContextInfo.tokens;
    if (!usedTokens || !contextWindow) return null;
    return {
      usedTokens,
      contextWindow,
      percent: calculateContextUsage(usedTokens, contextWindow),
      source:
        usage?.contextWindowSource ?? modelConfig.currentContextInfo.source,
      model:
        usage?.contextModel ||
        modelConfig.currentModel ||
        modelConfig.currentProvider,
    };
  }, [
    usage,
    modelConfig.currentContextInfo,
    modelConfig.currentModel,
    modelConfig.currentProvider,
  ]);

  return {
    input,
    setInput,
    isLoading: runState.isLoading,
    activityGroups: activity.activityGroups,
    toggleActivityGroup: activity.toggleActivityGroup,
    usage,
    contextUsage,
    titleGenerationPending: titleGeneration.titleGenerationPending,
    fastMode,
    setFastMode,
    messagesEndRef: scroll.messagesEndRef,
    messagesContainerRef: scroll.messagesContainerRef,
    inputRef: scroll.inputRef,
    pickerRef: modelConfig.pickerRef,
    slashMenuRef: slash.slashMenuRef,
    slashMenuOpen: slash.slashMenuOpen,
    filteredSlashCommands: slash.filteredSlashCommands,
    slashSelectedIndex: slash.slashSelectedIndex,
    setSlashSelectedIndex: slash.setSlashSelectedIndex,
    currentModel: modelConfig.currentModel,
    currentProvider: modelConfig.currentProvider,
    modelGroups: modelConfig.modelGroups,
    displayModel: modelConfig.currentModel
      ? modelConfig.currentModel.split("/").pop() || modelConfig.currentModel
      : t("chat.agentModelNotConfigured"),
    visibleMessages: messages.filter((m) => (m.content || "").trim()),
    lastMessageIsAgent:
      messages.length > 0 && messages[messages.length - 1].role === "agent",
    hermesSessionId,
    codexAuthRecovery,
    showCodexAuthRecovery,
    dismissCodexAuthRecovery,
    loadModelConfig: modelConfig.loadModelConfig,
    handleSend,
    handleQuickAsk,
    handleKeyDown,
    handleInputChange: slash.handleInputChange,
    handleSlashSelect,
    handleAbort,
    handleClear,
    handleApprove,
    handleDeny,
  };
}

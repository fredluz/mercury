import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS } from "../../../constants";
import { useI18n } from "../../../components/useI18n";
import { SLASH_COMMANDS } from "../chat.constants";
import { executeLocalCommand, isLocalSlashCommand } from "../chatCommands";
import type { ChatController, ChatMessage, ChatUsage, ModelGroup, SlashCommand } from "../types";

interface UseChatControllerArgs {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  profile?: string;
  onSessionStarted?: () => void;
  onNewChat?: () => void;
}

export function useChatController({
  messages,
  setMessages,
  profile,
  onSessionStarted,
  onNewChat,
}: UseChatControllerArgs): ChatController {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hermesSessionId, setHermesSessionId] = useState<string | null>(null);
  const [toolProgress, setToolProgress] = useState<string | null>(null);
  const [usage, setUsage] = useState<ChatUsage | null>(null);
  const [fastMode, setFastMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoadingRef = useRef(false);
  const userScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);

  const [currentModel, setCurrentModel] = useState("");
  const [currentProvider, setCurrentProvider] = useState("auto");
  const [currentBaseUrl, setCurrentBaseUrl] = useState("");
  const [modelGroups, setModelGroups] = useState<ModelGroup[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);

  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  isLoadingRef.current = isLoading;

  const filteredSlashCommands = useMemo(
    () =>
      slashMenuOpen
        ? SLASH_COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(slashFilter.toLowerCase()))
        : [],
    [slashMenuOpen, slashFilter],
  );

  const scrollToBottom = useCallback((force?: boolean) => {
    if (!force && userScrolledUpRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const [mc, savedModels] = await Promise.all([
      window.hermesAPI.getModelConfig(profile),
      window.hermesAPI.listModels(),
    ]);
    setCurrentModel(mc.model);
    setCurrentProvider(mc.provider);
    setCurrentBaseUrl(mc.baseUrl);

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
    if (messages.length === 0) setHermesSessionId(null);
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
    const cleanupDone = window.hermesAPI.onChatDone((sessionId) => {
      if (sessionId) setHermesSessionId(sessionId);
      setToolProgress(null);
      setIsLoading(false);
    });
    const cleanupError = window.hermesAPI.onChatError((error) => {
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: "agent", content: `Error: ${error}` }]);
      setToolProgress(null);
      setIsLoading(false);
    });
    const cleanupToolProgress = window.hermesAPI.onChatToolProgress(setToolProgress);
    const cleanupUsage = window.hermesAPI.onChatUsage((u) => {
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
      }));
    });
    return () => {
      cleanupChunk();
      cleanupDone();
      cleanupError();
      cleanupToolProgress();
      cleanupUsage();
    };
  }, [setMessages]);

  useEffect(() => scrollToBottom(), [messages, scrollToBottom]);

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

  async function selectModel(provider: string, model: string, baseUrl: string): Promise<void> {
    await window.hermesAPI.setModelConfig(provider, model, baseUrl, profile);
    setCurrentModel(model);
    setCurrentProvider(provider);
    setCurrentBaseUrl(baseUrl);
    setShowModelPicker(false);
    setCustomModelInput("");
  }

  async function handleCustomModelSubmit(): Promise<void> {
    const model = customModelInput.trim();
    if (model) await selectModel(currentProvider === "auto" ? "auto" : currentProvider, model, currentBaseUrl);
  }

  function handleClear(): void {
    if (isLoading) {
      window.hermesAPI.abortChat();
      setIsLoading(false);
    }
    setMessages([]);
    setHermesSessionId(null);
    setUsage(null);
    setToolProgress(null);
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

    setIsLoading(true);
    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, role: "user", content: text }]);
    onSessionStarted?.();
    try {
      await window.hermesAPI.sendMessage(
        text,
        profile,
        hermesSessionId || undefined,
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
    } catch {
      // Error already handled by onChatError IPC listener — avoid duplicate
    }
  }

  async function handleQuickAsk(): Promise<void> {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setMessages((prev) => [...prev, { id: `user-btw-${Date.now()}`, role: "user", content: `💭 ${text}` }]);
    try {
      await window.hermesAPI.sendMessage(
        `/btw ${text}`,
        profile,
        hermesSessionId || undefined,
        messages.map((m) => ({ role: m.role, content: m.content })),
      );
    } catch {
      // Error already handled by onChatError IPC listener — avoid duplicate
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
    setIsLoading(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  const handleApprove = useCallback(() => {
    setInput("");
    setIsLoading(true);
    setMessages((prev) => [...prev, { id: `user-approve-${Date.now()}`, role: "user", content: "/approve" }]);
    window.hermesAPI
      .sendMessage("/approve", profile, hermesSessionId || undefined, messages.map((m) => ({ role: m.role, content: m.content })))
      .catch(() => setIsLoading(false));
  }, [profile, hermesSessionId, setMessages, messages]);

  const handleDeny = useCallback(() => {
    setInput("");
    setIsLoading(true);
    setMessages((prev) => [...prev, { id: `user-deny-${Date.now()}`, role: "user", content: "/deny" }]);
    window.hermesAPI
      .sendMessage("/deny", profile, hermesSessionId || undefined, messages.map((m) => ({ role: m.role, content: m.content })))
      .catch(() => setIsLoading(false));
  }, [profile, hermesSessionId, setMessages, messages]);

  return {
    input,
    setInput,
    isLoading,
    toolProgress,
    usage,
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

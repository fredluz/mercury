import type { Dispatch, RefObject, SetStateAction } from "react";
import type { ContextWindowSource } from "../../../../shared/chat-metadata";
import type { TraceEvent } from "../../../../shared/traces";

export interface SlashCommand {
  name: string;
  description: string;
  category: "chat" | "agent" | "tools" | "info";
  /** If true, the command is handled locally instead of sent to the backend */
  local?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
}

export interface ModelGroup {
  provider: string;
  providerLabel: string;
  models: {
    provider: string;
    model: string;
    label: string;
    baseUrl: string;
    contextWindow?: number;
  }[];
}

export interface ChatContextUsage {
  usedTokens: number;
  contextWindow: number;
  percent: number;
  source: ContextWindowSource;
  model: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  lastPromptTokens?: number;
  lastCompletionTokens?: number;
  lastTotalTokens?: number;
  contextWindow?: number;
  contextWindowSource?: ContextWindowSource;
  contextModel?: string;
}

export type ChatActivityGroupStatus = "running" | "completed" | "failed" | "aborted";

export interface ChatActivityGroup {
  id: string;
  runId?: string;
  anchorMessageId: string;
  status: ChatActivityGroupStatus;
  startedAt: number;
  updatedAt: number;
  expanded: boolean;
  events: TraceEvent[];
}

export interface ChatController {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  activityGroups: ChatActivityGroup[];
  toggleActivityGroup: (groupId: string) => void;
  usage: ChatUsage | null;
  contextUsage: ChatContextUsage | null;
  titleGenerationPending: boolean;
  fastMode: boolean;
  setFastMode: Dispatch<SetStateAction<boolean>>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  pickerRef: RefObject<HTMLDivElement | null>;
  slashMenuRef: RefObject<HTMLDivElement | null>;
  slashMenuOpen: boolean;
  filteredSlashCommands: SlashCommand[];
  slashSelectedIndex: number;
  setSlashSelectedIndex: Dispatch<SetStateAction<number>>;
  currentModel: string;
  currentProvider: string;
  modelGroups: ModelGroup[];
  showModelPicker: boolean;
  setShowModelPicker: Dispatch<SetStateAction<boolean>>;
  customModelInput: string;
  setCustomModelInput: Dispatch<SetStateAction<string>>;
  displayModel: string;
  visibleMessages: ChatMessage[];
  lastMessageIsAgent: boolean;
  hermesSessionId: string | null;
  loadModelConfig: () => Promise<void>;
  selectModel: (
    provider: string,
    model: string,
    baseUrl: string,
    contextWindow?: number,
  ) => Promise<void>;
  handleCustomModelSubmit: () => Promise<void>;
  handleSend: () => Promise<void>;
  handleQuickAsk: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleSlashSelect: (cmd: SlashCommand) => void;
  handleAbort: () => void;
  handleClear: () => void;
  handleApprove: () => void;
  handleDeny: () => void;
}

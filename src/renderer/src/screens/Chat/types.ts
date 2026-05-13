import type { Dispatch, RefObject, SetStateAction } from "react";

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
  models: { provider: string; model: string; label: string; baseUrl: string }[];
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
}

export interface ChatController {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  toolProgress: string | null;
  usage: ChatUsage | null;
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
  selectModel: (provider: string, model: string, baseUrl: string) => Promise<void>;
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

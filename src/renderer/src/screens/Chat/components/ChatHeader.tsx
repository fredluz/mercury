import type React from "react";
import { Plus, Trash2 as Trash, Zap } from "lucide-react";
import type { ChatMessage, ChatUsage } from "../types";

interface ChatHeaderProps {
  sessionId: string | null;
  usage: ChatUsage | null;
  fastMode: boolean;
  messages: ChatMessage[];
  profile?: string;
  onFastModeChange: (value: boolean) => void;
  onNewChat?: () => void;
  onClear: () => void;
  t: (key: string, values?: Record<string, string>) => string;
}

export function ChatHeader({
  sessionId,
  usage,
  fastMode,
  messages,
  profile,
  onFastModeChange,
  onNewChat,
  onClear,
  t,
}: ChatHeaderProps): React.JSX.Element {
  return (
    <div className="chat-header">
      <div className="chat-header-left">
        <div className="chat-header-title">
          {sessionId ? t("chat.sessionTitle", { id: sessionId.slice(-6) }) : t("chat.title")}
        </div>
        {usage && (
          <span
            className="chat-token-counter"
            title={`Prompt: ${usage.promptTokens.toLocaleString()} | Completion: ${usage.completionTokens.toLocaleString()}${usage.cost != null ? ` | Cost: $${usage.cost.toFixed(4)}` : ""}`}
          >
            {usage.totalTokens.toLocaleString()} tokens
            {usage.cost != null && <span className="chat-cost"> · ${usage.cost.toFixed(4)}</span>}
          </span>
        )}
      </div>
      <div className="chat-header-actions">
        <div className="chat-fast-wrapper">
          <button
            className={`btn-ghost chat-fast-btn ${fastMode ? "chat-fast-active" : ""}`}
            onClick={async () => {
              const next = !fastMode;
              onFastModeChange(next);
              await window.hermesAPI.setConfig("agent.service_tier", next ? "fast" : "normal", profile);
            }}
          >
            <Zap size={14} />
          </button>
          <div className="chat-fast-popover">
            <strong>{fastMode ? t("chat.fastModeOn") : t("chat.fastMode")}</strong>
            <span>{fastMode ? t("chat.fastModeActive") : t("chat.fastModeInactive")}</span>
          </div>
        </div>
        {onNewChat && (
          <button className="btn-ghost chat-clear-btn" onClick={onNewChat} title={t("chat.newChat")}>
            <Plus size={16} />
          </button>
        )}
        {messages.length > 0 && (
          <button className="btn-ghost chat-clear-btn" onClick={onClear} title={t("chat.clearChat")}>
            <Trash size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

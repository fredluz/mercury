import type React from "react";
import { Plus, Trash2 as Trash, Zap } from "lucide-react";
import { RuntimeDiagnosticNotice } from "../../../components/RuntimeDiagnosticNotice";
import type { RuntimeDiagnostic } from "../../../../../shared/runtime";
import type { ChatContextUsage, ChatMessage } from "../types";

interface ChatHeaderProps {
  sessionId: string | null;
  sessionTitle?: string | null;
  titlePending: boolean;
  contextUsage: ChatContextUsage | null;
  fastMode: boolean;
  messages: ChatMessage[];
  profile?: string;
  runtimeDiagnostic?: RuntimeDiagnostic | null;
  onFastModeChange: (value: boolean) => void;
  onNewChat?: () => void;
  onClear: () => void;
  t: (key: string, values?: Record<string, string>) => string;
}

function formatPercent(percent: number): string {
  if (percent <= 0) return "0%";
  if (percent < 1) return "<1%";
  if (percent >= 100) return "100%+";
  return `${Math.round(percent)}%`;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString();
}

export function ChatHeader({
  sessionId,
  sessionTitle,
  titlePending,
  contextUsage,
  fastMode,
  messages,
  profile,
  runtimeDiagnostic,
  onFastModeChange,
  onNewChat,
  onClear,
  t,
}: ChatHeaderProps): React.JSX.Element {
  const cleanTitle = sessionTitle?.trim();
  const title = cleanTitle
    ? cleanTitle
    : titlePending
      ? t("chat.generatingTitle")
      : messages.length === 0
        ? t("chat.title")
        : t("chat.untitledChat");
  const profileName = profile && profile !== "default" ? profile : t("chat.defaultAgent");
  const contextPercent = contextUsage ? formatPercent(contextUsage.percent) : null;
  const contextTooltip = contextUsage
    ? t(
        contextUsage.source === "explicit" || contextUsage.source === "known-model"
          ? "chat.contextTooltip"
          : "chat.contextTooltipEstimated",
        {
          used: formatNumber(contextUsage.usedTokens),
          limit: formatNumber(contextUsage.contextWindow),
          model: contextUsage.model,
        },
      )
    : "";

  return (
    <div className="chat-header">
      <div className="chat-header-left">
        <div className="chat-header-title-row">
          <div
            className={`chat-header-title ${titlePending && !cleanTitle ? "chat-header-title-pending" : ""}`}
            title={sessionId ? `${title} · ${sessionId}` : title}
          >
            {title}
          </div>
        </div>
        <div className="chat-header-meta">
          <span className="chat-agent-identity">
            {t("chat.agentIdentity", { profile: profileName })}
          </span>
          {contextUsage && contextPercent && (
            <span className="chat-context-counter" title={contextTooltip}>
              {t("chat.contextUsed", { percent: contextPercent })}
            </span>
          )}
          <RuntimeDiagnosticNotice diagnostic={runtimeDiagnostic} compact />
        </div>
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

import type React from "react";
import { memo } from "react";
import { AgentMarkdown } from "../../../components/AgentMarkdown";
import MercuryMark from "../../../components/common/MercuryMark";
import { useI18n } from "../../../components/useI18n";
import { APPROVAL_RE } from "../chat.constants";
import type { ChatMessage } from "../types";

export function MercuryAvatar({ size = 30 }: { size?: number }): React.JSX.Element {
  return (
    <div className="chat-avatar chat-avatar-agent">
      <MercuryMark size={size} decorative />
    </div>
  );
}

export const HermesAvatar = MercuryAvatar;

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className={`chat-message chat-message-${msg.role}`}>
      {msg.role === "user" ? <div className="chat-avatar chat-avatar-user">U</div> : <MercuryAvatar />}
      <div className={`chat-bubble chat-bubble-${msg.role}`}>
        {msg.role === "agent" ? <AgentMarkdown>{msg.content}</AgentMarkdown> : msg.content}
      </div>
      {msg.role === "agent" && !isLoading && isLast && APPROVAL_RE.test(msg.content) && (
        <div className="chat-approval-bar">
          <button className="chat-approval-btn chat-approve" onClick={onApprove}>
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}
    </div>
  );
});

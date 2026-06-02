import type React from "react";
import { memo } from "react";
import { AgentMarkdown } from "../../../components/AgentMarkdown";
import AgentAvatar from "../../../components/common/AgentAvatar";
import { useI18n } from "../../../components/useI18n";
import { APPROVAL_RE } from "../chat.constants";
import type { ChatMessage } from "../types";
import type { ProfileInfo } from "../../../../../shared/profiles";

export function MercuryAvatar({
  size = 30,
  profile,
  profileName = "default",
}: {
  size?: number;
  profile?: ProfileInfo | null;
  profileName?: string;
}): React.JSX.Element {
  if (profile) {
    return (
      <AgentAvatar
        profile={profile}
        className="chat-avatar chat-avatar-agent"
        markSize={size}
      />
    );
  }

  const cleanProfileName = profileName.trim() || "default";
  return (
    <AgentAvatar
      profileName={cleanProfileName}
      displayName={cleanProfileName === "default" ? "Mercury" : cleanProfileName}
      isDefault={cleanProfileName === "default"}
      className="chat-avatar chat-avatar-agent"
      markSize={size}
    />
  );
}

export const HermesAvatar = MercuryAvatar;

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  agentProfile?: ProfileInfo | null;
  agentProfileName?: string;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  agentProfile,
  agentProfileName,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className={`chat-message chat-message-${msg.role}`}>
      {msg.role === "user" ? (
        <div className="chat-avatar chat-avatar-user">U</div>
      ) : (
        <MercuryAvatar profile={agentProfile} profileName={agentProfileName} />
      )}
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

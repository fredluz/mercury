import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentCreationDraft,
  AgentDraftChangeEvent,
  AgentDraftPatch,
} from "../../../../shared/agents";
import { ArrowLeft, Send } from "lucide-react";
import MercuryMark from "../../components/common/MercuryMark";
import { useI18n } from "../../components/useI18n";
import { useChatController } from "../Chat/hooks/useChatController";
import type { ChatMessage } from "../Chat/types";
import { AgentDraftNotifications } from "./AgentDraftNotifications";
import { AgentDraftReview } from "./AgentDraftReview";

function createWelcomeMessage(
  name: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): ChatMessage {
  return {
    id: `agent-creator-welcome-${Date.now()}`,
    role: "agent",
    content: t("agents.creatorWelcome", { name }),
  };
}

interface AgentCreatorProps {
  draft: AgentCreationDraft;
  notifications: AgentDraftChangeEvent[];
  committing: boolean;
  commitError: string | null;
  onCommit: () => void;
  onUpdateDraft: (patch: AgentDraftPatch) => Promise<void>;
  onClose: () => void;
}

export function AgentCreator({
  draft,
  notifications,
  committing,
  commitError,
  onCommit,
  onUpdateDraft,
  onClose,
}: AgentCreatorProps): React.JSX.Element {
  const { t } = useI18n();
  const draftIdRef = useRef(draft.id);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createWelcomeMessage(draft.displayName, t),
  ]);
  const [creatorSessionId, setCreatorSessionId] = useState<string | null>(null);
  const [conversationVersion, setConversationVersion] = useState(0);

  useEffect(() => {
    if (draftIdRef.current === draft.id) return;
    draftIdRef.current = draft.id;
    setCreatorSessionId(null);
    setMessages([createWelcomeMessage(draft.displayName, t)]);
    setConversationVersion((value) => value + 1);
  }, [draft.displayName, draft.id, t]);

  const chatOptions = useMemo(
    () => ({ mode: "agent-creation" as const, agentDraftId: draft.id }),
    [draft.id],
  );

  const chat = useChatController({
    messages,
    setMessages,
    sessionId: creatorSessionId,
    sessionTitle: draft.displayName,
    conversationVersion,
    profile: "default",
    chatOptions,
    onSessionResolved: setCreatorSessionId,
  });

  return (
    <div className="agents-creator-screen">
      <header className="agents-creator-header">
        <div className="agents-creator-title-group">
          <div className="agents-creator-mark">
            <MercuryMark size={30} decorative />
          </div>
          <div>
            <p className="agents-draft-eyebrow">
              {t("agents.creatorEyebrowNew")}
            </p>
            <h2>{t("agents.creatorTitleNew")}</h2>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <ArrowLeft size={14} />
          {t("agents.creatorBackShort")}
        </button>
      </header>

      <div className="agents-creator-layout">
        <section
          className="agents-creator-chat"
          aria-label={t("agents.creatorChatLabel")}
        >
          <div
            className="agents-creator-chat-messages"
            ref={chat.messagesContainerRef}
          >
            {chat.visibleMessages.map((message) => {
              const bubbleRole =
                message.role === "agent" ? "assistant" : "user";
              return (
                <div
                  key={message.id}
                  className={`agents-creator-message agents-creator-message-${bubbleRole}`}
                >
                  <span className="agents-creator-message-role">
                    {message.role === "agent"
                      ? "Mercury"
                      : t("agents.creatorYou")}
                  </span>
                  <p>{message.content}</p>
                </div>
              );
            })}
            <div ref={chat.messagesEndRef} />
          </div>
          <div className="agents-creator-composer-wrap">
            <AgentDraftNotifications notifications={notifications} />
            <div className="agents-creator-composer">
              <textarea
                ref={chat.inputRef}
                className="input agents-creator-input"
                value={chat.input}
                placeholder={t("agents.creatorInputPlaceholder")}
                onChange={chat.handleInputChange}
                onKeyDown={chat.handleKeyDown}
              />
              <button
                className="btn btn-primary"
                onClick={() => void chat.handleSend()}
                disabled={chat.isLoading || !chat.input.trim()}
              >
                <Send size={14} />
                {chat.isLoading ? t("common.loading") : t("chat.send")}
              </button>
            </div>
          </div>
        </section>

        <AgentDraftReview
          draft={draft}
          committing={committing}
          commitError={commitError}
          onCommit={onCommit}
          onUpdateDraft={onUpdateDraft}
        />
      </div>
    </div>
  );
}

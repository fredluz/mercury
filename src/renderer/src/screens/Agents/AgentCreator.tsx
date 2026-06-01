import { useEffect, useMemo, useState } from "react";
import type {
  AgentCreationDraft,
  AgentDraftChangeEvent,
  AgentDraftPatch,
} from "../../../../shared/agents";
import { ArrowLeft, Send } from "lucide-react";
import MercuryMark from "../../components/common/MercuryMark";
import { useI18n } from "../../components/useI18n";
import { AgentDraftNotifications } from "./AgentDraftNotifications";
import { AgentDraftReview } from "./AgentDraftReview";

interface CreatorMessage {
  role: "user" | "assistant";
  content: string;
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
  const [messages, setMessages] = useState<CreatorMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    setMessages((current) => {
      if (current.length > 0) return current;
      return [
        {
          role: "assistant",
          content: t("agents.creatorWelcome", { name: draft.displayName }),
        },
      ];
    });
  }, [draft.displayName, t]);

  const history = useMemo(
    () =>
      messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    [messages],
  );

  async function handleSend(): Promise<void> {
    const text = input.trim();
    if (!text || sending) return;
    const nextMessages: CreatorMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setSendError(null);
    try {
      const result = await window.hermesAPI.sendMessage(
        text,
        "default",
        undefined,
        history,
        { mode: "agent-creation", agentDraftId: draft.id },
      );
      if (result.response.trim()) {
        setMessages((current) => [
          ...current,
          { role: "assistant", content: result.response },
        ]);
      }
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : t("agents.creatorSendFailed"),
      );
    } finally {
      setSending(false);
    }
  }

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
          <div className="agents-creator-chat-messages">
            {messages.map((message, index) => (
              <div
                key={`${message.role}:${index}`}
                className={`agents-creator-message agents-creator-message-${message.role}`}
              >
                <span className="agents-creator-message-role">
                  {message.role === "assistant"
                    ? "Mercury"
                    : t("agents.creatorYou")}
                </span>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
          {sendError ? (
            <div className="agents-create-error" role="alert">
              {sendError}
            </div>
          ) : null}
          <div className="agents-creator-composer-wrap">
            <AgentDraftNotifications notifications={notifications} />
            <div className="agents-creator-composer">
              <textarea
                className="input agents-creator-input"
                value={input}
                placeholder={t("agents.creatorInputPlaceholder")}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <button
                className="btn btn-primary"
                onClick={() => void handleSend()}
                disabled={sending || !input.trim()}
              >
                <Send size={14} />
                {sending ? t("common.loading") : t("chat.send")}
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

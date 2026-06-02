import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentCreationDraft,
  AgentDraftChangeEvent,
  AgentDraftPatch,
  AgentSeedSkill,
  AgentSeedSkillPrepareRequest,
  AttachAgentSeedSkillResult,
} from "../../../../shared/agents";
import { ArrowLeft, Send } from "lucide-react";
import { Plus, Puzzle, X } from "../../assets/icons";
import MercuryMark from "../../components/common/MercuryMark";
import { useI18n } from "../../components/useI18n";
import { useChatController } from "../Chat/hooks/useChatController";
import type { ChatMessage } from "../Chat/types";
import { AgentDraftNotifications } from "./AgentDraftNotifications";
import { AgentDraftReview } from "./AgentDraftReview";
import { AgentSeedSkillModal } from "./AgentSeedSkillModal";

export function seedSkillLabel(seed: AgentSeedSkill): string {
  const leaf =
    seed.kind === "source" ? seed.directoryName || seed.name : seed.name;
  return `${seed.category}/${leaf}`;
}

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

function createSeedSkillAutoPrompt(): string {
  return [
    "A seed skill is now attached to this agent draft and is available in the Seed skill briefing.",
    "Automatically analyze the attached skill now: acknowledge that you can see it, explain what kind of agent best suits it, and fill missing/default displayName, description, and persona fields while preserving deliberate existing choices unless Fred asks to replace them.",
    "Use the <draft-mutation> delta contract for displayName, description, and persona. Do not emit seedSkill.",
  ].join("\n");
}

interface AgentCreatorProps {
  draft: AgentCreationDraft;
  notifications: AgentDraftChangeEvent[];
  committing: boolean;
  commitError: string | null;
  remoteOnly: boolean;
  onCommit: () => void;
  onUpdateDraft: (patch: AgentDraftPatch) => Promise<void>;
  onAttachSeedSkill: (
    seed: AgentSeedSkillPrepareRequest | null,
  ) => Promise<AttachAgentSeedSkillResult>;
  onClose: () => void;
}

export function AgentCreator({
  draft,
  notifications,
  committing,
  commitError,
  remoteOnly,
  onCommit,
  onUpdateDraft,
  onAttachSeedSkill,
  onClose,
}: AgentCreatorProps): React.JSX.Element {
  const { t } = useI18n();
  const draftIdRef = useRef(draft.id);
  const autoAnalyzedSeedFingerprintsRef = useRef<Set<string>>(
    new Set(draft.seedSkill?.fingerprint ? [draft.seedSkill.fingerprint] : []),
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createWelcomeMessage(draft.displayName, t),
  ]);
  const [creatorSessionId, setCreatorSessionId] = useState<string | null>(null);
  const [conversationVersion, setConversationVersion] = useState(0);
  const [seedModalOpen, setSeedModalOpen] = useState(false);
  const [attachedSeedForAutoAnalysis, setAttachedSeedForAutoAnalysis] =
    useState<AgentSeedSkill | null>(null);

  useEffect(() => {
    if (draftIdRef.current === draft.id) return;
    draftIdRef.current = draft.id;
    autoAnalyzedSeedFingerprintsRef.current = new Set(
      draft.seedSkill?.fingerprint ? [draft.seedSkill.fingerprint] : [],
    );
    setAttachedSeedForAutoAnalysis(null);
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

  const seed = draft.seedSkill ?? null;
  const hasConversation = chat.visibleMessages.some(
    (message) => message.role === "user",
  );
  const showHeaderAffordance = hasConversation || Boolean(seed);
  const affordanceDisabled = chat.isLoading || remoteOnly;
  const affordanceTitle = remoteOnly
    ? t("agents.seedRemoteDisabled")
    : chat.isLoading
      ? t("agents.seedBusyDisabled")
      : undefined;

  function openSeedModal(): void {
    if (affordanceDisabled) return;
    setSeedModalOpen(true);
  }

  const seedForAutoAnalysis = seed ?? attachedSeedForAutoAnalysis;

  useEffect(() => {
    if (!seedForAutoAnalysis || chat.isLoading) return;
    const { fingerprint } = seedForAutoAnalysis;
    if (autoAnalyzedSeedFingerprintsRef.current.has(fingerprint)) return;
    autoAnalyzedSeedFingerprintsRef.current.add(fingerprint);
    setMessages((prev) => [
      ...prev,
      {
        id: `agent-creator-seed-auto-${Date.now()}`,
        role: "user",
        content: t("agents.seedAutoAnalyzing"),
      },
    ]);
    void chat.handleSend(createSeedSkillAutoPrompt());
  }, [chat, seedForAutoAnalysis, t]);

  async function attachSeedSkill(
    seedRequest: AgentSeedSkillPrepareRequest,
  ): Promise<AttachAgentSeedSkillResult> {
    const result = await onAttachSeedSkill(seedRequest);
    if (result.success)
      setAttachedSeedForAutoAnalysis(result.draft.seedSkill ?? null);
    return result;
  }

  async function clearSeedSkill(): Promise<void> {
    if (affordanceDisabled) return;
    setAttachedSeedForAutoAnalysis(null);
    await onAttachSeedSkill(null);
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
        <div className="agents-creator-header-actions">
          {showHeaderAffordance ? (
            seed ? (
              <div className="agents-seed-chip" title={affordanceTitle}>
                <Puzzle size={14} />
                <span className="agents-seed-chip-label">
                  {t("agents.seedChip", { name: seedSkillLabel(seed) })}
                </span>
                <button
                  type="button"
                  className="agents-seed-chip-btn"
                  onClick={openSeedModal}
                  disabled={affordanceDisabled}
                >
                  {t("agents.seedReplace")}
                </button>
                <button
                  type="button"
                  className="agents-seed-chip-btn"
                  onClick={() => void clearSeedSkill()}
                  disabled={affordanceDisabled}
                  aria-label={t("agents.seedClear")}
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm agents-seed-header-btn"
                onClick={openSeedModal}
                disabled={affordanceDisabled}
                title={affordanceTitle}
              >
                <Puzzle size={14} />
                <Plus size={12} />
                {t("agents.seedCreateFromSkill")}
              </button>
            )
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <ArrowLeft size={14} />
            {t("agents.creatorBackShort")}
          </button>
        </div>
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
              const isSystemNote = message.id.startsWith(
                "agent-creator-seed-auto-",
              );
              const bubbleRole = isSystemNote
                ? "system"
                : message.role === "agent"
                  ? "assistant"
                  : "user";
              return (
                <div
                  key={message.id}
                  className={`agents-creator-message agents-creator-message-${bubbleRole}`}
                >
                  <span className="agents-creator-message-role">
                    {isSystemNote
                      ? t("agents.creatorSystem")
                      : message.role === "agent"
                        ? "Mercury"
                        : t("agents.creatorYou")}
                  </span>
                  <p>{message.content}</p>
                </div>
              );
            })}
            <div ref={chat.messagesEndRef} />
            {!showHeaderAffordance ? (
              <div className="agents-seed-cta">
                <button
                  type="button"
                  className="agents-seed-cta-btn"
                  onClick={openSeedModal}
                  disabled={affordanceDisabled}
                  title={affordanceTitle}
                >
                  <span className="agents-seed-cta-icon">
                    <Puzzle size={20} />
                    <Plus size={13} className="agents-seed-cta-plus" />
                  </span>
                  {t("agents.seedCreateFromSkill")}
                </button>
                <p className="agents-seed-cta-hint">
                  {t("agents.seedHeaderHint")}
                </p>
              </div>
            ) : null}
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
          onClearSeedSkill={clearSeedSkill}
          seedActionsDisabled={affordanceDisabled}
        />
      </div>

      {seedModalOpen ? (
        <AgentSeedSkillModal
          remoteOnly={remoteOnly}
          onAttach={attachSeedSkill}
          onClose={() => setSeedModalOpen(false)}
        />
      ) : null}
    </div>
  );
}

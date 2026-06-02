import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  ChatBubble,
  Plus,
  Puzzle,
  Sparkles,
  Trash,
  Wrench,
} from "../../assets/icons";
import { ImagePlus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AgentCommitResult,
  AgentCreationDraft,
  AgentDraftChangeEvent,
  AgentDraftPatch,
  AgentSeedSkillPrepareRequest,
  AttachAgentSeedSkillResult,
} from "../../../../shared/agents";
import type { ProfileInfo } from "../../../../shared/profiles";
import AgentAvatar from "../../components/common/AgentAvatar";
import { AgentModelConfigModal } from "../../components/AgentModelConfigModal";
import { useI18n } from "../../components/useI18n";
import { normalizeAvatarFileToPngDataUrl } from "../../utils/agent-avatar-image";
import { AgentCreator } from "./AgentCreator";

type ProfileActionView = "chat" | "skills" | "tools" | "soul" | "memory";

interface ProfileAction {
  view: ProfileActionView;
  icon: LucideIcon;
  labelKey: string;
}

const PROFILE_ACTIONS: ProfileAction[] = [
  { view: "chat", icon: ChatBubble, labelKey: "agents.actionChat" },
  { view: "skills", icon: Puzzle, labelKey: "agents.actionSkills" },
  { view: "tools", icon: Wrench, labelKey: "agents.actionTools" },
  { view: "soul", icon: Sparkles, labelKey: "agents.actionPersona" },
  { view: "memory", icon: Brain, labelKey: "agents.actionMemory" },
];

interface AgentsProps {
  activeProfile: string;
  onSelectProfile: (name: string) => void;
  onProfileAction: (view: ProfileActionView) => void;
}

function displayNameFor(profile: ProfileInfo): string {
  return profile.displayName.trim() || profile.name;
}

function commitFailureMessage(result: Extract<AgentCommitResult, { success: false }>): string {
  return `${result.code}: ${result.error}`;
}

function Agents({
  activeProfile,
  onSelectProfile,
  onProfileAction,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const [agents, setAgents] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<AgentCreationDraft | null>(null);
  const [draftNotifications, setDraftNotifications] = useState<AgentDraftChangeEvent[]>([]);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [modelAgent, setModelAgent] = useState<ProfileInfo | null>(null);
  const [avatarTarget, setAvatarTarget] = useState<ProfileInfo | null>(null);
  const [avatarMutatingProfile, setAvatarMutatingProfile] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAgents = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setAgents(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAgents().catch((err) => {
        setError(err instanceof Error ? err.message : t("agents.loadFailed"));
        setLoading(false);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAgents, t]);

  useEffect(() => {
    const unsubscribe = window.hermesAPI.onAgentDraftChanged((event) => {
      setCurrentDraft((draft) => {
        if (!draft || draft.id !== event.draftId) return draft;
        return event.snapshot;
      });
      if (event.notification) {
        setDraftNotifications((current) => [event, ...current].slice(0, 6));
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.hermesAPI
      .isRemoteOnlyMode()
      .then((value) => {
        if (!cancelled) setRemoteOnly(value);
      })
      .catch(() => {
        if (!cancelled) setRemoteOnly(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!currentDraft?.id) return;
    let cancelled = false;
    void window.hermesAPI.getAgentDraft(currentDraft.id).then((draft) => {
      if (!cancelled && draft) setCurrentDraft(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [currentDraft?.id]);

  async function handleNewAgent(): Promise<void> {
    setCreatingDraft(true);
    setError("");
    setCommitError(null);
    setDraftNotifications([]);
    try {
      const draft = await window.hermesAPI.createAgentDraft();
      const authoritative = await window.hermesAPI.getAgentDraft(draft.id);
      setCurrentDraft(authoritative ?? draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agents.createFailed"));
    } finally {
      setCreatingDraft(false);
    }
  }

  async function handleDelete(profile: ProfileInfo): Promise<void> {
    if (!profile.deletable) return;
    const result = await window.hermesAPI.deleteProfile(profile.name);
    if (result.success) {
      if (activeProfile === profile.name) onSelectProfile("default");
      void loadAgents();
    } else {
      setError(result.error || t("agents.deleteFailed"));
    }
    setConfirmDelete(null);
  }

  function canCustomizeAvatar(profile: ProfileInfo): boolean {
    return profile.name !== "default" && profile.kind === "custom" && !profile.immutable;
  }

  function handleChooseAvatar(profile: ProfileInfo): void {
    if (!canCustomizeAvatar(profile) || avatarMutatingProfile) return;
    setAvatarError(null);
    setAvatarTarget(profile);
    avatarFileInputRef.current?.click();
  }

  async function handleAvatarFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    const target = avatarTarget;
    event.currentTarget.value = "";
    if (!file || !target || !canCustomizeAvatar(target)) return;

    setAvatarMutatingProfile(target.name);
    setAvatarError(null);
    try {
      const imageDataUrl = await normalizeAvatarFileToPngDataUrl(file);
      const result = await window.hermesAPI.setAgentAvatar({
        profile: target.name,
        imageDataUrl,
      });
      if (result.success) {
        await loadAgents();
      } else {
        setAvatarError(`${t("agents.avatarUploadFailed")}: ${result.error}`);
      }
    } catch (err) {
      setAvatarError(
        err instanceof Error && err.message !== "avatarInvalidFile"
          ? `${t("agents.avatarUploadFailed")}: ${err.message}`
          : t("agents.avatarInvalidFile"),
      );
    } finally {
      setAvatarMutatingProfile(null);
      setAvatarTarget(null);
    }
  }

  async function handleClearAvatar(profile: ProfileInfo): Promise<void> {
    if (!canCustomizeAvatar(profile) || avatarMutatingProfile) return;
    setAvatarMutatingProfile(profile.name);
    setAvatarError(null);
    try {
      const result = await window.hermesAPI.clearAgentAvatar({ profile: profile.name });
      if (result.success) {
        await loadAgents();
      } else {
        setAvatarError(`${t("agents.avatarClearFailed")}: ${result.error}`);
      }
    } catch (err) {
      setAvatarError(
        err instanceof Error
          ? `${t("agents.avatarClearFailed")}: ${err.message}`
          : t("agents.avatarClearFailed"),
      );
    } finally {
      setAvatarMutatingProfile(null);
    }
  }

  async function handleSelect(profile: ProfileInfo): Promise<void> {
    const success = await window.hermesAPI.setActiveProfile(profile.name);
    if (!success) {
      setError(t("agents.activateFailed"));
      return;
    }
    onSelectProfile(profile.name);
    void loadAgents();
  }

  async function handleProfileAction(
    agent: ProfileInfo,
    view: ProfileActionView,
  ): Promise<void> {
    await handleSelect(agent);
    onProfileAction(view);
  }

  async function handleUpdateDraft(patch: AgentDraftPatch): Promise<void> {
    if (!currentDraft) return;
    const result = await window.hermesAPI.updateAgentDraft({
      draftId: currentDraft.id,
      expectedRevision: currentDraft.revision,
      mutationId: `ui:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      patch,
    });
    if (result.success) {
      setCurrentDraft(result.draft);
      setCommitError(null);
    } else {
      setCommitError(`${result.code}: ${result.error}`);
      if (result.draft) setCurrentDraft(result.draft);
    }
  }

  async function handleAttachSeedSkill(
    seedSkill: AgentSeedSkillPrepareRequest | null,
  ): Promise<AttachAgentSeedSkillResult> {
    if (!currentDraft) {
      return {
        success: false,
        code: "not-found",
        error: t("agents.seedAttachFailed"),
      };
    }
    const result = await window.hermesAPI.attachAgentSeedSkill({
      draftId: currentDraft.id,
      expectedRevision: currentDraft.revision,
      mutationId: `ui:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      seedSkill,
    });
    if (result.success) {
      setCurrentDraft(result.draft);
      setCommitError(null);
    } else {
      if (result.draft) setCurrentDraft(result.draft);
      // The modal surfaces its own error when attaching; a clear has no modal,
      // so surface its failure in the review pane.
      if (seedSkill === null) {
        setCommitError(`${result.code}: ${result.error}`);
      }
    }
    return result;
  }

  async function handleCommitDraft(): Promise<void> {
    if (!currentDraft || committing) return;
    setCommitting(true);
    setCommitError(null);
    const result = await window.hermesAPI.commitAgentDraft({
      draftId: currentDraft.id,
      expectedRevision: currentDraft.revision,
      activate: true,
    });
    if (result.success) {
      setCurrentDraft(null);
      setDraftNotifications([]);
      onSelectProfile(result.agent.name);
      await loadAgents();
      onProfileAction("chat");
    } else {
      if (result.draft) setCurrentDraft(result.draft);
      setCommitError(commitFailureMessage(result));
    }
    setCommitting(false);
  }

  function providerLabel(agent: ProfileInfo): string {
    if (agent.kind === "builtin") return t("agents.builtin");
    return t("agents.custom");
  }

  function isProfileActionAvailable(
    agent: ProfileInfo,
    view: ProfileActionView,
  ): boolean {
    if (agent.immutable && view !== "chat") return false;
    return true;
  }

  if (currentDraft) {
    return (
      <div className="agents-container agents-container-creator">
        <AgentCreator
          draft={currentDraft}
          notifications={draftNotifications}
          committing={committing}
          commitError={commitError}
          onCommit={handleCommitDraft}
          onUpdateDraft={handleUpdateDraft}
          onAttachSeedSkill={handleAttachSeedSkill}
          remoteOnly={remoteOnly}
          onClose={() => {
            setCurrentDraft(null);
            setDraftNotifications([]);
            setCommitError(null);
          }}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="agents-container">
        <div className="agents-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">{t("agents.title")}</h2>
          <p className="agents-subtitle">{t("agents.subtitle")}</p>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => void handleNewAgent()}
          disabled={creatingDraft}
        >
          <Plus size={14} />
          {creatingDraft ? t("agents.creating") : t("agents.newAgent")}
        </button>
      </div>

      <input
        ref={avatarFileInputRef}
        className="agents-avatar-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(event) => void handleAvatarFileChange(event)}
      />

      {error ? <div className="agents-create-error">{error}</div> : null}
      {avatarError ? (
        <div className="agents-create-error">{avatarError}</div>
      ) : null}

      <div className="agents-grid">
        {agents.map((agent) => {
          const name = displayNameFor(agent);
          const isActive = activeProfile === agent.name;
          const canEditAvatar = canCustomizeAvatar(agent);
          const isAvatarMutating = avatarMutatingProfile === agent.name;
          return (
            <div
              key={agent.name}
              className={`agents-card ${isActive ? "active" : ""}`}
              onClick={() => void handleSelect(agent)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSelect(agent);
              }}
            >
              <div className="agents-card-header">
                <AgentAvatar
                  profile={agent}
                  className="agents-card-avatar"
                  markClassName="agents-card-avatar-icon"
                  markSize={30}
                />
                <div className="agents-card-info">
                  <div className="agents-card-name">{name}</div>
                  <div className="agents-card-provider">{providerLabel(agent)}</div>
                </div>
                {isActive ? (
                  <span className="agents-card-active-badge">
                    {t("agents.active")}
                  </span>
                ) : null}
              </div>
              <div className="agents-card-model">
                {agent.description || t("agents.noDescription")}
              </div>
              <div className="agents-card-stats">
                <span>
                  {t("agents.packsCount", { count: agent.selectedPackIds.length })}
                </span>
                <span className="agents-card-dot" />
                <span>
                  {t("agents.docsPointersCount", { count: agent.docsPointers.length })}
                </span>
              </div>
              <div className="agents-card-footer">
                <div
                  className="agents-card-actions"
                  role="group"
                  aria-label={t("agents.actionsLabel")}
                >
                  {!agent.immutable ? (
                    <button
                      className="agents-card-action-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        setModelAgent(agent);
                      }}
                      title={t("agents.configureModel")}
                      aria-label={t("agents.configureModelFor", { name })}
                    >
                      <Wrench size={15} />
                    </button>
                  ) : null}
                  {canEditAvatar ? (
                    <button
                      className="agents-card-action-btn agents-card-avatar-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleChooseAvatar(agent);
                      }}
                      disabled={avatarMutatingProfile !== null}
                      title={
                        isAvatarMutating
                          ? t("agents.avatarUploading")
                          : t("agents.setAvatar")
                      }
                      aria-label={t("agents.setAvatarFor", { name })}
                    >
                      <ImagePlus size={15} />
                    </button>
                  ) : null}
                  {canEditAvatar && agent.avatar ? (
                    <button
                      className="agents-card-action-btn agents-card-avatar-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleClearAvatar(agent);
                      }}
                      disabled={avatarMutatingProfile !== null}
                      title={t("agents.clearAvatar")}
                      aria-label={t("agents.clearAvatarFor", { name })}
                    >
                      <X size={15} />
                    </button>
                  ) : null}
                  {PROFILE_ACTIONS.filter(({ view }) =>
                    isProfileActionAvailable(agent, view),
                  ).map(({ view, icon: Icon, labelKey }) => {
                    const label = t(labelKey, { name });
                    return (
                      <button
                        key={view}
                        className="agents-card-action-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleProfileAction(agent, view);
                        }}
                        title={label}
                        aria-label={label}
                      >
                        <Icon size={15} />
                      </button>
                    );
                  })}
                </div>
                {agent.deletable ? (
                  confirmDelete === agent.name ? (
                    <div
                      className="agents-card-confirm-delete"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span>{t("agents.deleteConfirm")}</span>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDelete(agent);
                        }}
                      >
                        {t("agents.yes")}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirmDelete(null);
                        }}
                      >
                        {t("agents.no")}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="agents-card-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                          setConfirmDelete(agent.name);
                      }}
                      title={t("agents.deleteTitle")}
                    >
                      <Trash size={14} />
                    </button>
                  )
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <AgentModelConfigModal
        profile={modelAgent?.name || ""}
        title={t("agents.configureModelFor", {
          name: modelAgent ? displayNameFor(modelAgent) : "",
        })}
        open={Boolean(modelAgent)}
        onClose={() => setModelAgent(null)}
        onSaved={loadAgents}
      />
    </div>
  );
}

export default Agents;

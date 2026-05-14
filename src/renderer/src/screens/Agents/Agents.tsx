import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  ChatBubble,
  Plus,
  Puzzle,
  Sparkles,
  Trash,
  Wrench,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import MercuryMark from "../../components/common/MercuryMark";
import { useI18n } from "../../components/useI18n";

interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
}

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

function AgentAvatar({ name }: { name: string }): React.JSX.Element {
  if (name === "default") {
    return (
      <div className="agents-card-avatar agents-card-avatar-icon">
        <MercuryMark size={30} decorative />
      </div>
    );
  }
  return (
    <div className="agents-card-avatar">{name.charAt(0).toUpperCase()}</div>
  );
}

function Agents({
  activeProfile,
  onSelectProfile,
  onProfileAction,
}: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [cloneConfig, setCloneConfig] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadProfiles = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setProfiles(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfiles();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProfiles]);

  async function handleCreate(): Promise<void> {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setError("");
    const result = await window.hermesAPI.createProfile(name, cloneConfig);
    setCreating(false);
    if (result.success) {
      setShowCreate(false);
      setNewName("");
      void loadProfiles();
    } else {
      setError(result.error || t("agents.createFailed"));
    }
  }

  async function handleDelete(name: string): Promise<void> {
    const result = await window.hermesAPI.deleteProfile(name);
    if (result.success) {
      if (activeProfile === name) onSelectProfile("default");
      void loadProfiles();
    }
    setConfirmDelete(null);
  }

  async function handleSelect(name: string): Promise<void> {
    await window.hermesAPI.setActiveProfile(name);
    onSelectProfile(name);
    void loadProfiles();
  }

  async function handleProfileAction(
    name: string,
    view: ProfileActionView,
  ): Promise<void> {
    await handleSelect(name);
    onProfileAction(view);
  }

  function providerLabel(provider: string): string {
    if (!provider || provider === "auto") return t("agents.auto");
    if (provider === "custom") return t("agents.local");
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  function isProfileActionAvailable(
    profile: ProfileInfo,
    view: ProfileActionView,
  ): boolean {
    void profile;
    void view;
    // These destination tabs remain useful for empty/setup states, so none of
    // the current profile summary fields represent a genuinely unavailable action.
    return true;
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
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} />
          {t("agents.newAgent")}
        </button>
      </div>

      {showCreate && (
        <div className="agents-create">
          <input
            className="input"
            placeholder={t("agents.namePlaceholder")}
            value={newName}
            onChange={(e) => {
              const v = e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "");
              setNewName(v);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            autoFocus
          />
          <label className="agents-create-clone">
            <input
              type="checkbox"
              checked={cloneConfig}
              onChange={(e) => setCloneConfig(e.target.checked)}
            />
            <span>{t("agents.cloneConfig")}</span>
          </label>
          {error && <div className="agents-create-error">{error}</div>}
          <div className="agents-create-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? t("agents.creating") : t("agents.create")}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setShowCreate(false);
                setError("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="agents-grid">
        {profiles.map((p) => (
          <div
            key={p.name}
            className={`agents-card ${activeProfile === p.name ? "active" : ""}`}
            onClick={() => handleSelect(p.name)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSelect(p.name);
            }}
          >
            <div className="agents-card-header">
              <AgentAvatar name={p.name} />
              <div className="agents-card-info">
                <div className="agents-card-name">{p.name}</div>
                <div className="agents-card-provider">
                  {providerLabel(p.provider)}
                </div>
              </div>
              {activeProfile === p.name && (
                <span className="agents-card-active-badge">
                  {t("agents.active")}
                </span>
              )}
            </div>
            <div className="agents-card-model">
              {p.model ? p.model.split("/").pop() : t("agents.noModel")}
            </div>
            <div className="agents-card-stats">
              <span>{t("agents.skillsCount", { count: p.skillCount })}</span>
              <span className="agents-card-dot" />
              {p.gatewayRunning ? (
                <span className="agents-card-gateway-on">
                  {t("agents.gatewayRunning")}
                </span>
              ) : (
                <span>{t("agents.gatewayOff")}</span>
              )}
            </div>
            <div className="agents-card-footer">
              <div
                className="agents-card-actions"
                role="group"
                aria-label={t("agents.actionsLabel")}
              >
                {PROFILE_ACTIONS.map(({ view, icon: Icon, labelKey }) => {
                  const label = t(labelKey, { name: p.name });
                  const available = isProfileActionAvailable(p, view);
                  return (
                    <button
                      key={view}
                      className="agents-card-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (available) void handleProfileAction(p.name, view);
                      }}
                      title={label}
                      aria-label={label}
                      disabled={!available}
                    >
                      <Icon size={15} />
                    </button>
                  );
                })}
              </div>
              {!p.isDefault &&
                (confirmDelete === p.name ? (
                  <div
                    className="agents-card-confirm-delete"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>{t("agents.deleteConfirm")}</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p.name);
                      }}
                    >
                      {t("agents.yes")}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(null);
                      }}
                    >
                      {t("agents.no")}
                    </button>
                  </div>
                ) : (
                  <button
                    className="agents-card-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(p.name);
                    }}
                    title={t("agents.deleteTitle")}
                  >
                    <Trash size={14} />
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Agents;

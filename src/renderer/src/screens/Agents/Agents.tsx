import { useState, useEffect, useCallback, useMemo } from "react";
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
import { AgentModelConfigModal } from "../../components/AgentModelConfigModal";
import { useI18n } from "../../components/useI18n";
import {
  filterInventoryToConnectedProviders,
  type InventoryModel,
} from "../../modelInventory";

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
  const [inventory, setInventory] = useState<InventoryModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [copyDefaultConfig, setCopyDefaultConfig] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [modelProfile, setModelProfile] = useState<ProfileInfo | null>(null);
  const [createProvider, setCreateProvider] = useState("");
  const [createModel, setCreateModel] = useState("");

  const loadProfiles = useCallback(async (): Promise<void> => {
    const list = await window.hermesAPI.listProfiles();
    setProfiles(list);
    setLoading(false);
  }, []);

  const loadInventory = useCallback(async (): Promise<void> => {
    // New profile creation can copy default config/API keys without copying
    // skills, so filter the picker against inherited credentials.
    const providerProfile = "default";
    const [models, env, credPool, codexStatus] = await Promise.all([
      window.hermesAPI.listModels(),
      window.hermesAPI.getEnv(providerProfile),
      window.hermesAPI.getCredentialPool(),
      window.hermesAPI.getCodexAuthStatus(providerProfile).catch(() => null),
    ]);
    const normalized = filterInventoryToConnectedProviders(
      models.map((entry) => ({
        id: entry.id,
        provider: entry.provider,
        model: entry.model,
        baseUrl: entry.baseUrl,
      })),
      { env, credentialPool: credPool, codexStatus },
    );
    setInventory(normalized);
    setCreateProvider((current) => current || normalized[0]?.provider || "");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadProfiles(), loadInventory()]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadInventory, loadProfiles]);

  const createProviders = useMemo(
    () => [
      ...new Set(inventory.map((entry) => entry.provider).filter(Boolean)),
    ],
    [inventory],
  );
  const createModels = useMemo(
    () => inventory.filter((entry) => entry.provider === createProvider),
    [createProvider, inventory],
  );

  useEffect(() => {
    if (!createProviders.length) return;
    if (!createProvider) {
      setCreateProvider(createProviders[0]);
      return;
    }
    if (!createProviders.includes(createProvider)) {
      setCreateProvider(createProviders[0]);
    }
  }, [createProvider, createProviders]);

  useEffect(() => {
    if (!createProvider) {
      setCreateModel("");
      return;
    }
    const hasCurrent = createModels.some(
      (entry) => entry.model === createModel,
    );
    if (!hasCurrent) {
      setCreateModel(createModels[0]?.model || "");
    }
  }, [createModel, createModels, createProvider]);

  async function handleCreate(): Promise<void> {
    const name = newName.trim().toLowerCase();
    if (!name) return;
    setCreating(true);
    setError("");
    const result = await window.hermesAPI.createProfile(
      name,
      copyDefaultConfig,
    );
    if (!result.success) {
      setCreating(false);
      setError(result.error || t("agents.createFailed"));
      return;
    }

    try {
      const selected = createModels.find(
        (entry) => entry.model === createModel,
      );
      if (selected) {
        await window.hermesAPI.setModelConfig(
          selected.provider,
          selected.model,
          selected.baseUrl || "",
          name,
        );
      }
      setShowCreate(false);
      setNewName("");
      setError("");
      await loadProfiles();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("agents.modelSaveFailed"),
      );
    } finally {
      setCreating(false);
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

      {showCreate ? (
        <div className="agents-create">
          <input
            className="input"
            placeholder={t("agents.namePlaceholder")}
            value={newName}
            onChange={(e) => {
              const value = e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9_-]/g, "");
              setNewName(value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
            autoFocus
          />
          <label className="agents-create-clone">
            <input
              type="checkbox"
              checked={copyDefaultConfig}
              onChange={(e) => setCopyDefaultConfig(e.target.checked)}
            />
            <span>{t("agents.cloneConfig")}</span>
          </label>
          <div className="agents-inline-model-grid">
            <label className="agents-model-field">
              <span>{t("agents.modelProvider")}</span>
              <div className="agents-model-select-wrap">
                <select
                  className="agents-model-select"
                  value={createProvider}
                  onChange={(e) => setCreateProvider(e.target.value)}
                  disabled={creating || createProviders.length === 0}
                >
                  {createProviders.length === 0 ? (
                    <option value="">{t("agents.noModelsAvailable")}</option>
                  ) : null}
                  {createProviders.map((provider) => (
                    <option key={provider} value={provider}>
                      {provider}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="agents-model-field">
              <span>{t("agents.modelName")}</span>
              <div className="agents-model-select-wrap">
                <select
                  className="agents-model-select"
                  value={createModel}
                  onChange={(e) => setCreateModel(e.target.value)}
                  disabled={creating || createModels.length === 0}
                >
                  {createModels.length === 0 ? (
                    <option value="">{t("agents.noModelsAvailable")}</option>
                  ) : null}
                  {createModels.map((entry) => (
                    <option
                      key={`${entry.provider}:${entry.model}`}
                      value={entry.model}
                    >
                      {entry.model}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
          {createProviders.length === 0 ? (
            <div className="agents-model-empty">
              {t("agents.noModelsAvailableHint")}
            </div>
          ) : null}
          {error ? <div className="agents-create-error">{error}</div> : null}
          <div className="agents-create-actions">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void handleCreate()}
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
      ) : null}

      <div className="agents-grid">
        {profiles.map((profile) => (
          <div
            key={profile.name}
            className={`agents-card ${activeProfile === profile.name ? "active" : ""}`}
            onClick={() => void handleSelect(profile.name)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSelect(profile.name);
            }}
          >
            <div className="agents-card-header">
              <AgentAvatar name={profile.name} />
              <div className="agents-card-info">
                <div className="agents-card-name">{profile.name}</div>
                <div className="agents-card-provider">
                  {providerLabel(profile.provider)}
                </div>
              </div>
              {activeProfile === profile.name ? (
                <span className="agents-card-active-badge">
                  {t("agents.active")}
                </span>
              ) : null}
            </div>
            <div className="agents-card-model">
              {profile.model
                ? profile.model.split("/").pop()
                : t("agents.noModel")}
            </div>
            <div className="agents-card-stats">
              <span>
                {t("agents.skillsCount", { count: profile.skillCount })}
              </span>
              <span className="agents-card-dot" />
              {profile.gatewayRunning ? (
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
                <button
                  className="agents-card-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModelProfile(profile);
                  }}
                  title={t("agents.configureModel")}
                  aria-label={t("agents.configureModelFor", {
                    name: profile.name,
                  })}
                >
                  <Wrench size={15} />
                </button>
                {PROFILE_ACTIONS.map(({ view, icon: Icon, labelKey }) => {
                  const label = t(labelKey, { name: profile.name });
                  const available = isProfileActionAvailable(profile, view);
                  return (
                    <button
                      key={view}
                      className="agents-card-action-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (available)
                          void handleProfileAction(profile.name, view);
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
              {!profile.isDefault ? (
                confirmDelete === profile.name ? (
                  <div
                    className="agents-card-confirm-delete"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span>{t("agents.deleteConfirm")}</span>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(profile.name);
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
                      setConfirmDelete(profile.name);
                    }}
                    title={t("agents.deleteTitle")}
                  >
                    <Trash size={14} />
                  </button>
                )
              ) : null}
            </div>
          </div>
        ))}
      </div>

      <AgentModelConfigModal
        profile={modelProfile?.name || ""}
        title={t("agents.configureModelFor", {
          name: modelProfile?.name || "",
        })}
        open={Boolean(modelProfile)}
        initialProvider={modelProfile?.provider}
        initialModel={modelProfile?.model}
        onClose={() => setModelProfile(null)}
        onSaved={loadProfiles}
      />
    </div>
  );
}

export default Agents;

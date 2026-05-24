import { useState, useEffect, useCallback } from "react";
import { Plus, Trash, Search, X, Refresh, Alert, Check } from "../../assets/icons";
import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import type {
  ModelCapability,
  ModelRoleEntry,
  ModelRoleId,
  ModelRoleResolution,
  ModelRoleSelection,
  SavedModelDescriptor,
} from "../../../../shared/model-roles";

interface ModelsProps {
  profile?: string;
  onBack?: () => void;
}

type SavedModel = SavedModelDescriptor;

type RoleSelections = Partial<Record<ModelRoleId, string>>;

function providerLabelKey(value: string): string {
  return PROVIDERS.options.find((p) => p.value === value)?.label || value;
}

function capabilitiesFor(model: Pick<SavedModel, "capabilities">): ModelCapability[] {
  return model.capabilities?.length ? model.capabilities : ["text"];
}

function isTextCapable(model: SavedModel): boolean {
  return capabilitiesFor(model).includes("text");
}

function sourceLabelKey(source: ModelRoleResolution["source"]): string {
  switch (source) {
    case "profile-override":
      return "models.source.profileOverride";
    case "global-default":
      return "models.source.globalDefault";
    case "role-fallback":
      return "models.source.fallback";
    case "legacy-chat-config":
      return "models.source.legacyChatConfig";
    case "provider-auto":
      return "models.source.providerAuto";
    case "unassigned":
      return "models.source.unassigned";
    case "missing-model":
      return "models.source.missingModel";
    case "image-capability":
      return "models.source.imageCapability";
  }
}

function shouldShowSourceBadge(source: ModelRoleResolution["source"]): boolean {
  switch (source) {
    case "profile-override":
    case "missing-model":
    case "legacy-chat-config":
      return true;
    default:
      return false;
  }
}

function buildSelection(role: ModelRoleId, model: SavedModel): Partial<ModelRoleSelection> {
  return {
    role,
    modelId: model.id,
    provider: model.provider,
    model: model.model,
    baseUrl: model.baseUrl,
    contextWindow: model.contextWindow,
    capabilities: capabilitiesFor(model),
    updatedAt: Date.now(),
  };
}

function Models({ profile, onBack }: ModelsProps): React.JSX.Element {
  const { t } = useI18n();
  const [models, setModels] = useState<SavedModel[]>([]);
  const [roles, setRoles] = useState<ModelRoleEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [roleSaving, setRoleSaving] = useState<string | null>(null);
  const [selectedByRole, setSelectedByRole] = useState<RoleSelections>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingModel, setEditingModel] = useState<SavedModel | null>(null);
  const [formName, setFormName] = useState("");
  const [formProvider, setFormProvider] = useState("openrouter");
  const [formModel, setFormModel] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formTextCapability, setFormTextCapability] = useState(true);
  const [formImageInputCapability, setFormImageInputCapability] = useState(false);
  const [formApiKey, setFormApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [formError, setFormError] = useState("");

  function resolveCustomEnvKey(url: string): string {
    if (!url) return "CUSTOM_API_KEY";
    if (/openrouter\.ai/i.test(url)) return "OPENROUTER_API_KEY";
    if (/anthropic\.com/i.test(url)) return "ANTHROPIC_API_KEY";
    if (/openai\.com/i.test(url)) return "OPENAI_API_KEY";
    if (/huggingface\.co/i.test(url)) return "HF_TOKEN";
    if (/opencode\.ai\/zen\/go/i.test(url)) return "OPENCODE_GO_API_KEY";
    if (/opencode\.ai\/zen/i.test(url)) return "OPENCODE_ZEN_API_KEY";
    if (/api\.groq\.com/i.test(url)) return "GROQ_API_KEY";
    if (/api\.deepseek\.com/i.test(url)) return "DEEPSEEK_API_KEY";
    if (/api\.together\.xyz/i.test(url)) return "TOGETHER_API_KEY";
    if (/api\.fireworks\.ai/i.test(url)) return "FIREWORKS_API_KEY";
    if (/api\.cerebras\.ai/i.test(url)) return "CEREBRAS_API_KEY";
    if (/api\.mistral\.ai/i.test(url)) return "MISTRAL_API_KEY";
    if (/api\.perplexity\.ai/i.test(url)) return "PERPLEXITY_API_KEY";
    return "CUSTOM_API_KEY";
  }

  const loadModels = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await window.hermesAPI.listModelRoles(profile);
      const textModels = result.savedModels.filter(isTextCapable);
      const nextSelections: RoleSelections = {};
      for (const role of result.roles) {
        if (role.id === "image") continue;
        const resolved = role.resolved.kind === "text" ? role.resolved : null;
        nextSelections[role.id] =
          (resolved?.ok ? resolved.modelId : undefined) ||
          role.profileOverride?.modelId ||
          role.global?.modelId ||
          textModels[0]?.id;
      }
      setModels(result.savedModels);
      setRoles(result.roles);
      setSelectedByRole(nextSelections);
    } catch (error) {
      setModels([]);
      setRoles([]);
      setSelectedByRole({});
      setLoadError((error as Error).message || "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadModels();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadModels]);

  function openAddModal(): void {
    setEditingModel(null);
    setFormName("");
    setFormProvider("openrouter");
    setFormModel("");
    setFormBaseUrl("");
    setFormTextCapability(true);
    setFormImageInputCapability(false);
    setFormApiKey("");
    setShowApiKey(false);
    setFormError("");
    setShowModal(true);
  }

  function openEditModal(m: SavedModel): void {
    const caps = capabilitiesFor(m);
    setEditingModel(m);
    setFormName(m.name);
    setFormProvider(m.provider);
    setFormModel(m.model);
    setFormBaseUrl(m.baseUrl);
    setFormTextCapability(caps.includes("text"));
    setFormImageInputCapability(caps.includes("image_input"));
    setFormApiKey("");
    setShowApiKey(false);
    setFormError("");
    setShowModal(true);
  }

  function closeModal(): void {
    setShowModal(false);
    setEditingModel(null);
    setFormError("");
  }

  function formCapabilities(): ModelCapability[] {
    const capabilities: ModelCapability[] = [];
    if (formTextCapability) capabilities.push("text");
    if (formImageInputCapability) capabilities.push("image_input");
    return capabilities;
  }

  async function handleSave(): Promise<void> {
    const name = formName.trim();
    const model = formModel.trim();
    const capabilities = formCapabilities();
    if (!name || !model) {
      setFormError(t("models.nameRequired"));
      return;
    }
    if (capabilities.length === 0) {
      setFormError(t("models.capabilitiesRequired"));
      return;
    }
    setFormError("");

    if (editingModel) {
      await window.hermesAPI.updateModel(editingModel.id, {
        name,
        provider: formProvider,
        model,
        baseUrl: formBaseUrl.trim(),
        capabilities,
      });
    } else {
      await window.hermesAPI.addModel(
        name,
        formProvider,
        model,
        formBaseUrl.trim(),
        capabilities,
      );
    }

    if (formApiKey.trim() && formProvider === "custom") {
      const envKey = resolveCustomEnvKey(formBaseUrl.trim());
      await window.hermesAPI.setEnv(envKey, formApiKey.trim(), profile);
    }

    closeModal();
    await loadModels();
  }

  async function handleDelete(id: string): Promise<void> {
    await window.hermesAPI.removeModel(id);
    setConfirmDelete(null);
    await loadModels();
  }

  async function handleSetRole(role: ModelRoleId, scope: "profile" | "global"): Promise<void> {
    const selectedModel = models.find((model) => model.id === selectedByRole[role]);
    if (!selectedModel) return;
    const key = `${scope}:${role}`;
    setRoleSaving(key);
    setLoadError(null);
    try {
      const selection = buildSelection(role, selectedModel);
      if (scope === "global") {
        await window.hermesAPI.setGlobalModelRoleDefault(role, selection);
      } else {
        await window.hermesAPI.setProfileModelRoleOverride(role, selection, profile);
      }
      await loadModels();
    } catch (error) {
      setLoadError((error as Error).message || t("models.loadFailed"));
    } finally {
      setRoleSaving(null);
    }
  }

  async function handleClearOverride(role: ModelRoleId): Promise<void> {
    setRoleSaving(`clear:${role}`);
    setLoadError(null);
    try {
      await window.hermesAPI.clearProfileModelRoleOverride(role, profile);
      await loadModels();
    } catch (error) {
      setLoadError((error as Error).message || t("models.loadFailed"));
    } finally {
      setRoleSaving(null);
    }
  }

  const textModels = models.filter(isTextCapable);
  const filtered = models.filter((m) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.name.toLowerCase().includes(q) ||
      m.model.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">{t("models.title")}</h1>
        <div className="models-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (loadError && roles.length === 0) {
    return (
      <div className="settings-container">
        {onBack && (
          <button className="btn-ghost models-settings-back" onClick={onBack}>
            ← {t("models.backToSettings")}
          </button>
        )}
        <h1 className="settings-header">{t("models.title")}</h1>
        <div className="models-empty">
          <p className="models-empty-text">{t("models.loadFailed")}</p>
          <p className="models-empty-hint">{loadError}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => loadModels()}>
            {t("models.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="models-header">
        <div>
          {onBack && (
            <button className="btn-ghost models-settings-back" onClick={onBack}>
              ← {t("models.backToSettings")}
            </button>
          )}
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            {t("models.title")}
          </h1>
          <p className="models-subtitle">{t("models.roleDefaultsSubtitle")}</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openAddModal}>
          <Plus size={14} />
          {t("models.addModel")}
        </button>
      </div>

      {loadError && (
        <div className="models-error" style={{ marginBottom: 12 }}>
          {loadError}
        </div>
      )}

      <section className="models-role-section">
        <div className="models-section-heading">
          <div>
            <h2>{t("models.roleDefaultsTitle")}</h2>
            <p>{t("models.roleDefaultsHint")}</p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => loadModels()}>
            <Refresh size={14} />
            {t("settings.refresh")}
          </button>
        </div>

        <div className="model-roles-list">
          {roles.map((role) => {
            if (role.id === "image") {
              const image = role.resolved.kind === "image" ? role.resolved : null;
              return (
                <div key={role.id} className="model-role-row model-role-row-image">
                  <div className="model-role-main">
                    <div className="model-role-title-row">
                      <h3>{t(role.nameKey)}</h3>
                      <span className={`model-role-source-badge ${image?.ok ? "ok" : "warning"}`}>
                        {image?.ok ? t("models.image.available") : t("models.image.unavailable")}
                      </span>
                    </div>
                    <p className="model-role-description">{t(role.descriptionKey)}</p>
                    <div className="model-role-image-status">
                      {image?.ok ? <Check size={14} /> : <Alert size={14} />}
                      <span>
                        {image?.ok
                          ? t("models.image.availableDetail")
                          : image?.reason || t("models.image.unavailable")}
                      </span>
                    </div>
                    <div className="model-role-meta">
                      <span>image_gen</span>
                      <span>{image?.provider || "openai-codex"}</span>
                      <span>{image?.model || "gpt-image-2-medium"}</span>
                    </div>
                    <p className="model-role-help">{t("models.image.codexNativeOnly")}</p>
                    <p className="model-role-help">{t("models.image.requirements")}</p>
                  </div>
                </div>
              );
            }

            const resolved = role.resolved.kind === "text" ? role.resolved : null;
            const selectedId = selectedByRole[role.id] || "";
            const isMissing = resolved?.source === "missing-model";
            const selectedModel = textModels.find((model) => model.id === selectedId);

            return (
              <div key={role.id} className={`model-role-row ${isMissing ? "model-role-missing" : ""}`}>
                <div className="model-role-main">
                  <div className="model-role-title-row">
                    <h3>{t(role.nameKey)}</h3>
                    {resolved && shouldShowSourceBadge(resolved.source) && (
                      <span className={`model-role-source-badge source-${resolved.source}`}>
                        {t(sourceLabelKey(resolved.source))}
                      </span>
                    )}
                  </div>
                  <p className="model-role-description">{t(role.descriptionKey)}</p>
                  {isMissing && (
                    <div className="model-role-warning">
                      <Alert size={14} />
                      <span>{t("models.missingModelDescription")}</span>
                    </div>
                  )}
                </div>

                <div className="model-role-actions">
                  <select
                    id={`model-role-${role.id}`}
                    className="input model-role-selector"
                    value={selectedId}
                    onChange={(event) =>
                      setSelectedByRole((prev) => ({ ...prev, [role.id]: event.target.value }))
                    }
                    disabled={textModels.length === 0}
                  >
                    {textModels.length === 0 ? (
                      <option value="">{t("models.noTextModels")}</option>
                    ) : (
                      Object.entries(
                        textModels.reduce<Record<string, SavedModel[]>>((groups, model) => {
                          const provider = model.provider || "Other";
                          if (!groups[provider]) groups[provider] = [];
                          groups[provider].push(model);
                          return groups;
                        }, {})
                      )
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([provider, providerModels]) => (
                          <optgroup key={provider} label={t(providerLabelKey(provider))}>
                            {providerModels.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.name.replace(new RegExp(`^${provider}\\s+`, "i"), "")}
                              </option>
                            ))}
                          </optgroup>
                        ))
                    )}
                  </select>
                  <div className="model-role-button-row">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSetRole(role.id, "profile")}
                      disabled={!selectedModel || roleSaving === `profile:${role.id}`}
                    >
                      {t("models.setProfileOverride")}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSetRole(role.id, "global")}
                      disabled={!selectedModel || roleSaving === `global:${role.id}`}
                    >
                      {t("models.setGlobalDefault")}
                    </button>
                    {role.profileOverride && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleClearOverride(role.id)}
                        disabled={roleSaving === `clear:${role.id}`}
                      >
                        {t("models.useGlobalDefault")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="models-library-section">
        <div className="models-section-heading">
          <div>
            <h2>{t("models.modelLibraryTitle")}</h2>
            <p>{t("models.subtitle")}</p>
          </div>
        </div>

        {models.length > 0 && (
          <div className="models-search">
            <Search size={14} />
            <input
              className="models-search-input"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("models.searchPlaceholder")}
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="models-empty">
            {models.length === 0 ? (
              <>
                <p className="models-empty-text">{t("models.empty")}</p>
                <p className="models-empty-hint">{t("models.emptyHint")}</p>
              </>
            ) : (
              <p className="models-empty-text">{t("models.noMatch")}</p>
            )}
          </div>
        ) : (
          <div className="models-grid">
            {filtered.map((m) => (
              <div
                key={m.id}
                className="models-card"
                onClick={() => openEditModal(m)}
              >
                <div className="models-card-header">
                  <div className="models-card-name">{m.name}</div>
                  <span className="models-card-provider">
                    {t(providerLabelKey(m.provider))}
                  </span>
                </div>
                <div className="models-card-model">{m.model}</div>
                {m.baseUrl && <div className="models-card-url">{m.baseUrl}</div>}
                <div className="models-card-capabilities">
                  {capabilitiesFor(m).map((capability) => (
                    <span key={capability}>{t(`models.capabilities.${capability}`)}</span>
                  ))}
                </div>
                <div className="models-card-footer">
                  {confirmDelete === m.id ? (
                    <div
                      className="models-card-confirm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>{t("models.deleteConfirm")}</span>
                      <button
                        className="btn btn-sm"
                        style={{ color: "var(--error)" }}
                        onClick={() => handleDelete(m.id)}
                      >
                        {t("models.yes")}
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => setConfirmDelete(null)}
                      >
                        {t("models.no")}
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn-ghost models-card-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(m.id);
                      }}
                      title={t("models.deleteModelTitle")}
                    >
                      <Trash size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showModal && (
        <div className="models-modal-overlay" onClick={closeModal}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {editingModel ? t("models.editModel") : t("models.addModel")}
              </h2>
              <button className="btn-ghost" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.displayName")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t("models.namePlaceholder")}
                  autoFocus
                />
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("common.provider")}
                </label>
                <select
                  className="input"
                  value={formProvider}
                  onChange={(e) => setFormProvider(e.target.value)}
                >
                  {PROVIDERS.options.map((p) => (
                    <option key={p.value} value={p.value}>
                      {t(p.label)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.modelId")}
                </label>
                <input
                  className="input"
                  type="text"
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  placeholder={t("models.modelIdPlaceholder")}
                />
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("common.baseUrl")} ({t("common.optional")})
                </label>
                <input
                  className="input"
                  type="text"
                  value={formBaseUrl}
                  onChange={(e) => setFormBaseUrl(e.target.value)}
                  placeholder={t("models.baseUrlPlaceholder")}
                />
                <span className="models-modal-hint">
                  {t("models.customProviderHint")}
                </span>
              </div>

              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("models.capabilitiesTitle")}
                </label>
                <label className="models-capability-option">
                  <input
                    type="checkbox"
                    checked={formTextCapability}
                    onChange={(e) => setFormTextCapability(e.target.checked)}
                  />
                  {t("models.capabilities.text")}
                </label>
                <label className="models-capability-option">
                  <input
                    type="checkbox"
                    checked={formImageInputCapability}
                    onChange={(e) => setFormImageInputCapability(e.target.checked)}
                  />
                  {t("models.capabilities.image_input")}
                </label>
                <label className="models-capability-option disabled">
                  <input type="checkbox" disabled />
                  {t("models.capabilities.codex_image_gen")}
                </label>
                <span className="models-modal-hint">
                  {t("models.capabilities.codexImageGenReserved")}
                </span>
              </div>

              {formProvider === "custom" && (
                <div className="models-modal-field">
                  <label className="models-modal-label">
                    {t("models.apiKeyLabel")} ({t("common.optional")})
                  </label>
                  <div className="setup-input-group">
                    <input
                      className="input"
                      type={showApiKey ? "text" : "password"}
                      value={formApiKey}
                      onChange={(e) => setFormApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                    <button
                      className="setup-toggle-visibility"
                      onClick={() => setShowApiKey(!showApiKey)}
                      type="button"
                    >
                      {showApiKey ? t("common.hide") : t("common.show")}
                    </button>
                  </div>
                  <span className="models-modal-hint">
                    {t("models.apiKeyHint")}
                  </span>
                </div>
              )}

              {formError && <div className="models-error">{formError}</div>}
            </div>

            <div className="models-modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={closeModal}>
                {t("common.cancel")}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>
                {editingModel ? t("models.update") : t("models.addModel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Models;

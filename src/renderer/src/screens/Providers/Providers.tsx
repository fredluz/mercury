import { useCallback, useEffect, useMemo, useState } from "react";
import { SETTINGS_SECTIONS } from "../../constants";
import type { SectionDef, FieldDef } from "../../constants";
import { useI18n } from "../../components/useI18n";
import { providerIdForEnvKey } from "../../modelInventory";
import { useCodexAuthFlow } from "../../hooks/useCodexAuthFlow";

type CredentialEntry = { key: string; label: string };
type CredentialDraft = { key: string; label: string };

const LLM_SECTION = SETTINGS_SECTIONS[0];
const SECONDARY_SECTIONS = SETTINGS_SECTIONS.slice(1);

function providerIdForField(field: FieldDef): string {
  return providerIdForEnvKey(field.key);
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 8)}...${key.slice(-4)}`;
}

function providerMatchesSearch(
  field: FieldDef,
  provider: string,
  query: string,
  t: (key: string) => string,
): boolean {
  if (!query) return true;
  const text = `${provider} ${t(field.label)} ${t(field.hint)}`.toLowerCase();
  return text.includes(query.toLowerCase());
}

function Providers({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [credPool, setCredPool] = useState<Record<string, CredentialEntry[]>>(
    {},
  );
  const [poolDrafts, setPoolDrafts] = useState<Record<string, CredentialDraft>>(
    {},
  );
  const [providerSearch, setProviderSearch] = useState("");

  const loadConfig = useCallback(async (): Promise<void> => {
    const [envData, pool] = await Promise.all([
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getCredentialPool(),
    ]);
    setEnv(envData);
    setCredPool(pool);
  }, [profile]);

  const codexAuth = useCodexAuthFlow({
    profile,
    active: visible !== false,
    onAuthenticated: loadConfig,
  });

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!visible) return;
    void loadConfig();
  }, [loadConfig, visible]);

  async function handleBlur(key: string): Promise<void> {
    const value = env[key] || "";
    await window.hermesAPI.setEnv(key, value, profile);
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 2000);
    await loadConfig();
  }

  function handleChange(key: string, value: string): void {
    setEnv((prev) => ({ ...prev, [key]: value }));
  }

  function toggleVisibility(key: string): void {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updatePoolDraft(provider: string, patch: Partial<CredentialDraft>) {
    setPoolDrafts((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] || { key: "", label: "" }), ...patch },
    }));
  }

  async function handleAddPoolKey(provider: string): Promise<void> {
    const draft = poolDrafts[provider];
    if (!draft?.key.trim()) return;
    const existing = credPool[provider] || [];
    const entries = [
      ...existing,
      {
        key: draft.key.trim(),
        label: draft.label.trim() || `Key ${existing.length + 1}`,
      },
    ];
    await window.hermesAPI.setCredentialPool(provider, entries);
    setCredPool((prev) => ({ ...prev, [provider]: entries }));
    setPoolDrafts((prev) => ({ ...prev, [provider]: { key: "", label: "" } }));
  }

  async function handleRemovePoolKey(
    provider: string,
    index: number,
  ): Promise<void> {
    const entries = [...(credPool[provider] || [])];
    entries.splice(index, 1);
    await window.hermesAPI.setCredentialPool(provider, entries);
    setCredPool((prev) => ({ ...prev, [provider]: entries }));
  }

  const llmFields = LLM_SECTION.items;
  const connectedFields = useMemo(
    () =>
      llmFields.filter((field) => {
        const provider = providerIdForField(field);
        return (
          Boolean((env[field.key] || "").trim()) ||
          Boolean(credPool[provider]?.length)
        );
      }),
    [credPool, env, llmFields],
  );
  const availableFields = useMemo(
    () =>
      llmFields.filter((field) => {
        const provider = providerIdForField(field);
        if ((env[field.key] || "").trim()) return false;
        if (credPool[provider]?.length) return false;
        return providerMatchesSearch(field, provider, providerSearch, t);
      }),
    [credPool, env, llmFields, providerSearch, t],
  );

  function renderApiKeyField(field: FieldDef): React.JSX.Element {
    return (
      <div className="provider-config-field">
        <label className="settings-field-label">
          {t(field.label)}
          {savedKey === field.key && (
            <span className="settings-saved">{t("common.saved")}</span>
          )}
        </label>
        <div className="settings-input-row">
          <input
            className="input"
            type={
              field.type === "password" && !visibleKeys.has(field.key)
                ? "password"
                : "text"
            }
            value={env[field.key] || ""}
            onChange={(event) => handleChange(field.key, event.target.value)}
            onBlur={() => void handleBlur(field.key)}
            placeholder={t(field.label)}
          />
          {field.type === "password" && (
            <button
              className="btn-ghost settings-toggle-btn"
              onClick={() => toggleVisibility(field.key)}
            >
              {visibleKeys.has(field.key) ? t("common.hide") : t("common.show")}
            </button>
          )}
        </div>
        <div className="settings-field-hint">{t(field.hint)}</div>
      </div>
    );
  }

  function renderCredentialPool(provider: string): React.JSX.Element {
    const entries = credPool[provider] || [];
    const draft = poolDrafts[provider] || { key: "", label: "" };
    return (
      <div className="provider-pool">
        <div className="provider-subtitle">Additional API keys</div>
        {entries.length > 0 && (
          <div className="provider-pool-list">
            {entries.map((entry, index) => (
              <div
                key={`${entry.label}-${index}`}
                className="provider-pool-row"
              >
                <span className="settings-pool-label">
                  {entry.label || `${t("settings.keyLabel")} ${index + 1}`}
                </span>
                <span className="settings-pool-key">{maskKey(entry.key)}</span>
                <button
                  className="btn-ghost provider-remove-key"
                  onClick={() => void handleRemovePoolKey(provider, index)}
                >
                  {t("settings.remove")}
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="provider-pool-add">
          <input
            className="input"
            type="password"
            value={draft.key}
            onChange={(event) =>
              updatePoolDraft(provider, { key: event.target.value })
            }
            placeholder={t("settings.apiKeyPlaceholder")}
          />
          <input
            className="input"
            type="text"
            value={draft.label}
            onChange={(event) =>
              updatePoolDraft(provider, { label: event.target.value })
            }
            placeholder={t("settings.labelPlaceholder", {
              optional: t("common.optional"),
            })}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => void handleAddPoolKey(provider)}
            disabled={!draft.key.trim()}
          >
            {t("settings.add")}
          </button>
        </div>
      </div>
    );
  }

  function renderProviderCard(field: FieldDef): React.JSX.Element {
    const provider = providerIdForField(field);
    const connected =
      Boolean((env[field.key] || "").trim()) ||
      Boolean(credPool[provider]?.length);
    return (
      <details
        key={field.key}
        className={`provider-card ${connected ? "connected" : ""}`}
        open={connected}
      >
        <summary className="provider-card-summary">
          <div>
            <div className="provider-card-title">{t(field.label)}</div>
            <div className="provider-card-hint">{t(field.hint)}</div>
          </div>
          <span className={`provider-status ${connected ? "connected" : ""}`}>
            {connected ? "Connected" : "Not connected"}
          </span>
        </summary>
        <div className="provider-card-body">
          {renderApiKeyField(field)}
          {renderCredentialPool(provider)}
        </div>
      </details>
    );
  }

  function renderCodexCard(): React.JSX.Element {
    const connected = Boolean(codexAuth.status?.hasHermesAuth);
    return (
      <details className={`provider-card ${connected ? "connected" : ""}`} open>
        <summary className="provider-card-summary">
          <div>
            <div className="provider-card-title">
              {t("constants.codexAppServerName")}
            </div>
            <div className="provider-card-hint">
              OpenAI Codex OAuth-backed runtime
            </div>
          </div>
          <span className={`provider-status ${connected ? "connected" : ""}`}>
            {connected ? "Connected" : "Not connected"}
          </span>
        </summary>
        <div className="provider-card-body">
          <div className="settings-codex-auth-card compact">
            <div className="settings-codex-auth-main">
              <div className="settings-entry-title">OpenAI Codex login</div>
              <div className="settings-entry-description">
                Connect the OAuth-backed Codex app server Hermes uses.
              </div>
              <div className="settings-codex-status-row">
                <span
                  className={
                    connected
                      ? "settings-codex-pill settings-codex-pill-ok"
                      : "settings-codex-pill"
                  }
                >
                  {connected ? "Signed in" : "Not signed in"}
                </span>
                {codexAuth.status?.hasCodexCliAuth && !connected && (
                  <span className="settings-codex-pill">
                    Codex CLI login found; Hermes needs its own session
                  </span>
                )}
              </div>
              {codexAuth.pending && codexAuth.phase === "waiting" && (
                <div className="settings-codex-code-box">
                  <div>
                    Open <code>{codexAuth.pending.verificationUri}</code> and enter:
                  </div>
                  <strong>{codexAuth.pending.userCode}</strong>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void codexAuth.copyCode()}
                  >
                    Copy code
                  </button>
                </div>
              )}
              {(codexAuth.errorMessage || codexAuth.phase === "success" || codexAuth.phase === "waiting") && (
                <div
                  className={
                    codexAuth.phase === "error"
                      ? "settings-codex-message settings-codex-message-error"
                      : "settings-codex-message"
                  }
                >
                  {codexAuth.errorMessage ||
                    (codexAuth.phase === "success"
                      ? "Codex app-server login complete."
                      : "Browser opened. Complete login to connect Codex.")}
                </div>
              )}
            </div>
            <div className="settings-codex-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void codexAuth.start()}
                disabled={
                  codexAuth.phase === "starting" || codexAuth.phase === "waiting"
                }
              >
                {connected ? "Re-authenticate" : "Sign in"}
              </button>
            </div>
          </div>
        </div>
      </details>
    );
  }

  function renderSecondarySection(section: SectionDef): React.JSX.Element {
    return (
      <details key={section.title} className="settings-section provider-fold">
        <summary className="provider-fold-summary">
          <span>{t(section.title)}</span>
          <span className="provider-fold-count">{section.items.length}</span>
        </summary>
        <div className="provider-fold-body">
          {section.items.map((field) => (
            <div key={field.key} className="settings-field">
              {renderApiKeyField(field)}
            </div>
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="settings-container providers-container">
      <h1 className="settings-header">{t("providers.title")}</h1>
      <p className="models-subtitle providers-subtitle">
        Connect provider credentials. Choose chat models from the chat model
        picker.
      </p>

      <section className="settings-section provider-main-section">
        <div className="settings-section-title">Connected providers</div>
        <div className="provider-list">
          {renderCodexCard()}
          {connectedFields.map(renderProviderCard)}
        </div>
      </section>

      <details className="settings-section provider-fold">
        <summary className="provider-fold-summary">
          <span>{t(LLM_SECTION.title)}</span>
          <span className="provider-fold-count">
            {availableFields.length} available
          </span>
        </summary>
        <div className="provider-fold-body">
          <input
            className="input provider-search"
            value={providerSearch}
            onChange={(event) => setProviderSearch(event.target.value)}
            placeholder="Search providers"
          />
          <div className="provider-list available">
            {availableFields.map(renderProviderCard)}
          </div>
        </div>
      </details>

      <div className="provider-secondary-sections">
        {SECONDARY_SECTIONS.map(renderSecondarySection)}
      </div>
    </div>
  );
}

export default Providers;

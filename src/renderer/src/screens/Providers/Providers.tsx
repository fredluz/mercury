import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SETTINGS_SECTIONS } from "../../constants";
import type { SectionDef, FieldDef } from "../../constants";
import { useI18n } from "../../components/useI18n";

type CodexAuthStatus = Awaited<
  ReturnType<typeof window.hermesAPI.getCodexAuthStatus>
>;
type CodexDeviceAuthStart = Awaited<
  ReturnType<typeof window.hermesAPI.startCodexDeviceAuth>
>;
type PendingCodexAuth = CodexDeviceAuthStart & { profile?: string };
type CredentialEntry = { key: string; label: string };
type CredentialDraft = { key: string; label: string };

const LLM_SECTION = SETTINGS_SECTIONS[0];
const SECONDARY_SECTIONS = SETTINGS_SECTIONS.slice(1);

const PROVIDER_BY_ENV_KEY: Record<string, string> = {
  OPENROUTER_API_KEY: "openrouter",
  OPENAI_API_KEY: "openai",
  ANTHROPIC_API_KEY: "anthropic",
  GROQ_API_KEY: "groq",
  GLM_API_KEY: "zai",
  KIMI_API_KEY: "kimi",
  MINIMAX_API_KEY: "minimax",
  MINIMAX_CN_API_KEY: "minimax-cn",
  OPENCODE_ZEN_API_KEY: "opencode-zen",
  OPENCODE_GO_API_KEY: "opencode-go",
  HF_TOKEN: "huggingface",
  DEEPSEEK_API_KEY: "deepseek",
  TOGETHER_API_KEY: "together",
  FIREWORKS_API_KEY: "fireworks",
  CEREBRAS_API_KEY: "cerebras",
  MISTRAL_API_KEY: "mistral",
  PERPLEXITY_API_KEY: "perplexity",
  CUSTOM_API_KEY: "custom",
  GOOGLE_API_KEY: "google",
  XAI_API_KEY: "xai",
};

function providerIdForField(field: FieldDef): string {
  return PROVIDER_BY_ENV_KEY[field.key] || field.key.toLowerCase();
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

  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [codexPending, setCodexPending] = useState<PendingCodexAuth | null>(
    null,
  );
  const [codexAuthState, setCodexAuthState] = useState<
    "idle" | "starting" | "waiting" | "success" | "error"
  >("idle");
  const [codexMessage, setCodexMessage] = useState("");
  const codexPollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadConfig = useCallback(async (): Promise<void> => {
    const [envData, pool, codex] = await Promise.all([
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getCredentialPool(),
      window.hermesAPI.getCodexAuthStatus(profile),
    ]);
    setEnv(envData);
    setCredPool(pool);
    setCodexStatus(codex);
  }, [profile]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (!visible) return;
    void loadConfig();
  }, [loadConfig, visible]);

  useEffect(() => {
    if (!codexPending || codexAuthState !== "waiting") return;
    if (codexPollTimer.current) clearInterval(codexPollTimer.current);

    async function poll(): Promise<void> {
      if (!codexPending) return;
      try {
        const result = await window.hermesAPI.pollCodexDeviceAuth(
          codexPending.sessionId,
          codexPending.profile,
        );
        if (result.status === "pending") return;
        if (codexPollTimer.current) clearInterval(codexPollTimer.current);
        codexPollTimer.current = null;
        if (result.status === "authenticated") {
          setCodexAuthState("success");
          setCodexMessage("Codex app-server login complete.");
          setCodexPending(null);
          await loadConfig();
          return;
        }
        setCodexAuthState("error");
        setCodexMessage(result.message || "Codex login failed.");
      } catch (error) {
        if (codexPollTimer.current) clearInterval(codexPollTimer.current);
        codexPollTimer.current = null;
        setCodexAuthState("error");
        setCodexMessage(error instanceof Error ? error.message : String(error));
      }
    }

    codexPollTimer.current = setInterval(
      () => void poll(),
      Math.max(3000, codexPending.intervalSeconds * 1000),
    );
    void poll();
    return () => {
      if (codexPollTimer.current) clearInterval(codexPollTimer.current);
      codexPollTimer.current = null;
    };
  }, [codexAuthState, codexPending, loadConfig]);

  async function handleStartCodexAuth(): Promise<void> {
    setCodexAuthState("starting");
    setCodexMessage("");
    try {
      const start = await window.hermesAPI.startCodexDeviceAuth();
      setCodexPending({ ...start, profile });
      setCodexAuthState("waiting");
      setCodexMessage("Browser opened. Complete login to connect Codex.");
    } catch (error) {
      setCodexAuthState("error");
      setCodexMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleCopyCodexCode(): Promise<void> {
    if (!codexPending?.userCode) return;
    await navigator.clipboard.writeText(codexPending.userCode);
  }

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
    const connected = Boolean(codexStatus?.hasHermesAuth);
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
                {codexStatus?.hasCodexCliAuth && !connected && (
                  <span className="settings-codex-pill">
                    Codex CLI login found; Hermes needs its own session
                  </span>
                )}
              </div>
              {codexPending && codexAuthState === "waiting" && (
                <div className="settings-codex-code-box">
                  <div>
                    Open <code>{codexPending.verificationUri}</code> and enter:
                  </div>
                  <strong>{codexPending.userCode}</strong>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void handleCopyCodexCode()}
                  >
                    Copy code
                  </button>
                </div>
              )}
              {codexMessage && (
                <div
                  className={
                    codexAuthState === "error"
                      ? "settings-codex-message settings-codex-message-error"
                      : "settings-codex-message"
                  }
                >
                  {codexMessage}
                </div>
              )}
            </div>
            <div className="settings-codex-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void handleStartCodexAuth()}
                disabled={
                  codexAuthState === "starting" || codexAuthState === "waiting"
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

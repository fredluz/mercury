import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SETTINGS_SECTIONS } from "../constants";
import type { FieldDef } from "../constants";
import { useI18n } from "./useI18n";

type InventoryModel = {
  id: string;
  provider: string;
  model: string;
  baseUrl: string;
};

interface AgentModelConfigModalProps {
  profile: string;
  title: string;
  open: boolean;
  initialProvider?: string;
  initialModel?: string;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
}

const LLM_SECTION = SETTINGS_SECTIONS[0];
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

function dedupeModels(models: InventoryModel[]): InventoryModel[] {
  const seen = new Set<string>();
  const result: InventoryModel[] = [];
  for (const model of models) {
    const key = `${model.provider}\u0000${model.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

function withCurrentModel(
  models: InventoryModel[],
  provider: string,
  model: string,
): InventoryModel[] {
  if (!provider.trim() || !model.trim()) return models;
  const hasCurrent = models.some(
    (entry) => entry.provider === provider.trim() && entry.model === model.trim(),
  );
  if (hasCurrent) return models;
  return dedupeModels([
    ...models,
    {
      id: `current:${provider.trim()}:${model.trim()}`,
      provider: provider.trim(),
      model: model.trim(),
      baseUrl: "",
    },
  ]);
}

export function AgentModelConfigModal({
  profile,
  title,
  open,
  initialProvider = "",
  initialModel = "",
  onClose,
  onSaved,
}: AgentModelConfigModalProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [inventory, setInventory] = useState<InventoryModel[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");

    void Promise.all([
      window.hermesAPI.listModels(),
      window.hermesAPI.getEnv(profile),
      window.hermesAPI.getCredentialPool(),
      window.hermesAPI.getCodexAuthStatus(profile).catch(() => null),
    ])
      .then(([models, env, credPool, codexStatus]) => {
        if (cancelled) return;

        const connectedProviders = new Set<string>();
        for (const field of LLM_SECTION.items) {
          const providerId = providerIdForField(field);
          if ((env[field.key] || "").trim() || (credPool[providerId] || []).length > 0) {
            connectedProviders.add(providerId);
          }
        }
        if (codexStatus?.hasHermesAuth) {
          connectedProviders.add("openai-codex");
        }
        if (initialProvider.trim()) {
          connectedProviders.add(initialProvider.trim());
        }

        const normalized = dedupeModels(
          models
            .map((entry) => ({
              id: entry.id,
              provider: entry.provider,
              model: entry.model,
              baseUrl: entry.baseUrl,
            }))
            .filter((entry) => connectedProviders.has(entry.provider)),
        );
        const filtered = withCurrentModel(
          normalized,
          initialProvider,
          initialModel,
        );

        setInventory(filtered);
        const firstProvider = initialProvider.trim() || filtered[0]?.provider || "";
        const providerModels = filtered.filter((entry) => entry.provider === firstProvider);
        const firstModel =
          providerModels.find((entry) => entry.model === initialModel.trim())?.model ||
          providerModels[0]?.model ||
          initialModel.trim() ||
          "";
        setProvider(firstProvider);
        setModel(firstModel);
      })
      .catch((err) => {
        if (cancelled) return;
        setInventory([]);
        setProvider(initialProvider.trim());
        setModel(initialModel.trim());
        setError(err instanceof Error ? err.message : t("agents.modelInventoryFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialModel, initialProvider, open, profile, t]);

  const providers = useMemo(
    () => [...new Set(inventory.map((entry) => entry.provider).filter(Boolean))],
    [inventory],
  );

  const providerModels = useMemo(
    () => inventory.filter((entry) => entry.provider === provider),
    [inventory, provider],
  );

  async function handleSave(): Promise<void> {
    const selected = providerModels.find((entry) => entry.model === model);
    if (!provider || !model) {
      setError(t("agents.modelRequired"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await window.hermesAPI.setModelConfig(
        provider,
        model,
        selected?.baseUrl || "",
        profile,
      );
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agents.modelSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="agents-modal-backdrop" onClick={onClose}>
      <div className="agents-modal agents-model-modal" onClick={(e) => e.stopPropagation()}>
        <div className="agents-modal-header">
          <div>
            <h3>{title}</h3>
            <p>{t("agents.modelModalSubtitle")}</p>
          </div>
        </div>

        <div className="agents-model-fields">
          <label className="agents-model-field">
            <span>{t("agents.modelProvider")}</span>
            <div className="agents-model-select-wrap">
              <select
                className="agents-model-select"
                value={provider}
                onChange={(e) => {
                  const nextProvider = e.target.value;
                  const nextModels = inventory.filter((entry) => entry.provider === nextProvider);
                  setProvider(nextProvider);
                  setModel(nextModels[0]?.model || "");
                }}
                disabled={loading || saving || providers.length === 0}
              >
                {providers.length === 0 ? (
                  <option value="">{t("agents.noModelsAvailable")}</option>
                ) : null}
                {providers.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </label>

          <label className="agents-model-field">
            <span>{t("agents.modelName")}</span>
            <div className="agents-model-select-wrap">
              <select
                className="agents-model-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={loading || saving || providerModels.length === 0}
              >
                {providerModels.length === 0 ? (
                  <option value="">{t("agents.noModelsAvailable")}</option>
                ) : null}
                {providerModels.map((entry) => (
                  <option key={`${entry.provider}:${entry.model}`} value={entry.model}>
                    {entry.model}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </label>
        </div>

        {error ? <div className="agents-create-error">{error}</div> : null}
        {!error && !loading && providers.length === 0 ? (
          <div className="agents-model-empty">{t("agents.noModelsAvailableHint")}</div>
        ) : null}

        <div className="agents-model-actions">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || !provider || !model}
          >
            {saving ? t("agents.savingModel") : t("agents.saveModel")}
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

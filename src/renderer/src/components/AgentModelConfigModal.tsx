import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  dedupeInventoryModels,
  filterInventoryToConnectedProviders,
  type InventoryModel,
} from "../modelInventory";
import { useI18n } from "./useI18n";

interface AgentModelConfigModalProps {
  profile: string;
  title: string;
  open: boolean;
  initialProvider?: string;
  initialModel?: string;
  onClose: () => void;
  onSaved?: () => Promise<void> | void;
}

function dedupeModels(models: InventoryModel[]): InventoryModel[] {
  return dedupeInventoryModels(models);
}

function withCurrentModel(
  models: InventoryModel[],
  provider: string,
  model: string,
): InventoryModel[] {
  if (!provider.trim() || !model.trim()) return models;
  const hasCurrent = models.some(
    (entry) =>
      entry.provider === provider.trim() && entry.model === model.trim(),
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

        const normalized = filterInventoryToConnectedProviders(
          models.map((entry) => ({
            id: entry.id,
            provider: entry.provider,
            model: entry.model,
            baseUrl: entry.baseUrl,
          })),
          {
            env,
            credentialPool: credPool,
            codexStatus,
            includeProviders: [initialProvider],
          },
        );
        const filtered = withCurrentModel(
          normalized,
          initialProvider,
          initialModel,
        );

        setInventory(filtered);
        const firstProvider =
          initialProvider.trim() || filtered[0]?.provider || "";
        const providerModels = filtered.filter(
          (entry) => entry.provider === firstProvider,
        );
        const firstModel =
          providerModels.find((entry) => entry.model === initialModel.trim())
            ?.model ||
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
        setError(
          err instanceof Error ? err.message : t("agents.modelInventoryFailed"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialModel, initialProvider, open, profile, t]);

  const providers = useMemo(
    () => [
      ...new Set(inventory.map((entry) => entry.provider).filter(Boolean)),
    ],
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
      setError(
        err instanceof Error ? err.message : t("agents.modelSaveFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="agents-modal-backdrop" onClick={onClose}>
      <div
        className="agents-modal agents-model-modal"
        onClick={(e) => e.stopPropagation()}
      >
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
                  const nextModels = inventory.filter(
                    (entry) => entry.provider === nextProvider,
                  );
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
                  <option
                    key={`${entry.provider}:${entry.model}`}
                    value={entry.model}
                  >
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
          <div className="agents-model-empty">
            {t("agents.noModelsAvailableHint")}
          </div>
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
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

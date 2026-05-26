import { SETTINGS_SECTIONS } from "./constants";

export type InventoryModel = {
  id: string;
  provider: string;
  model: string;
  baseUrl: string;
};

type CredentialPool = Record<string, Array<unknown>>;

type CodexAuthStatus = {
  hasHermesAuth?: boolean;
} | null;

type ConnectedProviderSources = {
  env: Record<string, string>;
  credentialPool: CredentialPool;
  codexStatus?: CodexAuthStatus;
  includeProviders?: Array<string | undefined>;
};

const LLM_SECTION = SETTINGS_SECTIONS[0];

export const PROVIDER_BY_ENV_KEY: Record<string, string> = {
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

export function providerIdForEnvKey(key: string): string {
  return PROVIDER_BY_ENV_KEY[key] || key.toLowerCase();
}

export function dedupeInventoryModels<T extends InventoryModel>(
  models: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const model of models) {
    const key = `${model.provider}\u0000${model.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(model);
  }
  return result;
}

export function getConnectedProviderIds({
  env,
  credentialPool,
  codexStatus,
  includeProviders = [],
}: ConnectedProviderSources): Set<string> {
  const connectedProviders = new Set<string>();

  for (const field of LLM_SECTION.items) {
    const providerId = providerIdForEnvKey(field.key);
    if (
      (env[field.key] || "").trim() ||
      (credentialPool[providerId] || []).length > 0
    ) {
      connectedProviders.add(providerId);
    }
  }

  if (codexStatus?.hasHermesAuth) {
    connectedProviders.add("openai-codex");
  }

  for (const provider of includeProviders) {
    const trimmed = provider?.trim();
    if (trimmed) connectedProviders.add(trimmed);
  }

  return connectedProviders;
}

export function filterInventoryToConnectedProviders<T extends InventoryModel>(
  models: T[],
  sources: ConnectedProviderSources,
): T[] {
  const connectedProviders = getConnectedProviderIds(sources);
  return dedupeInventoryModels(
    models.filter((entry) => connectedProviders.has(entry.provider)),
  );
}

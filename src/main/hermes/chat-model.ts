import { getModelConfig } from "../config";
import type {
  ModelRoleResolutionSource,
  ResolvedTextModelRole,
} from "../../shared/model-roles";

export interface ChatRuntimeModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  contextWindow?: number;
  source: ModelRoleResolutionSource;
  modelId?: string;
  missingModelId?: string;
}

function fromResolvedChatRole(resolved: ResolvedTextModelRole): ChatRuntimeModelConfig {
  return {
    provider: resolved.provider,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    contextWindow: resolved.contextWindow,
    source: resolved.source,
    ...(resolved.modelId ? { modelId: resolved.modelId } : {}),
    ...(resolved.missingModelId ? { missingModelId: resolved.missingModelId } : {}),
  };
}

function legacyChatModel(profile?: string): ChatRuntimeModelConfig {
  const legacy = getModelConfig(profile);
  return {
    provider: legacy.provider,
    model: legacy.model,
    baseUrl: legacy.baseUrl,
    source: legacy.provider === "auto" && !legacy.model ? "provider-auto" : "legacy-chat-config",
  };
}

export async function resolveChatRuntimeModel(profile?: string): Promise<ChatRuntimeModelConfig> {
  try {
    const { resolveModelForRoleForConnection } = await import("../services/model-roles-service");
    const resolved = await resolveModelForRoleForConnection("chat", profile);
    if (resolved.kind === "text" && resolved.ok) {
      return fromResolvedChatRole(resolved);
    }
  } catch (error) {
    console.warn("[chat-model] Falling back to legacy chat model config", error);
  }
  return legacyChatModel(profile);
}

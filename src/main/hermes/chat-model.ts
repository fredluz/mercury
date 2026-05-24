import { inferContextWindow } from "../../shared/chat-metadata";
import { getModelConfigForProfile } from "../services/config-service";

export interface ChatRuntimeModelConfig {
  provider: string;
  model: string;
  baseUrl: string;
  contextWindow?: number;
  source: "agent-config";
}

export class ChatRuntimeModelResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatRuntimeModelResolutionError";
  }
}

export async function resolveChatRuntimeModel(
  profile?: string,
): Promise<ChatRuntimeModelConfig> {
  try {
    const config = await getModelConfigForProfile(profile);
    const provider = config.provider?.trim() ?? "";
    const model = config.model?.trim() ?? "";
    const baseUrl = config.baseUrl?.trim() ?? "";

    if (!provider || provider === "auto" || !model) {
      throw new ChatRuntimeModelResolutionError(
        "No model is configured for this agent. Configure the agent model from the Agents screen or complete provider setup before sending messages.",
      );
    }

    return {
      provider,
      model,
      baseUrl,
      contextWindow: inferContextWindow(provider, model).tokens,
      source: "agent-config",
    };
  } catch (error) {
    if (error instanceof ChatRuntimeModelResolutionError) throw error;
    console.warn("[chat-model] Agent model config resolution failed", error);
    throw new ChatRuntimeModelResolutionError(
      "Agent model configuration is unavailable. Configure the agent model from the Agents screen or Providers setup before sending messages.",
    );
  }
}

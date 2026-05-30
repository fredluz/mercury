import type {
  ChatCallbacks,
  ChatHandle,
  ProfileRuntimeHandle,
} from "./types";
import { sendMessageViaRunsApi } from "./runs-api";

export function sendMessageViaApi(
  message: string,
  cb: ChatCallbacks,
  profile: string | undefined,
  resumeSessionId: string | undefined,
  history: Array<{ role: string; content: string }> | undefined,
  runtime: ProfileRuntimeHandle,
): Promise<ChatHandle> {
  return Promise.resolve(
    sendMessageViaRunsApi(message, cb, profile, resumeSessionId, history, runtime),
  );
}

export interface ChatCompletionProbeResult {
  success: boolean;
  error?: string;
}

export async function probeChatCompletionViaApi(): Promise<ChatCompletionProbeResult> {
  return {
    success: false,
    error:
      "Mercury no longer probes the legacy chat-completions endpoint; runtime readiness uses /health and /v1/capabilities.",
  };
}

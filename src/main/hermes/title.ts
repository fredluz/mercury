import { generateTitle } from "../session-cache";
import { getSessionTitle } from "../sessions";
import { assertVerifiedApiRuntimeHandle } from "./runtime/api-runtime";
import type { ProfileRuntimeHandle } from "./types";
import {
  type GenerateChatTitleRequest,
  sanitizeChatTitle,
} from "../../shared/chat-metadata";

function fallbackTitle(messages: GenerateChatTitleRequest["messages"]): string {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content || "";
  return sanitizeChatTitle(generateTitle(firstUserMessage)) || generateTitle(firstUserMessage);
}

export async function generateChatTitle(
  request: GenerateChatTitleRequest,
  preparedRuntime?: ProfileRuntimeHandle,
): Promise<string> {
  if (preparedRuntime) {
    const expectedProfile = request.profile?.trim() || preparedRuntime.request.profile || "default";
    assertVerifiedApiRuntimeHandle(preparedRuntime, expectedProfile, "title");
  }

  if (request.sessionId) {
    const existingTitle = getSessionTitle(request.sessionId, request.profile);
    if (existingTitle) return sanitizeChatTitle(existingTitle) || existingTitle;
  }

  return fallbackTitle(request.messages);
}

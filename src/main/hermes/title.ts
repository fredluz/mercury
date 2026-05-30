import { generateTitle } from "../session-cache";
import { getSessionTitle } from "../sessions";
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
  _preparedRuntime?: ProfileRuntimeHandle,
): Promise<string> {
  if (request.sessionId) {
    const existingTitle = getSessionTitle(request.sessionId, request.profile);
    if (existingTitle) return sanitizeChatTitle(existingTitle) || existingTitle;
  }

  return fallbackTitle(request.messages);
}

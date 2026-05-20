import type {
  ScheduleContextMetadata,
  ScheduleCreatePayload,
} from "../../../../shared/schedules";
import type { ChatMessage } from "./types";

export interface ChatScheduleConversationMessage {
  index: number;
  role: ChatMessage["role"];
  content: string;
}

export interface ChatScheduleConversationContext extends ScheduleContextMetadata {
  source: "chat";
  profile?: string;
  createdAt: number;
  messageCount: number;
  messages: ChatScheduleConversationMessage[];
}

export interface ChatScheduleConversationDraft extends ScheduleCreatePayload {
  context: ChatScheduleConversationContext;
  conversation: ChatScheduleConversationContext;
  metadata: {
    source: "chat";
    createdAt: number;
    profile?: string;
  };
}

interface BuildScheduleDraftArgs {
  messages: ChatMessage[];
  sessionId?: string | null;
  sessionTitle?: string | null;
  profile?: string;
  createdAt?: number;
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= length) return normalized;
  return `${normalized.slice(0, Math.max(0, length - 1)).trimEnd()}...`;
}

function conversationExcerpt(
  messages: ChatScheduleConversationMessage[],
): string {
  const firstUserMessage = messages.find((message) => message.role === "user");
  return truncate(firstUserMessage?.content || messages[0]?.content || "", 180);
}

export function buildScheduleDraftFromConversation({
  messages,
  sessionId,
  sessionTitle,
  profile,
  createdAt = Date.now(),
}: BuildScheduleDraftArgs): ChatScheduleConversationDraft {
  const conversationMessages = messages
    .map((message, index) => ({
      index,
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
  const excerpt = conversationExcerpt(conversationMessages);
  const cleanTitle = sessionTitle?.trim();
  const context: ChatScheduleConversationContext = {
    source: "chat",
    sessionId: sessionId || undefined,
    conversationId: sessionId || undefined,
    title: cleanTitle || excerpt || undefined,
    excerpt: excerpt || undefined,
    profile,
    createdAt,
    messageCount: conversationMessages.length,
    messages: conversationMessages,
  };

  return {
    context,
    conversation: context,
    sourceSessionId: sessionId || undefined,
    metadata: {
      source: "chat",
      createdAt,
      profile,
    },
  };
}

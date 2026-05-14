export type ChatTitleRole = "user" | "agent" | "assistant";

export interface ChatTitleMessage {
  role: ChatTitleRole;
  content: string;
}

export interface GenerateChatTitleRequest {
  profile?: string;
  sessionId?: string;
  messages: ChatTitleMessage[];
}

export type ContextWindowSource = "explicit" | "known-model" | "family" | "fallback";

export interface ContextWindowInfo {
  tokens: number;
  source: ContextWindowSource;
}

const FALLBACK_CONTEXT_WINDOW = 128_000;
const MAX_TITLE_MESSAGES = 8;
const MAX_TITLE_MESSAGE_CHARS = 1_200;
const MAX_TITLE_TOTAL_CHARS = 6_000;

function normalize(value: string | undefined | null): string {
  return (value || "").trim().toLowerCase();
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function inferContextWindow(
  provider: string,
  model: string,
  explicit?: number | null,
): ContextWindowInfo {
  if (isPositiveFiniteNumber(explicit)) {
    return { tokens: Math.floor(explicit), source: "explicit" };
  }

  const normalizedProvider = normalize(provider);
  const normalizedModel = normalize(model);
  const combined = `${normalizedProvider}/${normalizedModel}`;

  if (combined.includes("claude-sonnet-4")) {
    return { tokens: 200_000, source: "known-model" };
  }

  if (
    normalizedModel === "gpt-4.1" ||
    normalizedModel.startsWith("gpt-4.1-") ||
    normalizedModel.endsWith("/gpt-4.1") ||
    normalizedModel.includes("/gpt-4.1-")
  ) {
    return { tokens: 1_047_576, source: "known-model" };
  }

  if (normalizedModel.includes("gpt-4o")) {
    return { tokens: 128_000, source: "family" };
  }

  if (combined.includes("deepseek")) {
    return { tokens: 128_000, source: "family" };
  }

  return { tokens: FALLBACK_CONTEXT_WINDOW, source: "fallback" };
}

export function calculateContextUsage(
  usedTokens: number,
  contextWindow: number,
): number {
  if (!isPositiveFiniteNumber(usedTokens) || !isPositiveFiniteNumber(contextWindow)) {
    return 0;
  }
  return Math.max(0, (usedTokens / contextWindow) * 100);
}

export function sanitizeChatTitle(rawTitle: string, maxLength = 60): string {
  let title = (rawTitle || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^[\s\-*>#`_~"'“”‘’]+|[\s\-*>#`_~"'“”‘’]+$/g, "")
    .replace(/^title\s*:\s*/i, "")
    .replace(/^[\s\-*>#`_~"'“”‘’]+|[\s\-*>#`_~"'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (title.length > maxLength) {
    const truncated = title.slice(0, maxLength + 1);
    const boundary = truncated.lastIndexOf(" ");
    title = (boundary >= 30 ? truncated.slice(0, boundary) : title.slice(0, maxLength)).trim();
  }

  title = title.replace(/[.!?。！？]+$/u, "").trim();
  return title;
}

export function normalizeGenerateChatTitleRequest(
  request: GenerateChatTitleRequest,
): GenerateChatTitleRequest {
  let remainingChars = MAX_TITLE_TOTAL_CHARS;
  const messages: ChatTitleMessage[] = [];

  for (const message of request.messages.slice(0, MAX_TITLE_MESSAGES)) {
    if (remainingChars <= 0) break;
    const content = message.content
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, Math.min(MAX_TITLE_MESSAGE_CHARS, remainingChars));
    remainingChars -= content.length;
    if (content) messages.push({ role: message.role, content });
  }

  return {
    profile: request.profile?.trim() || undefined,
    sessionId: request.sessionId?.trim() || undefined,
    messages,
  };
}

export function isGenerateChatTitleRequest(
  value: unknown,
): value is GenerateChatTitleRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GenerateChatTitleRequest>;
  if (candidate.profile !== undefined && typeof candidate.profile !== "string") return false;
  if (candidate.sessionId !== undefined && typeof candidate.sessionId !== "string") return false;
  if (!Array.isArray(candidate.messages)) return false;
  return candidate.messages.every((message) => {
    if (!message || typeof message !== "object") return false;
    const msg = message as Partial<ChatTitleMessage>;
    return (
      (msg.role === "user" || msg.role === "agent" || msg.role === "assistant") &&
      typeof msg.content === "string"
    );
  });
}

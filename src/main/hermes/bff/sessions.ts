import type { SessionMessage, SessionSummary } from "../../sessions";
import type { CachedSession } from "../../session-cache";
import type { ProfileHermesBffClient } from "./client";

export interface HermesServerSession {
  id: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  source: string;
  messageCount: number;
  model: string;
  profile: string;
  raw: Record<string, unknown>;
}

export class HermesSessionsBffClient {
  constructor(private readonly client: ProfileHermesBffClient) {}

  async create(): Promise<HermesServerSession> {
    const payload = await this.client.json<unknown>({
      family: "sessions",
      method: "POST",
      path: "/api/sessions",
      body: {},
      expectedStatuses: [200, 201, 202],
      retry: "none",
    });
    return normalizeSession(unwrapPayload(payload, "session"), this.client.profile);
  }

  async read(sessionId: string): Promise<HermesServerSession> {
    const payload = await this.client.json<unknown>({
      family: "sessions",
      method: "GET",
      path: `/api/sessions/${encodeURIComponent(sessionId)}`,
      sessionId,
    });
    return normalizeSession(unwrapPayload(payload, "session"), this.client.profile);
  }

  async list(): Promise<HermesServerSession[]> {
    const payload = await this.client.json<unknown>({
      family: "sessions",
      method: "GET",
      path: "/api/sessions",
    });
    const sessions = unwrapPayload(payload, "sessions");
    if (!Array.isArray(sessions)) throw new Error("Hermes session list was malformed.");
    return sessions.map((session) => normalizeSession(session, this.client.profile));
  }

  async messages(sessionId: string): Promise<SessionMessage[]> {
    const payload = await this.client.json<unknown>({
      family: "sessions",
      method: "GET",
      path: `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      sessionId,
    });
    const messages = unwrapPayload(payload, "messages");
    if (!Array.isArray(messages)) {
      throw new Error("Hermes session messages response was malformed.");
    }
    return messages.map(normalizeMessage);
  }

  async fork(sessionId: string): Promise<HermesServerSession> {
    const payload = await this.client.json<unknown>({
      family: "sessions",
      method: "POST",
      path: `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
      body: {},
      expectedStatuses: [200, 201, 202],
      sessionId,
      retry: "none",
    });
    return normalizeSession(unwrapPayload(payload, "session"), this.client.profile);
  }

  async updateTitle(sessionId: string, title: string): Promise<HermesServerSession> {
    const payload = await this.client.json<unknown>({
      family: "sessions",
      method: "PATCH",
      path: `/api/sessions/${encodeURIComponent(sessionId)}`,
      body: { title },
      sessionId,
      retry: "none",
    });
    return normalizeSession(unwrapPayload(payload, "session"), this.client.profile);
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.json({
      family: "sessions",
      method: "DELETE",
      path: `/api/sessions/${encodeURIComponent(sessionId)}`,
      expectedStatuses: [200, 202, 204],
      sessionId,
      retry: "none",
    });
  }
}

export function cachedSessionFromServerSession(session: HermesServerSession): CachedSession {
  return {
    id: session.id,
    title: session.title || "New Conversation",
    startedAt: session.startedAt,
    source: session.source,
    messageCount: session.messageCount,
    model: session.model,
    profile: session.profile,
  };
}

export function summaryFromServerSession(session: HermesServerSession): SessionSummary {
  return {
    id: session.id,
    source: session.source,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount: session.messageCount,
    model: session.model,
    title: session.title,
    preview: "",
    profile: session.profile,
  };
}

export function normalizeSession(payload: unknown, profile: string): HermesServerSession {
  if (!payload || typeof payload !== "object") {
    throw new Error("Hermes session response was malformed.");
  }
  const record = payload as Record<string, unknown>;
  const id = firstString(record, ["id", "session_id", "sessionId"]);
  if (!id) throw new Error("Hermes session response did not include an id.");
  return {
    id,
    title: firstString(record, ["title", "name"]) || null,
    startedAt: seconds(record.started_at ?? record.startedAt ?? record.created_at ?? record.createdAt),
    endedAt:
      record.ended_at || record.endedAt
        ? seconds(record.ended_at ?? record.endedAt)
        : null,
    source: firstString(record, ["source"]) || "api",
    messageCount: firstNumber(record, ["message_count", "messageCount"]),
    model: firstString(record, ["model"]),
    profile,
    raw: record,
  };
}

export function normalizeMessage(payload: unknown): SessionMessage {
  if (!payload || typeof payload !== "object") {
    throw new Error("Hermes session message response was malformed.");
  }
  const record = payload as Record<string, unknown>;
  return {
    id:
      typeof record.id === "number"
        ? record.id
        : Number.parseInt(String(record.id ?? 0), 10) || 0,
    role:
      record.role === "tool"
        ? "tool"
        : record.role === "assistant" || record.role === "agent"
          ? "assistant"
          : "user",
    content: typeof record.content === "string" ? record.content : "",
    timestamp: seconds(record.timestamp ?? record.created_at ?? record.createdAt),
  };
}

function unwrapPayload(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  return record[key] ?? record.data ?? payload;
}

function seconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

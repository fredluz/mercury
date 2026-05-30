import http from "http";
import https from "https";
import type { CachedSession } from "../session-cache";
import type { SessionMessage, SessionSummary } from "../sessions";
import type { ProfileRuntimeHandle } from "../hermes/types";
import { assertVerifiedApiRuntimeHandle } from "../hermes/runtime/api-runtime";

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

type RequestOptions = {
  method: string;
  path: string;
  body?: unknown;
};

function normalizeProfile(profile?: string): string {
  const trimmed = profile?.trim();
  return trimmed && trimmed !== "default" ? trimmed : "default";
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

function unwrapPayload(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  return record[key] ?? record.data ?? payload;
}

function normalizeSession(
  payload: unknown,
  profile: string,
): HermesServerSession {
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

function normalizeMessage(payload: unknown): SessionMessage {
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

async function requestJson(
  runtime: ProfileRuntimeHandle,
  options: RequestOptions,
): Promise<unknown> {
  assertVerifiedApiRuntimeHandle(
    runtime,
    runtime.request.profile,
    "sessions",
  );
  const url = `${runtime.apiBaseUrl.replace(/\/+$/, "")}${options.path}`;
  const mod = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: options.method,
        headers: {
          "content-type": "application/json",
          ...(runtime.authHeaders ?? {}),
        },
        timeout: 20_000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Hermes Sessions API error ${res.statusCode}: ${raw}`));
            return;
          }
          if (!raw.trim()) {
            resolve({});
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error("Hermes Sessions API returned invalid JSON."));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Hermes Sessions API timed out.")));
    if (options.body !== undefined) req.write(JSON.stringify(options.body));
    req.end();
  });
}

export function cachedSessionFromServerSession(
  session: HermesServerSession,
): CachedSession {
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

export function summaryFromServerSession(
  session: HermesServerSession,
): SessionSummary {
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

export async function createHermesSession(
  runtime: ProfileRuntimeHandle,
): Promise<HermesServerSession> {
  const profile = normalizeProfile(runtime.request.profile);
  const payload = await requestJson(runtime, {
    method: "POST",
    path: "/api/sessions",
    body: {},
  });
  return normalizeSession(unwrapPayload(payload, "session"), profile);
}

export async function readHermesSession(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<HermesServerSession> {
  const profile = normalizeProfile(runtime.request.profile);
  const payload = await requestJson(runtime, {
    method: "GET",
    path: `/api/sessions/${encodeURIComponent(sessionId)}`,
  });
  return normalizeSession(unwrapPayload(payload, "session"), profile);
}

export async function listHermesSessions(
  runtime: ProfileRuntimeHandle,
): Promise<HermesServerSession[]> {
  const profile = normalizeProfile(runtime.request.profile);
  const payload = await requestJson(runtime, {
    method: "GET",
    path: "/api/sessions",
  });
  const sessions = unwrapPayload(payload, "sessions");
  if (!Array.isArray(sessions)) throw new Error("Hermes session list was malformed.");
  return sessions.map((session) => normalizeSession(session, profile));
}

export async function getHermesSessionMessages(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<SessionMessage[]> {
  const payload = await requestJson(runtime, {
    method: "GET",
    path: `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
  });
  const messages = unwrapPayload(payload, "messages");
  if (!Array.isArray(messages)) {
    throw new Error("Hermes session messages response was malformed.");
  }
  return messages.map(normalizeMessage);
}

export async function forkHermesSession(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<HermesServerSession> {
  const profile = normalizeProfile(runtime.request.profile);
  const payload = await requestJson(runtime, {
    method: "POST",
    path: `/api/sessions/${encodeURIComponent(sessionId)}/fork`,
    body: {},
  });
  return normalizeSession(unwrapPayload(payload, "session"), profile);
}

export async function updateHermesSessionTitle(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
  title: string,
): Promise<HermesServerSession> {
  const profile = normalizeProfile(runtime.request.profile);
  const payload = await requestJson(runtime, {
    method: "PATCH",
    path: `/api/sessions/${encodeURIComponent(sessionId)}`,
    body: { title },
  });
  return normalizeSession(unwrapPayload(payload, "session"), profile);
}

export async function deleteHermesSession(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<void> {
  await requestJson(runtime, {
    method: "DELETE",
    path: `/api/sessions/${encodeURIComponent(sessionId)}`,
  });
}

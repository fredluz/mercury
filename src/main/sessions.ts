import Database from "better-sqlite3";
import { existsSync } from "fs";
import {
  discoverSessionProfileScopes,
  getSessionProfileScope,
  type SessionProfileScope,
} from "./session-db";

export interface SessionSummary {
  id: string;
  source: string;
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
  model: string;
  title: string | null;
  preview: string;
  profile?: string;
}

export interface SessionMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
}

export interface SearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
  profile?: string;
}

function getDb(scope: SessionProfileScope): Database.Database | null {
  if (!existsSync(scope.dbPath)) return null;
  return new Database(scope.dbPath, { readonly: true });
}

function listSessionsForScope(
  scope: SessionProfileScope,
  limit: number,
  offset: number,
): SessionSummary[] {
  const db = getDb(scope);
  if (!db) return [];

  try {
    const rows = db
      .prepare(
        `SELECT
          s.id,
          s.source,
          s.started_at,
          s.ended_at,
          s.message_count,
          s.model,
          s.title
        FROM sessions s
        ORDER BY s.started_at DESC
        LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
      id: string;
      source: string;
      started_at: number;
      ended_at: number | null;
      message_count: number;
      model: string;
      title: string | null;
    }>;

    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      messageCount: r.message_count,
      model: r.model || "",
      title: r.title,
      preview: "",
      profile: scope.profile,
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function listSessions(
  limit = 30,
  offset = 0,
  profile?: string,
): SessionSummary[] {
  if (profile?.trim()) {
    return listSessionsForScope(getSessionProfileScope(profile), limit, offset);
  }

  const rows = discoverSessionProfileScopes()
    .flatMap((scope) => listSessionsForScope(scope, limit + offset, 0))
    .sort((a, b) => b.startedAt - a.startedAt);
  return rows.slice(offset, offset + limit);
}

function searchSessionsForScope(
  scope: SessionProfileScope,
  query: string,
  limit: number,
): SearchResult[] {
  const db = getDb(scope);
  if (!db) return [];

  try {
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'",
      )
      .get() as { name: string } | undefined;

    if (!tableCheck) return [];

    const sanitized = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => `"${w.replace(/"/g, "")}"*`)
      .join(" ");

    if (!sanitized) return [];

    const rows = db
      .prepare(
        `SELECT DISTINCT
          m.session_id,
          s.title,
          s.started_at,
          s.source,
          s.message_count,
          s.model,
          snippet(messages_fts, 0, '<<', '>>', '...', 40) as snippet
        FROM messages_fts
        JOIN messages m ON m.id = messages_fts.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
      )
      .all(sanitized, limit) as Array<{
      session_id: string;
      title: string | null;
      started_at: number;
      source: string;
      message_count: number;
      model: string;
      snippet: string;
    }>;

    return rows.map((r) => ({
      sessionId: r.session_id,
      title: r.title,
      startedAt: r.started_at,
      source: r.source,
      messageCount: r.message_count,
      model: r.model || "",
      snippet: r.snippet || "",
      profile: scope.profile,
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export function searchSessions(
  query: string,
  limit = 20,
  profile?: string,
): SearchResult[] {
  if (profile?.trim()) {
    return searchSessionsForScope(getSessionProfileScope(profile), query, limit);
  }

  return discoverSessionProfileScopes()
    .flatMap((scope) => searchSessionsForScope(scope, query, limit))
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
}

export function getSessionTitle(
  sessionId: string,
  profile?: string,
): string | null {
  for (const scope of profile?.trim()
    ? [getSessionProfileScope(profile)]
    : discoverSessionProfileScopes()) {
    const db = getDb(scope);
    if (!db) continue;

    try {
      const row = db
        .prepare(`SELECT title FROM sessions WHERE id = ?`)
        .get(sessionId) as { title: string | null } | undefined;
      if (row) {
        const title = row.title?.trim();
        return title || null;
      }
    } catch {
      return null;
    } finally {
      db.close();
    }
  }
  return null;
}

function getSessionMessagesForScope(
  scope: SessionProfileScope,
  sessionId: string,
): SessionMessage[] | null {
  const db = getDb(scope);
  if (!db) return null;

  try {
    const session = db
      .prepare(`SELECT id FROM sessions WHERE id = ?`)
      .get(sessionId) as { id: string } | undefined;
    if (!session) return null;

    const rows = db
      .prepare(
        `SELECT id, role, content, timestamp
         FROM messages
         WHERE session_id = ? AND role IN ('user', 'assistant') AND content IS NOT NULL
         ORDER BY timestamp, id`,
      )
      .all(sessionId) as Array<{
      id: number;
      role: string;
      content: string;
      timestamp: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content,
      timestamp: r.timestamp,
    }));
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export function getSessionMessages(
  sessionId: string,
  profile?: string,
): SessionMessage[] {
  const scopes = profile?.trim()
    ? [getSessionProfileScope(profile)]
    : discoverSessionProfileScopes();

  for (const scope of scopes) {
    const messages = getSessionMessagesForScope(scope, sessionId);
    if (messages) return messages;
  }
  return [];
}

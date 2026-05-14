import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import Database from "better-sqlite3";
import { sanitizeChatTitle } from "../shared/chat-metadata";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

const CACHE_DIR = join(HERMES_HOME, "desktop");
const CACHE_FILE = join(CACHE_DIR, "sessions.json");
const DB_PATH = join(HERMES_HOME, "state.db");

export interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  profile?: string;
}

interface CacheData {
  sessions: CachedSession[];
  lastSync: number;
}

// Generate a short, readable title from the first user message (like ChatGPT/Claude)
export function generateTitle(message: string): string {
  if (!message || !message.trim())
    return t("sessions.newConversation", getAppLocale());

  // Clean up the message
  let text = message.trim();

  // Remove markdown formatting
  text = text.replace(/[#*_`~\[\]()]/g, "");
  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, "");
  // Remove extra whitespace
  text = text.replace(/\s+/g, " ").trim();

  if (!text) return t("sessions.newConversation", getAppLocale());

  // If short enough, use as-is
  if (text.length <= 50) return text;

  // Take first meaningful chunk — aim for ~40-50 chars at word boundary
  const words = text.split(" ");
  let title = "";
  for (const word of words) {
    if ((title + " " + word).trim().length > 45) break;
    title = (title + " " + word).trim();
  }

  return title || text.slice(0, 45) + "...";
}

function readCache(): CacheData {
  try {
    if (!existsSync(CACHE_FILE)) return { sessions: [], lastSync: 0 };
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return { sessions: [], lastSync: 0 };
  }
}

function writeCache(data: CacheData): void {
  try {
    safeWriteFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

function getDb(readonly = true): Database.Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly });
}

type SessionRow = {
  id: string;
  started_at: number;
  source: string;
  message_count: number;
  model: string;
  title: string | null;
};

function normalizeProfile(profile?: string): string {
  const value = profile?.trim();
  return value || "default";
}

function readSessionRow(
  db: Database.Database,
  sessionId: string,
): SessionRow | null {
  try {
    return (
      (db
        .prepare(
          `SELECT id, started_at, source, message_count, model, title
           FROM sessions
           WHERE id = ?`,
        )
        .get(sessionId) as SessionRow | undefined) || null
    );
  } catch {
    return null;
  }
}

function generateTitleFromFirstMessage(
  db: Database.Database,
  sessionId: string,
): string {
  try {
    const msg = db
      .prepare(
        `SELECT content FROM messages
         WHERE session_id = ? AND role = 'user' AND content IS NOT NULL
         ORDER BY timestamp, id LIMIT 1`,
      )
      .get(sessionId) as { content: string } | undefined;
    return msg
      ? generateTitle(msg.content)
      : t("sessions.newConversation", getAppLocale());
  } catch {
    return t("sessions.newConversation", getAppLocale());
  }
}

function cachedSessionFromRow(
  db: Database.Database | null,
  row: SessionRow,
  overrides: Partial<CachedSession> = {},
): CachedSession {
  const title =
    overrides.title ||
    row.title?.trim() ||
    (db
      ? generateTitleFromFirstMessage(db, row.id)
      : t("sessions.newConversation", getAppLocale()));
  return {
    id: row.id,
    title,
    startedAt: row.started_at,
    source: row.source,
    messageCount: row.message_count,
    model: row.model || "",
    ...overrides,
  };
}

// Sync from hermes DB to local cache — only fetches new/updated sessions
export function syncSessionCache(): CachedSession[] {
  const cache = readCache();
  const db = getDb();
  if (!db) return cache.sessions;

  try {
    // Fetch sessions newer than last sync, or all if first sync
    const rows = db
      .prepare(
        `SELECT s.id, s.started_at, s.source, s.message_count, s.model, s.title
         FROM sessions s
         WHERE s.started_at > ?
         ORDER BY s.started_at DESC`,
      )
      .all(cache.lastSync > 0 ? cache.lastSync - 300 : 0) as Array<{
      id: string;
      started_at: number;
      source: string;
      message_count: number;
      model: string;
      title: string | null;
    }>;

    // Index existing sessions by id once so the per-row update below is
    // O(1) instead of O(N). Without this, syncing N existing sessions
    // against N new rows is O(N²) and visibly slows app startup once a
    // user has accumulated thousands of sessions (issue #16).
    const existingById = new Map<string, CachedSession>();
    for (const s of cache.sessions) existingById.set(s.id, s);
    const newSessions: CachedSession[] = [];

    for (const row of rows) {
      const existing = existingById.get(row.id);
      if (existing) {
        // Update existing entry (message count/model/title may have changed)
        existing.messageCount = row.message_count;
        existing.model = row.model || "";
        if (row.title && row.title.trim()) {
          existing.title = row.title.trim();
        }
        continue;
      }

      newSessions.push(cachedSessionFromRow(db, row));
    }

    // Merge: new sessions first (most recent), then existing
    const allSessions = [...newSessions, ...cache.sessions];
    // Sort by startedAt descending
    allSessions.sort((a, b) => b.startedAt - a.startedAt);

    const updated: CacheData = {
      sessions: allSessions,
      lastSync: Math.floor(Date.now() / 1000),
    };
    writeCache(updated);
    return updated.sessions;
  } catch {
    return cache.sessions;
  } finally {
    db.close();
  }
}

// Fast read from cache only (no DB access)
export function listCachedSessions(
  limit = 50,
  offset = 0,
): CachedSession[] {
  const cache = readCache();
  return cache.sessions.slice(offset, offset + limit);
}

// Update title for a specific session in SQLite where available and in the
// desktop cache. Returns true when either backing store was updated.
export function updateSessionTitle(
  sessionId: string,
  title: string,
): boolean {
  const cleanSessionId = sessionId.trim();
  const cleanTitle = sanitizeChatTitle(title, 120);
  if (!cleanSessionId || !cleanTitle) return false;

  let updated = false;
  let row: ReturnType<typeof readSessionRow> = null;
  const db = getDb(false);
  if (db) {
    try {
      row = readSessionRow(db, cleanSessionId);
      if (row) {
        const changes = db
          .prepare(`UPDATE sessions SET title = ? WHERE id = ?`)
          .run(cleanTitle, cleanSessionId).changes;
        updated = updated || changes > 0;
        row = { ...row, title: cleanTitle };
      }
    } catch {
      // Older or partial DBs may not have sessions.title yet. Cache updates
      // below are still useful and should not fail the IPC call.
    } finally {
      db.close();
    }
  }

  const cache = readCache();
  const idx = cache.sessions.findIndex((s) => s.id === cleanSessionId);
  if (idx >= 0) {
    cache.sessions[idx].title = cleanTitle;
    writeCache(cache);
    return true;
  }

  if (row) {
    cache.sessions.push(cachedSessionFromRow(null, row, { title: cleanTitle }));
    cache.sessions.sort((a, b) => b.startedAt - a.startedAt);
    writeCache(cache);
    updated = true;
  }

  return updated;
}

export function updateSessionProfile(
  sessionId: string,
  profile?: string,
): boolean {
  const cleanSessionId = sessionId.trim();
  if (!cleanSessionId) return false;
  const cleanProfile = normalizeProfile(profile);

  let row: ReturnType<typeof readSessionRow> = null;
  const db = getDb();
  if (db) {
    try {
      row = readSessionRow(db, cleanSessionId);
    } finally {
      db.close();
    }
  }

  const cache = readCache();
  const idx = cache.sessions.findIndex((s) => s.id === cleanSessionId);
  if (idx >= 0) {
    cache.sessions[idx].profile = cleanProfile;
    writeCache(cache);
    return true;
  }

  if (!row) return false;
  cache.sessions.push(
    cachedSessionFromRow(null, row, { profile: cleanProfile }),
  );
  cache.sessions.sort((a, b) => b.startedAt - a.startedAt);
  writeCache(cache);
  return true;
}

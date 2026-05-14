import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import Database from "better-sqlite3";
import { sanitizeChatTitle } from "../shared/chat-metadata";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";
import {
  discoverSessionProfileScopes,
  getSessionProfileScope,
  normalizeSessionProfile,
  sessionCacheKey,
  type SessionProfileScope,
} from "./session-db";

const CACHE_DIR = join(HERMES_HOME, "desktop");
const CACHE_FILE = join(CACHE_DIR, "sessions.json");

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
  profileSync?: Record<string, number>;
}

// Generate a short, readable title from the first user message (like ChatGPT/Claude)
export function generateTitle(message: string): string {
  if (!message || !message.trim())
    return t("sessions.newConversation", getAppLocale());

  let text = message.trim();
  text = text.replace(/[#*_`~\[\]()]/g, "");
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/\s+/g, " ").trim();

  if (!text) return t("sessions.newConversation", getAppLocale());
  if (text.length <= 50) return text;

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
    if (!existsSync(CACHE_FILE)) return { sessions: [], lastSync: 0, profileSync: {} };
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as CacheData;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      lastSync: Number(parsed.lastSync) || 0,
      profileSync: parsed.profileSync || {},
    };
  } catch {
    return { sessions: [], lastSync: 0, profileSync: {} };
  }
}

function writeCache(data: CacheData): void {
  try {
    safeWriteFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // non-fatal
  }
}

function getDb(
  scope: SessionProfileScope,
  readonly = true,
): Database.Database | null {
  if (!existsSync(scope.dbPath)) return null;
  return new Database(scope.dbPath, { readonly });
}

type SessionRow = {
  id: string;
  started_at: number;
  source: string;
  message_count: number;
  model: string;
  title: string | null;
};

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
  profile: string,
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
    profile,
    ...overrides,
  };
}

function normalizeCachedSessionProfile(session: CachedSession): string {
  return normalizeSessionProfile(session.profile);
}

function matchingCacheIndex(
  sessions: CachedSession[],
  sessionId: string,
  profile?: string,
): number {
  if (profile?.trim()) {
    const key = sessionCacheKey(sessionId, profile);
    return sessions.findIndex(
      (session) =>
        sessionCacheKey(session.id, normalizeCachedSessionProfile(session)) === key,
    );
  }
  return sessions.findIndex((session) => session.id === sessionId);
}

function sortSessions(sessions: CachedSession[]): CachedSession[] {
  return sessions.sort((a, b) => b.startedAt - a.startedAt);
}

function syncScope(
  cache: CacheData,
  scope: SessionProfileScope,
  forceFull: boolean,
): void {
  const db = getDb(scope);
  if (!db) return;

  try {
    const profileSync = cache.profileSync || {};
    const lastProfileSync = profileSync[scope.profile] || 0;
    const since = forceFull || lastProfileSync <= 0 ? 0 : lastProfileSync - 300;
    const rows = db
      .prepare(
        `SELECT s.id, s.started_at, s.source, s.message_count, s.model, s.title
         FROM sessions s
         WHERE s.started_at > ?
         ORDER BY s.started_at DESC`,
      )
      .all(since) as SessionRow[];

    const existingByKey = new Map<string, CachedSession>();
    for (const session of cache.sessions) {
      const normalizedProfile = normalizeCachedSessionProfile(session);
      session.profile = normalizedProfile;
      existingByKey.set(sessionCacheKey(session.id, normalizedProfile), session);
    }

    for (const row of rows) {
      const key = sessionCacheKey(row.id, scope.profile);
      const existing = existingByKey.get(key);
      if (existing) {
        existing.profile = scope.profile;
        existing.startedAt = row.started_at;
        existing.source = row.source;
        existing.messageCount = row.message_count;
        existing.model = row.model || "";
        if (row.title && row.title.trim()) existing.title = row.title.trim();
        continue;
      }
      const created = cachedSessionFromRow(db, row, scope.profile);
      cache.sessions.push(created);
      existingByKey.set(key, created);
    }

    cache.profileSync = {
      ...profileSync,
      [scope.profile]: Math.floor(Date.now() / 1000),
    };
  } finally {
    db.close();
  }
}

function dedupeCacheSessions(sessions: CachedSession[]): CachedSession[] {
  const byKey = new Map<string, CachedSession>();
  for (const session of sessions) {
    session.profile = normalizeCachedSessionProfile(session);
    byKey.set(sessionCacheKey(session.id, session.profile), session);
  }
  return sortSessions([...byKey.values()]);
}

function discoverKnownSessionProfiles(
  scopes: SessionProfileScope[],
): Map<string, Set<string>> {
  const profilesById = new Map<string, Set<string>>();
  for (const scope of scopes) {
    const db = getDb(scope);
    if (!db) continue;
    try {
      const rows = db.prepare(`SELECT id FROM sessions`).all() as Array<{ id: string }>;
      for (const row of rows) {
        const profiles = profilesById.get(row.id) || new Set<string>();
        profiles.add(scope.profile);
        profilesById.set(row.id, profiles);
      }
    } catch {
      // Ignore malformed DBs during legacy metadata backfill.
    } finally {
      db.close();
    }
  }
  return profilesById;
}

function dropMisprofiledLegacyDefaults(
  sessions: CachedSession[],
  profilesById: Map<string, Set<string>>,
): CachedSession[] {
  return sessions.filter((session) => {
    const profile = normalizeCachedSessionProfile(session);
    const knownProfiles = profilesById.get(session.id);
    if (!knownProfiles || knownProfiles.size === 0) return true;
    if (knownProfiles.has(profile)) return true;
    return !(profile === "default" && knownProfiles.size > 0);
  });
}

// Sync from hermes DB(s) to local cache — only fetches new/updated sessions per profile.
export function syncSessionCache(profile?: string): CachedSession[] {
  const cache = readCache();
  const requestedProfile = profile?.trim()
    ? normalizeSessionProfile(profile)
    : undefined;
  const scopes = requestedProfile
    ? [getSessionProfileScope(requestedProfile)]
    : discoverSessionProfileScopes();
  const hasMissingProfile = cache.sessions.some((session) => !session.profile);
  const hasMissingProfileSync = scopes.some(
    (scope) => !(cache.profileSync || {})[scope.profile],
  );
  const forceFull = hasMissingProfile || hasMissingProfileSync;

  try {
    for (const scope of scopes) {
      try {
        syncScope(cache, scope, forceFull);
      } catch {
        // One malformed profile DB should not prevent other profiles from syncing.
      }
    }
    if (forceFull && !requestedProfile) {
      cache.sessions = dropMisprofiledLegacyDefaults(
        cache.sessions,
        discoverKnownSessionProfiles(scopes),
      );
    }
    cache.sessions = dedupeCacheSessions(cache.sessions);
    cache.lastSync = Math.floor(Date.now() / 1000);
    cache.profileSync = cache.profileSync || {};
    writeCache(cache);
  } catch {
    // Preserve old cache if a partial sync fails.
  }

  return requestedProfile
    ? cache.sessions.filter(
        (session) => normalizeCachedSessionProfile(session) === requestedProfile,
      )
    : cache.sessions;
}

// Fast read from cache only (no DB access)
export function listCachedSessions(
  limit = 50,
  offset = 0,
  profile?: string,
): CachedSession[] {
  const requestedProfile = profile?.trim()
    ? normalizeSessionProfile(profile)
    : undefined;
  const cache = readCache();
  const sessions = dedupeCacheSessions(cache.sessions).filter(
    (session) =>
      !requestedProfile || normalizeCachedSessionProfile(session) === requestedProfile,
  );
  return sessions.slice(offset, offset + limit);
}

// Update title for a specific session in SQLite where available and in the
// desktop cache. Returns true when either backing store was updated.
export function updateSessionTitle(
  sessionId: string,
  title: string,
  profile?: string,
): boolean {
  const cleanSessionId = sessionId.trim();
  const cleanTitle = sanitizeChatTitle(title, 120);
  if (!cleanSessionId || !cleanTitle) return false;

  const requestedProfile = profile?.trim()
    ? normalizeSessionProfile(profile)
    : undefined;
  const scopes = requestedProfile
    ? [getSessionProfileScope(requestedProfile)]
    : discoverSessionProfileScopes();
  let updated = false;
  let insertedRow: { row: SessionRow; profile: string } | null = null;

  for (const scope of scopes) {
    const db = getDb(scope, false);
    if (!db) continue;
    try {
      const row = readSessionRow(db, cleanSessionId);
      if (row) {
        const changes = db
          .prepare(`UPDATE sessions SET title = ? WHERE id = ?`)
          .run(cleanTitle, cleanSessionId).changes;
        updated = updated || changes > 0;
        insertedRow = { row: { ...row, title: cleanTitle }, profile: scope.profile };
        if (requestedProfile) break;
      }
    } catch {
      // Older or partial DBs may not have sessions.title yet. Cache updates
      // below are still useful and should not fail the IPC call.
    } finally {
      db.close();
    }
  }

  const cache = readCache();
  let cacheUpdated = false;
  if (requestedProfile) {
    const idx = matchingCacheIndex(cache.sessions, cleanSessionId, requestedProfile);
    if (idx >= 0) {
      cache.sessions[idx].title = cleanTitle;
      cache.sessions[idx].profile = requestedProfile;
      cacheUpdated = true;
    }
  } else {
    for (const session of cache.sessions) {
      if (session.id !== cleanSessionId) continue;
      session.title = cleanTitle;
      session.profile = normalizeCachedSessionProfile(session);
      cacheUpdated = true;
    }
  }

  if (!cacheUpdated && insertedRow) {
    cache.sessions.push(
      cachedSessionFromRow(null, insertedRow.row, insertedRow.profile, {
        title: cleanTitle,
      }),
    );
    cacheUpdated = true;
  }

  if (cacheUpdated) {
    cache.sessions = dedupeCacheSessions(cache.sessions);
    writeCache(cache);
    return true;
  }

  return updated;
}

export function updateSessionProfile(
  sessionId: string,
  profile?: string,
): boolean {
  const cleanSessionId = sessionId.trim();
  if (!cleanSessionId) return false;
  const cleanProfile = normalizeSessionProfile(profile);
  const scope = getSessionProfileScope(cleanProfile);

  let row: ReturnType<typeof readSessionRow> = null;
  const db = getDb(scope);
  if (db) {
    try {
      row = readSessionRow(db, cleanSessionId);
    } finally {
      db.close();
    }
  }

  const cache = readCache();
  const idx = matchingCacheIndex(cache.sessions, cleanSessionId, cleanProfile);
  if (idx >= 0) {
    cache.sessions[idx].profile = cleanProfile;
    if (row) {
      cache.sessions[idx] = cachedSessionFromRow(null, row, cleanProfile, {
        title: cache.sessions[idx].title,
      });
    }
    cache.sessions = dedupeCacheSessions(cache.sessions);
    writeCache(cache);
    return true;
  }

  if (!row) return false;
  cache.sessions.push(cachedSessionFromRow(null, row, cleanProfile));
  cache.sessions = dedupeCacheSessions(cache.sessions);
  writeCache(cache);
  return true;
}

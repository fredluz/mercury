import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { performance } from "perf_hooks";
import { getConnectionConfig } from "../config";
import { listSessions, getSessionMessages, searchSessions } from "../sessions";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
  projectCachedSession,
  removeCachedSession,
} from "../session-cache";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "../profiles";
import {
  sshListSessions,
  sshGetSessionMessages,
  sshSearchSessions,
  sshListProfiles,
  sshCreateProfile,
  sshDeleteProfile,
  sshListCachedSessions,
} from "../ssh-remote";
import { profileRuntimeManager } from "../hermes/runtime";
import type { ProfileRuntimeHandle } from "../hermes/types";
import {
  cachedSessionFromServerSession,
  deleteHermesSession,
  forkHermesSession,
  getHermesSessionMessages,
  listHermesSessions,
  readHermesSession,
  summaryFromServerSession,
  updateHermesSessionTitle,
} from "./hermes-sessions-api";

type SessionsDiagChannel =
  | "list-server-sessions"
  | "get-session-messages"
  | "list-cached-sessions"
  | "sync-session-cache"
  | "search-sessions"
  | "update-server-title"
  | "delete-server-session";

function isSessionsDiagEnabled(): boolean {
  return process.env.MERCURY_SESSIONS_DIAG === "1";
}

function getSessionsDiagFile(): string {
  return (
    process.env.MERCURY_SESSIONS_DIAG_FILE ||
    join(tmpdir(), "mercury-sessions-diag.ndjson")
  );
}

function resultCount(result: unknown): number | undefined {
  return Array.isArray(result) ? result.length : undefined;
}

function writeSessionsDiag(record: Record<string, unknown>): void {
  if (!isSessionsDiagEnabled()) return;
  try {
    const file = getSessionsDiagFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    // Diagnostics must never affect service behavior.
  }
}

function errorDiagFields(error: unknown): Record<string, unknown> {
  return {
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : undefined,
  };
}

function recordRuntimeResolutionFallback(
  channel: SessionsDiagChannel,
  meta: Record<string, unknown>,
  error: unknown,
): void {
  writeSessionsDiag({
    scope: "sessions-service",
    channel,
    ok: true,
    fallback: true,
    fallbackReason: "runtime-resolution-failed",
    ts: new Date().toISOString(),
    ...meta,
    ...errorDiagFields(error),
  });
}

function attachCachedProfiles<
  T extends { sessionId: string; profile?: string },
>(results: T[]): T[] {
  const cachedSessions = listCachedSessions(Number.MAX_SAFE_INTEGER);
  const profiles = new Map(
    cachedSessions.map((session) => [
      `${session.profile || "default"}\u0000${session.id}`,
      session.profile,
    ]),
  );
  const idOnlyProfiles = new Map<string, string | undefined>();
  for (const session of cachedSessions) {
    if (!idOnlyProfiles.has(session.id)) idOnlyProfiles.set(session.id, session.profile);
  }
  return results.map((result) => ({
    ...result,
    profile:
      result.profile ||
      profiles.get(`${result.profile || "default"}\u0000${result.sessionId}`) ||
      idOnlyProfiles.get(result.sessionId),
  }));
}

async function withSessionsDiag<T>(
  channel: SessionsDiagChannel,
  meta: Record<string, unknown>,
  run: () => T | Promise<T>,
  start = performance.now(),
): Promise<T> {
  if (!isSessionsDiagEnabled()) return run();
  try {
    const result = await run();
    writeSessionsDiag({
      scope: "sessions-service",
      channel,
      totalMs: performance.now() - start,
      resultCount: resultCount(result),
      ok: true,
      ts: new Date().toISOString(),
      ...meta,
    });
    return result;
  } catch (error) {
    writeSessionsDiag({
      scope: "sessions-service",
      channel,
      totalMs: performance.now() - start,
      ok: false,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : undefined,
      ts: new Date().toISOString(),
      ...meta,
    });
    throw error;
  }
}

export function listSessionsForProfile(limit?: number, offset?: number, profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshListSessions(conn.ssh, limit, offset, profile);
  return listSessions(limit, offset, profile);
}

async function resolveSessionsRuntime(profile?: string) {
  return profileRuntimeManager.resolveRuntime({
    profile: profileRuntimeManager.normalizeProfile(profile),
    purpose: "sessions",
    preferTransport: "api",
  });
}

function shouldUseLegacySessionsFallback(
  conn: ReturnType<typeof getConnectionConfig>,
): boolean {
  return conn.mode === "local" || conn.mode === "ssh";
}

export async function listServerSessionsForProfile(
  limit = 30,
  offset = 0,
  profile?: string,
) {
  const start = performance.now();
  const conn = getConnectionConfig();
  const meta: Record<string, unknown> = {
    mode: conn.mode,
    limit,
    offset,
    profile,
    hasProfile: Boolean(profile?.trim()),
  };
  return withSessionsDiag(
    "list-server-sessions",
    meta,
    async () => {
      let runtime: ProfileRuntimeHandle;
      try {
        runtime = await resolveSessionsRuntime(profile);
      } catch (error) {
        if (!shouldUseLegacySessionsFallback(conn)) throw error;
        recordRuntimeResolutionFallback("list-server-sessions", meta, error);
        return listSessionsForProfile(limit, offset, profile);
      }

      const sessions = await listHermesSessions(runtime);
      for (const session of sessions) {
        projectCachedSession(cachedSessionFromServerSession(session));
      }
      return sessions
        .map(summaryFromServerSession)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(offset, offset + limit);
    },
    start,
  );
}

export async function getSessionMessagesForProfile(
  sessionId: string,
  profile?: string,
) {
  const conn = getConnectionConfig();
  const mode = conn.mode;
  const meta = { mode, sessionId, profile, hasProfile: Boolean(profile?.trim()) };
  return withSessionsDiag(
    "get-session-messages",
    meta,
    async () => {
      let runtime: ProfileRuntimeHandle;
      try {
        runtime = await resolveSessionsRuntime(profile);
      } catch (error) {
        if (!shouldUseLegacySessionsFallback(conn)) throw error;
        recordRuntimeResolutionFallback("get-session-messages", meta, error);
        if (conn.mode === "ssh" && conn.ssh)
          return sshGetSessionMessages(conn.ssh, sessionId, profile);
        return getSessionMessages(sessionId, profile);
      }

      const session = await readHermesSession(runtime, sessionId);
      projectCachedSession(cachedSessionFromServerSession(session));
      return await getHermesSessionMessages(runtime, sessionId);
    },
  );
}

export function listProfilesForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshListProfiles(conn.ssh);
  return listProfiles();
}

export function createProfileForConnection(name: string, clone: boolean) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshCreateProfile(conn.ssh, name, clone);
  return createProfile(name, clone);
}

export function deleteProfileForConnection(name: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshDeleteProfile(conn.ssh, name);
  return deleteProfile(name);
}

export function setActiveProfileForConnection(name: string): boolean {
  if (getConnectionConfig().mode !== "ssh") setActiveProfile(name);
  return true;
}

export async function listCachedSessionsForProfile(
  limit?: number,
  offset?: number,
  profile?: string,
) {
  const configStart = performance.now();
  const conn = getConnectionConfig();
  const configMs = performance.now() - configStart;
  const mode = conn.mode;
  const diagMeta: Record<string, unknown> = {
    mode,
    configMs,
    limit,
    offset,
    profile,
    hasProfile: Boolean(profile?.trim()),
  };
  return withSessionsDiag(
    "list-cached-sessions",
    diagMeta,
    async () => {
      const implStart = performance.now();
      try {
        if (conn.mode === "ssh" && conn.ssh)
          return await sshListCachedSessions(conn.ssh, limit, offset, profile);
        return listCachedSessions(limit, offset, profile);
      } finally {
        diagMeta.implMs = performance.now() - implStart;
      }
    },
    configStart,
  );
}

export async function syncSessionCacheForProfile(profile?: string) {
  const configStart = performance.now();
  const conn = getConnectionConfig();
  const configMs = performance.now() - configStart;
  const mode = conn.mode;
  const diagMeta: Record<string, unknown> = {
    mode,
    configMs,
    profile,
    hasProfile: Boolean(profile?.trim()),
  };
  return withSessionsDiag(
    "sync-session-cache",
    diagMeta,
    async () => {
      const implStart = performance.now();
      try {
        if (conn.mode === "ssh" && conn.ssh)
          return await sshListCachedSessions(conn.ssh, 50, 0, profile);
        return syncSessionCache(profile);
      } finally {
        diagMeta.implMs = performance.now() - implStart;
      }
    },
    configStart,
  );
}

export function updateSessionTitleForProfile(
  sessionId: string,
  title: string,
  profile?: string,
): boolean {
  return updateSessionTitle(sessionId, title, profile);
}

export async function updateServerSessionTitleForProfile(
  sessionId: string,
  title: string,
  profile?: string,
): Promise<boolean> {
  const start = performance.now();
  const conn = getConnectionConfig();
  const meta: Record<string, unknown> = {
    mode: conn.mode,
    sessionId,
    titleLength: title.length,
    profile,
    hasProfile: Boolean(profile?.trim()),
  };
  return withSessionsDiag(
    "update-server-title",
    meta,
    async () => {
      let runtime: ProfileRuntimeHandle;
      try {
        runtime = await resolveSessionsRuntime(profile);
      } catch (error) {
        if (!shouldUseLegacySessionsFallback(conn)) throw error;
        recordRuntimeResolutionFallback("update-server-title", meta, error);
        return updateSessionTitle(sessionId, title, profile);
      }

      try {
        const session = await updateHermesSessionTitle(runtime, sessionId, title);
        projectCachedSession(cachedSessionFromServerSession(session));
        return true;
      } catch {
        return false;
      }
    },
    start,
  );
}

export async function deleteServerSessionForProfile(
  sessionId: string,
  profile?: string,
): Promise<boolean> {
  const start = performance.now();
  const conn = getConnectionConfig();
  const meta: Record<string, unknown> = {
    mode: conn.mode,
    sessionId,
    profile,
    hasProfile: Boolean(profile?.trim()),
  };
  return withSessionsDiag(
    "delete-server-session",
    meta,
    async () => {
      let runtime: ProfileRuntimeHandle;
      try {
        runtime = await resolveSessionsRuntime(profile);
      } catch (error) {
        if (!shouldUseLegacySessionsFallback(conn)) throw error;
        recordRuntimeResolutionFallback("delete-server-session", meta, error);
        return removeCachedSession(sessionId, profile);
      }

      try {
        await deleteHermesSession(runtime, sessionId);
        removeCachedSession(sessionId, profile);
        return true;
      } catch {
        return false;
      }
    },
    start,
  );
}

export async function forkServerSessionForProfile(
  sessionId: string,
  profile?: string,
) {
  const runtime = await resolveSessionsRuntime(profile);
  const session = await forkHermesSession(runtime, sessionId);
  projectCachedSession(cachedSessionFromServerSession(session));
  return summaryFromServerSession(session);
}

export async function searchSessionsForProfile(
  query: string,
  limit?: number,
  profile?: string,
) {
  const safeQuery = typeof query === "string" ? query : "";
  const configStart = performance.now();
  const conn = getConnectionConfig();
  const configMs = performance.now() - configStart;
  const mode = conn.mode;
  const diagMeta: Record<string, unknown> = {
    mode,
    configMs,
    queryLength: safeQuery.length,
    limit,
    profile,
    hasProfile: Boolean(profile?.trim()),
  };
  return withSessionsDiag(
    "search-sessions",
    diagMeta,
    async () => {
      const implStart = performance.now();
      try {
        if (conn.mode === "ssh" && conn.ssh)
          return await sshSearchSessions(conn.ssh, safeQuery, limit, profile);
        return attachCachedProfiles(searchSessions(safeQuery, limit, profile));
      } finally {
        diagMeta.implMs = performance.now() - implStart;
      }
    },
    configStart,
  );
}

import { ipcMain } from "electron";
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

type SessionsDiagChannel =
  | "get-session-messages"
  | "list-cached-sessions"
  | "sync-session-cache"
  | "search-sessions";

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
    // Diagnostics must never affect IPC behavior.
  }
}

function attachCachedProfiles<
  T extends { sessionId: string; profile?: string },
>(results: T[]): T[] {
  const profiles = new Map(
    listCachedSessions(Number.MAX_SAFE_INTEGER).map((session) => [
      `${session.profile || "default"}\u0000${session.id}`,
      session.profile,
    ]),
  );
  const idOnlyProfiles = new Map<string, string | undefined>();
  for (const session of listCachedSessions(Number.MAX_SAFE_INTEGER)) {
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
      scope: "sessions-ipc",
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
      scope: "sessions-ipc",
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

export function registerSessionsIpc(): void {
  // Sessions
  ipcMain.handle(
    "list-sessions",
    (_event, limit?: number, offset?: number, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshListSessions(conn.ssh, limit, offset, profile);
      return listSessions(limit, offset, profile);
    },
  );

  ipcMain.handle(
    "get-session-messages",
    async (_event, sessionId: string, profile?: string) => {
      const conn = getConnectionConfig();
      const mode = conn.mode;
      return withSessionsDiag(
        "get-session-messages",
        { mode, sessionId, profile, hasProfile: Boolean(profile?.trim()) },
        async () => {
          if (conn.mode === "ssh" && conn.ssh)
            return sshGetSessionMessages(conn.ssh, sessionId, profile);
          return getSessionMessages(sessionId, profile);
        },
      );
    },
  );

  // Profiles
  ipcMain.handle("list-profiles", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListProfiles(conn.ssh);
    return listProfiles();
  });
  ipcMain.handle("create-profile", (_event, name: string, clone: boolean) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshCreateProfile(conn.ssh, name, clone);
    return createProfile(name, clone);
  });
  ipcMain.handle("delete-profile", (_event, name: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshDeleteProfile(conn.ssh, name);
    return deleteProfile(name);
  });
  ipcMain.handle("set-active-profile", (_event, name: string) => {
    if (getConnectionConfig().mode !== "ssh") setActiveProfile(name);
    return true;
  });

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    async (_event, limit?: number, offset?: number, profile?: string) => {
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
    },
  );
  ipcMain.handle("sync-session-cache", async (_event, profile?: string) => {
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
  });
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string, profile?: string) =>
      updateSessionTitle(sessionId, title, profile),
  );

  // Session search
  ipcMain.handle(
    "search-sessions",
    async (_event, query: string, limit?: number, profile?: string) => {
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
    },
  );
}

import Database from "better-sqlite3";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { profileHome } from "./utils";

export interface SessionProfileScope {
  profile: string;
  home: string;
  dbPath: string;
  isDefault: boolean;
}
/**
 * Open a profile state.db with a schema guard.
 *
 * better-sqlite3 12.8.0 bundles SQLite 3.51.3, which crashes on unbounded
 * selectExpander() recursion when prepare() expands a malicious VIEW
 * (CVE-2026-119371). An imported Hermes archive can land an attacker-controlled
 * state.db under any profile home, so every open of these DBs must go through
 * this guard: any database containing a view is refused until a better-sqlite3
 * release bundling a fixed SQLite ships. Revert this guard when the dependency
 * update lands.
 */
export function openSessionDb(
  dbPath: string,
  options: Database.Options = {},
): Database.Database | null {
  if (!existsSync(dbPath)) return null;

  let db: Database.Database;
  try {
    db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
      ...options,
    });
  } catch {
    return null;
  }

  try {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'view'",
      )
      .get() as { count: number } | undefined;
    if ((row?.count ?? 0) === 0) return db;
    console.warn(
      `[session-db] refusing to open ${dbPath}: database contains views (CVE-2026-119371 mitigation)`,
    );
  } catch {
    // Fall through and refuse the handle on any probe failure.
  }

  try {
    db.close();
  } catch {
    // best-effort close
  }
  return null;
}

export function normalizeSessionProfile(profile?: string | null): string {
  const value = profile?.trim();
  return !value || value === "default" ? "default" : value;
}

export function getSessionDbPath(profile?: string | null): string {
  return join(profileHome(normalizeSessionProfile(profile)), "state.db");
}

export function getSessionProfileScope(profile?: string | null): SessionProfileScope {
  const normalized = normalizeSessionProfile(profile);
  const home = profileHome(normalized);
  return {
    profile: normalized,
    home,
    dbPath: join(home, "state.db"),
    isDefault: normalized === "default",
  };
}

export function discoverSessionProfileScopes(profile?: string | null): SessionProfileScope[] {
  if (profile !== undefined && profile !== null && profile.trim()) {
    return [getSessionProfileScope(profile)];
  }

  const scopes: SessionProfileScope[] = [getSessionProfileScope("default")];
  const profilesDir = join(HERMES_HOME, "profiles");
  if (!existsSync(profilesDir)) return scopes;

  try {
    for (const name of readdirSync(profilesDir).sort()) {
      if (!name || name.startsWith(".")) continue;
      const home = join(profilesDir, name);
      try {
        if (!statSync(home).isDirectory()) continue;
      } catch {
        continue;
      }
      scopes.push({
        profile: name,
        home,
        dbPath: join(home, "state.db"),
        isDefault: false,
      });
    }
  } catch {
    // Best-effort profile discovery; default scope is still usable.
  }
  return scopes;
}

export function sessionCacheKey(
  sessionId: string,
  profile?: string | null,
): string {
  return `${normalizeSessionProfile(profile)}\u0000${sessionId}`;
}

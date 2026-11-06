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
 * (CVE-2026-119371), and contains a use-after-free in the R-Tree
 * nodeWrite() path reachable through a poisoned rtree shadow table such as
 * sessions_node (CVE-2026-119378). The same VIEW refusal also blocks the
 * crafted-view route to CVE-2026-119591, where a VIEW resolving to a large
 * multi-row VALUES clause crashes sqlite3ExprDeleteNN() /
 * countOfViewOptimization() via recursive free of the nested expression
 * tree on COUNT(*). An imported Hermes archive can land an
 * attacker-controlled state.db under any profile home, so every open of
 * these DBs must go through this guard: any database containing a view, an
 * rtree/geopoly virtual table, or an rtree-style *_node/*_rowid/*_parent
 * shadow table is refused until a better-sqlite3 release bundling a fixed
 * SQLite ships. Revert this guard when the dependency update lands.
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
    const viewRow = db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'view'",
      )
      .get() as { count: number } | undefined;
    // CVE-2026-119378: rtree/geopoly virtual tables (and their _node,
    // _rowid, _parent shadow tables) expose the R-Tree nodeWrite()
    // use-after-free in SQLite <3.54.0. FTS5 shadows are type='table' too
    // but carry no 'CREATE VIRTUAL TABLE ... rtree/geopoly' sql and are not
    // named *_node/*_rowid/*_parent, so legitimate messages_fts dbs pass.
    const rtreeRow = db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND " +
          "((sql LIKE 'CREATE VIRTUAL TABLE%' AND (sql LIKE '%rtree%' OR sql LIKE '%geopoly%')) " +
          "OR name LIKE '%_node' OR name LIKE '%_rowid' OR name LIKE '%_parent')",
      )
      .get() as { count: number } | undefined;
    if ((viewRow?.count ?? 0) === 0 && (rtreeRow?.count ?? 0) === 0)
      return db;
    console.warn(
      `[session-db] refusing to open ${dbPath}: database contains views or rtree/geopoly tables (CVE-2026-119371/CVE-2026-119376/CVE-2026-119378/CVE-2026-119591 mitigation)`,
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

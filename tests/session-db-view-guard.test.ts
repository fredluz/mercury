import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, existsSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(
      os.tmpdir(),
      `hermes-session-db-guard-test-${Date.now()}`,
    ),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  getEnhancedPath: () => process.env.PATH || "",
}));

import Database from "better-sqlite3";
import { listSessions } from "../src/main/sessions";
import { getSessionProfileScope, openSessionDb } from "../src/main/session-db";

function dbPathForProfile(profile?: string): string {
  return profile && profile !== "default"
    ? join(TEST_HOME, "profiles", profile, "state.db")
    : join(TEST_HOME, "state.db");
}

function seedDb(profile: string | undefined, withView: boolean): string {
  const dbPath = dbPathForProfile(profile);
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      message_count INTEGER,
      model TEXT,
      title TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      content TEXT,
      timestamp INTEGER
    );
    INSERT INTO sessions (id, source, started_at, ended_at, message_count, model, title)
      VALUES ('s-1', 'cli', 1700000000, NULL, 1, 'gpt-5.5', 'fixture');
  `);
  if (withView) {
    // Any view entry in sqlite_master triggers the CVE-2026-119371 guard; the
    // CTE chain that actually exhausts the stack is not needed for the test.
    db.exec(`CREATE VIEW sessions_view AS SELECT * FROM sessions`);
  }
  db.close();
  return dbPath;
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME))
    rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("state.db view guard (CVE-2026-119371 mitigation)", () => {
  it("refuses to open a state.db containing a view", () => {
    const dbPath = seedDb(undefined, true);
    expect(openSessionDb(dbPath)).toBeNull();
  });

  it("degrades listSessions to empty for a view-bearing profile without throwing", () => {
    seedDb("attacker-imported", true);
    expect(listSessions(10, 0, "attacker-imported")).toEqual([]);
    expect(listSessions(10)).toEqual([]);
  });

  it("still opens a normal fixture database with no views", () => {
    const dbPath = seedDb(undefined, false);
    const db = openSessionDb(dbPath);
    expect(db).not.toBeNull();
    const row = db?.prepare("SELECT COUNT(*) AS count FROM sessions").get() as
      | { count: number }
      | undefined;
    expect(row?.count).toBe(1);
    db?.close();
  });

  it("returns null when the database file does not exist", () => {
    const scope = getSessionProfileScope("missing-profile");
    expect(openSessionDb(scope.dbPath)).toBeNull();
  });

  it("lists sessions normally when no profile DB contains a view", () => {
    seedDb(undefined, false);
    seedDb("research-agent", false);
    expect(
      listSessions(10)
        .map((session) => session.profile)
        .sort(),
    ).toEqual(["default", "research-agent"]);
  });

  it("refuses a state.db whose view carries a long COLLATE operator chain (CVE-2026-119376)", () => {
    const dbPath = dbPathForProfile(undefined);
    mkdirSync(join(dbPath, ".."), { recursive: true });
    const db = new Database(dbPath);
    // CVE-2026-119376: SQLite <3.54.0 does not count chained postfix COLLATE
    // operators against SQLITE_LIMIT_EXPR_DEPTH, so a deep chain in a view's
    // stored SELECT drives unbounded sqlite3WalkExprNN() recursion -> stack
    // exhaustion on prepare(). better-sqlite3 12.8.0 bundles 3.51.3. The
    // chain need not reach the ~175k crash threshold: the contract under
    // test is refusal of any view before attacker SQL is ever prepared.
    const collateChain = "COLLATE NOCASE ".repeat(2000);
    db.exec(`CREATE VIEW sessions AS SELECT 'x' ${collateChain}`);
    db.close();
    expect(openSessionDb(dbPath)).toBeNull();
    // The downstream read path degrades to empty rather than preparing the
    // view's chained SELECT and crashing.
    expect(listSessions(10)).toEqual([]);
  });


  it("refuses a state.db whose sessions table is an rtree virtual table (CVE-2026-119378)", () => {
    const dbPath = dbPathForProfile(undefined);
    mkdirSync(join(dbPath, ".."), { recursive: true });
    const db = new Database(dbPath);
    // CVE-2026-119378: SQLite <3.54.0 (better-sqlite3 12.8.0 bundles 3.51.3)
    // has a use-after-free in R-Tree nodeWrite(), reachable via a poisoned
    // sessions_node shadow table when the app runs UPDATE sessions. rtree is
    // compiled into the bundled SQLite, which is why this vtab is the
    // delivery vehicle. Any rtree/geopoly module must be refused.
    db.exec(`CREATE VIRTUAL TABLE sessions USING rtree(id, minX, maxX)`);
    db.close();
    expect(openSessionDb(dbPath)).toBeNull();
    expect(listSessions(10)).toEqual([]);
  });

  it("refuses a state.db carrying an orphan rtree-style shadow table", () => {
    const dbPath = dbPathForProfile(undefined);
    mkdirSync(join(dbPath, ".."), { recursive: true });
    const db = new Database(dbPath);
    // A crafted archive may drop the vtab row and plant only the poisoned
    // shadow table (e.g. WITHOUT ROWID sessions_node); the *_node name is
    // refused independently of the CREATE VIRTUAL TABLE probe.
    db.exec(`CREATE TABLE sessions_node (nodeno INTEGER PRIMARY KEY, data BLOB)`);
    db.close();
    expect(openSessionDb(dbPath)).toBeNull();
    expect(listSessions(10)).toEqual([]);
  });

  it("still opens a state.db with a legitimate messages_fts FTS5 table", () => {
    const dbPath = dbPathForProfile(undefined);
    mkdirSync(join(dbPath, ".."), { recursive: true });
    const db = new Database(dbPath);
    // Real Hermes state.db files ship CREATE VIRTUAL TABLE messages_fts
    // USING fts5(content) plus its _data/_idx/_content/_docsize/_config
    // shadow tables; none of these match the rtree/geopoly or *_node /
    // *_rowid / *_parent probes, so the FTS5 db must remain accepted.
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        message_count INTEGER,
        model TEXT,
        title TEXT
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        role TEXT,
        content TEXT,
        timestamp INTEGER
      );
      INSERT INTO sessions (id, source, started_at, ended_at, message_count, model, title)
        VALUES ('s-1', 'cli', 1700000000, NULL, 1, 'gpt-5.5', 'fixture');
      CREATE VIRTUAL TABLE messages_fts USING fts5(content);
      INSERT INTO messages_fts (rowid, content) VALUES (1, 'hello fts');
    `);
    db.close();
    const handle = openSessionDb(dbPath);
    expect(handle).not.toBeNull();
    handle?.close();
    expect(listSessions(10).map((session) => session.id)).toEqual(["s-1"]);
  });
});

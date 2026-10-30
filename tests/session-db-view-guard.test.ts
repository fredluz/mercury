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
});

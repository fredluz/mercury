import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, existsSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-sessions-profile-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  getEnhancedPath: () => process.env.PATH || "",
}));

import Database from "better-sqlite3";
import { getSessionMessages, listSessions, searchSessions } from "../src/main/sessions";

function dbPathForProfile(profile?: string): string {
  return profile && profile !== "default"
    ? join(TEST_HOME, "profiles", profile, "state.db")
    : join(TEST_HOME, "state.db");
}

function seedDb(
  sessions: Array<{
    id: string;
    started_at: number;
    title?: string | null;
    content: string;
  }>,
  profile?: string,
): void {
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
    CREATE VIRTUAL TABLE messages_fts USING fts5(content);
  `);
  const insSession = db.prepare(
    `INSERT INTO sessions (id, source, started_at, ended_at, message_count, model, title)
     VALUES (?, 'cli', ?, NULL, 2, 'gpt-5.5', ?)`,
  );
  const insMessage = db.prepare(
    `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, 'user', ?, ?)`,
  );
  const insFts = db.prepare(`INSERT INTO messages_fts (rowid, content) VALUES (?, ?)`);
  for (const session of sessions) {
    insSession.run(session.id, session.started_at, session.title ?? null);
    const info = insMessage.run(session.id, session.content, session.started_at);
    insFts.run(info.lastInsertRowid, session.content);
  }
  db.close();
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME)) rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("profile-aware local sessions", () => {
  it("aggregates default and named profile session lists with profile metadata", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([{ id: "default-a", started_at: now, content: "default work" }]);
    seedDb(
      [{ id: "named-a", started_at: now + 10, content: "named work" }],
      "research-agent",
    );

    expect(listSessions(10).map((session) => [session.id, session.profile])).toEqual([
      ["named-a", "research-agent"],
      ["default-a", "default"],
    ]);
    expect(listSessions(10, 0, "research-agent")).toEqual([
      expect.objectContaining({ id: "named-a", profile: "research-agent" }),
    ]);
  });

  it("searches the requested profile DB and annotates results", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([{ id: "default-a", started_at: now, content: "needle default" }]);
    seedDb(
      [{ id: "named-a", started_at: now + 10, content: "needle named" }],
      "research-agent",
    );

    expect(searchSessions("needle", 10, "research-agent")).toEqual([
      expect.objectContaining({ sessionId: "named-a", profile: "research-agent" }),
    ]);
    expect(searchSessions("needle", 10).map((result) => result.profile)).toEqual([
      "research-agent",
      "default",
    ]);
  });

  it("reads messages from the profile-specific DB when duplicate ids exist", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([{ id: "same-id", started_at: now, content: "default transcript" }]);
    seedDb(
      [{ id: "same-id", started_at: now + 10, content: "named transcript" }],
      "research-agent",
    );

    expect(getSessionMessages("same-id", "research-agent")[0].content).toBe(
      "named transcript",
    );
    expect(getSessionMessages("same-id")[0].content).toBe("default transcript");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";

// vi.hoisted runs before module imports, so we can't reference imported
// helpers here — use the bare Node modules via require.
const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(
      os.tmpdir(),
      `hermes-session-cache-test-${Date.now()}`,
    ),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  getEnhancedPath: () => process.env.PATH || "",
}));

// Stub the i18n + locale modules so the cache code doesn't need the
// renderer-side translation files at test time.
vi.mock("../src/shared/i18n", () => ({
  t: (key: string) => key,
}));
vi.mock("../src/main/locale", () => ({
  getAppLocale: () => "en",
}));

import Database from "better-sqlite3";
import {
  syncSessionCache,
  updateSessionProfile,
  updateSessionTitle,
} from "../src/main/session-cache";

const CACHE_FILE = join(TEST_HOME, "desktop", "sessions.json");
const DB_PATH = join(TEST_HOME, "state.db");

function seedDb(
  sessions: Array<{
    id: string;
    started_at: number;
    source?: string;
    message_count?: number;
    model?: string;
    title?: string | null;
    firstUserMessage?: string;
  }>,
): void {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      message_count INTEGER,
      model TEXT,
      title TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      content TEXT,
      timestamp INTEGER
    );
  `);
  const insSession = db.prepare(
    `INSERT OR REPLACE INTO sessions (id, source, started_at, ended_at, message_count, model, title)
     VALUES (?, ?, ?, NULL, ?, ?, ?)`,
  );
  const insMessage = db.prepare(
    `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
  );
  for (const s of sessions) {
    insSession.run(
      s.id,
      s.source ?? "cli",
      s.started_at,
      s.message_count ?? 0,
      s.model ?? "gpt-4o",
      s.title ?? null,
    );
    if (s.firstUserMessage) {
      insMessage.run(s.id, "user", s.firstUserMessage, s.started_at);
    }
  }
  db.close();
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("syncSessionCache", () => {
  it("returns an empty list when no DB exists yet", () => {
    expect(syncSessionCache()).toEqual([]);
  });

  it("on first sync, ingests all sessions and generates titles", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "s1",
        started_at: now,
        message_count: 2,
        firstUserMessage: "How do I write a Python decorator?",
      },
      {
        id: "s2",
        started_at: now + 100,
        message_count: 4,
        firstUserMessage: "Explain RAII in Rust",
      },
    ]);

    const result = syncSessionCache();
    expect(result).toHaveLength(2);
    // Sorted by startedAt DESC
    expect(result[0].id).toBe("s2");
    expect(result[1].id).toBe("s1");
    expect(result[0].title).toContain("RAII");
    expect(result[1].title).toContain("Python decorator");
    expect(existsSync(CACHE_FILE)).toBe(true);
  });

  it("refreshes cached metadata from DB titles on existing sessions", () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 2,
        firstUserMessage: "old heuristic title",
      },
    ]);
    syncSessionCache();

    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 3,
        title: "Generated DB Title",
        firstUserMessage: "old heuristic title",
      },
    ]);

    const result = syncSessionCache();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Generated DB Title");
    expect(result[0].messageCount).toBe(3);
  });

  it("updates messageCount on existing sessions without duplicating them (issue #16 regression)", () => {
    // Use a future started_at so the 5-minute incremental sync window
    // (lastSync - 300) still catches the row on the second sync.
    const future = Math.floor(Date.now() / 1000) + 600;
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 2,
        firstUserMessage: "hi",
      },
    ]);
    syncSessionCache();

    // Bump message_count on the same session.
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 9,
        firstUserMessage: "hi",
      },
    ]);
    const result = syncSessionCache();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("s1");
    expect(result[0].messageCount).toBe(9);
  });

  it("appends new sessions on subsequent syncs without losing old ones", () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 1,
        firstUserMessage: "a",
      },
    ]);
    syncSessionCache();

    seedDb([
      {
        id: "s1",
        started_at: future,
        message_count: 1,
        firstUserMessage: "a",
      },
      {
        id: "s2",
        started_at: future + 200,
        message_count: 5,
        firstUserMessage: "b",
      },
    ]);
    const result = syncSessionCache();

    expect(result.map((r) => r.id)).toEqual(["s2", "s1"]);
  });

  it("updates SQLite title and inserts cache entry when cache is missing", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "s-title",
        started_at: now,
        message_count: 2,
        model: "gpt-4.1",
        firstUserMessage: "please name this chat",
      },
    ]);

    expect(updateSessionTitle("s-title", "Model Generated Title")).toBe(true);

    const db = new Database(DB_PATH, { readonly: true });
    const row = db
      .prepare(`SELECT title FROM sessions WHERE id = ?`)
      .get("s-title") as { title: string | null };
    db.close();
    expect(row.title).toBe("Model Generated Title");

    const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as {
      sessions: Array<{ id: string; title: string; model: string }>;
    };
    expect(cache.sessions).toEqual([
      expect.objectContaining({
        id: "s-title",
        title: "Model Generated Title",
        model: "gpt-4.1",
      }),
    ]);
  });

  it("updates an existing cache entry even if the DB row is unavailable", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "cached-only",
        started_at: now,
        message_count: 1,
        firstUserMessage: "cached only title",
      },
    ]);
    syncSessionCache();
    rmSync(DB_PATH, { force: true });

    expect(updateSessionTitle("cached-only", "Cache Only Title")).toBe(true);
    const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as {
      sessions: Array<{ id: string; title: string }>;
    };
    expect(cache.sessions[0]).toEqual(
      expect.objectContaining({ id: "cached-only", title: "Cache Only Title" }),
    );
  });

  it("records the Mercury profile used for a session in the desktop cache", () => {
    const now = Math.floor(Date.now() / 1000);
    seedDb([
      {
        id: "profiled-session",
        started_at: now,
        message_count: 2,
        model: "gpt-5.5",
        firstUserMessage: "which profile handled this",
      },
    ]);

    expect(updateSessionProfile("profiled-session", "youtube-optimizer")).toBe(true);

    const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as {
      sessions: Array<{ id: string; profile?: string; model: string }>;
    };
    expect(cache.sessions[0]).toEqual(
      expect.objectContaining({
        id: "profiled-session",
        profile: "youtube-optimizer",
        model: "gpt-5.5",
      }),
    );
  });

  it("preserves recorded profile metadata during later cache syncs", () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    seedDb([
      {
        id: "profile-preserved",
        started_at: future,
        message_count: 1,
        firstUserMessage: "remember the profile",
      },
    ]);
    syncSessionCache();
    updateSessionProfile("profile-preserved", "research-agent");

    seedDb([
      {
        id: "profile-preserved",
        started_at: future,
        message_count: 3,
        title: "Updated Title",
        firstUserMessage: "remember the profile",
      },
    ]);

    const result = syncSessionCache();
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: "profile-preserved",
        profile: "research-agent",
        messageCount: 3,
        title: "Updated Title",
      }),
    );
  });

  it("handles a large existing cache without quadratic blowup (issue #16)", () => {
    // 1500 existing sessions in cache, then sync sees same 1500 but with
    // bumped message counts. The pre-fix O(N²) implementation took >2s here
    // on commodity hardware; the O(N) implementation should finish in well
    // under 500ms.
    const N = 1500;
    const future = Math.floor(Date.now() / 1000) + 600;
    const sessions = Array.from({ length: N }, (_, i) => ({
      id: `s${i}`,
      started_at: future + i,
      message_count: 1,
      firstUserMessage: `message ${i}`,
    }));
    seedDb(sessions);
    syncSessionCache(); // first sync — populates cache

    // Bump every message_count and re-sync.
    seedDb(sessions.map((s) => ({ ...s, message_count: s.message_count + 1 })));
    const start = Date.now();
    const result = syncSessionCache();
    const elapsed = Date.now() - start;

    expect(result).toHaveLength(N);
    expect(result.every((r) => r.messageCount === 2)).toBe(true);
    expect(elapsed).toBeLessThan(500);
  });
});

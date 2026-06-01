import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";

// `vi.hoisted` runs before module imports, so we can't reference imported
// `join` / `tmpdir` here — use the bare Node modules via require, which is
// the documented escape hatch for hoisted setup.
const { TEST_HOME, execFileSyncMock } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-profiles-test-${Date.now()}`),
    execFileSyncMock: vi.fn(),
  };
});

// Mock installer module so HERMES_HOME points at our temp dir before
// profiles.ts evaluates the `PROFILES_DIR` constant from it.
vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("child_process", () => ({
  default: { execFileSync: execFileSyncMock },
  execFileSync: execFileSyncMock,
}));

// Import AFTER the mock so PROFILES_DIR is resolved against TEST_HOME.
import { createProfile, listProfiles } from "../src/main/profiles";

const PROFILES_DIR = join(TEST_HOME, "profiles");

beforeEach(() => {
  execFileSyncMock.mockReset();
  execFileSyncMock.mockImplementation((_bin: string, args: string[]) => {
    const createIndex = args.findIndex((arg) => arg === "create");
    if (args[0] === "/dev/null" && args[1] === "profile" && createIndex === 2) {
      mkdirSync(join(PROFILES_DIR, args[3]), { recursive: true });
    }
    return Buffer.from("");
  });
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(PROFILES_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("createProfile", () => {
  it("always creates local profiles with upstream skills disabled", () => {
    const result = createProfile("fresh", false);

    expect(result).toEqual({ success: true });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "create", "fresh", "--no-skills"],
      expect.objectContaining({ timeout: 15000 }),
    );
    expect(execFileSyncMock.mock.calls[0][1]).not.toContain("--clone");
  });

  it("copies only default config and API keys when requested", () => {
    writeFileSync(
      join(TEST_HOME, "config.yaml"),
      "model:\n  default: gpt-4o\n",
    );
    writeFileSync(join(TEST_HOME, ".env"), "OPENAI_API_KEY=sk-test\n");
    mkdirSync(join(TEST_HOME, "skills", "system", "demo"), { recursive: true });
    writeFileSync(
      join(TEST_HOME, "skills", "system", "demo", "SKILL.md"),
      "demo",
    );

    const result = createProfile("copy", true);

    expect(result).toEqual({ success: true });
    expect(
      readFileSync(join(PROFILES_DIR, "copy", "config.yaml"), "utf8"),
    ).toContain("gpt-4o");
    expect(readFileSync(join(PROFILES_DIR, "copy", ".env"), "utf8")).toContain(
      "OPENAI_API_KEY",
    );
    expect(existsSync(join(PROFILES_DIR, "copy", "skills"))).toBe(false);
  });

  it("rejects unsafe profile names before invoking Hermes", () => {
    const result = createProfile("Bad Name", false);

    expect(result.success).toBe(false);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});

describe("listProfiles", () => {
  it("includes a profile directory that has neither config.yaml nor .env (issue #19)", async () => {
    const empty = join(PROFILES_DIR, "fresh");
    mkdirSync(empty, { recursive: true });

    const profiles = await listProfiles();
    const fresh = profiles.find((p) => p.name === "fresh");
    expect(fresh).toBeDefined();
    expect(fresh?.isDefault).toBe(false);
    expect(fresh?.hasEnv).toBe(false);
  });

  it("includes a profile that has only .env", async () => {
    const dir = join(PROFILES_DIR, "env-only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".env"), "OPENAI_API_KEY=x\n");

    const profiles = await listProfiles();
    const found = profiles.find((p) => p.name === "env-only");
    expect(found).toBeDefined();
    expect(found?.hasEnv).toBe(true);
  });

  it("includes a profile that has only config.yaml and parses model/provider", async () => {
    const dir = join(PROFILES_DIR, "config-only");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.yaml"),
      "models:\n  default: gpt-4o\n  provider: openai\n",
    );

    const profiles = await listProfiles();
    const found = profiles.find((p) => p.name === "config-only");
    expect(found).toBeDefined();
    expect(found?.model).toBe("gpt-4o");
    expect(found?.provider).toBe("openai");
  });

  it("parses nested Hermes model config blocks", async () => {
    const dir = join(PROFILES_DIR, "nested-config");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.yaml"),
      'model:\n  default: "gpt-5.5"\n  provider: "openai-codex"\n  base_url: "https://chatgpt.com/backend-api/codex"\n',
    );

    const profiles = await listProfiles();
    const found = profiles.find((p) => p.name === "nested-config");
    expect(found?.model).toBe("gpt-5.5");
    expect(found?.provider).toBe("openai-codex");
  });

  it("recognizes JSON gateway pid files", async () => {
    const dir = join(PROFILES_DIR, "json-pid");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "gateway.pid"),
      JSON.stringify({ pid: 12345 }),
      "utf-8",
    );
    const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      expect(pid).toBe(12345);
      expect(signal).toBe(0);
      return true;
    });

    const profiles = await listProfiles();
    expect(profiles.find((p) => p.name === "json-pid")?.gatewayRunning).toBe(
      true,
    );
    expect(kill).toHaveBeenCalled();
  });

  it("ignores dotfiles like .DS_Store under the profiles directory", async () => {
    writeFileSync(join(PROFILES_DIR, ".DS_Store"), "");
    mkdirSync(join(PROFILES_DIR, ".hidden"), { recursive: true });

    const profiles = await listProfiles();
    const dotProfiles = profiles.filter(
      (p) => p.name.startsWith(".") || p.name === ".DS_Store",
    );
    expect(dotProfiles).toHaveLength(0);
  });

  it("ignores files (non-directories) under the profiles directory", async () => {
    writeFileSync(join(PROFILES_DIR, "stray.txt"), "stray");

    const profiles = await listProfiles();
    expect(profiles.find((p) => p.name === "stray.txt")).toBeUndefined();
  });

  it("returns the default profile even when ~/.hermes/profiles/ is empty", async () => {
    const profiles = await listProfiles();
    expect(profiles.find((p) => p.isDefault)).toBeDefined();
  });

  it("marks the active profile correctly", async () => {
    const dir = join(PROFILES_DIR, "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(TEST_HOME, "active_profile"), "work\n");

    const profiles = await listProfiles();
    const work = profiles.find((p) => p.name === "work");
    const def = profiles.find((p) => p.isDefault);
    expect(work?.isActive).toBe(true);
    expect(def?.isActive).toBe(false);
  });
});

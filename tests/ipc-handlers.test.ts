import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const mainIpcDir = join(ROOT, "src/main/ipc");
const mainIpcIndexSrc = readFileSync(join(mainIpcDir, "index.ts"), "utf-8");

function readTsSources(paths: string[]): string {
  const files: string[] = [];

  function collect(path: string): void {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) collect(join(path, entry));
      return;
    }
    if (path.endsWith(".ts") && !path.endsWith(".d.ts")) files.push(path);
  }

  for (const path of paths) collect(path);
  return files
    .sort()
    .map((file) => readFileSync(file, "utf-8"))
    .join("\n");
}

const mainSrc = readTsSources([join(ROOT, "src/main/index.ts"), mainIpcDir]);
const preloadSrc = readTsSources([
  join(ROOT, "src/preload/index.ts"),
  join(ROOT, "src/preload/api"),
]);

/**
 * Extract all IPC channel names registered in main process modules.
 */
function extractIpcHandleChannels(src: string): string[] {
  const channels: string[] = [];
  const re = /ipcMain\.handle\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.push(m[1]);
  }
  return [...new Set(channels)];
}

/**
 * Extract all ipcRenderer.invoke channel names from preload.
 */
function extractPreloadInvokeChannels(src: string): string[] {
  const channels: string[] = [];
  const re = /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    channels.push(m[1]);
  }
  return [...new Set(channels)];
}

const mainChannels = extractIpcHandleChannels(mainSrc);
const preloadChannels = extractPreloadInvokeChannels(preloadSrc);

describe("IPC Handler ↔ Preload Consistency", () => {
  it("session handlers pass optional profile arguments", () => {
    expect(mainSrc).toContain("listSessions(limit, offset, profile)");
    expect(mainSrc).toContain("getSessionMessages(sessionId, profile)");
    expect(mainSrc).toContain("listCachedSessions(limit, offset, profile)");
    expect(mainSrc).toContain("syncSessionCache(profile)");
    expect(mainSrc).toContain("updateSessionTitle(sessionId, title, profile)");
    expect(mainSrc).toContain("searchSessions(safeQuery, limit, profile)");
  });

  it("main process registers IPC handlers", () => {
    expect(mainChannels.length).toBeGreaterThan(30);
  });

  it("preload invokes IPC channels", () => {
    expect(preloadChannels.length).toBeGreaterThan(30);
  });

  it("every preload invoke has a matching main handler", () => {
    const missing = preloadChannels.filter((ch) => !mainChannels.includes(ch));
    expect(missing).toEqual([]);
  });

  it("every main handler has a matching preload invoke", () => {
    const missing = mainChannels.filter((ch) => !preloadChannels.includes(ch));
    expect(missing).toEqual([]);
  });

  it("registerIpcHandlers wires every IPC module", () => {
    const modules = readdirSync(mainIpcDir)
      .filter((entry) => entry.endsWith(".ts"))
      .filter((entry) => !["index.ts", "types.ts"].includes(entry));

    for (const moduleName of modules) {
      const moduleSrc = readFileSync(join(mainIpcDir, moduleName), "utf-8");
      const registerName = moduleSrc.match(
        /export function (register\w+Ipc)\(/,
      )?.[1];
      expect(
        registerName,
        `${moduleName} exports a register function`,
      ).toBeTruthy();
      expect(mainIpcIndexSrc).toContain(registerName!);
      expect(mainIpcIndexSrc).toMatch(new RegExp(`${registerName}\\(`));
    }
  });
});

// ─── New feature handlers registered ────────────────────

describe("New IPC handlers from v0.8/v0.9 features", () => {
  const newChannels = [
    "run-hermes-backup",
    "run-hermes-import",
    "read-logs",
    "run-hermes-dump",
    "list-mcp-servers",
    "discover-memory-providers",
    "import-skill-markdown",
    "record-local-chat-trace",
    "get-perf-telemetry-config",
    "record-perf-event",
  ];

  for (const ch of newChannels) {
    it(`main has handler: ${ch}`, () => {
      expect(mainChannels).toContain(ch);
    });

    it(`preload invokes: ${ch}`, () => {
      expect(preloadChannels).toContain(ch);
    });
  }
});

// ─── Legacy handlers still present ──────────────────────

describe("Legacy IPC handlers preserved", () => {
  const legacyChannels = [
    "check-install",
    "start-install",
    "get-hermes-version",
    "run-hermes-doctor",
    "run-hermes-update",
    "get-env",
    "set-env",
    "get-config",
    "set-config",
    "get-model-config",
    "set-model-config",
    "send-message",
    "abort-chat",
    "start-gateway",
    "stop-gateway",
    "gateway-status",
    "get-platform-enabled",
    "set-platform-enabled",
    "list-sessions",
    "get-session-messages",
    "list-profiles",
    "create-profile",
    "list-cron-jobs",
    "create-cron-job",
    "open-external",
  ];

  for (const ch of legacyChannels) {
    it(`${ch} handler still registered`, () => {
      expect(mainChannels).toContain(ch);
    });
  }
});

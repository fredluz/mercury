import { afterEach, describe, expect, it, vi } from "vitest";

function mockSystemServiceDeps(
  options: {
    revalidateRuntime?: ReturnType<typeof vi.fn>;
    getSnapshot?: ReturnType<typeof vi.fn>;
  } = {},
): void {
  const revalidateRuntime =
    options.revalidateRuntime ?? vi.fn().mockResolvedValue(true);
  const getSnapshot = options.getSnapshot ?? vi.fn().mockReturnValue([]);

  vi.doMock("../src/main/installer", () => ({
    runHermesBackup: vi.fn(),
    runHermesImport: vi.fn(),
    runHermesDump: vi.fn(),
    listMcpServers: vi.fn(),
    discoverMemoryProviders: vi.fn(),
    readLogs: vi.fn(),
  }));
  vi.doMock("../src/main/config", () => ({
    getConnectionConfig: vi.fn().mockReturnValue({ mode: "local" }),
  }));
  vi.doMock("../src/main/hermes", () => ({
    getRuntimeDiagnostic: vi.fn(),
    markRuntimeStale: vi.fn(),
    revalidateRuntime,
  }));
  vi.doMock("../src/main/hermes/session-activity", () => ({
    chatSessionActivityTracker: { getSnapshot },
  }));
  vi.doMock("../src/main/ssh-remote", () => ({
    sshRunDump: vi.fn(),
    sshDiscoverMemoryProviders: vi.fn(),
    sshReadLogs: vi.fn(),
    sshListMcpServers: vi.fn(),
  }));
  vi.doMock("../src/main/services/runtime-debug-service", () => ({
    launchRuntimeDebugAgent: vi.fn(),
  }));
}

describe("system-service runtime revalidation", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("returns false instead of rejecting when runtime revalidation fails", async () => {
    mockSystemServiceDeps({
      revalidateRuntime: vi
        .fn()
        .mockRejectedValue(new Error("runtime-profile-unverified")),
    });
    const { revalidateRuntimeForProfile } =
      await import("../src/main/services/system-service");

    await expect(revalidateRuntimeForProfile("default")).resolves.toBe(false);
  });

  it("delegates session runtime activity snapshots to the chat activity tracker", async () => {
    const getSnapshot = vi
      .fn()
      .mockReturnValue([
        { profile: "alpha", activeRunCount: 1, isIdle: false, sessions: [] },
      ]);
    mockSystemServiceDeps({ getSnapshot });
    const { getSessionRuntimeActivityForProfile } =
      await import("../src/main/services/system-service");

    await expect(getSessionRuntimeActivityForProfile("alpha")).toEqual([
      { profile: "alpha", activeRunCount: 1, isIdle: false, sessions: [] },
    ]);
    expect(getSnapshot).toHaveBeenCalledWith("alpha");
  });

  it("delegates runtime revalidation to the capability-gated runtime manager", async () => {
    const revalidateRuntime = vi.fn().mockResolvedValue(false);
    mockSystemServiceDeps({
      revalidateRuntime,
    });
    const { revalidateRuntimeForProfile } =
      await import("../src/main/services/system-service");

    await expect(revalidateRuntimeForProfile("default")).resolves.toBe(false);
    expect(revalidateRuntime).toHaveBeenCalledWith("default");
  });
});

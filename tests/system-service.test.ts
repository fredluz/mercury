import { afterEach, describe, expect, it, vi } from "vitest";

function mockSystemServiceDeps(options: {
  prepareChatBackend?: ReturnType<typeof vi.fn>;
  probeChatCompletionViaApi?: ReturnType<typeof vi.fn>;
  resolveChatRuntimeModel?: ReturnType<typeof vi.fn>;
} = {}): void {
  const prepareChatBackend =
    options.prepareChatBackend ?? vi.fn().mockResolvedValue({ transport: "api" });
  const probeChatCompletionViaApi =
    options.probeChatCompletionViaApi ?? vi.fn().mockResolvedValue({ success: true });
  const resolveChatRuntimeModel =
    options.resolveChatRuntimeModel ??
    vi.fn().mockResolvedValue({ provider: "openai", model: "gpt-5.5" });

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
  }));
  vi.doMock("../src/main/hermes/chat-api", () => ({
    probeChatCompletionViaApi,
  }));
  vi.doMock("../src/main/hermes/chat-model", () => ({
    resolveChatRuntimeModel,
  }));
  vi.doMock("../src/main/services/chat-service", () => ({
    prepareChatBackend,
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

  it("returns false instead of rejecting when runtime preparation fails", async () => {
    mockSystemServiceDeps({
      prepareChatBackend: vi
        .fn()
        .mockRejectedValue(new Error("runtime-profile-unverified")),
    });
    const { revalidateRuntimeForProfile } = await import(
      "../src/main/services/system-service"
    );

    await expect(revalidateRuntimeForProfile("default")).resolves.toBe(false);
  });

  it("returns false instead of rejecting when the API probe fails", async () => {
    mockSystemServiceDeps({
      prepareChatBackend: vi.fn().mockResolvedValue({ transport: "api" }),
      probeChatCompletionViaApi: vi
        .fn()
        .mockRejectedValue(new Error("probe assertion failed")),
    });
    const { revalidateRuntimeForProfile } = await import(
      "../src/main/services/system-service"
    );

    await expect(revalidateRuntimeForProfile("default")).resolves.toBe(false);
  });
});

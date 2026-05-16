import { EventEmitter } from "events";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ChildProcess } from "child_process";
import { describe, expect, it, vi } from "vitest";
import {
  buildHermesProfileCommandArgs,
  ProfileRuntimeManager,
  type ProfileRuntimeManagerDeps,
} from "../src/main/hermes/runtime";
import { ProfileRuntimeError } from "../src/main/hermes/types";

function fakeChildProcess(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.pid = pid;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  }) as ChildProcess["kill"];
  child.unref = vi.fn() as ChildProcess["unref"];
  return child;
}

function noOpTimers(): Pick<
  ProfileRuntimeManagerDeps,
  "setTimeout" | "setInterval" | "clearInterval"
> {
  return {
    setTimeout: vi.fn(() => 1) as unknown as typeof setTimeout,
    setInterval: vi.fn(() => 1) as unknown as typeof setInterval,
    clearInterval: vi.fn() as unknown as typeof clearInterval,
  };
}

describe("ProfileRuntimeManager contract", () => {
  it("creates profile API config for fresh named profiles", async () => {
    const root = mkdtempSync(join(tmpdir(), "mercury-profile-runtime-"));
    vi.resetModules();
    vi.doMock("../src/main/utils", () => ({
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? join(root, "profiles", profile)
          : root,
    }));
    try {
      const { ensureApiServerConfig, defaultLocalApiPortForProfile } = await import(
        "../src/main/hermes/connection"
      );
      ensureApiServerConfig("alpha");
      const config = readFileSync(join(root, "profiles", "alpha", "config.yaml"), "utf-8");
      expect(config).toContain("api_server:");
      expect(config).toContain(`port: ${defaultLocalApiPortForProfile("alpha")}`);
      expect(config).toContain('host: "127.0.0.1"');
    } finally {
      vi.doUnmock("../src/main/utils");
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("constructs Hermes commands with -p before the subcommand for named profiles", () => {
    expect(buildHermesProfileCommandArgs("hermes", "alpha", ["chat"])).toEqual([
      "hermes",
      "-p",
      "alpha",
      "chat",
    ]);
    expect(buildHermesProfileCommandArgs("hermes", "default", ["chat"])).toEqual([
      "hermes",
      "chat",
    ]);
    expect(buildHermesProfileCommandArgs("hermes", undefined, ["gateway"])).toEqual([
      "hermes",
      "gateway",
    ]);
  });

  it("falls back to a verified CLI identity for named local profiles without managed API evidence", async () => {
    const isApiServerReady = vi.fn().mockResolvedValue(true);
    const manager = new ProfileRuntimeManager({
      hermesScript: "hermes",
      getConnectionConfig: vi.fn().mockReturnValue({ mode: "local" }),
      isApiServerReady,
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      getLocalApiPort: vi.fn().mockReturnValue(19_001),
      getLocalApiUrl: vi.fn().mockReturnValue("http://127.0.0.1:19001"),
      ...noOpTimers(),
    });

    const handle = await manager.resolveRuntime({
      profile: "alpha",
      mode: "local",
      purpose: "chat",
      sessionId: "session-1",
    });

    expect(handle.transport).toBe("cli");
    expect(handle.identity).toMatchObject({
      requestedProfile: "alpha",
      actualProfile: "alpha",
      verified: true,
      verificationSource: "cli-args",
      transport: "cli",
      hermesHome: "/tmp/hermes/profiles/alpha",
    });
    expect(handle.cliCommand).toEqual(["hermes", "-p", "alpha", "chat"]);
    expect(isApiServerReady).not.toHaveBeenCalled();
  });

  it("keeps local gateway process and API readiness state keyed by profile", async () => {
    const child = fakeChildProcess(4_321);
    const spawn = vi.fn().mockReturnValue(child);
    const isApiServerReady = vi.fn().mockResolvedValue(true);
    const manager = new ProfileRuntimeManager({
      baseHermesHome: "/tmp/hermes",
      hermesPython: "python",
      hermesRepo: "/tmp/hermes/hermes-agent",
      hermesScript: "hermes",
      spawn,
      readEnv: vi.fn((profile?: string) =>
        profile === "alpha" ? { API_SERVER_KEY: "alpha-secret" } : {},
      ),
      getConnectionConfig: vi.fn().mockReturnValue({ mode: "local" }),
      ensureApiServerConfig: vi.fn(),
      isApiServerReady,
      getEnhancedPath: vi.fn().mockReturnValue("/usr/bin"),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      getLocalApiPort: vi.fn((profile?: string) =>
        profile === "alpha" ? 19_001 : 19_002,
      ),
      getLocalApiUrl: vi.fn((profile?: string) =>
        profile === "alpha"
          ? "http://127.0.0.1:19001"
          : "http://127.0.0.1:19002",
      ),
      now: () => 1_778_921_600_000,
      ...noOpTimers(),
    });

    expect(manager.startGateway("alpha")).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "python",
      ["hermes", "-p", "alpha", "gateway"],
      expect.objectContaining({
        cwd: "/tmp/hermes/hermes-agent",
        detached: true,
        env: expect.objectContaining({
          HERMES_HOME: "/tmp/hermes",
          API_SERVER_ENABLED: "true",
          API_SERVER_HOST: "127.0.0.1",
          API_SERVER_PORT: "19001",
          API_SERVER_KEY: "alpha-secret",
        }),
      }),
    );
    expect(manager.isGatewayRunning("alpha")).toBe(true);
    expect(manager.isGatewayRunning("beta")).toBe(false);
    expect(manager.getRuntimeDiagnostic("alpha")).toMatchObject({
      selectedProfile: "alpha",
      verified: false,
      status: "unverified",
      mismatchReason: "Gateway process has started but API readiness has not been verified yet.",
    });

    const runtime = await manager.resolveRuntime({
      profile: "alpha",
      mode: "local",
      purpose: "chat",
      preferTransport: "api",
    });

    expect(runtime.transport).toBe("api");
    expect(runtime.apiBaseUrl).toBe("http://127.0.0.1:19001");
    expect(runtime.authHeaders).toEqual({ Authorization: "Bearer alpha-secret" });
    expect(runtime.identity).toMatchObject({
      requestedProfile: "alpha",
      actualProfile: "alpha",
      verified: true,
      verificationSource: "managed-process",
      transport: "api",
      localPort: 19_001,
      pid: 4_321,
      startedByMercury: true,
      command: ["hermes", "-p", "alpha", "gateway"],
    });
    expect(isApiServerReady).toHaveBeenCalledWith(
      "http://127.0.0.1:19001",
      { Authorization: "Bearer alpha-secret" },
    );
  });

  it("reports verified diagnostics and stale invalidation for profile runtimes", async () => {
    const child = fakeChildProcess(4_321);
    const manager = new ProfileRuntimeManager({
      baseHermesHome: "/tmp/hermes",
      hermesPython: "python",
      hermesRepo: "/tmp/hermes/hermes-agent",
      hermesScript: "hermes",
      spawn: vi.fn().mockReturnValue(child),
      readEnv: vi.fn((profile?: string) =>
        profile === "alpha" ? { API_SERVER_KEY: "alpha-secret" } : {},
      ),
      getConnectionConfig: vi.fn().mockReturnValue({ mode: "local" }),
      ensureApiServerConfig: vi.fn(),
      isApiServerReady: vi.fn().mockResolvedValue(true),
      getEnhancedPath: vi.fn().mockReturnValue("/usr/bin"),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      getLocalApiPort: vi.fn().mockReturnValue(19_001),
      getLocalApiUrl: vi.fn().mockReturnValue("http://127.0.0.1:19001"),
      now: () => 1_778_921_600_000,
      ...noOpTimers(),
    });

    manager.startGateway("alpha");
    await manager.resolveRuntime({
      profile: "alpha",
      mode: "local",
      purpose: "chat",
      preferTransport: "api",
    });

    expect(manager.getRuntimeDiagnostic("alpha")).toMatchObject({
      selectedProfile: "alpha",
      requestedProfile: "alpha",
      actualProfile: "alpha",
      verified: true,
      status: "verified",
      mode: "local",
      transport: "api",
      localPort: 19_001,
      pid: 4_321,
      authSource: "profile-env",
      authKeyFingerprint: expect.stringMatching(/^sha256:/),
      stale: false,
    });

    manager.markRuntimeStale("alpha", "Config key provider changed for profile runtime.");
    expect(manager.getRuntimeDiagnostic("alpha")).toMatchObject({
      selectedProfile: "alpha",
      verified: false,
      status: "stale",
      stale: true,
      staleReason: "Config key provider changed for profile runtime.",
    });
  });

  it("does not clear stale markers until runtime identity is revalidated", async () => {
    const child = fakeChildProcess(4_321);
    const manager = new ProfileRuntimeManager({
      baseHermesHome: "/tmp/hermes",
      hermesPython: "python",
      hermesRepo: "/tmp/hermes/hermes-agent",
      hermesScript: "hermes",
      spawn: vi.fn().mockReturnValue(child),
      readEnv: vi.fn().mockReturnValue({}),
      getConnectionConfig: vi.fn().mockReturnValue({ mode: "local" }),
      ensureApiServerConfig: vi.fn(),
      isApiServerReady: vi.fn().mockResolvedValue(true),
      getEnhancedPath: vi.fn().mockReturnValue("/usr/bin"),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      getLocalApiPort: vi.fn().mockReturnValue(19_001),
      getLocalApiUrl: vi.fn().mockReturnValue("http://127.0.0.1:19001"),
      now: vi
        .fn()
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(2_000)
        .mockReturnValue(3_000),
      ...noOpTimers(),
    });

    manager.startGateway("alpha");
    await manager.resolveRuntime({
      profile: "alpha",
      mode: "local",
      purpose: "chat",
      preferTransport: "api",
    });
    manager.markRuntimeStale("alpha", "Profile config changed.");
    manager.clearRuntimeStale("alpha");
    expect(manager.getRuntimeDiagnostic("alpha")).toMatchObject({
      status: "stale",
      stale: true,
      staleReason: "Profile config changed.",
    });

    await expect(manager.revalidateRuntime("alpha", "chat")).resolves.toBe(true);
    expect(manager.getRuntimeDiagnostic("alpha")).toMatchObject({
      status: "verified",
      stale: false,
      verified: true,
    });
  });

  it("fails closed when a named profile is configured on the default API port", () => {
    const spawn = vi.fn().mockReturnValue(fakeChildProcess(4_321));
    const manager = new ProfileRuntimeManager({
      baseHermesHome: "/tmp/hermes",
      hermesPython: "python",
      hermesRepo: "/tmp/hermes/hermes-agent",
      hermesScript: "hermes",
      spawn,
      readEnv: vi.fn().mockReturnValue({}),
      getConnectionConfig: vi.fn().mockReturnValue({ mode: "local" }),
      ensureApiServerConfig: vi.fn(),
      getEnhancedPath: vi.fn().mockReturnValue("/usr/bin"),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      getLocalApiPort: vi.fn().mockReturnValue(8_642),
      getLocalApiUrl: vi.fn().mockReturnValue("http://127.0.0.1:8642"),
      now: () => 1_778_921_600_000,
      ...noOpTimers(),
    });

    expect(() => manager.startGateway("alpha")).toThrow(ProfileRuntimeError);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("fails closed when two managed profiles would share a local API port", () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce(fakeChildProcess(4_321))
      .mockReturnValueOnce(fakeChildProcess(4_322));
    const manager = new ProfileRuntimeManager({
      baseHermesHome: "/tmp/hermes",
      hermesPython: "python",
      hermesRepo: "/tmp/hermes/hermes-agent",
      hermesScript: "hermes",
      spawn,
      readEnv: vi.fn().mockReturnValue({}),
      getConnectionConfig: vi.fn().mockReturnValue({ mode: "local" }),
      ensureApiServerConfig: vi.fn(),
      getEnhancedPath: vi.fn().mockReturnValue("/usr/bin"),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      getLocalApiPort: vi.fn().mockReturnValue(19_001),
      getLocalApiUrl: vi.fn().mockReturnValue("http://127.0.0.1:19001"),
      now: () => 1_778_921_600_000,
      ...noOpTimers(),
    });

    expect(manager.startGateway("alpha")).toBe(true);
    expect(() => manager.startGateway("beta")).toThrow(ProfileRuntimeError);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("fails closed for named SSH profiles tunneled through the default remote API port", async () => {
    const manager = new ProfileRuntimeManager({
      hermesScript: "hermes",
      getConnectionConfig: vi.fn().mockReturnValue({
        mode: "ssh",
        ssh: {
          host: "example.test",
          port: 22,
          username: "hermes",
          keyPath: "",
          remotePort: 8642,
          localPort: 18642,
        },
      }),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      ...noOpTimers(),
    });

    await expect(
      manager.resolveRuntime({ profile: "alpha", purpose: "chat" }),
    ).rejects.toMatchObject({
      code: "runtime-profile-unverified",
      identity: expect.objectContaining({
        requestedProfile: "alpha",
        actualProfile: null,
        verified: false,
        mode: "ssh",
        transport: "ssh-api",
        remotePort: 8642,
      }),
    });
  });

  it("fails closed for SSH tunnels when remote profile runtime evidence is missing", async () => {
    const verifySshRuntime = vi.fn().mockResolvedValue({
      verified: false,
      reason: "Remote profile config does not declare the tunnel port.",
      configPath: "~/.hermes/profiles/alpha/config.yaml",
      hermesHome: "~/.hermes/profiles/alpha",
      pidFile: "~/.hermes/profiles/alpha/gateway.pid",
    });
    const manager = new ProfileRuntimeManager({
      hermesScript: "hermes",
      getConnectionConfig: vi.fn().mockReturnValue({
        mode: "ssh",
        ssh: {
          host: "example.test",
          port: 22,
          username: "hermes",
          keyPath: "",
          remotePort: 19_001,
          localPort: 29_001,
        },
      }),
      getSshTunnelUrl: vi.fn().mockReturnValue("http://127.0.0.1:29001"),
      verifySshRuntime,
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      ...noOpTimers(),
    });

    await expect(
      manager.resolveRuntime({ profile: "alpha", purpose: "chat" }),
    ).rejects.toMatchObject({
      code: "runtime-profile-unverified",
      identity: expect.objectContaining({
        requestedProfile: "alpha",
        actualProfile: null,
        verified: false,
        mode: "ssh",
        transport: "ssh-api",
        apiBaseUrl: "http://127.0.0.1:29001",
        remotePort: 19_001,
        configPath: "~/.hermes/profiles/alpha/config.yaml",
        mismatchReason: "Remote profile config does not declare the tunnel port.",
      }),
    });
    expect(manager.getRuntimeDiagnostic("alpha")).toMatchObject({
      status: "unverified",
      verified: false,
      mismatchReason: "Remote profile config does not declare the tunnel port.",
      configPath: "~/.hermes/profiles/alpha/config.yaml",
    });
    expect(verifySshRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ remotePort: 19_001, localPort: 29_001 }),
      "alpha",
      19_001,
    );
  });

  it("verifies SSH API runtimes only after remote config/status evidence matches", async () => {
    const manager = new ProfileRuntimeManager({
      hermesScript: "hermes",
      getConnectionConfig: vi.fn().mockReturnValue({
        mode: "ssh",
        ssh: {
          host: "example.test",
          port: 22,
          username: "hermes",
          keyPath: "",
          remotePort: 19_001,
          localPort: 29_001,
        },
      }),
      getSshTunnelUrl: vi.fn().mockReturnValue("http://127.0.0.1:29001"),
      verifySshRuntime: vi.fn().mockResolvedValue({
        verified: true,
        configuredPort: 19_001,
        configPath: "~/.hermes/profiles/alpha/config.yaml",
        hermesHome: "~/.hermes/profiles/alpha",
        pidFile: "~/.hermes/profiles/alpha/gateway.pid",
      }),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      ...noOpTimers(),
    });

    const runtime = await manager.resolveRuntime({
      profile: "alpha",
      purpose: "chat",
      preferTransport: "api",
    });

    expect(runtime.transport).toBe("ssh-api");
    expect(runtime.identity).toMatchObject({
      requestedProfile: "alpha",
      actualProfile: "alpha",
      verified: true,
      mode: "ssh",
      transport: "ssh-api",
      apiBaseUrl: "http://127.0.0.1:29001",
      remotePort: 19_001,
      configPath: "~/.hermes/profiles/alpha/config.yaml",
      pidFile: "~/.hermes/profiles/alpha/gateway.pid",
      capabilities: expect.objectContaining({
        remoteConfigPortVerified: true,
        remoteGatewayStatusVerified: true,
      }),
    });
    expect(manager.getRuntimeDiagnostic("alpha")).toMatchObject({
      status: "verified",
      verified: true,
      actualProfile: "alpha",
      mode: "ssh",
      transport: "ssh-api",
      configPath: "~/.hermes/profiles/alpha/config.yaml",
    });
  });

  it("fails closed for pure remote HTTP runtimes without verified identity", async () => {
    const manager = new ProfileRuntimeManager({
      hermesScript: "hermes",
      getConnectionConfig: vi.fn().mockReturnValue({ mode: "remote" }),
      profileHome: (profile?: string) =>
        profile && profile !== "default"
          ? `/tmp/hermes/profiles/${profile}`
          : "/tmp/hermes",
      ...noOpTimers(),
    });

    await expect(
      manager.resolveRuntime({ profile: "alpha", purpose: "chat" }),
    ).rejects.toMatchObject({
      code: "runtime-unsupported-remote-profile",
      identity: expect.objectContaining({
        requestedProfile: "alpha",
        actualProfile: null,
        verified: false,
        mode: "remote",
        transport: "remote-api",
      }),
    });
  });

  it("serializes structured runtime errors with stable codes", () => {
    const error = new ProfileRuntimeError(
      "runtime-profile-unverified",
      "Could not verify profile identity.",
    );

    expect(error.toJSON()).toEqual({
      code: "runtime-profile-unverified",
      message: "Could not verify profile identity.",
      identity: undefined,
    });
  });
});

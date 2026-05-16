import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { sendMessageViaApi } from "../src/main/hermes/chat-api";

const ROOT = join(__dirname, "..");

function src(path: string): string {
  return readFileSync(join(ROOT, path), "utf-8");
}

describe("reliable profile runtime contract sentinels", () => {
  it("defines a shared diagnostic surface and structured main-process runtime contract", () => {
    const sharedRuntime = src("src/shared/runtime.ts");
    const mainTypes = src("src/main/hermes/types.ts");
    const runtimeManager = src("src/main/hermes/runtime.ts");

    for (const field of [
      "selectedProfile",
      "requestedProfile",
      "actualProfile",
      "verificationSource",
      "apiBaseUrl",
      "localPort",
      "remotePort",
      "pid",
      "pidFile",
      "logDir",
      "hermesHome",
      "configPath",
      "authKeyFingerprint",
      "authSource",
      "verifiedAt",
      "staleReason",
      "mismatchReason",
      "unsupportedReason",
    ]) {
      expect(sharedRuntime, `RuntimeDiagnostic includes ${field}`).toContain(field);
    }

    expect(mainTypes).toContain("export interface ProfileRuntimeRequest");
    expect(mainTypes).toContain("export interface RuntimeIdentity");
    expect(mainTypes).toContain("export interface ProfileRuntimeHandle");
    expect(mainTypes).toContain('"runtime-profile-mismatch"');
    expect(mainTypes).toContain('"runtime-profile-unverified"');
    expect(mainTypes).toContain('"runtime-unsupported-remote-profile"');
    expect(mainTypes).toContain("export class ProfileRuntimeError extends Error");

    expect(runtimeManager).toContain("export class ProfileRuntimeManager");
    expect(runtimeManager).toContain("private readonly states = new Map<string, RuntimeState>()");
    expect(runtimeManager).toContain("createUnverifiedExternalIdentity");
    expect(runtimeManager).toContain("runtime-unsupported-remote-profile");
    expect(runtimeManager).toContain("markRuntimeStale");
    expect(runtimeManager).toContain("markAllRuntimeStale");
    expect(runtimeManager).toContain("getRuntimeDiagnostic");
  });

  it("keeps gateway lifecycle profile-aware from renderer through preload IPC into main/SSH/local handlers", () => {
    const rendererGateway = src("src/renderer/src/screens/Gateway/Gateway.tsx");
    const preloadNavigation = src("src/preload/api/navigation.ts");
    const preloadTypes = src("src/preload/index.d.ts");
    const ipcGateway = src("src/main/ipc/gateway.ts");
    const hermesGateway = src("src/main/hermes/gateway.ts");

    for (const invocation of [
      "gatewayStatus(profile)",
      "startGateway(profile)",
      "stopGateway(profile)",
    ]) {
      expect(rendererGateway, `Gateway UI calls ${invocation}`).toContain(invocation);
    }

    for (const channel of [
      'ipcRenderer.invoke("gateway-status", profile)',
      'ipcRenderer.invoke("start-gateway", profile)',
      'ipcRenderer.invoke("stop-gateway", profile)',
      'ipcRenderer.invoke("restart-gateway", profile)',
    ]) {
      expect(preloadNavigation).toContain(channel);
    }

    expect(preloadTypes).toContain("gatewayStatus: (profile?: string)");
    expect(preloadTypes).toContain("startGateway: (profile?: string)");
    expect(preloadTypes).toContain("stopGateway: (profile?: string)");
    expect(preloadTypes).toContain("restartGateway: (profile?: string)");

    expect(ipcGateway).toContain('ipcMain.handle("start-gateway", async (_event, profile?: string)');
    expect(ipcGateway).toContain("sshStartGateway(conn.ssh, profile)");
    expect(ipcGateway).toContain("sshStopGateway(conn.ssh, profile)");
    expect(ipcGateway).toContain("sshGatewayStatus(conn.ssh, profile)");
    expect(ipcGateway).toContain("startGateway(profile)");
    expect(ipcGateway).toContain("stopGateway(true, profile)");
    expect(ipcGateway).toContain("restartGateway(profile)");
    expect(ipcGateway).toContain('if (conn.mode === "remote") return false;');

    expect(hermesGateway).toContain("profileRuntimeManager.startGateway(normalizedProfile)");
    expect(hermesGateway).toContain("profileRuntimeManager.isGatewayRunning(profile)");
    expect(hermesGateway).toContain("profileRuntimeManager.restartGateway(profile)");
  });

  it("routes chat, title, and cron execution through verified profile runtime handles", () => {
    const chatIpc = src("src/main/ipc/chat.ts");
    const hermesGateway = src("src/main/hermes/gateway.ts");
    const chatApi = src("src/main/hermes/chat-api.ts");
    const title = src("src/main/hermes/title.ts");
    const cron = src("src/main/cronjobs.ts");

    expect(chatIpc).toContain("prepareChatBackend(profile, \"chat\", resumeSessionId)");
    expect(chatIpc).toContain("profileRuntimeManager.resolveRuntime({");
    expect(chatIpc).toContain("sshGatewayStatus(conn.ssh, normalizedProfile)");
    expect(chatIpc).toContain("sshReadRemoteApiKey(conn.ssh, normalizedProfile)");
    expect(chatIpc).toContain("runtime,");

    expect(hermesGateway).toContain("preparedRuntime ??");
    expect(hermesGateway).toContain("profileRuntimeManager.resolveRuntime({");
    expect(hermesGateway).toContain("runtime.request.profile !== normalizedProfile");
    expect(hermesGateway).toContain("sendMessageViaApi(");
    expect(hermesGateway).toContain("runtime,");
    expect(chatApi).toContain("runtime: ProfileRuntimeHandle");
    expect(chatApi).toContain("Verified API runtime handle is required for chat API execution");
    expect(chatApi).toContain("`${runtime.apiBaseUrl}/v1/chat/completions`");
    expect(chatApi).toContain("...(runtime.authHeaders ?? {})");
    expect(chatApi).not.toContain("getApiUrl(");
    expect(chatApi).not.toContain("getRemoteAuthHeader");

    expect(title).toContain("getSessionTitle(request.sessionId, request.profile)");
    expect(title).toContain("runtimeMatchesRequest(runtime, request.profile)");
    expect(title).toContain("profileRuntimeManager.resolveRuntime({");
    expect(title).toContain("purpose: \"title\"");
    expect(title).toContain("!runtime.apiBaseUrl");
    expect(title).toContain("`${runtime.apiBaseUrl}/v1/chat/completions`");

    expect(cron).toContain("buildHermesProfileCommandArgs(HERMES_SCRIPT, profile");
    expect(cron).toContain("profileRuntimeManager.resolveRuntime({");
    expect(cron).toContain("purpose: \"cron\"");
    expect(cron).toContain("preferTransport: \"api\"");
    expect(cron).toContain("runtime.identity.actualProfile !== requestedProfile");
    expect(cron).toContain("Verified cron API runtime is not available for profile");
    expect(cron).toContain("fetch(`${runtime.apiBaseUrl}${path}`");
  });

  it("keeps SSH and pure remote behavior profile-bound or fail-closed", () => {
    const sshRuntime = src("src/main/ssh/runtime.ts");
    const sshConfig = src("src/main/ssh/config.ts");
    const sshSkills = src("src/main/ssh/skills.ts");
    const sshTunnel = src("src/main/ssh-tunnel.ts");
    const runtimeManager = src("src/main/hermes/runtime.ts");
    const ipcGateway = src("src/main/ipc/gateway.ts");
    const ipcConfig = src("src/main/ipc/config.ts");

    expect(sshRuntime).toContain("buildSshHermesProfileCommand");
    expect(sshRuntime).toContain("return hermesProfileCommand(profile, args)");
    expect(sshRuntime).toContain("export async function sshGatewayStatus(");
    expect(sshRuntime).toContain("profile?: string,");
    expect(sshRuntime).toContain("remoteGatewayPidPath(profile)");
    expect(sshRuntime).toContain("export async function sshStartGateway(");
    expect(sshRuntime).toContain('hermesProfileCommand(profile, "gateway start")');
    expect(sshRuntime).toContain("export async function sshStopGateway(");
    expect(sshRuntime).toContain('hermesProfileCommand(profile, "gateway stop")');
    expect(sshRuntime).toContain("export async function sshReadRemoteApiKey(");
    expect(sshRuntime).toContain("sshReadEnv(config, profile)");
    expect(sshRuntime).toContain("remoteHermesHomePath(profile)");
    expect(sshConfig).toContain("platform_toolsets");
    expect(sshConfig).toContain("api_server:");
    expect(sshSkills).toContain("export function buildSshSkillCommand(");
    expect(sshSkills).toContain("return hermesProfileCommand(profile, args)");

    expect(sshTunnel).toContain("buildSshTunnelIdentityKey");
    expect(sshTunnel).toContain("normalizeProfile(profile)");
    expect(sshTunnel).toContain("const requestedProfile = normalizeProfile(profile)");
    expect(sshTunnel).toContain("requestedProfile !== activeProfile");
    expect(sshTunnel).toContain("activeTunnelKey = buildSshTunnelIdentityKey(config, profile)");

    expect(runtimeManager).toContain('if (mode === "remote")');
    expect(runtimeManager).toContain('"runtime-unsupported-remote-profile"');
    expect(runtimeManager).toContain('const transport = request.mode === "ssh" ? "ssh-api" : "remote-api"');
    expect(runtimeManager).toContain("SSH tunnel is not verified for profile");
    expect(ipcGateway).toContain('if (conn.mode === "remote") return false;');
    expect(ipcConfig).toContain("setSshRemoteApiKey(key, profile)");
  });

  it("surfaces runtime diagnostics and stale state through IPC, preload, and renderer warning components", () => {
    const ipcSystem = src("src/main/ipc/system.ts");
    const ipcConfig = src("src/main/ipc/config.ts");
    const ipcKnowledge = src("src/main/ipc/knowledge.ts");
    const preloadApp = src("src/preload/api/app.ts");
    const preloadTypes = src("src/preload/index.d.ts");
    const layout = src("src/renderer/src/screens/Layout/Layout.tsx");
    const diagnosticNotice = src("src/renderer/src/components/RuntimeDiagnosticNotice.tsx");
    const gatewayScreen = src("src/renderer/src/screens/Gateway/Gateway.tsx");
    const chatScreen = src("src/renderer/src/screens/Chat/Chat.tsx");
    const settingsScreen = src("src/renderer/src/screens/Settings/Settings.tsx");

    expect(ipcSystem).toContain('ipcMain.handle("get-runtime-diagnostic"');
    expect(ipcSystem).toContain("getRuntimeDiagnostic(profile)");
    expect(ipcSystem).toContain("markRuntimeStale(profile, \"Profile import changed profile runtime files.\")");
    expect(ipcConfig).toContain("markRuntimeStale(profile");
    expect(ipcConfig).toContain("markAllRuntimesStale");
    expect(ipcKnowledge).toContain("markRuntimeStale(profile");

    expect(preloadApp).toContain('ipcRenderer.invoke("get-runtime-diagnostic", profile)');
    expect(preloadTypes).toContain("getRuntimeDiagnostic: (profile?: string) => Promise<RuntimeDiagnostic>");

    expect(layout).toContain("getRuntimeDiagnostic(requestedProfile)");
    expect(layout).toContain("activeProfileRef.current === requestedProfile");
    expect(layout).toContain("<RuntimeDiagnosticNotice diagnostic={runtimeDiagnostic}");
    expect(diagnosticNotice).toContain("Runtime warning");
    expect(diagnosticNotice).toContain("Runtime verified");
    expect(diagnosticNotice).toContain("runtimeDiagnosticMessage");
    const chatHeader = src("src/renderer/src/screens/Chat/components/ChatHeader.tsx");
    const settingsCore = src("src/renderer/src/screens/Settings/components/SettingsCoreSections.tsx");

    expect(gatewayScreen).toContain("RuntimeDiagnosticNotice");
    expect(chatScreen).toContain("runtimeDiagnostic={runtimeDiagnostic}");
    expect(chatHeader).toContain("RuntimeDiagnosticNotice");
    expect(settingsScreen).toContain("runtimeDiagnostic");
    expect(settingsCore).toContain("RuntimeDiagnosticNotice");
  });

  it("requires a verified API runtime handle for chat API execution", () => {
    const callbacks = {
      onChunk: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
    };

    expect(() =>
      sendMessageViaApi(
        "hello",
        callbacks,
        "alpha",
        undefined,
        undefined,
        undefined as never,
      ),
    ).toThrow("Verified API runtime handle is required for chat API execution");
    expect(() =>
      sendMessageViaApi(
        "hello",
        callbacks,
        "alpha",
        undefined,
        undefined,
        {
          request: { profile: "alpha", mode: "local", purpose: "chat" },
          identity: {
            requestedProfile: "alpha",
            actualProfile: "alpha",
            verified: true,
            verificationSource: "managed-process",
            mode: "local",
            transport: "api",
            startedByMercury: true,
            verifiedAt: 1,
          },
          transport: "api",
        },
      ),
    ).toThrow("Verified API runtime handle is required for chat API execution");
  });

  it("documents storage isolation separately from runtime isolation", () => {
    const storageDoc = src("docs/subsystems/storage-and-profiles.md");
    const architectureDoc = src("docs/architecture/overview.md");
    const investigation = src("docs/investigations/reliable-profile-runtime-2026-05-16.md");

    expect(storageDoc).toContain("Storage isolation vs runtime isolation");
    expect(storageDoc).toContain("ProfileRuntimeManager");
    expect(storageDoc).toContain("RuntimeDiagnostic");
    expect(storageDoc).toContain("Pure remote HTTP mode");

    expect(architectureDoc).toContain("Profile runtime manager");
    expect(architectureDoc).toContain("runtime diagnostics");
    expect(architectureDoc).toContain("src/shared/runtime.ts");

    expect(investigation).toContain("Implementation status after Items 1-5");
    expect(investigation).toContain("final behavior");
    expect(investigation).toContain("remaining limitations");
  });
});

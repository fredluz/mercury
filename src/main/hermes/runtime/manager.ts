import { spawn as defaultSpawn } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { getConnectionConfig, readEnv } from "../../config";
import { HERMES_HOME, HERMES_PYTHON, HERMES_REPO, HERMES_SCRIPT, getEnhancedPath } from "../../install/paths";
import { profileHome as defaultProfileHome } from "../../utils";
import { getSshTunnelUrl } from "../../ssh-tunnel";
import { sshVerifyProfileRuntime } from "../../ssh/runtime";
import { ensureApiServerConfig, getLocalApiPort, getLocalApiUrl, isApiServerReady } from "../connection";
import type { RuntimeDiagnostic } from "../../../shared/runtime";
import type { ProfileRuntimeHandle, ProfileRuntimeRequest, RuntimeIdentity } from "../types";
import { ProfileRuntimeError } from "../types";
import { assertNoLocalPortConflict, gatewayCommandArgs, localAuthHeaders, resolveLocalApiRuntime } from "./local-runtime";
import { buildRuntimeDiagnostic } from "./diagnostics";
import { createCliRuntimeHandle, createDiagnosticIdentity, createLocalApiIdentity, createUnverifiedExternalIdentity, type RuntimeIdentityContext } from "./identity";
import { normalizeProfile } from "./profile";
import { createInitialRuntimeState, type RuntimeState } from "./state";
import { resolveSshApiRuntime } from "./ssh-runtime";

const HEALTH_POLL_INTERVAL_MS = 15_000;
const API_STARTUP_CHECK_DELAY_MS = 3_000;

type SpawnLike = typeof defaultSpawn;

export interface ProfileRuntimeManagerDeps {
  baseHermesHome?: string;
  hermesPython?: string;
  hermesRepo?: string;
  hermesScript?: string;
  spawn?: SpawnLike;
  readEnv?: typeof readEnv;
  getConnectionConfig?: typeof getConnectionConfig;
  ensureApiServerConfig?: typeof ensureApiServerConfig;
  isApiServerReady?: typeof isApiServerReady;
  getLocalApiPort?: typeof getLocalApiPort;
  getLocalApiUrl?: typeof getLocalApiUrl;
  getEnhancedPath?: typeof getEnhancedPath;
  getSshTunnelUrl?: typeof getSshTunnelUrl;
  profileHome?: typeof defaultProfileHome;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  verifySshRuntime?: typeof sshVerifyProfileRuntime;
}

export class ProfileRuntimeManager {
  private readonly baseHermesHome: string;
  private readonly hermesPython: string;
  private readonly hermesRepo: string;
  private readonly hermesScript: string;
  private readonly spawn: SpawnLike;
  private readonly readEnv: typeof readEnv;
  private readonly getConnectionConfig: typeof getConnectionConfig;
  private readonly ensureApiServerConfig: typeof ensureApiServerConfig;
  private readonly isApiServerReady: typeof isApiServerReady;
  private readonly getLocalApiPort: typeof getLocalApiPort;
  private readonly getLocalApiUrl: typeof getLocalApiUrl;
  private readonly getEnhancedPath: typeof getEnhancedPath;
  private readonly getSshTunnelUrl: typeof getSshTunnelUrl;
  private readonly profileHome: typeof defaultProfileHome;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private readonly verifySshRuntime: typeof sshVerifyProfileRuntime;
  private readonly states = new Map<string, RuntimeState>();

  constructor(deps: ProfileRuntimeManagerDeps = {}) {
    this.baseHermesHome = deps.baseHermesHome ?? HERMES_HOME;
    this.hermesPython = deps.hermesPython ?? HERMES_PYTHON;
    this.hermesRepo = deps.hermesRepo ?? HERMES_REPO;
    this.hermesScript = deps.hermesScript ?? HERMES_SCRIPT;
    this.spawn = deps.spawn ?? defaultSpawn;
    this.readEnv = deps.readEnv ?? readEnv;
    this.getConnectionConfig = deps.getConnectionConfig ?? getConnectionConfig;
    this.ensureApiServerConfig = deps.ensureApiServerConfig ?? ensureApiServerConfig;
    this.isApiServerReady = deps.isApiServerReady ?? isApiServerReady;
    this.getLocalApiPort = deps.getLocalApiPort ?? getLocalApiPort;
    this.getLocalApiUrl = deps.getLocalApiUrl ?? getLocalApiUrl;
    this.getEnhancedPath = deps.getEnhancedPath ?? getEnhancedPath;
    this.getSshTunnelUrl = deps.getSshTunnelUrl ?? getSshTunnelUrl;
    this.profileHome = deps.profileHome ?? defaultProfileHome;
    this.now = deps.now ?? Date.now;
    this.setTimeoutFn = deps.setTimeout ?? setTimeout;
    this.setIntervalFn = deps.setInterval ?? setInterval;
    this.clearIntervalFn = deps.clearInterval ?? clearInterval;
    this.verifySshRuntime = deps.verifySshRuntime ?? sshVerifyProfileRuntime;
  }

  normalizeProfile(profile?: string): string {
    return normalizeProfile(profile);
  }

  async resolveRuntime(
    request: ProfileRuntimeRequest,
  ): Promise<ProfileRuntimeHandle> {
    const profile = normalizeProfile(request.profile);
    const mode = request.mode ?? this.getConnectionConfig().mode;
    const normalizedRequest = { ...request, profile, mode };

    if (mode === "ssh") {
      return resolveSshApiRuntime({
        request: normalizedRequest,
        identityContext: this.identityContext(),
        getConnectionConfig: this.getConnectionConfig,
        getSshTunnelUrl: this.getSshTunnelUrl,
        verifySshRuntime: this.verifySshRuntime,
        setLastIdentity: (profile, identity) => {
          this.stateFor(profile).lastIdentity = identity;
        },
      });
    }

    if (mode === "remote") {
      const identity = createUnverifiedExternalIdentity(this.identityContext(), normalizedRequest);
      throw new ProfileRuntimeError(
        "runtime-unsupported-remote-profile",
        "Pure remote HTTP runtimes must declare or verify their profile identity before execution.",
        identity,
      );
    }

    if (request.preferTransport === "cli") {
      return createCliRuntimeHandle(this.identityContext(), normalizedRequest);
    }

    if (request.preferTransport === "api" || request.purpose === "gateway") {
      const apiHandle = await resolveLocalApiRuntime(this.localRuntimeContext(), normalizedRequest, { requireReady: request.purpose !== "gateway" });
      if (apiHandle) return apiHandle;
      if (request.purpose === "gateway") {
        throw new ProfileRuntimeError(
          "runtime-unavailable",
          `Local gateway runtime for profile ${profile} is not ready.`,
        );
      }
    }

    const apiHandle = await resolveLocalApiRuntime(this.localRuntimeContext(), normalizedRequest, { requireReady: true });
    return apiHandle ?? createCliRuntimeHandle(this.identityContext(), normalizedRequest);
  }

  ensureInitialized(profile?: string): void {
    const normalizedProfile = normalizeProfile(profile);
    this.ensureApiServerConfig(normalizedProfile);
    this.startHealthPolling(normalizedProfile);
  }

  startGateway(profile?: string): boolean {
    const normalizedProfile = normalizeProfile(profile);
    this.ensureInitialized(normalizedProfile);
    if (this.isGatewayRunning(normalizedProfile)) return false;
    assertNoLocalPortConflict({
      ...this.localRuntimeContext(),
      profiles: () => this.states.keys(),
      isGatewayRunning: (profile) => this.isGatewayRunning(profile),
    }, normalizedProfile);

    const state = this.stateFor(normalizedProfile);
    const profileEnv = this.readEnv(normalizedProfile);
    const localApiPort = this.getLocalApiPort(normalizedProfile);
    const localApiHost = "127.0.0.1";
    const gatewayEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PATH: this.getEnhancedPath(),
      HOME: homedir(),
      HERMES_HOME: this.baseHermesHome,
      API_SERVER_ENABLED: "true",
      API_SERVER_HOST: localApiHost,
      API_SERVER_PORT: String(localApiPort),
    };

    for (const [key, value] of Object.entries(profileEnv)) {
      if (value) gatewayEnv[key] = value;
    }

    const args = this.gatewayCommandArgs(normalizedProfile);
    const child = this.spawn(this.hermesPython, args, {
      cwd: this.hermesRepo,
      env: gatewayEnv,
      stdio: "ignore",
      detached: true,
    });

    child.unref();
    state.gatewayProcess = child;
    state.gatewayStartedByApp = true;
    state.apiServerAvailable = null;
    state.managedApiHost = localApiHost;
    state.managedApiPort = localApiPort;
    state.gatewayCommand = args;
    state.staleReason = undefined;
    state.staleAt = undefined;
    state.lastIdentity = createLocalApiIdentity(this.identityContext(), normalizedProfile, {
      pid: child.pid,
      startedByMercury: true,
      verified: false,
      verificationSource: "managed-process",
      command: args,
      mismatchReason: "Gateway process has started but API readiness has not been verified yet.",
    });

    child.on("close", () => {
      state.gatewayProcess = null;
      state.gatewayStartedByApp = false;
      state.apiServerAvailable = false;
      this.startHealthPolling(normalizedProfile);
    });

    this.setTimeoutFn(async () => {
      state.apiServerAvailable = await this.checkLocalApiReady(normalizedProfile);
    }, API_STARTUP_CHECK_DELAY_MS);

    return true;
  }

  stopGateway(force = false, profile?: string): void {
    const normalizedProfile = normalizeProfile(profile);
    const state = this.stateFor(normalizedProfile);
    if (!force && !state.gatewayStartedByApp) return;

    if (state.gatewayProcess && !state.gatewayProcess.killed) {
      state.gatewayProcess.kill("SIGTERM");
      state.gatewayProcess = null;
    }

    const pid = this.readPidFile(normalizedProfile);
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already dead
      }
    }

    const pidFile = this.pidFileFor(normalizedProfile);
    if (existsSync(pidFile)) {
      try {
        unlinkSync(pidFile);
      } catch {
        // best-effort; will be overwritten on next gateway start
      }
    }

    state.gatewayStartedByApp = false;
    state.apiServerAvailable = false;
    state.managedApiHost = undefined;
    state.managedApiPort = undefined;
    state.gatewayCommand = undefined;
    state.lastIdentity = undefined;
  }

  isGatewayRunning(profile?: string): boolean {
    const normalizedProfile = normalizeProfile(profile);
    const state = this.stateFor(normalizedProfile);
    if (state.gatewayProcess && !state.gatewayProcess.killed) return true;

    const pid = this.readPidFile(normalizedProfile);
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  isApiReady(profile?: string): boolean {
    return this.stateFor(normalizeProfile(profile)).apiServerAvailable === true;
  }

  restartGateway(profile?: string): void {
    const normalizedProfile = normalizeProfile(profile);
    if (!this.stateFor(normalizedProfile).gatewayStartedByApp && !this.isGatewayRunning(normalizedProfile)) return;
    this.stopGateway(true, normalizedProfile);
    this.setTimeoutFn(() => {
      this.startGateway(normalizedProfile);
    }, 500);
  }

  stopHealthPolling(profile?: string): void {
    if (profile === undefined) {
      for (const state of this.states.values()) {
        if (state.healthCheckInterval) {
          this.clearIntervalFn(state.healthCheckInterval);
          state.healthCheckInterval = null;
        }
      }
      return;
    }

    const state = this.stateFor(normalizeProfile(profile));
    if (state.healthCheckInterval) {
      this.clearIntervalFn(state.healthCheckInterval);
      state.healthCheckInterval = null;
    }
  }

  getRuntimeIdentity(profile?: string): RuntimeIdentity | undefined {
    return this.stateFor(normalizeProfile(profile)).lastIdentity;
  }

  markRuntimeStale(profile: string | undefined, reason: string): void {
    const normalizedProfile = normalizeProfile(profile);
    const state = this.stateFor(normalizedProfile);
    state.staleReason = reason;
    state.staleAt = this.now();
    state.apiServerAvailable = false;
  }

  clearRuntimeStale(profile?: string): void {
    const state = this.stateFor(normalizeProfile(profile));
    if (
      state.staleAt &&
      (!state.lastIdentity?.verified || state.lastIdentity.verifiedAt <= state.staleAt)
    ) {
      return;
    }
    state.staleReason = undefined;
    state.staleAt = undefined;
  }

  async revalidateRuntime(profile?: string, purpose: ProfileRuntimeRequest["purpose"] = "gateway"): Promise<boolean> {
    const normalizedProfile = normalizeProfile(profile);
    const state = this.stateFor(normalizedProfile);
    const previousStaleReason = state.staleReason;
    const previousStaleAt = state.staleAt;
    state.staleReason = undefined;
    try {
      const handle = await this.resolveRuntime({
        profile: normalizedProfile,
        purpose,
        preferTransport: "api",
      });
      const verified =
        handle.identity.verified &&
        handle.identity.actualProfile === normalizedProfile &&
        handle.request.profile === normalizedProfile;
      if (verified) {
        state.staleReason = undefined;
        state.staleAt = undefined;
        return true;
      }
    } catch {
      // keep previous stale marker below
    }
    state.staleReason = previousStaleReason;
    state.staleAt = previousStaleAt;
    return false;
  }

  markAllRuntimeStale(reason: string): void {
    if (this.states.size === 0) {
      this.markRuntimeStale(undefined, reason);
      return;
    }
    for (const profile of this.states.keys()) {
      this.markRuntimeStale(profile, reason);
    }
  }

  getRuntimeDiagnostic(profile?: string): RuntimeDiagnostic {
    const selectedProfile = normalizeProfile(profile);
    const state = this.stateFor(selectedProfile);
    const mode = this.getConnectionConfig().mode;
    const storedIdentity = state.lastIdentity;
    const modeMismatchReason = storedIdentity && storedIdentity.mode !== mode
      ? `Connection mode changed from ${storedIdentity.mode} to ${mode}; runtime identity must be revalidated.`
      : undefined;
    const identity = !modeMismatchReason && storedIdentity
      ? storedIdentity
      : createDiagnosticIdentity(this.identityContext(), selectedProfile, mode);
    return buildRuntimeDiagnostic({
      selectedProfile,
      state,
      mode,
      identity,
      modeMismatchReason,
    });
  }

  private stateFor(profile: string): RuntimeState {
    let state = this.states.get(profile);
    if (!state) {
      state = createInitialRuntimeState();
      this.states.set(profile, state);
    }
    return state;
  }

  private startHealthPolling(profile: string): void {
    const state = this.stateFor(profile);
    if (state.healthCheckInterval) return;
    state.healthCheckInterval = this.setIntervalFn(async () => {
      state.apiServerAvailable = await this.checkLocalApiReady(profile);
      if (state.apiServerAvailable && state.healthCheckInterval) {
        this.clearIntervalFn(state.healthCheckInterval);
        state.healthCheckInterval = null;
      }
    }, HEALTH_POLL_INTERVAL_MS);
  }

  private async checkLocalApiReady(profile: string): Promise<boolean> {
    return this.isApiServerReady(
      this.getLocalApiUrl(profile),
      localAuthHeaders({ readEnv: this.readEnv }, profile),
    );
  }

  private gatewayCommandArgs(profile: string): string[] {
    return gatewayCommandArgs({ hermesScript: this.hermesScript }, profile);
  }

  private pidFor(profile: string): number | undefined {
    return this.stateFor(profile).gatewayProcess?.pid ?? this.readPidFile(profile) ?? undefined;
  }

  private readPidFile(profile: string): number | null {
    const pidFile = this.pidFileFor(profile);
    if (!existsSync(pidFile)) return null;
    try {
      const raw = readFileSync(pidFile, "utf-8").trim();
      const parsed = raw.startsWith("{") ? JSON.parse(raw).pid : parseInt(raw, 10);
      return typeof parsed === "number" && !isNaN(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private localRuntimeContext(): Parameters<typeof resolveLocalApiRuntime>[0] {
    return {
      hermesScript: this.hermesScript,
      readEnv: this.readEnv,
      isApiServerReady: this.isApiServerReady,
      getLocalApiPort: this.getLocalApiPort,
      getLocalApiUrl: this.getLocalApiUrl,
      stateFor: (profile) => this.stateFor(profile),
      identityContext: this.identityContext(),
      pidFor: (profile) => this.pidFor(profile),
      homeFor: (profile) => this.homeFor(profile),
      configPathFor: (profile) => this.configPathFor(profile),
      now: this.now,
    };
  }

  private identityContext(): RuntimeIdentityContext {
    return {
      hermesScript: this.hermesScript,
      readEnv: this.readEnv,
      getConnectionConfig: this.getConnectionConfig,
      getLocalApiPort: this.getLocalApiPort,
      getLocalApiUrl: this.getLocalApiUrl,
      getSshTunnelUrl: this.getSshTunnelUrl,
      profileHome: this.profileHome,
      now: this.now,
      pidFor: (profile) => this.pidFor(profile),
      pidFileFor: (profile) => this.pidFileFor(profile),
      configPathFor: (profile) => this.configPathFor(profile),
    };
  }

  private pidFileFor(profile: string): string {
    return join(this.homeFor(profile), "gateway.pid");
  }

  private configPathFor(profile: string): string {
    return join(this.homeFor(profile), "config.yaml");
  }

  private homeFor(profile: string): string {
    return this.profileHome(profile);
  }
}

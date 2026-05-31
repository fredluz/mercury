import { randomUUID } from "crypto";
import { spawn as defaultSpawn } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  getConnectionConfig,
  readEnv,
  setEnvValue as defaultSetEnvValue,
} from "../../config";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "../../install/paths";
import { profileHome as defaultProfileHome } from "../../utils";
import { getSshTunnelUrl } from "../../ssh-tunnel";
import { sshVerifyProfileRuntime } from "../../ssh/runtime";
import {
  ensureApiServerConfig,
  getLocalApiPort,
  getLocalApiUrl,
  isApiServerReady,
  probeHermesCapabilities,
} from "../connection";
import type { RuntimeDiagnostic } from "../../../shared/runtime";
import type {
  ProfileRuntimeHandle,
  ProfileRuntimeRequest,
  RuntimeIdentity,
} from "../types";
import { ProfileRuntimeError } from "../types";
import {
  assertNoLocalPortConflict,
  gatewayCommandArgs,
  localAuthHeaders,
  resolveLocalApiRuntimeAttempt,
  type LocalApiRuntimeFailure,
} from "./local-runtime";
import { buildRuntimeDiagnostic } from "./diagnostics";
import {
  createDiagnosticIdentity,
  createLocalApiIdentity,
  createUnverifiedExternalIdentity,
  type RuntimeIdentityContext,
} from "./identity";
import { normalizeProfile } from "./profile";
import { createInitialRuntimeState, type RuntimeState } from "./state";
import { resolveSshApiRuntime } from "./ssh-runtime";

const HEALTH_POLL_INTERVAL_MS = 15_000;
const API_STARTUP_CHECK_DELAY_MS = 3_000;
const DEFAULT_API_STARTUP_TIMEOUT_MS = 12_000;
const DEFAULT_API_STARTUP_RETRY_INTERVAL_MS = 500;

type SpawnLike = typeof defaultSpawn;
type NormalizedRuntimeRequest = ProfileRuntimeRequest & {
  profile: string;
  mode: NonNullable<ProfileRuntimeRequest["mode"]>;
};

export interface ProfileRuntimeManagerDeps {
  baseHermesHome?: string;
  hermesPython?: string;
  hermesRepo?: string;
  hermesScript?: string;
  spawn?: SpawnLike;
  readEnv?: typeof readEnv;
  setEnvValue?: typeof defaultSetEnvValue;
  getConnectionConfig?: typeof getConnectionConfig;
  ensureApiServerConfig?: typeof ensureApiServerConfig;
  isApiServerReady?: typeof isApiServerReady;
  probeHermesCapabilities?: typeof probeHermesCapabilities;
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
  apiStartupTimeoutMs?: number;
  apiStartupRetryIntervalMs?: number;
}

export class ProfileRuntimeManager {
  private readonly baseHermesHome: string;
  private readonly hermesPython: string;
  private readonly hermesRepo: string;
  private readonly hermesScript: string;
  private readonly spawn: SpawnLike;
  private readonly readEnv: typeof readEnv;
  private readonly setEnvValue: typeof defaultSetEnvValue;
  private readonly canPersistGeneratedEnv: boolean;
  private readonly getConnectionConfig: typeof getConnectionConfig;
  private readonly ensureApiServerConfig: typeof ensureApiServerConfig;
  private readonly isApiServerReady: typeof isApiServerReady;
  private readonly probeHermesCapabilities: typeof probeHermesCapabilities;
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
  private readonly apiStartupTimeoutMs: number;
  private readonly apiStartupRetryIntervalMs: number;
  private readonly states = new Map<string, RuntimeState>();

  constructor(deps: ProfileRuntimeManagerDeps = {}) {
    this.baseHermesHome = deps.baseHermesHome ?? HERMES_HOME;
    this.hermesPython = deps.hermesPython ?? HERMES_PYTHON;
    this.hermesRepo = deps.hermesRepo ?? HERMES_REPO;
    this.hermesScript = deps.hermesScript ?? HERMES_SCRIPT;
    this.spawn = deps.spawn ?? defaultSpawn;
    this.readEnv = deps.readEnv ?? readEnv;
    this.setEnvValue = deps.setEnvValue ?? defaultSetEnvValue;
    this.canPersistGeneratedEnv = !deps.readEnv || Boolean(deps.setEnvValue);
    this.getConnectionConfig = deps.getConnectionConfig ?? getConnectionConfig;
    this.ensureApiServerConfig =
      deps.ensureApiServerConfig ?? ensureApiServerConfig;
    this.isApiServerReady = deps.isApiServerReady ?? isApiServerReady;
    this.probeHermesCapabilities =
      deps.probeHermesCapabilities ?? probeHermesCapabilities;
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
    this.apiStartupTimeoutMs =
      deps.apiStartupTimeoutMs ?? DEFAULT_API_STARTUP_TIMEOUT_MS;
    this.apiStartupRetryIntervalMs =
      deps.apiStartupRetryIntervalMs ?? DEFAULT_API_STARTUP_RETRY_INTERVAL_MS;
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
        probeHermesCapabilities: this.probeHermesCapabilities,
        setLastIdentity: (profile, identity) => {
          this.stateFor(profile).lastIdentity = identity;
        },
      });
    }

    if (mode === "remote") {
      const identity = createUnverifiedExternalIdentity(
        this.identityContext(),
        normalizedRequest,
      );
      throw new ProfileRuntimeError(
        "runtime-unsupported-remote-profile",
        "Pure remote HTTP runtimes must declare or verify their profile identity before execution.",
        identity,
      );
    }

    return this.resolveRequiredLocalApiRuntime(normalizedRequest);
  }

  ensureInitialized(profile?: string): void {
    const normalizedProfile = normalizeProfile(profile);
    this.ensureApiServerConfig(normalizedProfile);
    this.startHealthPolling(normalizedProfile);
  }

  startGateway(profile?: string): boolean {
    const normalizedProfile = normalizeProfile(profile);
    this.ensureInitialized(normalizedProfile);
    if (stateHasLiveChild(this.stateFor(normalizedProfile))) return false;
    if (this.isGatewayRunning(normalizedProfile)) {
      // A pid-file-only gateway may be an old Hermes process launched before
      // Mercury's current API contract. Refresh it instead of attaching to an
      // unknown/stale API surface.
      this.stopGateway(true, normalizedProfile);
    }
    assertNoLocalPortConflict(
      {
        ...this.localRuntimeContext(),
        profiles: () => this.states.keys(),
        isGatewayRunning: (profile) => this.isGatewayRunning(profile),
      },
      normalizedProfile,
    );

    const state = this.stateFor(normalizedProfile);
    const generatedApiServerKey = this.ensureLocalApiServerKey(normalizedProfile);
    const profileEnv = this.readEnv(normalizedProfile);
    const localApiPort = this.getLocalApiPort(normalizedProfile);
    const localApiHost = "127.0.0.1";
    const gatewayEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PATH: this.getEnhancedPath(),
      HOME: homedir(),
      HERMES_HOME: this.baseHermesHome,
    };

    for (const [key, value] of Object.entries(profileEnv)) {
      if (value) gatewayEnv[key] = value;
    }

    gatewayEnv.API_SERVER_ENABLED = "true";
    gatewayEnv.API_SERVER_HOST = localApiHost;
    gatewayEnv.API_SERVER_PORT = String(localApiPort);
    const apiServerKey = generatedApiServerKey ?? profileEnv.API_SERVER_KEY;
    if (apiServerKey) gatewayEnv.API_SERVER_KEY = apiServerKey;

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
    state.lastIdentity = createLocalApiIdentity(
      this.identityContext(),
      normalizedProfile,
      {
        pid: child.pid,
        startedByMercury: true,
        verified: false,
        verificationSource: "managed-process",
        command: args,
        mismatchReason:
          "Gateway process has started but API readiness has not been verified yet.",
      },
    );

    child.on("close", () => {
      state.gatewayProcess = null;
      state.gatewayStartedByApp = false;
      state.apiServerAvailable = false;
      this.startHealthPolling(normalizedProfile);
    });

    this.setTimeoutFn(async () => {
      state.apiServerAvailable =
        await this.checkLocalApiReady(normalizedProfile);
    }, API_STARTUP_CHECK_DELAY_MS);

    return true;
  }

  stopGateway(force = false, profile?: string): void {
    this.stopGatewayForProfile(normalizeProfile(profile), force);
  }

  stopAllGateways(): void {
    for (const profile of this.knownGatewayProfiles()) {
      this.stopGatewayForProfile(profile, true);
    }
  }

  private stopGatewayForProfile(profile: string, force: boolean): void {
    const state = this.stateFor(profile);
    if (!force && !state.gatewayStartedByApp) return;

    if (state.gatewayProcess && !state.gatewayProcess.killed) {
      state.gatewayProcess.kill("SIGTERM");
      state.gatewayProcess = null;
    }

    const pid = this.readPidFile(profile);
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already dead
      }
    }

    const pidFile = this.pidFileFor(profile);
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
    if (
      !this.stateFor(normalizedProfile).gatewayStartedByApp &&
      !this.isGatewayRunning(normalizedProfile)
    )
      return;
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
      (!state.lastIdentity?.verified ||
        state.lastIdentity.verifiedAt <= state.staleAt)
    ) {
      return;
    }
    state.staleReason = undefined;
    state.staleAt = undefined;
  }

  async revalidateRuntime(
    profile?: string,
    purpose: ProfileRuntimeRequest["purpose"] = "gateway",
  ): Promise<boolean> {
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
        handle.request.profile === normalizedProfile &&
        !handle.identity.capabilityProblem;
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
    const modeMismatchReason =
      storedIdentity && storedIdentity.mode !== mode
        ? `Connection mode changed from ${storedIdentity.mode} to ${mode}; runtime identity must be revalidated.`
        : undefined;
    const identity =
      !modeMismatchReason && storedIdentity
        ? storedIdentity
        : createDiagnosticIdentity(
            this.identityContext(),
            selectedProfile,
            mode,
          );
    return buildRuntimeDiagnostic({
      selectedProfile,
      state,
      mode,
      identity,
      modeMismatchReason,
    });
  }

  private async resolveRequiredLocalApiRuntime(
    request: NormalizedRuntimeRequest,
  ): Promise<ProfileRuntimeHandle> {
    const intervalMs = Math.max(0, this.apiStartupRetryIntervalMs);
    const timeoutMs = Math.max(0, this.apiStartupTimeoutMs);
    const maxAttempts =
      intervalMs === 0
        ? 1
        : Math.max(1, Math.floor(timeoutMs / intervalMs) + 1);
    let lastRetryableFailure: LocalApiRuntimeFailure | undefined;

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      const attempt = await resolveLocalApiRuntimeAttempt(
        this.localRuntimeContext(),
        request,
      );
      if (attempt.ok) return attempt.handle;

      if (!attempt.failure.retryable) {
        throw new ProfileRuntimeError(
          attempt.failure.code,
          attempt.failure.message,
          attempt.failure.identity,
        );
      }

      lastRetryableFailure = attempt.failure;
      if (attemptIndex < maxAttempts - 1) await this.sleep(intervalMs);
    }

    const failure = lastRetryableFailure;
    throw new ProfileRuntimeError(
      "runtime-unavailable",
      `Local API runtime for profile ${request.profile} did not become ready within ${timeoutMs}ms.`,
      failure?.identity,
    );
  }

  private sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.setTimeoutFn(() => resolve(), ms);
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
    return (
      this.stateFor(profile).gatewayProcess?.pid ??
      this.readPidFile(profile) ??
      undefined
    );
  }

  private readPidFile(profile: string): number | null {
    const pidFile = this.pidFileFor(profile);
    if (!existsSync(pidFile)) return null;
    try {
      const raw = readFileSync(pidFile, "utf-8").trim();
      const parsed = raw.startsWith("{")
        ? JSON.parse(raw).pid
        : parseInt(raw, 10);
      return typeof parsed === "number" && !isNaN(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private ensureLocalApiServerKey(profile: string): string | undefined {
    const existing = this.readEnv(profile).API_SERVER_KEY;
    if (existing) return existing;
    if (!this.canPersistGeneratedEnv) return undefined;

    const key = `mercury_${randomUUID().replace(/-/g, "")}`;
    this.setEnvValue("API_SERVER_KEY", key, profile);
    return key;
  }

  private knownGatewayProfiles(): string[] {
    const profiles = new Set<string>(this.states.keys());
    if (existsSync(this.pidFileFor("default"))) profiles.add("default");

    const profilesDir = join(this.baseHermesHome, "profiles");
    try {
      for (const entry of readdirSync(profilesDir)) {
        const profileDir = join(profilesDir, entry);
        if (!statSync(profileDir).isDirectory()) continue;
        if (existsSync(join(profileDir, "gateway.pid"))) {
          profiles.add(normalizeProfile(entry));
        }
      }
    } catch {
      // Missing or unreadable profiles directory is fine.
    }

    return [...profiles];
  }

  private localRuntimeContext(): Parameters<
    typeof resolveLocalApiRuntimeAttempt
  >[0] {
    return {
      hermesScript: this.hermesScript,
      readEnv: this.readEnv,
      isApiServerReady: this.isApiServerReady,
      probeHermesCapabilities: this.probeHermesCapabilities,
      getLocalApiPort: this.getLocalApiPort,
      getLocalApiUrl: this.getLocalApiUrl,
      stateFor: (profile) => this.stateFor(profile),
      identityContext: this.identityContext(),
      pidFor: (profile) => this.pidFor(profile),
      pidFileFor: (profile) => this.pidFileFor(profile),
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

function stateHasLiveChild(state: RuntimeState): boolean {
  return Boolean(state.gatewayProcess && !state.gatewayProcess.killed);
}

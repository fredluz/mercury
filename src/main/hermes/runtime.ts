import { ChildProcess, spawn as defaultSpawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { readEnv, getConnectionConfig } from "../config";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "../install/paths";
import { profileHome as defaultProfileHome } from "../utils";
import { getSshTunnelUrl } from "../ssh-tunnel";
import {
  sshVerifyProfileRuntime,
  type SshRuntimeVerificationEvidence,
} from "../ssh/runtime";
import {
  defaultLocalApiPortForProfile as selectDefaultLocalApiPortForProfile,
  ensureApiServerConfig,
  getLocalApiPort,
  getLocalApiUrl,
  getRemoteAuthHeader,
  isApiServerReady,
} from "./connection";
import type { RuntimeDiagnostic, RuntimeDiagnosticStatus } from "../../shared/runtime";
import type {
  ProfileRuntimeHandle,
  ProfileRuntimeRequest,
  RuntimeIdentity,
  RuntimeMode,
} from "./types";
import { ProfileRuntimeError } from "./types";

const HEALTH_POLL_INTERVAL_MS = 15_000;
const API_STARTUP_CHECK_DELAY_MS = 3_000;

type SpawnLike = typeof defaultSpawn;

type TimerLike = ReturnType<typeof setInterval>;

type RuntimeState = {
  gatewayProcess: ChildProcess | null;
  gatewayStartedByApp: boolean;
  apiServerAvailable: boolean | null;
  healthCheckInterval: TimerLike | null;
  managedApiHost?: string;
  managedApiPort?: number;
  gatewayCommand?: string[];
  lastIdentity?: RuntimeIdentity;
  staleReason?: string;
  staleAt?: number;
};

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

function normalizeProfile(profile?: string): string {
  const trimmed = profile?.trim();
  return trimmed && trimmed !== "default" ? trimmed : "default";
}

function isNamedProfile(profile: string): boolean {
  return profile !== "default";
}

function fingerprintSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  const digest = createHash("sha256").update(secret).digest("hex").slice(0, 12);
  return `sha256:${digest}`;
}

export { defaultLocalApiPortForProfile } from "./connection";

export function buildHermesProfileCommandArgs(
  hermesScript: string,
  profile: string | undefined,
  commandArgs: string[],
): string[] {
  const normalizedProfile = normalizeProfile(profile);
  const args = [hermesScript];
  if (isNamedProfile(normalizedProfile)) {
    args.push("-p", normalizedProfile);
  }
  args.push(...commandArgs);
  return args;
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
      return this.resolveSshApiRuntime(normalizedRequest);
    }

    if (mode === "remote") {
      const identity = this.createUnverifiedExternalIdentity(normalizedRequest);
      throw new ProfileRuntimeError(
        "runtime-unsupported-remote-profile",
        "Pure remote HTTP runtimes must declare or verify their profile identity before execution.",
        identity,
      );
    }

    if (request.preferTransport === "cli") {
      return this.createCliRuntimeHandle(normalizedRequest);
    }

    if (request.preferTransport === "api" || request.purpose === "gateway") {
      const apiHandle = await this.resolveLocalApiRuntime(normalizedRequest, {
        requireReady: request.purpose !== "gateway",
      });
      if (apiHandle) return apiHandle;
      if (request.purpose === "gateway") {
        throw new ProfileRuntimeError(
          "runtime-unavailable",
          `Local gateway runtime for profile ${profile} is not ready.`,
        );
      }
    }

    const apiHandle = await this.resolveLocalApiRuntime(normalizedRequest, {
      requireReady: true,
    });
    return apiHandle ?? this.createCliRuntimeHandle(normalizedRequest);
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
    this.assertNoLocalPortConflict(normalizedProfile);

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
    state.lastIdentity = this.createLocalApiIdentity(normalizedProfile, {
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
      : this.createDiagnosticIdentity(selectedProfile, mode);
    const stale = Boolean(state.staleReason || modeMismatchReason);
    const profileMismatch = Boolean(
      identity.actualProfile && identity.actualProfile !== identity.requestedProfile,
    );
    const unsupported = mode === "remote" || Boolean(identity.mismatchReason?.includes("unsupported"));
    const status: RuntimeDiagnosticStatus = stale
      ? "stale"
      : unsupported
        ? "unsupported"
        : profileMismatch
          ? "mismatch"
          : identity.verified
            ? "verified"
            : "unverified";

    return {
      selectedProfile,
      requestedProfile: identity.requestedProfile,
      actualProfile: identity.actualProfile,
      verified: identity.verified && !stale && !profileMismatch && !unsupported,
      verificationSource: identity.verificationSource,
      mode: identity.mode,
      transport: identity.transport,
      status,
      apiBaseUrl: identity.apiBaseUrl,
      localPort: identity.localPort,
      remotePort: identity.remotePort,
      pid: identity.pid,
      pidFile: identity.pidFile,
      logDir: identity.logDir,
      hermesHome: identity.hermesHome,
      configPath: identity.configPath,
      authKeyFingerprint: identity.authKeyFingerprint,
      authSource: this.authSourceFor(identity),
      startedByMercury: identity.startedByMercury,
      verifiedAt: identity.verifiedAt,
      stale,
      staleReason: state.staleReason ?? modeMismatchReason,
      staleAt: state.staleAt,
      mismatchReason: stale ? state.staleReason ?? modeMismatchReason : identity.mismatchReason,
      unsupportedReason: unsupported ? identity.mismatchReason ?? "Remote runtime identity is not verified." : undefined,
      capabilities: identity.capabilities,
      command: identity.command,
    };
  }

  private stateFor(profile: string): RuntimeState {
    let state = this.states.get(profile);
    if (!state) {
      state = {
        gatewayProcess: null,
        gatewayStartedByApp: false,
        apiServerAvailable: null,
        healthCheckInterval: null,
      };
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

  private async resolveLocalApiRuntime(
    request: ProfileRuntimeRequest & { profile: string; mode: RuntimeMode },
    options: { requireReady: boolean },
  ): Promise<ProfileRuntimeHandle | null> {
    const state = this.stateFor(request.profile);
    if (state.staleReason) return null;
    const hasManagedProcessEvidence = this.hasManagedProcessEvidence(request.profile);
    const allowLegacyDefaultProbe = request.profile === "default";
    if (!hasManagedProcessEvidence && !allowLegacyDefaultProbe) {
      state.apiServerAvailable = false;
      return null;
    }

    if (state.apiServerAvailable !== true || options.requireReady) {
      state.apiServerAvailable = await this.checkLocalApiReady(request.profile);
    }

    if (options.requireReady && !state.apiServerAvailable) return null;
    if (state.apiServerAvailable !== true) return null;

    const identity = this.createLocalApiIdentity(request.profile, {
      pid: this.pidFor(request.profile),
      startedByMercury: hasManagedProcessEvidence,
      verified: true,
      verificationSource: "managed-process",
      command: state.gatewayCommand ?? state.lastIdentity?.command ?? this.gatewayCommandArgs(request.profile),
    });
    state.lastIdentity = identity;

    return {
      request,
      identity,
      transport: "api",
      apiBaseUrl: identity.apiBaseUrl,
      authHeaders: this.localAuthHeaders(request.profile),
    };
  }

  private createCliRuntimeHandle(
    request: ProfileRuntimeRequest & { profile: string; mode: RuntimeMode },
  ): ProfileRuntimeHandle {
    const command = buildHermesProfileCommandArgs(this.hermesScript, request.profile, [
      request.purpose,
    ]);
    const identity: RuntimeIdentity = {
      requestedProfile: request.profile,
      actualProfile: request.profile,
      verified: true,
      verificationSource: "cli-args",
      mode: "local",
      transport: "cli",
      hermesHome: this.homeFor(request.profile),
      configPath: this.configPathFor(request.profile),
      startedByMercury: false,
      verifiedAt: this.now(),
      command,
      capabilities: { profileArgument: isNamedProfile(request.profile) },
    };
    return {
      request,
      identity,
      transport: "cli",
      cliCommand: command,
    };
  }

  private createLocalApiIdentity(
    profile: string,
    evidence: {
      pid?: number;
      startedByMercury: boolean;
      verified: boolean;
      verificationSource: RuntimeIdentity["verificationSource"];
      command?: string[];
      mismatchReason?: string;
    },
  ): RuntimeIdentity {
    const apiBaseUrl = this.getLocalApiUrl(profile);
    const apiKey = this.readEnv(profile).API_SERVER_KEY;
    return {
      requestedProfile: profile,
      actualProfile: evidence.verified ? profile : null,
      verified: evidence.verified,
      verificationSource: evidence.verificationSource,
      mode: "local",
      transport: "api",
      apiBaseUrl,
      localPort: this.getLocalApiPort(profile),
      pid: evidence.pid,
      pidFile: this.pidFileFor(profile),
      logDir: this.homeFor(profile),
      hermesHome: this.homeFor(profile),
      configPath: this.configPathFor(profile),
      authKeyFingerprint: fingerprintSecret(apiKey),
      startedByMercury: evidence.startedByMercury,
      verifiedAt: this.now(),
      command: evidence.command,
      mismatchReason: evidence.mismatchReason,
      capabilities: {
        managedByMercury: evidence.startedByMercury,
        profileBoundApi: evidence.startedByMercury,
        forcedApiPort: evidence.startedByMercury,
      },
    };
  }

  private async resolveSshApiRuntime(
    request: ProfileRuntimeRequest & { profile: string; mode: RuntimeMode },
  ): Promise<ProfileRuntimeHandle> {
    const conn = this.getConnectionConfig();
    if (
      isNamedProfile(request.profile) &&
      conn.ssh.remotePort === selectDefaultLocalApiPortForProfile("default")
    ) {
      const identity = this.createUnverifiedExternalIdentity(request);
      identity.remotePort = conn.ssh.remotePort;
      identity.mismatchReason = `Named SSH profile ${request.profile} cannot be verified through the default remote API port ${conn.ssh.remotePort}. Configure a profile-specific SSH remote port.`;
      throw new ProfileRuntimeError(
        "runtime-profile-unverified",
        identity.mismatchReason,
        identity,
      );
    }
    const apiBaseUrl = this.getSshTunnelUrl(request.profile, conn.ssh);
    if (!apiBaseUrl) {
      const identity = this.createUnverifiedExternalIdentity(request);
      throw new ProfileRuntimeError(
        "runtime-profile-unverified",
        `SSH tunnel is not verified for profile ${request.profile}.`,
        identity,
      );
    }

    const evidence = await this.verifySshRuntime(
      conn.ssh,
      request.profile,
      conn.ssh.remotePort,
    );
    if (!evidence.verified) {
      const identity = this.createSshIdentity(request, apiBaseUrl, evidence, false);
      identity.mismatchReason = evidence.reason ??
        `SSH runtime identity is unverified for profile ${request.profile}.`;
      this.stateFor(request.profile).lastIdentity = identity;
      throw new ProfileRuntimeError(
        "runtime-profile-unverified",
        identity.mismatchReason,
        identity,
      );
    }

    const authHeaders = getRemoteAuthHeader(request.profile);
    const apiKey = authHeaders.Authorization?.replace(/^Bearer\s+/i, "");
    const identity = this.createSshIdentity(request, apiBaseUrl, evidence, true, apiKey);
    this.stateFor(request.profile).lastIdentity = identity;
    return {
      request,
      identity,
      transport: "ssh-api",
      apiBaseUrl,
      authHeaders,
    };
  }

  private createSshIdentity(
    request: ProfileRuntimeRequest & { profile: string; mode: RuntimeMode },
    apiBaseUrl: string,
    evidence: SshRuntimeVerificationEvidence,
    verified: boolean,
    apiKey?: string,
  ): RuntimeIdentity {
    const conn = this.getConnectionConfig();
    return {
      requestedProfile: request.profile,
      actualProfile: verified ? request.profile : null,
      verified,
      verificationSource: verified ? "managed-process" : "unverified",
      mode: "ssh",
      transport: "ssh-api",
      apiBaseUrl,
      remotePort: conn.ssh.remotePort,
      localPort: conn.ssh.localPort,
      pidFile: evidence.pidFile,
      hermesHome: evidence.hermesHome,
      configPath: evidence.configPath,
      authKeyFingerprint: fingerprintSecret(apiKey),
      startedByMercury: verified,
      verifiedAt: this.now(),
      mismatchReason: evidence.reason,
      capabilities: {
        profileBoundApi: verified,
        sshTunnelProfileBound: true,
        remoteConfigPortVerified: evidence.configuredPort === conn.ssh.remotePort,
        remoteGatewayStatusVerified: verified,
      },
    };
  }

  private createDiagnosticIdentity(profile: string, mode: RuntimeMode): RuntimeIdentity {
    if (mode === "local") {
      const apiKey = this.readEnv(profile).API_SERVER_KEY;
      return {
        requestedProfile: profile,
        actualProfile: null,
        verified: false,
        verificationSource: "unverified",
        mode,
        transport: "api",
        apiBaseUrl: this.getLocalApiUrl(profile),
        localPort: this.getLocalApiPort(profile),
        pid: this.pidFor(profile),
        pidFile: this.pidFileFor(profile),
        logDir: this.homeFor(profile),
        hermesHome: this.homeFor(profile),
        configPath: this.configPathFor(profile),
        authKeyFingerprint: fingerprintSecret(apiKey),
        startedByMercury: false,
        verifiedAt: this.now(),
        mismatchReason: "Local runtime identity has not been verified yet.",
      };
    }

    const request = { profile, mode, purpose: "chat" as const };
    const identity = this.createUnverifiedExternalIdentity(request);
    const conn = this.getConnectionConfig();
    if (mode === "ssh") {
      identity.apiBaseUrl = this.getSshTunnelUrl(profile, conn.ssh) ?? undefined;
      identity.localPort = conn.ssh.localPort;
      identity.remotePort = conn.ssh.remotePort;
      identity.hermesHome = this.homeFor(profile);
      identity.configPath = this.configPathFor(profile);
    } else if (mode === "remote") {
      identity.apiBaseUrl = conn.remoteUrl || undefined;
      identity.authKeyFingerprint = fingerprintSecret(conn.apiKey);
    }
    return identity;
  }

  private authSourceFor(identity: RuntimeIdentity): RuntimeDiagnostic["authSource"] {
    if (!identity.authKeyFingerprint) return "none";
    if (identity.mode === "ssh") return "remote-env";
    if (identity.mode === "remote") return "connection-config";
    return "profile-env";
  }

  private createUnverifiedExternalIdentity(
    request: ProfileRuntimeRequest & { profile: string; mode: RuntimeMode },
  ): RuntimeIdentity {
    const transport = request.mode === "ssh" ? "ssh-api" : "remote-api";
    return {
      requestedProfile: request.profile,
      actualProfile: null,
      verified: false,
      verificationSource: "unverified",
      mode: request.mode,
      transport,
      startedByMercury: false,
      verifiedAt: this.now(),
      mismatchReason: `${request.mode} runtime identity is unverified for profile-isolated execution.`,
    };
  }

  private assertNoLocalPortConflict(profile: string): void {
    const port = this.getLocalApiPort(profile);
    if (
      isNamedProfile(profile) &&
      port === selectDefaultLocalApiPortForProfile("default")
    ) {
      throw new ProfileRuntimeError(
        "runtime-port-conflict",
        `Named profile ${profile} cannot use the default Hermes API port ${port}; configure a profile-specific API port.`,
        {
          requestedProfile: profile,
          actualProfile: null,
          verified: false,
          verificationSource: "unverified",
          mode: "local",
          transport: "api",
          apiBaseUrl: this.getLocalApiUrl(profile),
          localPort: port,
          hermesHome: this.homeFor(profile),
          configPath: this.configPathFor(profile),
          startedByMercury: false,
          verifiedAt: this.now(),
          mismatchReason: `Port ${port} is reserved for the default profile and cannot prove named profile ${profile}.`,
        },
      );
    }
    for (const [otherProfile] of this.states.entries()) {
      if (otherProfile === profile) continue;
      if (!this.isGatewayRunning(otherProfile)) continue;
      if (this.getLocalApiPort(otherProfile) !== port) continue;
      throw new ProfileRuntimeError(
        "runtime-port-conflict",
        `Local Hermes API port ${port} is already owned by profile ${otherProfile}; cannot start profile ${profile}.`,
        {
          requestedProfile: profile,
          actualProfile: otherProfile,
          verified: false,
          verificationSource: "managed-process",
          mode: "local",
          transport: "api",
          apiBaseUrl: this.getLocalApiUrl(profile),
          localPort: port,
          hermesHome: this.homeFor(profile),
          configPath: this.configPathFor(profile),
          startedByMercury: false,
          verifiedAt: this.now(),
          mismatchReason: `Port ${port} is already associated with profile ${otherProfile}.`,
        },
      );
    }
  }

  private async checkLocalApiReady(profile: string): Promise<boolean> {
    return this.isApiServerReady(this.getLocalApiUrl(profile), this.localAuthHeaders(profile));
  }

  private localAuthHeaders(profile: string): Record<string, string> {
    const apiKey = this.readEnv(profile).API_SERVER_KEY;
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  }

  private gatewayCommandArgs(profile: string): string[] {
    return buildHermesProfileCommandArgs(this.hermesScript, profile, ["gateway"]);
  }

  private hasManagedProcessEvidence(profile: string): boolean {
    const state = this.stateFor(profile);
    const expectedPort = this.getLocalApiPort(profile);
    const expectedCommand = this.gatewayCommandArgs(profile);
    return Boolean(
      state.gatewayStartedByApp &&
        state.gatewayProcess &&
        !state.gatewayProcess.killed &&
        state.managedApiHost === "127.0.0.1" &&
        state.managedApiPort === expectedPort &&
        JSON.stringify(state.gatewayCommand) === JSON.stringify(expectedCommand),
    );
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

export const profileRuntimeManager = new ProfileRuntimeManager();

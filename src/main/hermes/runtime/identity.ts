import type { getConnectionConfig, readEnv } from "../../config";
import type { profileHome as defaultProfileHome } from "../../utils";
import type { SshRuntimeVerificationEvidence } from "../../ssh/runtime";
import type { RuntimeDiagnostic } from "../../../shared/runtime";
import type {
  ProfileRuntimeRequest,
  RuntimeIdentity,
  RuntimeMode,
} from "../types";
import { fingerprintSecret } from "./profile";

export interface RuntimeIdentityContext {
  hermesScript: string;
  readEnv: typeof readEnv;
  getConnectionConfig: typeof getConnectionConfig;
  getLocalApiPort: (profile?: string) => number;
  getLocalApiUrl: (profile?: string) => string;
  getSshTunnelUrl: (profile: string | undefined, ssh: ReturnType<typeof getConnectionConfig>["ssh"]) => string | null;
  profileHome: typeof defaultProfileHome;
  now: () => number;
  pidFor: (profile: string) => number | undefined;
  pidFileFor: (profile: string) => string;
  configPathFor: (profile: string) => string;
}

type NormalizedRuntimeRequest = ProfileRuntimeRequest & { profile: string; mode: RuntimeMode };

export function createLocalApiIdentity(
  ctx: RuntimeIdentityContext,
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
  const apiBaseUrl = ctx.getLocalApiUrl(profile);
  const apiKey = ctx.readEnv(profile).API_SERVER_KEY;
  return {
    requestedProfile: profile,
    actualProfile: evidence.verified ? profile : null,
    verified: evidence.verified,
    verificationSource: evidence.verificationSource,
    mode: "local",
    transport: "api",
    apiBaseUrl,
    localPort: ctx.getLocalApiPort(profile),
    pid: evidence.pid,
    pidFile: ctx.pidFileFor(profile),
    logDir: homeFor(ctx, profile),
    hermesHome: homeFor(ctx, profile),
    configPath: ctx.configPathFor(profile),
    authKeyFingerprint: fingerprintSecret(apiKey),
    startedByMercury: evidence.startedByMercury,
    verifiedAt: ctx.now(),
    command: evidence.command,
    mismatchReason: evidence.mismatchReason,
    capabilities: {
      managedByMercury: evidence.startedByMercury,
      profileBoundApi: evidence.startedByMercury,
      forcedApiPort: evidence.startedByMercury,
    },
  };
}

export function createSshIdentity(
  ctx: RuntimeIdentityContext,
  request: NormalizedRuntimeRequest,
  apiBaseUrl: string,
  evidence: SshRuntimeVerificationEvidence,
  verified: boolean,
  apiKey?: string,
): RuntimeIdentity {
  const conn = ctx.getConnectionConfig();
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
    verifiedAt: ctx.now(),
    mismatchReason: evidence.reason,
    capabilities: {
      profileBoundApi: verified,
      sshTunnelProfileBound: true,
      remoteConfigPortVerified: evidence.configuredPort === conn.ssh.remotePort,
      remoteGatewayStatusVerified: verified,
    },
  };
}

export function createDiagnosticIdentity(
  ctx: RuntimeIdentityContext,
  profile: string,
  mode: RuntimeMode,
): RuntimeIdentity {
  if (mode === "local") {
    const apiKey = ctx.readEnv(profile).API_SERVER_KEY;
    return {
      requestedProfile: profile,
      actualProfile: null,
      verified: false,
      verificationSource: "unverified",
      mode,
      transport: "api",
      apiBaseUrl: ctx.getLocalApiUrl(profile),
      localPort: ctx.getLocalApiPort(profile),
      pid: ctx.pidFor(profile),
      pidFile: ctx.pidFileFor(profile),
      logDir: homeFor(ctx, profile),
      hermesHome: homeFor(ctx, profile),
      configPath: ctx.configPathFor(profile),
      authKeyFingerprint: fingerprintSecret(apiKey),
      startedByMercury: false,
      verifiedAt: ctx.now(),
      mismatchReason: "Local runtime identity has not been verified yet.",
    };
  }

  const request = { profile, mode, purpose: "chat" as const };
  const identity = createUnverifiedExternalIdentity(ctx, request);
  const conn = ctx.getConnectionConfig();
  if (mode === "ssh") {
    identity.apiBaseUrl = ctx.getSshTunnelUrl(profile, conn.ssh) ?? undefined;
    identity.localPort = conn.ssh.localPort;
    identity.remotePort = conn.ssh.remotePort;
    identity.hermesHome = homeFor(ctx, profile);
    identity.configPath = ctx.configPathFor(profile);
  } else if (mode === "remote") {
    identity.apiBaseUrl = conn.remoteUrl || undefined;
    identity.authKeyFingerprint = fingerprintSecret(conn.apiKey);
  }
  return identity;
}

export function authSourceFor(identity: RuntimeIdentity): RuntimeDiagnostic["authSource"] {
  if (!identity.authKeyFingerprint) return "none";
  if (identity.mode === "ssh") return "remote-env";
  if (identity.mode === "remote") return "connection-config";
  return "profile-env";
}

export function createUnverifiedExternalIdentity(
  ctx: RuntimeIdentityContext,
  request: NormalizedRuntimeRequest,
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
    verifiedAt: ctx.now(),
    mismatchReason: `${request.mode} runtime identity is unverified for profile-isolated execution.`,
  };
}

function homeFor(ctx: RuntimeIdentityContext, profile: string): string {
  return ctx.profileHome(profile);
}

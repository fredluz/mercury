import { defaultLocalApiPortForProfile as selectDefaultLocalApiPortForProfile } from "../connection";
import type { isApiServerReady } from "../connection";
import type { readEnv } from "../../config";
import type { ProfileRuntimeHandle, ProfileRuntimeRequest, RuntimeMode } from "../types";
import { ProfileRuntimeError } from "../types";
import { buildHermesProfileCommandArgs } from "./command";
import { createLocalApiIdentity, type RuntimeIdentityContext } from "./identity";
import { isNamedProfile } from "./profile";
import type { RuntimeState } from "./state";

type NormalizedRuntimeRequest = ProfileRuntimeRequest & { profile: string; mode: RuntimeMode };

interface LocalRuntimeContext {
  hermesScript: string;
  readEnv: typeof readEnv;
  isApiServerReady: typeof isApiServerReady;
  getLocalApiPort: (profile?: string) => number;
  getLocalApiUrl: (profile?: string) => string;
  stateFor: (profile: string) => RuntimeState;
  identityContext: RuntimeIdentityContext;
  pidFor: (profile: string) => number | undefined;
  homeFor: (profile: string) => string;
  configPathFor: (profile: string) => string;
  now: () => number;
}

export async function resolveLocalApiRuntime(
  ctx: LocalRuntimeContext,
  request: NormalizedRuntimeRequest,
  options: { requireReady: boolean },
): Promise<ProfileRuntimeHandle | null> {
  const state = ctx.stateFor(request.profile);
  if (state.staleReason) return null;
  const managedProcessEvidence = hasManagedProcessEvidence(ctx, request.profile);
  const allowLegacyDefaultProbe = request.profile === "default";
  if (!managedProcessEvidence && !allowLegacyDefaultProbe) {
    state.apiServerAvailable = false;
    return null;
  }

  if (state.apiServerAvailable !== true || options.requireReady) {
    state.apiServerAvailable = await checkLocalApiReady(ctx, request.profile);
  }

  if (options.requireReady && !state.apiServerAvailable) return null;
  if (state.apiServerAvailable !== true) return null;

  const identity = createLocalApiIdentity(ctx.identityContext, request.profile, {
    pid: ctx.pidFor(request.profile),
    startedByMercury: managedProcessEvidence,
    verified: true,
    verificationSource: "managed-process",
    command: state.gatewayCommand ?? state.lastIdentity?.command ?? gatewayCommandArgs(ctx, request.profile),
  });
  state.lastIdentity = identity;

  return {
    request,
    identity,
    transport: "api",
    apiBaseUrl: identity.apiBaseUrl,
    authHeaders: localAuthHeaders(ctx, request.profile),
  };
}

export function assertNoLocalPortConflict(
  ctx: LocalRuntimeContext & {
    profiles: () => IterableIterator<string>;
    isGatewayRunning: (profile?: string) => boolean;
  },
  profile: string,
): void {
  const port = ctx.getLocalApiPort(profile);
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
        apiBaseUrl: ctx.getLocalApiUrl(profile),
        localPort: port,
        hermesHome: ctx.homeFor(profile),
        configPath: ctx.configPathFor(profile),
        startedByMercury: false,
        verifiedAt: ctx.now(),
        mismatchReason: `Port ${port} is reserved for the default profile and cannot prove named profile ${profile}.`,
      },
    );
  }
  for (const otherProfile of ctx.profiles()) {
    if (otherProfile === profile) continue;
    if (!ctx.isGatewayRunning(otherProfile)) continue;
    if (ctx.getLocalApiPort(otherProfile) !== port) continue;
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
        apiBaseUrl: ctx.getLocalApiUrl(profile),
        localPort: port,
        hermesHome: ctx.homeFor(profile),
        configPath: ctx.configPathFor(profile),
        startedByMercury: false,
        verifiedAt: ctx.now(),
        mismatchReason: `Port ${port} is already associated with profile ${otherProfile}.`,
      },
    );
  }
}

export function localAuthHeaders(ctx: Pick<LocalRuntimeContext, "readEnv">, profile: string): Record<string, string> {
  const apiKey = ctx.readEnv(profile).API_SERVER_KEY;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function gatewayCommandArgs(ctx: Pick<LocalRuntimeContext, "hermesScript">, profile: string): string[] {
  return buildHermesProfileCommandArgs(ctx.hermesScript, profile, ["gateway"]);
}

function hasManagedProcessEvidence(ctx: LocalRuntimeContext, profile: string): boolean {
  const state = ctx.stateFor(profile);
  const expectedPort = ctx.getLocalApiPort(profile);
  const expectedCommand = gatewayCommandArgs(ctx, profile);
  return Boolean(
    state.gatewayStartedByApp &&
      state.gatewayProcess &&
      !state.gatewayProcess.killed &&
      state.managedApiHost === "127.0.0.1" &&
      state.managedApiPort === expectedPort &&
      JSON.stringify(state.gatewayCommand) === JSON.stringify(expectedCommand),
  );
}

function checkLocalApiReady(ctx: LocalRuntimeContext, profile: string): Promise<boolean> {
  return ctx.isApiServerReady(ctx.getLocalApiUrl(profile), localAuthHeaders(ctx, profile));
}

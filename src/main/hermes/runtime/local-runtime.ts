import { existsSync, readFileSync } from "fs";
import { defaultLocalApiPortForProfile as selectDefaultLocalApiPortForProfile } from "../connection";
import type { isApiServerReady } from "../connection";
import type { readEnv } from "../../config";
import type {
  ProfileRuntimeHandle,
  ProfileRuntimeRequest,
  RuntimeMode,
} from "../types";
import { ProfileRuntimeError } from "../types";
import { buildHermesProfileCommandArgs } from "./command";
import {
  createLocalApiIdentity,
  type RuntimeIdentityContext,
} from "./identity";
import { isNamedProfile } from "./profile";
import type { RuntimeState } from "./state";

type NormalizedRuntimeRequest = ProfileRuntimeRequest & {
  profile: string;
  mode: RuntimeMode;
};

interface LocalRuntimeContext {
  hermesScript: string;
  readEnv: typeof readEnv;
  isApiServerReady: typeof isApiServerReady;
  getLocalApiPort: (profile?: string) => number;
  getLocalApiUrl: (profile?: string) => string;
  stateFor: (profile: string) => RuntimeState;
  identityContext: RuntimeIdentityContext;
  pidFor: (profile: string) => number | undefined;
  pidFileFor: (profile: string) => string;
  homeFor: (profile: string) => string;
  configPathFor: (profile: string) => string;
  now: () => number;
}

export type LocalApiRuntimeFailureReason = "stale" | "unmanaged" | "not-ready";

export interface LocalApiRuntimeFailure {
  reason: LocalApiRuntimeFailureReason;
  retryable: boolean;
  code:
    | "runtime-stale-after-profile-switch"
    | "runtime-profile-unverified"
    | "runtime-unavailable";
  message: string;
  identity: ProfileRuntimeHandle["identity"];
}

export type LocalApiRuntimeAttempt =
  | { ok: true; handle: ProfileRuntimeHandle }
  | { ok: false; failure: LocalApiRuntimeFailure };

export async function resolveLocalApiRuntimeAttempt(
  ctx: LocalRuntimeContext,
  request: NormalizedRuntimeRequest,
): Promise<LocalApiRuntimeAttempt> {
  const state = ctx.stateFor(request.profile);
  if (state.staleReason) {
    const identity =
      state.lastIdentity ??
      createLocalApiIdentity(ctx.identityContext, request.profile, {
        pid: ctx.pidFor(request.profile),
        startedByMercury: false,
        verified: false,
        verificationSource: "unverified",
        mismatchReason: state.staleReason,
      });
    return {
      ok: false,
      failure: {
        reason: "stale",
        retryable: false,
        code: "runtime-stale-after-profile-switch",
        message: `Local API runtime for profile ${request.profile} is stale: ${state.staleReason}`,
        identity: {
          ...identity,
          verified: false,
          actualProfile: null,
          mismatchReason: state.staleReason,
        },
      },
    };
  }

  const managedProcessEvidence = inspectManagedProcessEvidence(
    ctx,
    request.profile,
  );
  if (managedProcessEvidence.status === "pending") {
    state.apiServerAvailable = false;
    const identity = createLocalApiIdentity(
      ctx.identityContext,
      request.profile,
      {
        pid: ctx.pidFor(request.profile),
        startedByMercury: true,
        verified: false,
        verificationSource: "managed-process",
        command:
          state.gatewayCommand ??
          state.lastIdentity?.command ??
          gatewayCommandArgs(ctx, request.profile),
        mismatchReason: managedProcessEvidence.mismatchReason,
      },
    );
    state.lastIdentity = identity;
    return {
      ok: false,
      failure: {
        reason: "not-ready",
        retryable: true,
        code: "runtime-unavailable",
        message: `Local API runtime for profile ${request.profile} is not ready yet.`,
        identity,
      },
    };
  }
  if (managedProcessEvidence.status === "unmanaged") {
    state.apiServerAvailable = false;
    const identity = createLocalApiIdentity(
      ctx.identityContext,
      request.profile,
      {
        pid: ctx.pidFor(request.profile),
        startedByMercury: false,
        verified: false,
        verificationSource: "unverified",
        command: state.gatewayCommand,
        mismatchReason: `Mercury cannot prove the local API belongs to profile ${request.profile}; start or restart the gateway from Mercury before running ${request.purpose}.`,
      },
    );
    state.lastIdentity = identity;
    return {
      ok: false,
      failure: {
        reason: "unmanaged",
        retryable: false,
        code: "runtime-profile-unverified",
        message: `Mercury cannot prove the local API belongs to profile ${request.profile}; start or restart the selected Agent gateway from Mercury and try again.`,
        identity,
      },
    };
  }

  state.apiServerAvailable = await checkLocalApiReady(ctx, request.profile);
  if (!state.apiServerAvailable) {
    const identity = createLocalApiIdentity(
      ctx.identityContext,
      request.profile,
      {
        pid: ctx.pidFor(request.profile),
        startedByMercury: true,
        verified: false,
        verificationSource: "managed-process",
        command:
          state.gatewayCommand ??
          state.lastIdentity?.command ??
          gatewayCommandArgs(ctx, request.profile),
        mismatchReason:
          "Gateway process is managed by Mercury but the API is not ready yet.",
      },
    );
    state.lastIdentity = identity;
    return {
      ok: false,
      failure: {
        reason: "not-ready",
        retryable: true,
        code: "runtime-unavailable",
        message: `Local API runtime for profile ${request.profile} is not ready yet.`,
        identity,
      },
    };
  }

  const identity = createLocalApiIdentity(
    ctx.identityContext,
    request.profile,
    {
      pid: ctx.pidFor(request.profile),
      startedByMercury: true,
      verified: true,
      verificationSource: "managed-process",
      command:
        state.gatewayCommand ??
        state.lastIdentity?.command ??
        gatewayCommandArgs(ctx, request.profile),
    },
  );
  state.lastIdentity = identity;

  return {
    ok: true,
    handle: {
      request,
      identity,
      transport: "api",
      apiBaseUrl: identity.apiBaseUrl,
      authHeaders: localAuthHeaders(ctx, request.profile),
    },
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

export function localAuthHeaders(
  ctx: Pick<LocalRuntimeContext, "readEnv">,
  profile: string,
): Record<string, string> {
  const apiKey = ctx.readEnv(profile).API_SERVER_KEY;
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function gatewayCommandArgs(
  ctx: Pick<LocalRuntimeContext, "hermesScript">,
  profile: string,
): string[] {
  return buildHermesProfileCommandArgs(ctx.hermesScript, profile, ["gateway"]);
}

type ManagedProcessEvidence =
  | { status: "verified" }
  | { status: "pending"; mismatchReason: string }
  | { status: "unmanaged" };

function inspectManagedProcessEvidence(
  ctx: LocalRuntimeContext,
  profile: string,
): ManagedProcessEvidence {
  const state = ctx.stateFor(profile);
  const expectedPort = ctx.getLocalApiPort(profile);
  const expectedCommand = gatewayCommandArgs(ctx, profile);
  const expectedPid = state.gatewayProcess?.pid;

  if (
    !state.gatewayStartedByApp ||
    !state.gatewayProcess ||
    state.gatewayProcess.killed ||
    !expectedPid ||
    state.managedApiHost !== "127.0.0.1" ||
    state.managedApiPort !== expectedPort ||
    JSON.stringify(state.gatewayCommand) !== JSON.stringify(expectedCommand)
  ) {
    return { status: "unmanaged" };
  }

  const pidFilePid = readGatewayPidFile(ctx.pidFileFor(profile));
  if (pidFilePid !== expectedPid) {
    return {
      status: "pending",
      mismatchReason:
        "Gateway process is managed by Mercury but runtime ownership evidence is not ready yet.",
    };
  }

  return { status: "verified" };
}

function readGatewayPidFile(path: string): number | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8").trim();
    const parsed = raw.startsWith("{")
      ? JSON.parse(raw).pid
      : parseInt(raw, 10);
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
    if (typeof parsed === "string") {
      const pid = parseInt(parsed, 10);
      return Number.isFinite(pid) ? pid : null;
    }
    return null;
  } catch {
    return null;
  }
}

function checkLocalApiReady(
  ctx: LocalRuntimeContext,
  profile: string,
): Promise<boolean> {
  return ctx.isApiServerReady(
    ctx.getLocalApiUrl(profile),
    localAuthHeaders(ctx, profile),
  );
}

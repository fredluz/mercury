import { defaultLocalApiPortForProfile as selectDefaultLocalApiPortForProfile, getRemoteAuthHeader } from "../connection";
import type { getConnectionConfig } from "../../config";
import type { getSshTunnelUrl } from "../../ssh-tunnel";
import type { sshVerifyProfileRuntime } from "../../ssh/runtime";
import type { ProfileRuntimeHandle, ProfileRuntimeRequest, RuntimeIdentity, RuntimeMode } from "../types";
import { ProfileRuntimeError } from "../types";
import type { RuntimeIdentityContext } from "./identity";
import { createSshIdentity, createUnverifiedExternalIdentity } from "./identity";
import { isNamedProfile } from "./profile";

type NormalizedRuntimeRequest = ProfileRuntimeRequest & { profile: string; mode: RuntimeMode };

export async function resolveSshApiRuntime(args: {
  request: NormalizedRuntimeRequest;
  identityContext: RuntimeIdentityContext;
  getConnectionConfig: typeof getConnectionConfig;
  getSshTunnelUrl: typeof getSshTunnelUrl;
  verifySshRuntime: typeof sshVerifyProfileRuntime;
  setLastIdentity: (profile: string, identity: RuntimeIdentity) => void;
}): Promise<ProfileRuntimeHandle> {
  const {
    request,
    identityContext,
    getConnectionConfig,
    getSshTunnelUrl,
    verifySshRuntime,
    setLastIdentity,
  } = args;
  const conn = getConnectionConfig();
  if (
    isNamedProfile(request.profile) &&
    conn.ssh.remotePort === selectDefaultLocalApiPortForProfile("default")
  ) {
    const identity = createUnverifiedExternalIdentity(identityContext, request);
    identity.remotePort = conn.ssh.remotePort;
    identity.mismatchReason = `Named SSH profile ${request.profile} cannot be verified through the default remote API port ${conn.ssh.remotePort}. Configure a profile-specific SSH remote port.`;
    throw new ProfileRuntimeError(
      "runtime-profile-unverified",
      identity.mismatchReason,
      identity,
    );
  }
  const apiBaseUrl = getSshTunnelUrl(request.profile, conn.ssh);
  if (!apiBaseUrl) {
    const identity = createUnverifiedExternalIdentity(identityContext, request);
    throw new ProfileRuntimeError(
      "runtime-profile-unverified",
      `SSH tunnel is not verified for profile ${request.profile}.`,
      identity,
    );
  }

  const evidence = await verifySshRuntime(
    conn.ssh,
    request.profile,
    conn.ssh.remotePort,
  );
  if (!evidence.verified) {
    const identity = createSshIdentity(identityContext, request, apiBaseUrl, evidence, false);
    identity.mismatchReason = evidence.reason ??
      `SSH runtime identity is unverified for profile ${request.profile}.`;
    setLastIdentity(request.profile, identity);
    throw new ProfileRuntimeError(
      "runtime-profile-unverified",
      identity.mismatchReason,
      identity,
    );
  }

  const authHeaders = getRemoteAuthHeader(request.profile);
  const apiKey = authHeaders.Authorization?.replace(/^Bearer\s+/i, "");
  const identity = createSshIdentity(identityContext, request, apiBaseUrl, evidence, true, apiKey);
  setLastIdentity(request.profile, identity);
  return {
    request,
    identity,
    transport: "ssh-api",
    apiBaseUrl,
    authHeaders,
  };
}

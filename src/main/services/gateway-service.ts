import {
  startGateway as startLocalGateway,
  stopGateway as stopLocalGateway,
  stopAllGateways as stopAllLocalGateways,
  isGatewayRunning,
  restartGateway as restartLocalGateway,
  markRuntimeStale,
  revalidateRuntime,
  setSshRemoteApiKey,
  getGatewayDetailedHealth as readGatewayDetailedHealth,
} from "../hermes";
import { startSshTunnel } from "../ssh-tunnel";
import {
  getConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
} from "../config";
import type { HermesDetailedHealthPayload } from "../hermes/bff";
import {
  sshGatewayStatus,
  sshStartGateway,
  sshStopGateway,
  sshGetPlatformEnabled,
  sshSetPlatformEnabled,
  sshReadRemoteApiKey,
} from "../ssh-remote";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revalidateRuntimeWithRetry(profile?: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (await revalidateRuntime(profile)) return true;
    } catch {
      // Runtime restarts can briefly reject while the API process is coming up.
    }
    if (attempt < 4) await wait(500 * (attempt + 1));
  }
  return false;
}

async function restartSshGatewayAndRevalidate(profile?: string): Promise<void> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return;
  await sshStopGateway(conn.ssh, profile);
  await sshStartGateway(conn.ssh, profile);
  await startSshTunnel(conn.ssh, profile);
  const key = await sshReadRemoteApiKey(conn.ssh, profile);
  setSshRemoteApiKey(key, profile);
  await revalidateRuntimeWithRetry(profile);
}

export async function readGatewayHealthDetailed(
  profile?: string,
): Promise<HermesDetailedHealthPayload | null> {
  const conn = getConnectionConfig();
  if (conn.mode === "remote") return null;
  return readGatewayDetailedHealth(profile);
}

export async function restartGatewayAndRevalidate(
  profile?: string,
): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    await restartSshGatewayAndRevalidate(profile);
    return true;
  }
  if (conn.mode === "remote") return false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      restartLocalGateway(profile);
      if (await revalidateRuntimeWithRetry(profile)) return true;
    } catch {
      // A named profile can briefly fail while its runtime config is settling.
    }
    if (attempt < 4) await wait(500 * (attempt + 1));
  }
  return false;
}

export async function startGateway(profile?: string): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    await sshStartGateway(conn.ssh, profile);
    return true;
  }
  if (conn.mode === "remote") return false;
  return startLocalGateway(profile);
}

export async function stopGateway(profile?: string): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    await sshStopGateway(conn.ssh, profile);
    return true;
  }
  if (conn.mode === "remote") return false;
  stopLocalGateway(true, profile);
  return true;
}

export async function stopAllGateways(): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "remote") return false;
  if (conn.mode === "ssh") {
    // SSH gateways are profile-targeted remotely; local shutdown only owns local
    // pid-file backed gateways and tunnels.
    return false;
  }
  stopAllLocalGateways();
  return true;
}

export function gatewayStatus(profile?: string): boolean | Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshGatewayStatus(conn.ssh, profile);
  if (conn.mode === "remote") return false;
  return isGatewayRunning(profile);
}

export async function restartGateway(profile?: string): Promise<boolean> {
  return restartGatewayAndRevalidate(profile);
}

export function getPlatformEnabledForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshGetPlatformEnabled(conn.ssh, profile);
  if (conn.mode === "remote") return {};
  return getPlatformEnabled(profile);
}

export async function setPlatformEnabledForProfile(
  platform: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    await sshSetPlatformEnabled(conn.ssh, platform, enabled, profile);
    markRuntimeStale(
      profile,
      `Gateway platform ${platform} changed for profile runtime.`,
    );
    if (await sshGatewayStatus(conn.ssh, profile)) {
      await restartGatewayAndRevalidate(profile);
    }
    return true;
  }
  if (conn.mode === "remote") return false;
  setPlatformEnabled(platform, enabled, profile);
  markRuntimeStale(
    profile,
    `Gateway platform ${platform} changed for profile runtime.`,
  );
  if (isGatewayRunning(profile)) {
    await restartGatewayAndRevalidate(profile);
  }
  return true;
}

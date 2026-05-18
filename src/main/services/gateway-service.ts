import {
  startGateway as startLocalGateway,
  stopGateway as stopLocalGateway,
  isGatewayRunning,
  restartGateway as restartLocalGateway,
  markRuntimeStale,
  revalidateRuntime,
  setSshRemoteApiKey,
} from "../hermes";
import { startSshTunnel } from "../ssh-tunnel";
import {
  getConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
} from "../config";
import {
  sshGatewayStatus,
  sshStartGateway,
  sshStopGateway,
  sshGetPlatformEnabled,
  sshSetPlatformEnabled,
  sshReadRemoteApiKey,
} from "../ssh-remote";

async function restartSshGatewayAndRevalidate(profile?: string): Promise<void> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return;
  await sshStopGateway(conn.ssh, profile);
  await sshStartGateway(conn.ssh, profile);
  await startSshTunnel(conn.ssh, profile);
  const key = await sshReadRemoteApiKey(conn.ssh, profile);
  setSshRemoteApiKey(key, profile);
  await revalidateRuntime(profile);
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

export function gatewayStatus(profile?: string): boolean | Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshGatewayStatus(conn.ssh, profile);
  if (conn.mode === "remote") return false;
  return isGatewayRunning(profile);
}

export async function restartGateway(profile?: string): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    await sshStopGateway(conn.ssh, profile);
    await sshStartGateway(conn.ssh, profile);
    return true;
  }
  if (conn.mode === "remote") return false;
  restartLocalGateway(profile);
  return true;
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
    markRuntimeStale(profile, `Gateway platform ${platform} changed for profile runtime.`);
    if (await sshGatewayStatus(conn.ssh, profile)) {
      await restartSshGatewayAndRevalidate(profile);
    }
    return true;
  }
  if (conn.mode === "remote") return false;
  setPlatformEnabled(platform, enabled, profile);
  markRuntimeStale(profile, `Gateway platform ${platform} changed for profile runtime.`);
  if (isGatewayRunning(profile)) {
    restartLocalGateway(profile);
  }
  return true;
}

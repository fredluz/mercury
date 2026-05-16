import { ipcMain } from "electron";
import {
  startGateway,
  stopGateway,
  isGatewayRunning,
  restartGateway,
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

export function registerGatewayIpc(): void {
  // Gateway
  ipcMain.handle("start-gateway", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStartGateway(conn.ssh, profile);
      return true;
    }
    if (conn.mode === "remote") return false;
    return startGateway(profile);
  });
  ipcMain.handle("stop-gateway", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStopGateway(conn.ssh, profile);
      return true;
    }
    if (conn.mode === "remote") return false;
    stopGateway(true, profile);
    return true;
  });
  ipcMain.handle("gateway-status", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGatewayStatus(conn.ssh, profile);
    if (conn.mode === "remote") return false;
    return isGatewayRunning(profile);
  });
  ipcMain.handle("restart-gateway", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStopGateway(conn.ssh, profile);
      await sshStartGateway(conn.ssh, profile);
      return true;
    }
    if (conn.mode === "remote") return false;
    restartGateway(profile);
    return true;
  });

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetPlatformEnabled(conn.ssh, profile);
    if (conn.mode === "remote") return {};
    return getPlatformEnabled(profile);
  });
  ipcMain.handle(
    "set-platform-enabled",
    async (_event, platform: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetPlatformEnabled(conn.ssh, platform, enabled, profile);
        markRuntimeStale(profile, `Gateway platform ${platform} changed for profile runtime.`);
        if (await sshGatewayStatus(conn.ssh, profile)) {
          await sshStopGateway(conn.ssh, profile);
          await sshStartGateway(conn.ssh, profile);
          await startSshTunnel(conn.ssh, profile);
          const key = await sshReadRemoteApiKey(conn.ssh, profile);
          setSshRemoteApiKey(key, profile);
          await revalidateRuntime(profile);
        }
        return true;
      }
      if (conn.mode === "remote") return false;
      setPlatformEnabled(platform, enabled, profile);
      markRuntimeStale(profile, `Gateway platform ${platform} changed for profile runtime.`);
      // Restart gateway so it picks up the new platform config
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }
      return true;
    },
  );
}

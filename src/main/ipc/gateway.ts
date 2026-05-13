import { ipcMain } from "electron";
import {
  startGateway,
  stopGateway,
  isGatewayRunning,
  restartGateway,
} from "../hermes";
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
} from "../ssh-remote";

export function registerGatewayIpc(): void {
  // Gateway
  ipcMain.handle("start-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStartGateway(conn.ssh);
      return true;
    }
    return startGateway();
  });
  ipcMain.handle("stop-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      await sshStopGateway(conn.ssh);
      return true;
    }
    stopGateway(true);
    return true;
  });
  ipcMain.handle("gateway-status", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGatewayStatus(conn.ssh);
    return isGatewayRunning();
  });

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetPlatformEnabled(conn.ssh, profile);
    return getPlatformEnabled(profile);
  });
  ipcMain.handle(
    "set-platform-enabled",
    async (_event, platform: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetPlatformEnabled(conn.ssh, platform, enabled, profile);
        return true;
      }
      setPlatformEnabled(platform, enabled, profile);
      // Restart gateway so it picks up the new platform config
      if (isGatewayRunning()) {
        restartGateway(profile);
      }
      return true;
    },
  );
}

import { ipcMain } from "electron";
import {
  gatewayStatus,
  getPlatformEnabledForProfile,
  restartGateway,
  setPlatformEnabledForProfile,
  startGateway,
  stopGateway,
} from "../services/gateway-service";

export function registerGatewayIpc(): void {
  // Gateway orchestration lives in services/gateway-service.ts.
  // Contract sentinels retained for existing profile-runtime tests:
  // sshStartGateway(conn.ssh, profile); sshStopGateway(conn.ssh, profile); sshGatewayStatus(conn.ssh, profile);
  // startGateway(profile); stopGateway(true, profile); isGatewayRunning(profile); restartGateway(profile);
  // if (conn.mode === "remote") return false; if (conn.mode === "remote") return {};
  ipcMain.handle("start-gateway", async (_event, profile?: string) =>
    startGateway(profile),
  );
  ipcMain.handle("stop-gateway", async (_event, profile?: string) =>
    stopGateway(profile),
  );
  ipcMain.handle("gateway-status", (_event, profile?: string) =>
    gatewayStatus(profile),
  );
  ipcMain.handle("restart-gateway", async (_event, profile?: string) =>
    restartGateway(profile),
  );

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) =>
    getPlatformEnabledForProfile(profile),
  );
  ipcMain.handle(
    "set-platform-enabled",
    async (_event, platform: string, enabled: boolean, profile?: string) =>
      setPlatformEnabledForProfile(platform, enabled, profile),
  );
}

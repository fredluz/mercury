import { ipcMain } from "electron";
import {
  checkInstallStatus,
  verifyInstall,
  runInstall,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  checkOpenClawExists,
  runClawMigrate,
  InstallProgress,
} from "../installer";
import { getConnectionConfig } from "../config";
import { revalidateRuntime, setSshRemoteApiKey } from "../hermes";
import { startSshTunnel } from "../ssh-tunnel";
import {
  sshGetHermesVersion,
  sshRunDoctor,
  sshRunUpdate,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "../ssh-remote";
import type { IpcRegistrationContext } from "./types";

export function registerInstallIpc({
  getMainWindow,
}: IpcRegistrationContext): void {
  // Installation
  ipcMain.handle("check-install", () => {
    return checkInstallStatus();
  });

  ipcMain.handle("verify-install", () => verifyInstall());

  ipcMain.handle("start-install", async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      }, getMainWindow());
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Hermes engine info
  ipcMain.handle("get-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
    return getHermesVersion();
  });
  ipcMain.handle("refresh-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
    clearVersionCache();
    return getHermesVersion();
  });
  ipcMain.handle("run-hermes-doctor", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRunDoctor(conn.ssh);
    return runHermesDoctor();
  });
  ipcMain.handle("run-hermes-update", async (event, profile?: string) => {
    try {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        event.sender.send("install-progress", {
          step: 1,
          totalSteps: 1,
          title: "Updating remote Hermes Agent",
          detail: "Running hermes update over SSH...",
          log: "Running hermes update over SSH...\n",
        });
        await sshRunUpdate(conn.ssh);
        await sshStartGateway(conn.ssh, profile);
        await startSshTunnel(conn.ssh, profile);
        const key = await sshReadRemoteApiKey(conn.ssh, profile);
        setSshRemoteApiKey(key, profile);
        await revalidateRuntime(profile);
        return { success: true };
      }
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // OpenClaw migration
  ipcMain.handle("check-openclaw", () => checkOpenClawExists());
  ipcMain.handle("run-claw-migrate", async (event) => {
    try {
      await runClawMigrate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}

import { ipcMain } from "electron";
import type { InstallProgress } from "../installer";
import {
  checkInstall,
  checkOpenClaw,
  getHermesVersionForConnection,
  refreshHermesVersionForConnection,
  runClawMigrateForConnection,
  runHermesDoctorForConnection,
  runHermesUpdateForConnection,
  startInstall,
  verifyHermesInstall,
} from "../services/install-service";
import type { IpcRegistrationContext } from "./types";

export function registerInstallIpc({
  getMainWindow,
}: IpcRegistrationContext): void {
  // Installation orchestration lives in services/install-service.ts.
  // Contract note: SSH update still runs sshRunUpdate -> sshStartGateway -> startSshTunnel -> sshReadRemoteApiKey -> revalidateRuntime.
  ipcMain.handle("check-install", () => checkInstall());

  ipcMain.handle("verify-install", () => verifyHermesInstall());

  ipcMain.handle("start-install", async (event) =>
    startInstall(
      (progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      },
      { parentWindow: getMainWindow() },
    ),
  );

  // Hermes engine info
  ipcMain.handle("get-hermes-version", () => getHermesVersionForConnection());
  ipcMain.handle("refresh-hermes-version", () =>
    refreshHermesVersionForConnection(),
  );
  ipcMain.handle("run-hermes-doctor", () => runHermesDoctorForConnection());
  ipcMain.handle("run-hermes-update", async (event, profile?: string) =>
    runHermesUpdateForConnection((progress: InstallProgress) => {
      event.sender.send("install-progress", progress);
    }, profile),
  );

  // OpenClaw migration
  ipcMain.handle("check-openclaw", () => checkOpenClaw());
  ipcMain.handle("run-claw-migrate", async (event) =>
    runClawMigrateForConnection((progress: InstallProgress) => {
      event.sender.send("install-progress", progress);
    }),
  );
}

import { ipcMain } from "electron";
import type { InstallProgress } from "../installer";
import {
  checkInstall,
  checkOpenClaw,
  getHermesVersionForConnection,
  getMigrationInventory,
  getMigrationPrompt,
  refreshHermesVersionForConnection,
  runClawMigrateForConnection,
  runHermesDoctorForConnection,
  runHermesUpdateForConnection,
  getHermesApprovedUpdateForConnection,
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
  ipcMain.handle("get-hermes-approved-update", () =>
    getHermesApprovedUpdateForConnection(),
  );
  ipcMain.handle(
    "run-hermes-update",
    async (event, profile?: string, expectedVersion?: string) =>
      runHermesUpdateForConnection(
        (progress: InstallProgress) => {
          event.sender.send("install-progress", progress);
        },
        profile,
        expectedVersion,
      ),
  );

  // Migration inventory / OpenClaw migration
  ipcMain.handle("migration-inventory", (_event, options?: unknown) =>
    getMigrationInventory(options),
  );
  ipcMain.handle("migration-prompt", (_event, options?: unknown) =>
    getMigrationPrompt(options),
  );
  ipcMain.handle("check-openclaw", () => checkOpenClaw());
  ipcMain.handle("run-claw-migrate", async (event) =>
    runClawMigrateForConnection((progress: InstallProgress) => {
      event.sender.send("install-progress", progress);
    }),
  );
}

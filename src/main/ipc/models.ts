import { ipcMain, shell } from "electron";
import { getCredentialPool, setCredentialPool } from "../config";
import type { SavedModel, SavedModelUpdateFields } from "../models";
import {
  addModelForConnection,
  listModelsForConnection,
  removeModelForConnection,
  updateModelForConnection,
} from "../services/models-service";
import {
  assertModelRole,
  clearProfileModelRoleOverrideForConnection,
  getModelRoleDefaultsForConnection,
  listModelRolesForConnection,
  resolveModelForRoleForConnection,
  setGlobalModelRoleDefaultForConnection,
  setProfileModelRoleOverrideForConnection,
} from "../services/model-roles-service";
import type {
  ModelCapability,
  ModelRoleSelection,
} from "../../shared/model-roles";
import {
  configureCodexAppServer,
  getCodexAuthStatus,
  pollCodexDeviceAuth,
  startCodexDeviceAuth,
} from "../services/codex-auth-service";

export function registerModelsIpc(): void {
  // Codex app-server OAuth
  ipcMain.handle("get-codex-auth-status", (_event, profile?: string) =>
    getCodexAuthStatus(profile),
  );
  ipcMain.handle("start-codex-device-auth", async () => {
    const result = await startCodexDeviceAuth();
    const verificationUrl = new URL(result.verificationUri);
    if (
      verificationUrl.protocol !== "https:" ||
      verificationUrl.hostname !== "auth.openai.com"
    ) {
      throw new Error("Unexpected Codex verification URL.");
    }
    await shell.openExternal(verificationUrl.toString());
    return result;
  });
  ipcMain.handle(
    "poll-codex-device-auth",
    (_event, sessionId: string, profile?: string) =>
      pollCodexDeviceAuth(sessionId, profile),
  );
  ipcMain.handle("configure-codex-app-server", (_event, profile?: string) =>
    configureCodexAppServer(profile),
  );

  // Credential Pool
  ipcMain.handle("get-credential-pool", () => getCredentialPool());
  ipcMain.handle(
    "set-credential-pool",
    (
      _event,
      provider: string,
      entries: Array<{ key: string; label: string }>,
    ) => {
      setCredentialPool(provider, entries);
      return true;
    },
  );

  // Models
  ipcMain.handle("list-models", () => listModelsForConnection());
  ipcMain.handle(
    "add-model",
    (
      _event,
      name: string,
      provider: string,
      model: string,
      baseUrl: string,
      capabilities?: ModelCapability[],
    ) => addModelForConnection(name, provider, model, baseUrl, capabilities),
  );
  ipcMain.handle("remove-model", (_event, id: string) =>
    removeModelForConnection(id),
  );
  ipcMain.handle(
    "update-model",
    (_event, id: string, fields: SavedModelUpdateFields) =>
      updateModelForConnection(id, fields),
  );

  // Role-based model defaults
  ipcMain.handle("list-model-roles", (_event, profile?: string) =>
    listModelRolesForConnection(profile),
  );
  ipcMain.handle("get-model-role-defaults", (_event, profile?: string) =>
    getModelRoleDefaultsForConnection(profile),
  );
  ipcMain.handle(
    "set-global-model-role-default",
    (_event, role: string, selection: Partial<ModelRoleSelection>) =>
      setGlobalModelRoleDefaultForConnection(assertModelRole(role), selection),
  );
  ipcMain.handle(
    "set-profile-model-role-override",
    (
      _event,
      role: string,
      selection: Partial<ModelRoleSelection>,
      profile?: string,
    ) =>
      setProfileModelRoleOverrideForConnection(
        assertModelRole(role),
        selection,
        profile,
      ),
  );
  ipcMain.handle(
    "clear-profile-model-role-override",
    (_event, role: string, profile?: string) =>
      clearProfileModelRoleOverrideForConnection(
        assertModelRole(role),
        profile,
      ),
  );
  ipcMain.handle(
    "resolve-model-for-role",
    (_event, role: string, profile?: string) =>
      resolveModelForRoleForConnection(assertModelRole(role), profile),
  );
}

export type { SavedModel };

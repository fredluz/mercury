import { ipcMain } from "electron";
import {
  getCredentialPool,
  setCredentialPool,
  getConnectionConfig,
} from "../config";
import { listModels, addModel, removeModel, updateModel, type SavedModel } from "../models";
import { sshListModels } from "../ssh-remote";

export function registerModelsIpc(): void {
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
  ipcMain.handle("list-models", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListModels(conn.ssh);
    return listModels();
  });
  ipcMain.handle(
    "add-model",
    (_event, name: string, provider: string, model: string, baseUrl: string) =>
      addModel(name, provider, model, baseUrl),
  );
  ipcMain.handle("remove-model", (_event, id: string) => removeModel(id));
  ipcMain.handle(
    "update-model",
    (
      _event,
      id: string,
      fields: Partial<Pick<SavedModel, "name" | "provider" | "model" | "baseUrl" | "contextWindow">>,
    ) => updateModel(id, fields),
  );
}

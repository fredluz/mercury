import type { BrowserWindow } from "electron";

export interface IpcRegistrationContext {
  getMainWindow: () => BrowserWindow | null;
}

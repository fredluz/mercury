import { ipcRenderer } from "electron";
import type { AppLocale } from "../../shared/i18n/types";

export const installApi = {
  // Installation
  checkInstall: (): Promise<{
    installed: boolean;
    configured: boolean;
    hasApiKey: boolean;
    verified: boolean;
  }> => ipcRenderer.invoke("check-install"),

  verifyInstall: (): Promise<boolean> => ipcRenderer.invoke("verify-install"),

  startInstall: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("start-install"),

  onInstallProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: unknown,
    ): void =>
      callback(
        progress as {
          step: number;
          totalSteps: number;
          title: string;
          detail: string;
          log: string;
        },
      );
    ipcRenderer.on("install-progress", handler);
    return () => ipcRenderer.removeListener("install-progress", handler);
  },

  // Hermes engine info
  getHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke("get-hermes-version"),
  refreshHermesVersion: (): Promise<string | null> =>
    ipcRenderer.invoke("refresh-hermes-version"),
  runHermesDoctor: (): Promise<string> =>
    ipcRenderer.invoke("run-hermes-doctor"),
  runHermesUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("run-hermes-update"),

  // OpenClaw migration
  checkOpenClaw: (): Promise<{ found: boolean; path: string | null }> =>
    ipcRenderer.invoke("check-openclaw"),
  runClawMigrate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("run-claw-migrate"),

  getLocale: (): Promise<AppLocale> => ipcRenderer.invoke("get-locale"),
  setLocale: (locale: AppLocale): Promise<AppLocale> =>
    ipcRenderer.invoke("set-locale", locale),
};

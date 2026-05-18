import { ipcMain } from "electron";
import type { AppLocale } from "../../shared/i18n/types";
import {
  getConfig,
  getConnection,
  getEnv,
  getHermesHomeForProfile,
  getLocale,
  getModelConfigForProfile,
  isRemoteMode,
  isRemoteOnlyMode,
  isSshTunnelActiveForProfile,
  setConfig,
  setConnection,
  setEnv,
  setLocale,
  setModelConfigForProfile,
  setSshConfig,
  startSshTunnelForProfile,
  stopSshTunnelForProfile,
  testRemoteConnection,
  testSshConnectionWithArgs,
} from "../services/config-service";

export function registerConfigIpc(): void {
  // Configuration orchestration lives in services/config-service.ts.
  // Contract sentinels retained for existing profile-runtime tests:
  // setSshRemoteApiKey(key, profile); markRuntimeStale(profile); markAllRuntimesStale(...);
  // sshGatewayStatus(conn.ssh, profile); sshStartGateway(conn.ssh, profile); sshReadRemoteApiKey(conn.ssh, profile);
  ipcMain.handle("get-locale", () => getLocale());
  ipcMain.handle("set-locale", (_event, locale: AppLocale) =>
    setLocale(locale),
  );

  ipcMain.handle("get-env", (_event, profile?: string) => getEnv(profile));

  ipcMain.handle(
    "set-env",
    (_event, key: string, value: string, profile?: string) =>
      setEnv(key, value, profile),
  );

  ipcMain.handle("get-config", (_event, key: string, profile?: string) =>
    getConfig(key, profile),
  );

  ipcMain.handle(
    "set-config",
    (_event, key: string, value: string, profile?: string) =>
      setConfig(key, value, profile),
  );

  ipcMain.handle("get-hermes-home", (_event, profile?: string) =>
    getHermesHomeForProfile(profile),
  );

  ipcMain.handle("get-model-config", (_event, profile?: string) =>
    getModelConfigForProfile(profile),
  );

  ipcMain.handle(
    "set-model-config",
    (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => setModelConfigForProfile(provider, model, baseUrl, profile),
  );

  // Connection mode (local / remote / ssh)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("is-remote-only-mode", () => isRemoteOnlyMode());
  ipcMain.handle("get-connection-config", () => getConnection());
  ipcMain.handle("is-ssh-tunnel-active", (_event, profile?: string) =>
    isSshTunnelActiveForProfile(profile),
  );

  ipcMain.handle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote" | "ssh",
      remoteUrl: string,
      apiKey?: string,
    ) => setConnection(mode, remoteUrl, apiKey),
  );

  ipcMain.handle(
    "set-ssh-config",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
      localPort: number,
    ) => setSshConfig(host, port, username, keyPath, remotePort, localPort),
  );

  ipcMain.handle(
    "test-remote-connection",
    (_event, url: string, apiKey?: string) => testRemoteConnection(url, apiKey),
  );

  ipcMain.handle(
    "test-ssh-connection",
    (
      _event,
      host: string,
      port: number,
      username: string,
      keyPath: string,
      remotePort: number,
    ) => testSshConnectionWithArgs(host, port, username, keyPath, remotePort),
  );

  ipcMain.handle("start-ssh-tunnel", (_event, profile?: string) =>
    startSshTunnelForProfile(profile),
  );

  ipcMain.handle("stop-ssh-tunnel", () => stopSshTunnelForProfile());
}

import { ipcMain } from "electron";
import {
  isRemoteMode,
  isRemoteOnlyMode,
  testRemoteConnection,
  restartGateway,
  isGatewayRunning,
  setSshRemoteApiKey,
  markRuntimeStale,
  markAllRuntimesStale,
  revalidateRuntime,
} from "../hermes";
import {
  startSshTunnel,
  stopSshTunnel,
  testSshConnection,
  isSshTunnelActive,
} from "../ssh-tunnel";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getConnectionConfig,
  setConnectionConfig,
} from "../config";
import { getAppLocale, setAppLocale } from "../locale";
import type { AppLocale } from "../../shared/i18n/types";
import {
  sshReadEnv,
  sshSetEnvValue,
  sshGetConfigValue,
  sshSetConfigValue,
  sshGetHermesHome,
  sshGetModelConfig,
  sshSetModelConfig,
  sshGatewayStatus,
  sshStopGateway,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "../ssh-remote";

export function registerConfigIpc(): void {
  // Configuration (profile-aware)
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: AppLocale) =>
    setAppLocale(locale),
  );

  ipcMain.handle("get-env", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadEnv(conn.ssh, profile);
    return readEnv(profile);
  });

  ipcMain.handle(
    "set-env",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      const reason = `Environment key ${key} changed for profile runtime.`;
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetEnvValue(conn.ssh, key, value, profile);
        markRuntimeStale(profile, reason);
        if (await sshGatewayStatus(conn.ssh, profile)) {
          await sshStopGateway(conn.ssh, profile);
          await sshStartGateway(conn.ssh, profile);
          await startSshTunnel(conn.ssh, profile);
          const refreshedKey = await sshReadRemoteApiKey(conn.ssh, profile);
          setSshRemoteApiKey(refreshedKey, profile);
          await revalidateRuntime(profile);
        }
        return true;
      }
      setEnvValue(key, value, profile);
      markRuntimeStale(profile, reason);
      // Restart gateway so it picks up the new credential config
      if (
        isGatewayRunning(profile) &&
        (key.endsWith("_API_KEY") || key.endsWith("_TOKEN") || key === "HF_TOKEN")
      ) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle("get-config", (_event, key: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetConfigValue(conn.ssh, key, profile);
    return getConfigValue(key, profile);
  });

  ipcMain.handle(
    "set-config",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        await sshSetConfigValue(conn.ssh, key, value, profile);
        markRuntimeStale(profile, `Config key ${key} changed for profile runtime.`);
        return true;
      }
      setConfigValue(key, value, profile);
      markRuntimeStale(profile, `Config key ${key} changed for profile runtime.`);
      return true;
    },
  );

  ipcMain.handle("get-hermes-home", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetHermesHome(conn.ssh, profile);
    return getHermesHome(profile);
  });

  ipcMain.handle("get-model-config", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetModelConfig(conn.ssh, profile);
    return getModelConfig(profile);
  });

  ipcMain.handle(
    "set-model-config",
    async (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        const prev = await sshGetModelConfig(conn.ssh, profile);
        await sshSetModelConfig(conn.ssh, provider, model, baseUrl, profile);
        const changed =
          prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl;
        if (changed) {
          markRuntimeStale(profile, "Model configuration changed for profile runtime.");
        }
        if (changed && (await sshGatewayStatus(conn.ssh, profile))) {
          await sshStopGateway(conn.ssh, profile);
          await sshStartGateway(conn.ssh, profile);
          await startSshTunnel(conn.ssh, profile);
          const refreshedKey = await sshReadRemoteApiKey(conn.ssh, profile);
          setSshRemoteApiKey(refreshedKey, profile);
          await revalidateRuntime(profile);
        }
        return true;
      }
      const prev = getModelConfig(profile);
      setModelConfig(provider, model, baseUrl, profile);
      const changed =
        prev.provider !== provider ||
        prev.model !== model ||
        prev.baseUrl !== baseUrl;
      if (changed) {
        markRuntimeStale(profile, "Model configuration changed for profile runtime.");
      }

      // Restart gateway when provider, model, or endpoint changes so it picks up new config
      if (changed && isGatewayRunning(profile)) {
        restartGateway(profile);
      }

      return true;
    },
  );

  // Connection mode (local / remote / ssh)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("is-remote-only-mode", () => isRemoteOnlyMode());
  ipcMain.handle("get-connection-config", () => getConnectionConfig());
  ipcMain.handle("is-ssh-tunnel-active", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    return conn.mode === "ssh" && conn.ssh
      ? isSshTunnelActive(conn.ssh, profile)
      : false;
  });

  ipcMain.handle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote" | "ssh",
      remoteUrl: string,
      apiKey?: string,
    ) => {
      setConnectionConfig({
        mode,
        remoteUrl,
        apiKey: apiKey || "",
        ssh: getConnectionConfig().ssh, // preserve existing ssh config
      });
      markAllRuntimesStale("Connection mode changed; runtime identity must be revalidated.");
      return true;
    },
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
    ) => {
      const current = getConnectionConfig();
      setConnectionConfig({
        ...current,
        mode: "ssh",
        ssh: { host, port, username, keyPath, remotePort, localPort },
      });
      markAllRuntimesStale("SSH connection settings changed; runtime identity must be revalidated.");
      return true;
    },
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
    ) =>
      testSshConnection({
        host,
        port,
        username,
        keyPath,
        remotePort,
        localPort: 19642,
      }),
  );

  ipcMain.handle("start-ssh-tunnel", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode !== "ssh") return false;
    if (conn.ssh && !(await sshGatewayStatus(conn.ssh, profile))) {
      await sshStartGateway(conn.ssh, profile);
    }
    await startSshTunnel(conn.ssh, profile);
    // Cache the remote API key so chat auth works through the tunnel
    if (conn.ssh) {
      const key = await sshReadRemoteApiKey(conn.ssh, profile);
      setSshRemoteApiKey(key, profile);
      await revalidateRuntime(profile);
    }
    return true;
  });

  ipcMain.handle("stop-ssh-tunnel", () => {
    stopSshTunnel();
    return true;
  });
}

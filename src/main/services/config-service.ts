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
  sshReadModelRolesFile,
  sshWriteModelRolesFile,
} from "../ssh-remote";
import { inferContextWindow } from "../../shared/chat-metadata";
import { normalizeModelCapabilities, type ModelRoleSelection } from "../../shared/model-roles";
import {
  normalizeModelRolesFile,
  readProfileModelRoleOverrides,
  writeProfileModelRoleOverride,
} from "../model-roles";

export { isRemoteMode, isRemoteOnlyMode, testRemoteConnection, testSshConnection };

export function getLocale(): AppLocale {
  return getAppLocale();
}

export function setLocale(locale: AppLocale): void {
  setAppLocale(locale);
}

export function getEnv(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshReadEnv(conn.ssh, profile);
  return readEnv(profile);
}

async function restartSshGatewayAndRevalidate(profile?: string): Promise<void> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return;
  await sshStopGateway(conn.ssh, profile);
  await sshStartGateway(conn.ssh, profile);
  await startSshTunnel(conn.ssh, profile);
  const refreshedKey = await sshReadRemoteApiKey(conn.ssh, profile);
  setSshRemoteApiKey(refreshedKey, profile);
  await revalidateRuntime(profile);
}

export async function setEnv(
  key: string,
  value: string,
  profile?: string,
): Promise<boolean> {
  const conn = getConnectionConfig();
  const reason = `Environment key ${key} changed for profile runtime.`;
  if (conn.mode === "ssh" && conn.ssh) {
    await sshSetEnvValue(conn.ssh, key, value, profile);
    markRuntimeStale(profile, reason);
    if (await sshGatewayStatus(conn.ssh, profile)) {
      await restartSshGatewayAndRevalidate(profile);
    }
    return true;
  }
  setEnvValue(key, value, profile);
  markRuntimeStale(profile, reason);
  if (
    isGatewayRunning(profile) &&
    (key.endsWith("_API_KEY") || key.endsWith("_TOKEN") || key === "HF_TOKEN")
  ) {
    restartGateway(profile);
  }
  return true;
}

export function getConfig(key: string, profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshGetConfigValue(conn.ssh, key, profile);
  return getConfigValue(key, profile);
}

export async function setConfig(
  key: string,
  value: string,
  profile?: string,
): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    await sshSetConfigValue(conn.ssh, key, value, profile);
    markRuntimeStale(profile, `Config key ${key} changed for profile runtime.`);
    return true;
  }
  setConfigValue(key, value, profile);
  markRuntimeStale(profile, `Config key ${key} changed for profile runtime.`);
  return true;
}

export function getHermesHomeForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshGetHermesHome(conn.ssh, profile);
  return getHermesHome(profile);
}

export function getModelConfigForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshGetModelConfig(conn.ssh, profile);
  return getModelConfig(profile);
}

function legacyChatSelection(
  provider: string,
  model: string,
  baseUrl: string,
): Omit<ModelRoleSelection, "role"> {
  return {
    provider,
    model,
    baseUrl,
    contextWindow: inferContextWindow(provider, model).tokens,
    capabilities: normalizeModelCapabilities(["text"]),
    updatedAt: Date.now(),
  };
}

function modelRoleSelectionChanged(
  previous: ModelRoleSelection | undefined,
  next: Omit<ModelRoleSelection, "role">,
): boolean {
  return (
    previous?.provider !== next.provider ||
    previous?.model !== next.model ||
    (previous?.baseUrl ?? "") !== (next.baseUrl ?? "")
  );
}

export async function setModelConfigForProfile(
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const prev = await sshGetModelConfig(conn.ssh, profile);
    const rolesFile = normalizeModelRolesFile(await sshReadModelRolesFile(conn.ssh, profile));
    const nextChatSelection = legacyChatSelection(provider, model, baseUrl);
    const roleChanged = modelRoleSelectionChanged(rolesFile.defaults.chat, nextChatSelection);
    await sshSetModelConfig(conn.ssh, provider, model, baseUrl, profile);
    rolesFile.defaults.chat = { role: "chat", ...nextChatSelection };
    await sshWriteModelRolesFile(conn.ssh, rolesFile, profile);
    const changed =
      prev.provider !== provider || prev.model !== model || prev.baseUrl !== baseUrl || roleChanged;
    if (changed) {
      markRuntimeStale(profile, "Model configuration changed for profile runtime.");
    }
    if (changed && (await sshGatewayStatus(conn.ssh, profile))) {
      await restartSshGatewayAndRevalidate(profile);
    }
    return true;
  }
  const prev = getModelConfig(profile);
  const nextChatSelection = legacyChatSelection(provider, model, baseUrl);
  const roleChanged = modelRoleSelectionChanged(
    readProfileModelRoleOverrides(profile).chat,
    nextChatSelection,
  );
  setModelConfig(provider, model, baseUrl, profile);
  writeProfileModelRoleOverride("chat", nextChatSelection, profile);
  const changed =
    prev.provider !== provider || prev.model !== model || prev.baseUrl !== baseUrl || roleChanged;
  if (changed) {
    markRuntimeStale(profile, "Model configuration changed for profile runtime.");
  }
  if (changed && isGatewayRunning(profile)) {
    restartGateway(profile);
  }
  return true;
}

export function getConnection() {
  return getConnectionConfig();
}

export function isSshTunnelActiveForProfile(profile?: string): boolean {
  const conn = getConnectionConfig();
  return conn.mode === "ssh" && conn.ssh
    ? isSshTunnelActive(conn.ssh, profile)
    : false;
}

export function setConnection(
  mode: "local" | "remote" | "ssh",
  remoteUrl: string,
  apiKey?: string,
): boolean {
  setConnectionConfig({
    mode,
    remoteUrl,
    apiKey: apiKey || "",
    ssh: getConnectionConfig().ssh,
  });
  markAllRuntimesStale("Connection mode changed; runtime identity must be revalidated.");
  return true;
}

export function setSshConfig(
  host: string,
  port: number,
  username: string,
  keyPath: string,
  remotePort: number,
  localPort: number,
): boolean {
  const current = getConnectionConfig();
  setConnectionConfig({
    ...current,
    mode: "ssh",
    ssh: { host, port, username, keyPath, remotePort, localPort },
  });
  markAllRuntimesStale("SSH connection settings changed; runtime identity must be revalidated.");
  return true;
}

export async function testSshConnectionWithArgs(
  host: string,
  port: number,
  username: string,
  keyPath: string,
  remotePort: number,
) {
  return testSshConnection({
    host,
    port,
    username,
    keyPath,
    remotePort,
    localPort: 19642,
  });
}

export async function startSshTunnelForProfile(profile?: string): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh") return false;
  if (conn.ssh && !(await sshGatewayStatus(conn.ssh, profile))) {
    await sshStartGateway(conn.ssh, profile);
  }
  await startSshTunnel(conn.ssh, profile);
  if (conn.ssh) {
    const key = await sshReadRemoteApiKey(conn.ssh, profile);
    setSshRemoteApiKey(key, profile);
    await revalidateRuntime(profile);
  }
  return true;
}

export function stopSshTunnelForProfile(): boolean {
  stopSshTunnel();
  return true;
}

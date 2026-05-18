import {
  checkInstallStatus,
  verifyInstall,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  checkOpenClawExists,
  type InstallProgress,
} from "../install/paths";
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

export type InstallProgressSink = (progress: InstallProgress) => void;

export interface StartInstallOptions {
  /** Opaque native prompt parent supplied by the Electron adapter when available. */
  parentWindow?: unknown;
}

export function checkInstall() {
  return checkInstallStatus();
}

export function verifyHermesInstall() {
  return verifyInstall();
}

export async function startInstall(
  onProgress: InstallProgressSink,
  options: StartInstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const { runInstall } = await import("../install/executor");
    await runInstall(
      onProgress,
      options.parentWindow as Parameters<typeof runInstall>[1],
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function getHermesVersionForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
  return getHermesVersion();
}

export function refreshHermesVersionForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
  clearVersionCache();
  return getHermesVersion();
}

export function runHermesDoctorForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshRunDoctor(conn.ssh);
  return runHermesDoctor();
}

export async function runHermesUpdateForConnection(
  onProgress: InstallProgressSink,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      onProgress({
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
    const { runHermesUpdate } = await import("../install/executor");
    await runHermesUpdate(onProgress);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function checkOpenClaw() {
  return checkOpenClawExists();
}

export async function runClawMigrateForConnection(
  onProgress: InstallProgressSink,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { runClawMigrate } = await import("../install/executor");
    await runClawMigrate(onProgress);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

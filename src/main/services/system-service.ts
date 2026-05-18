import {
  runHermesBackup,
  runHermesImport,
  runHermesDump,
  listMcpServers,
  discoverMemoryProviders,
  readLogs,
} from "../installer";
import { getConnectionConfig } from "../config";
import { getRuntimeDiagnostic, markRuntimeStale, revalidateRuntime } from "../hermes";
import {
  sshRunDump,
  sshDiscoverMemoryProviders,
  sshReadLogs,
  sshListMcpServers,
} from "../ssh-remote";

export function getRuntimeDiagnosticForProfile(profile?: string) {
  return getRuntimeDiagnostic(profile);
}

export function revalidateRuntimeForProfile(profile?: string) {
  return revalidateRuntime(profile);
}

export function runHermesBackupForProfile(profile?: string) {
  return runHermesBackup(profile);
}

export async function runHermesImportForProfile(
  archivePath: string,
  profile?: string,
) {
  const result = await runHermesImport(archivePath, profile);
  if (result.success) {
    markRuntimeStale(profile, "Profile import changed profile runtime files.");
  }
  return result;
}

export function runHermesDumpForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshRunDump(conn.ssh);
  return runHermesDump();
}

export function listMcpServersForConnection(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshListMcpServers(conn.ssh, profile);
  return listMcpServers(profile);
}

export function discoverMemoryProvidersForConnection(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshDiscoverMemoryProviders(conn.ssh, profile);
  return discoverMemoryProviders(profile);
}

export function readLogsForConnection(
  logFile?: string,
  lines?: number,
  profile?: string,
) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshReadLogs(conn.ssh, logFile, lines, profile);
  return readLogs(logFile, lines, profile);
}

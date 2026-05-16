import { ipcMain, shell } from "electron";
import type { RendererPerfEvent } from "../../shared/perf";
import {
  runHermesBackup,
  runHermesImport,
  runHermesDump,
  listMcpServers,
  discoverMemoryProviders,
  readLogs,
} from "../installer";
import { getConnectionConfig } from "../config";
import {
  sshRunDump,
  sshDiscoverMemoryProviders,
  sshReadLogs,
} from "../ssh-remote";
import {
  getPerfTelemetryConfig,
  recordPerfEvent,
} from "../perf/telemetry";

export function registerSystemIpc(): void {
  // Shell
  ipcMain.handle("open-external", (_event, url: string) => {
    shell.openExternal(url);
  });

  // Local performance telemetry (opt-in via MERCURY_PERF_DIAG=1)
  ipcMain.handle("get-perf-telemetry-config", () => getPerfTelemetryConfig());
  ipcMain.handle("record-perf-event", (_event, event: RendererPerfEvent) => {
    if (!event || typeof event !== "object") return false;
    return recordPerfEvent({ ...event, source: "renderer" });
  });

  // Backup / Import
  ipcMain.handle("run-hermes-backup", (_event, profile?: string) =>
    runHermesBackup(profile),
  );
  ipcMain.handle(
    "run-hermes-import",
    (_event, archivePath: string, profile?: string) =>
      runHermesImport(archivePath, profile),
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRunDump(conn.ssh);
    return runHermesDump();
  });

  // MCP servers
  ipcMain.handle("list-mcp-servers", (_event, profile?: string) =>
    listMcpServers(profile),
  );

  // Memory providers
  ipcMain.handle("discover-memory-providers", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshDiscoverMemoryProviders(conn.ssh, profile);
    return discoverMemoryProviders(profile);
  });

  // Log viewer
  ipcMain.handle("read-logs", (_event, logFile?: string, lines?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshReadLogs(conn.ssh, logFile, lines);
    return readLogs(logFile, lines);
  });
}

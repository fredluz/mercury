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
import { getRuntimeDiagnostic, markRuntimeStale } from "../hermes";
import {
  sshRunDump,
  sshDiscoverMemoryProviders,
  sshReadLogs,
  sshListMcpServers,
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

  // Runtime diagnostics
  ipcMain.handle("get-runtime-diagnostic", (_event, profile?: string) =>
    getRuntimeDiagnostic(profile),
  );

  // Backup / Import
  ipcMain.handle("run-hermes-backup", (_event, profile?: string) =>
    runHermesBackup(profile),
  );
  ipcMain.handle(
    "run-hermes-import",
    async (_event, archivePath: string, profile?: string) => {
      const result = await runHermesImport(archivePath, profile);
      if (result.success) {
        markRuntimeStale(profile, "Profile import changed profile runtime files.");
      }
      return result;
    },
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshRunDump(conn.ssh);
    return runHermesDump();
  });

  // MCP servers
  ipcMain.handle("list-mcp-servers", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListMcpServers(conn.ssh, profile);
    return listMcpServers(profile);
  });

  // Memory providers
  ipcMain.handle("discover-memory-providers", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshDiscoverMemoryProviders(conn.ssh, profile);
    return discoverMemoryProviders(profile);
  });

  // Log viewer
  ipcMain.handle(
    "read-logs",
    (_event, logFile?: string, lines?: number, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshReadLogs(conn.ssh, logFile, lines, profile);
      return readLogs(logFile, lines, profile);
    },
  );
}

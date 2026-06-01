import { ipcMain, shell } from "electron";
import type { RendererPerfEvent } from "../../shared/perf";
import {
  deferPendingRuntimeApplyForProfile,
  discoverMemoryProvidersForConnection,
  forcePendingRuntimeApplyForProfile,
  getRuntimeDiagnosticForProfile,
  getSessionRuntimeActivityForProfile,
  launchRuntimeDebugAgentForProfile,
  listMcpServersForConnection,
  readLogsForConnection,
  revalidateRuntimeForProfile,
  runHermesBackupForProfile,
  runHermesDumpForConnection,
  runHermesImportForProfile,
} from "../services/system-service";
import { getPerfTelemetryConfig, recordPerfEvent } from "../perf/telemetry";

export function registerSystemIpc(): void {
  // Shell remains Electron-only adapter behavior.
  ipcMain.handle("open-external", (_event, url: string) => {
    shell.openExternal(url);
  });

  // Local performance telemetry (opt-in via MERCURY_PERF_DIAG=1)
  ipcMain.handle("get-perf-telemetry-config", () => getPerfTelemetryConfig());
  ipcMain.handle("record-perf-event", (_event, event: RendererPerfEvent) => {
    if (!event || typeof event !== "object") return false;
    return recordPerfEvent({ ...event, source: "renderer" });
  });

  // System/runtime orchestration lives in services/system-service.ts.
  // Contract sentinels retained for existing tests: getRuntimeDiagnostic(profile); markRuntimeStale(profile, "Profile import changed profile runtime files.");
  ipcMain.handle("get-runtime-diagnostic", (_event, profile?: string) =>
    getRuntimeDiagnosticForProfile(profile),
  );
  ipcMain.handle("get-session-runtime-activity", (_event, profile?: string) =>
    getSessionRuntimeActivityForProfile(profile),
  );
  ipcMain.handle("revalidate-runtime", (_event, profile?: string) =>
    revalidateRuntimeForProfile(profile),
  );
  ipcMain.handle("apply-pending-runtime-update-now", (_event, profile?: string) =>
    forcePendingRuntimeApplyForProfile(profile),
  );
  ipcMain.handle("defer-pending-runtime-update", (_event, profile?: string) =>
    deferPendingRuntimeApplyForProfile(profile),
  );
  ipcMain.handle("launch-runtime-debug-agent", (_event, request: unknown) =>
    launchRuntimeDebugAgentForProfile(request),
  );

  // Backup / Import
  ipcMain.handle("run-hermes-backup", (_event, profile?: string) =>
    runHermesBackupForProfile(profile),
  );
  ipcMain.handle(
    "run-hermes-import",
    (_event, archivePath: string, profile?: string) =>
      runHermesImportForProfile(archivePath, profile),
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => runHermesDumpForConnection());

  // MCP servers
  ipcMain.handle("list-mcp-servers", (_event, profile?: string) =>
    listMcpServersForConnection(profile),
  );

  // Memory providers
  ipcMain.handle("discover-memory-providers", (_event, profile?: string) =>
    discoverMemoryProvidersForConnection(profile),
  );

  // Log viewer
  ipcMain.handle(
    "read-logs",
    (_event, logFile?: string, lines?: number, profile?: string) =>
      readLogsForConnection(logFile, lines, profile),
  );
}

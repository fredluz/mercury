import { app, shell, BrowserWindow, ipcMain, Menu } from "electron";
import { performance } from "perf_hooks";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import type { AppUpdater } from "electron-updater";
import icon from "../../resources/icon.png?asset";
import nightlyIcon from "../../resources/nightly-icon.png?asset";
import { getConnectionConfig } from "./config";
import { stopGateway, stopHealthPolling, setSshRemoteApiKey } from "./hermes";
import { startSshTunnel, stopSshTunnel } from "./ssh-tunnel";
import { stopAll as stopClaw3d } from "./claw3d";
import {
  sshGatewayStatus,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "./ssh-remote";
import { registerIpcHandlers, abortActiveChat } from "./ipc";
import { recordMemorySnapshot, recordPerfEvent } from "./perf/telemetry";

process.on("uncaughtException", (err) => {
  console.error("[MAIN UNCAUGHT]", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MAIN UNHANDLED REJECTION]", reason);
});

let mainWindow: BrowserWindow | null = null;

function recordStartupMark(name: string, meta?: Record<string, unknown>): void {
  recordPerfEvent({
    scope: "startup",
    name,
    phase: "mark",
    nowMs: performance.now(),
    meta,
  });
}

function resourceUsageSummary(): Record<string, number> | undefined {
  if (typeof process.resourceUsage !== "function") return undefined;
  const usage = process.resourceUsage();
  return {
    userCPUTime: usage.userCPUTime,
    systemCPUTime: usage.systemCPUTime,
    maxRSS: usage.maxRSS,
    fsRead: usage.fsRead,
    fsWrite: usage.fsWrite,
    voluntaryContextSwitches: usage.voluntaryContextSwitches,
    involuntaryContextSwitches: usage.involuntaryContextSwitches,
  };
}

function appMetricsSummary(): Record<string, unknown> | undefined {
  if (!app.isReady()) return undefined;
  const metrics = app.getAppMetrics();
  const byType = metrics.reduce<Record<string, number>>((acc, metric) => {
    acc[metric.type] = (acc[metric.type] ?? 0) + 1;
    return acc;
  }, {});
  const memoryWorkingSetSize = metrics.reduce(
    (sum, metric) => sum + (metric.memory?.workingSetSize ?? 0),
    0,
  );
  return {
    processCount: metrics.length,
    byType,
    memoryWorkingSetSize,
  };
}

function recordStartupMemory(name: string, meta?: Record<string, unknown>): void {
  recordMemorySnapshot("startup", name, {
    ...meta,
    resourceUsage: resourceUsageSummary(),
    appMetrics: appMetricsSummary(),
  });
}

recordStartupMark("main.module.evaluated", {
  platform: process.platform,
  packaged: app.isPackaged,
});

function createWindow(): void {
  recordStartupMark("window.create.start");
  recordStartupMemory("startup.memory.snapshot", { phaseName: "before-window-create" });

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === "linux" ? { icon: isNightlyBuild() ? nightlyIcon : icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true,
    },
  });

  recordStartupMark("window.create.end", {
    width: 1100,
    height: 750,
  });

  mainWindow.on("ready-to-show", () => {
    recordStartupMark("window.ready-to-show");
    recordStartupMemory("startup.memory.snapshot", { phaseName: "ready-to-show" });
    mainWindow!.show();
  });

  mainWindow.webContents.on("dom-ready", () => {
    recordStartupMark("window.dom-ready");
  });

  mainWindow.webContents.on("did-finish-load", () => {
    recordStartupMark("window.did-finish-load");
    recordStartupMemory("startup.memory.snapshot", { phaseName: "did-finish-load" });
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[CRASH] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
  });

  mainWindow.webContents.on(
    "console-message",
    (_event, level, message, line, sourceId) => {
      if (level >= 2) {
        console.error(`[RENDERER ERROR] ${message} (${sourceId}:${line})`);
      }
    },
  );

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[LOAD FAIL]", errorCode, errorDescription);
    },
  );

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  recordStartupMark("window.load.requested", {
    target: is.dev && process.env["ELECTRON_RENDERER_URL"] ? "dev-url" : "file",
  });
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "Chat",
      submenu: [
        {
          label: "New Chat",
          accelerator: "CmdOrCtrl+N",
          click: (): void => {
            mainWindow?.webContents.send("menu-new-chat");
          },
        },
        { type: "separator" },
        {
          label: "Search Sessions",
          accelerator: "CmdOrCtrl+K",
          click: (): void => {
            mainWindow?.webContents.send("menu-search-sessions");
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(is.dev
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }]),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Hermes Agent on GitHub",
          click: (): void => {
            shell.openExternal("https://github.com/NousResearch/hermes-agent/");
          },
        },
        {
          label: "Report an Issue",
          click: (): void => {
            shell.openExternal("https://github.com/fredluz/mercury/issues");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  recordStartupMark("menu.built", { itemCount: template.length });
}

function isNightlyBuild(): boolean {
  return app.getVersion().includes("-nightly.") || app.getName().toLowerCase().includes("nightly");
}

function setupUpdater(): void {
  // IPC handlers must always be registered to avoid invoke errors
  ipcMain.handle("get-app-version", () => app.getVersion());

  if (!app.isPackaged) {
    // Skip auto-update in dev mode
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => true);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // Dynamic import to avoid electron-updater issues in dev mode
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = isNightlyBuild();

  autoUpdater.on("update-available", (info) => {
    mainWindow?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    mainWindow?.webContents.send("update-downloaded");
  });

  autoUpdater.on("update-not-available", (info) => {
    mainWindow?.webContents.send("update-not-available", {
      version: info.version,
    });
  });

  autoUpdater.on("error", (err) => {
    mainWindow?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo?.version || null;
      return version && version !== app.getVersion() ? version : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle("download-update", () => {
    autoUpdater.downloadUpdate();
    return true;
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

app.whenReady().then(() => {
  recordStartupMark("app.whenReady.resolved");
  recordStartupMemory("startup.memory.snapshot", { phaseName: "app-ready" });

  const nightly = isNightlyBuild();
  app.name = nightly ? "Mercury Nightly" : "Mercury";
  electronApp.setAppUserModelId(
    nightly ? "com.fredluz.mercury.nightly" : "com.fredluz.mercury",
  );

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  buildMenu();
  recordStartupMark("ipc.register.start");
  registerIpcHandlers({ getMainWindow: () => mainWindow });
  recordStartupMark("ipc.register.end");
  createWindow();
  setupUpdater();

  // Auto-start SSH tunnel if configured
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh.host) {
    (async () => {
      if (!(await sshGatewayStatus(conn.ssh))) {
        await sshStartGateway(conn.ssh);
      }
      await startSshTunnel(conn.ssh);
      const key = await sshReadRemoteApiKey(conn.ssh);
      setSshRemoteApiKey(key);
    })().catch((err) => {
      console.error("[SSH TUNNEL] Failed to start on launch:", err);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopGateway();
    stopSshTunnel();
    stopClaw3d();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopHealthPolling();
  abortActiveChat();
  stopGateway();
  stopSshTunnel();
  stopClaw3d();
});

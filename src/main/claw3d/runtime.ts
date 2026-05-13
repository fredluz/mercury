import { spawn, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getEnhancedPath } from "../install/paths";
import { stripAnsi } from "../utils";
import { ADAPTER_PID_FILE, DEV_PID_FILE, HERMES_OFFICE_DIR, claw3dState, cleanupPid, findNpm, readPid, writePid } from "./shared";
import { getSavedPort, isAdapterRunning, isDevServerRunning } from "./config";

function killProcessTree(proc: ChildProcess): void {
  if (proc.pid) {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      try {
        proc.kill("SIGTERM");
      } catch {
        /* already dead */
      }
    }
    // Fallback: SIGKILL after 3 seconds
    setTimeout(() => {
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      } catch {
        /* already dead */
      }
    }, 3000);
  }
}

export function startDevServer(): boolean {
  if (isDevServerRunning()) return true;
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) return false;

  claw3dState.devServerError = "";
  claw3dState.devServerLogs = "";
  const port = getSavedPort();
  const npm = findNpm();
  const proc = spawn(npm, ["run", "dev"], {
    cwd: HERMES_OFFICE_DIR,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
      TERM: "dumb",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  claw3dState.devServerProcess = proc;
  if (proc.pid) writePid(DEV_PID_FILE, proc.pid);

  proc.stdout?.on("data", (data: Buffer) => {
    claw3dState.devServerLogs += stripAnsi(data.toString());
    // Keep only last 2000 chars
    if (claw3dState.devServerLogs.length > 2000) claw3dState.devServerLogs = claw3dState.devServerLogs.slice(-2000);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    claw3dState.devServerLogs += text;
    if (claw3dState.devServerLogs.length > 2000) claw3dState.devServerLogs = claw3dState.devServerLogs.slice(-2000);
    // Capture real errors (not warnings)
    if (
      /error|EADDRINUSE|ENOENT|failed|fatal/i.test(text) &&
      !/warning/i.test(text)
    ) {
      claw3dState.devServerError = text.trim().slice(0, 300);
    }
  });

  proc.on("close", (code) => {
    if (code && code !== 0 && !claw3dState.devServerError) {
      claw3dState.devServerError = `Dev server exited with code ${code}. Check if port ${port} is available.`;
    }
    claw3dState.devServerProcess = null;
    cleanupPid(DEV_PID_FILE);
  });

  proc.unref();
  return true;
}

export function stopDevServer(): void {
  if (claw3dState.devServerProcess) {
    killProcessTree(claw3dState.devServerProcess);
    claw3dState.devServerProcess = null;
  }

  const pid = readPid(DEV_PID_FILE);
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
  cleanupPid(DEV_PID_FILE);
}

export function startAdapter(): boolean {
  if (isAdapterRunning()) return true;
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) return false;

  claw3dState.adapterError = "";
  claw3dState.adapterLogs = "";
  const npm = findNpm();
  const proc = spawn(npm, ["run", "hermes-adapter"], {
    cwd: HERMES_OFFICE_DIR,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
      TERM: "dumb",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  claw3dState.adapterProcess = proc;
  if (proc.pid) writePid(ADAPTER_PID_FILE, proc.pid);

  proc.stdout?.on("data", (data: Buffer) => {
    claw3dState.adapterLogs += stripAnsi(data.toString());
    if (claw3dState.adapterLogs.length > 2000) claw3dState.adapterLogs = claw3dState.adapterLogs.slice(-2000);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = stripAnsi(data.toString());
    claw3dState.adapterLogs += text;
    if (claw3dState.adapterLogs.length > 2000) claw3dState.adapterLogs = claw3dState.adapterLogs.slice(-2000);
    if (
      /error|EADDRINUSE|ENOENT|failed|fatal/i.test(text) &&
      !/warning/i.test(text)
    ) {
      claw3dState.adapterError = text.trim().slice(0, 300);
    }
  });

  proc.on("close", (code) => {
    if (code && code !== 0 && !claw3dState.adapterError) {
      claw3dState.adapterError = `Hermes adapter exited with code ${code}`;
    }
    claw3dState.adapterProcess = null;
    cleanupPid(ADAPTER_PID_FILE);
  });

  proc.unref();
  return true;
}

export function stopAdapter(): void {
  if (claw3dState.adapterProcess) {
    killProcessTree(claw3dState.adapterProcess);
    claw3dState.adapterProcess = null;
  }

  const pid = readPid(ADAPTER_PID_FILE);
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already dead */
      }
    }
  }
  cleanupPid(ADAPTER_PID_FILE);
}

export function startAll(): { success: boolean; error?: string } {
  if (!existsSync(join(HERMES_OFFICE_DIR, "node_modules"))) {
    return {
      success: false,
      error: "Claw3D is not installed. Please install it first.",
    };
  }

  const port = getSavedPort();

  // Start dev server
  const devOk = startDevServer();
  if (!devOk) {
    return {
      success: false,
      error: `Failed to start dev server on port ${port}`,
    };
  }

  // Start adapter
  const adapterOk = startAdapter();
  if (!adapterOk) {
    return { success: false, error: "Failed to start Hermes adapter" };
  }

  return { success: true };
}

export function stopAll(): void {
  stopDevServer();
  stopAdapter();
  claw3dState.devServerError = "";
  claw3dState.adapterError = "";
}

export function getClaw3dLogs(): string {
  return [
    claw3dState.devServerLogs ? `=== Dev Server ===\n${claw3dState.devServerLogs}` : "",
    claw3dState.adapterLogs ? `=== Adapter ===\n${claw3dState.adapterLogs}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

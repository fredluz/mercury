import type { ChildProcess } from "child_process";
import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getEnhancedPath, HERMES_HOME } from "../install/paths";
import { safeWriteFile } from "../utils";

export const HERMES_OFFICE_REPO = "https://github.com/fathah/hermes-office";
export const HERMES_OFFICE_DIR = join(HERMES_HOME, "hermes-office");
export const DEV_PID_FILE = join(HERMES_HOME, "claw3d-dev.pid");
export const ADAPTER_PID_FILE = join(HERMES_HOME, "claw3d-adapter.pid");
export const PORT_FILE = join(HERMES_HOME, "claw3d-port");
export const WS_URL_FILE = join(HERMES_HOME, "claw3d-ws-url");
export const DEFAULT_PORT = 3000;
export const DEFAULT_WS_URL = "ws://localhost:18789";
export const CLAW3D_SETTINGS_DIR = join(homedir(), ".openclaw", "claw3d");

export const claw3dState: {
  devServerProcess: ChildProcess | null;
  adapterProcess: ChildProcess | null;
  devServerLogs: string;
  adapterLogs: string;
  devServerError: string;
  adapterError: string;
  cachedNpmPath: string | null;
} = {
  devServerProcess: null,
  adapterProcess: null,
  devServerLogs: "",
  adapterLogs: "",
  devServerError: "",
  adapterError: "",
  cachedNpmPath: null,
};

export function isProcessRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function readPid(file: string): number | null {
  try { const pid = parseInt(readFileSync(file, "utf-8").trim(), 10); return isNaN(pid) ? null : pid; } catch { return null; }
}

export function writePid(file: string, pid: number): void { safeWriteFile(file, String(pid)); }

export function cleanupPid(file: string): void { try { unlinkSync(file); } catch { /* ignore */ } }

export function findNpm(): string {
  if (claw3dState.cachedNpmPath) return claw3dState.cachedNpmPath;
  const home = homedir();
  const candidates = [
    join(home, ".volta", "bin", "npm"),
    join(home, ".asdf", "shims", "npm"),
    join(home, ".local", "share", "fnm", "aliases", "default", "bin", "npm"),
    join(home, ".fnm", "aliases", "default", "bin", "npm"),
    "/usr/local/bin/npm",
    "/opt/homebrew/bin/npm",
  ];
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const nvmVersions = join(nvmDir, "versions", "node");
  if (existsSync(nvmVersions)) {
    try {
      const versions = readdirSync(nvmVersions).filter((d: string) => d.startsWith("v")).sort().reverse();
      for (const v of versions) candidates.unshift(join(nvmVersions, v, "bin", "npm"));
    } catch { /* non-fatal */ }
  }
  for (const c of candidates) {
    if (existsSync(c)) { claw3dState.cachedNpmPath = c; return c; }
  }
  try {
    const npmPath = execSync("which npm 2>/dev/null || where npm 2>/dev/null", { env: { ...process.env, PATH: getEnhancedPath() }, timeout: 5000 })
      .toString().trim().split("\n")[0];
    if (npmPath && existsSync(npmPath)) { claw3dState.cachedNpmPath = npmPath; return npmPath; }
  } catch { /* fall through */ }
  claw3dState.cachedNpmPath = "npm";
  return "npm";
}

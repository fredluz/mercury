import { execFile, execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, delimiter } from "path";
import { homedir } from "os";
import { getModelConfig, getConnectionConfig } from "../config";
import { stripAnsi } from "../utils";

const IS_WINDOWS = process.platform === "win32";

export const HERMES_HOME =
  process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes");
export const HERMES_REPO = join(HERMES_HOME, "hermes-agent");
export const HERMES_VENV = join(HERMES_REPO, "venv");
export const HERMES_PYTHON = IS_WINDOWS
  ? join(HERMES_VENV, "Scripts", "python.exe")
  : join(HERMES_VENV, "bin", "python");
export const HERMES_SCRIPT = join(HERMES_REPO, "hermes");
export const HERMES_ENV_FILE = join(HERMES_HOME, ".env");
export const HERMES_CONFIG_FILE = join(HERMES_HOME, "config.yaml");
export const HERMES_AUTH_FILE = join(HERMES_HOME, "auth.json");

export interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
}

export interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

export function getEnhancedPath(): string {
  const home = homedir();
  const extra: string[] = IS_WINDOWS
    ? [
        // Bundled by install.ps1 inside HERMES_HOME — these matter when the
        // user's system PATH doesn't include git or node yet.
        join(HERMES_HOME, "git", "bin"),
        join(HERMES_HOME, "git", "cmd"),
        join(HERMES_HOME, "git", "usr", "bin"),
        join(HERMES_HOME, "node"),
        join(HERMES_VENV, "Scripts"),
        // Where `uv` lands when astral.sh's installer runs.
        join(home, ".local", "bin"),
        join(home, ".cargo", "bin"),
      ]
    : [
        join(home, ".local", "bin"),
        join(home, ".cargo", "bin"),
        join(HERMES_VENV, "bin"),
        // Node version manager shim directories
        join(home, ".volta", "bin"),
        join(home, ".asdf", "shims"),
        join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
        join(home, ".fnm", "aliases", "default", "bin"),
        ...resolveNvmBin(home),
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
      ];
  return [...extra, process.env.PATH || ""].join(delimiter);
}

/** Resolve the active nvm node version's bin directory. */
function resolveNvmBin(home: string): string[] {
  const nvmDir = process.env.NVM_DIR || join(home, ".nvm");
  const versionsDir = join(nvmDir, "versions", "node");
  if (!existsSync(versionsDir)) return [];
  try {
    // Try to read the default alias to find the active version
    const aliasFile = join(nvmDir, "alias", "default");
    if (existsSync(aliasFile)) {
      const alias = readFileSync(aliasFile, "utf-8").trim();
      // alias can be a full version "v20.11.0" or a partial "20" or "lts/*"
      if (alias.startsWith("v")) {
        const bin = join(versionsDir, alias, "bin");
        if (existsSync(bin)) return [bin];
      }
    }
    // Fallback: pick the latest installed version
    const versions = (readdirSync(versionsDir) as string[])
      .filter((d: string) => d.startsWith("v"))
      .sort()
      .reverse();
    if (versions.length > 0) {
      return [join(versionsDir, versions[0], "bin")];
    }
  } catch {
    /* non-fatal */
  }
  return [];
}

export function hasHermesAuthCredential(provider: string): boolean {
  if (!provider || !existsSync(HERMES_AUTH_FILE)) return false;
  try {
    const auth = JSON.parse(readFileSync(HERMES_AUTH_FILE, "utf-8")) as {
      active_provider?: string;
      credential_pool?: Record<string, unknown[]>;
      providers?: Record<string, unknown>;
    };
    const pool = auth.credential_pool?.[provider];
    if (Array.isArray(pool) && pool.length > 0) return true;
    if (auth.active_provider === provider) return true;
    return Boolean(auth.providers?.[provider]);
  } catch {
    return false;
  }
}

export function checkInstallStatus(): InstallStatus {
  // Remote mode: skip local checks entirely
  const conn = getConnectionConfig();
  if (conn.mode === "remote" && conn.remoteUrl) {
    return {
      installed: true,
      configured: true,
      hasApiKey: true,
      verified: true,
    };
  }

  // Fast path: file existence is enough to gate the UI. The deep
  // `python --version` check used to run here adds 1–10s of cold-start
  // latency, so it now lives in `verifyInstall()` and is invoked lazily
  // by the renderer after the main UI is mounted.
  const installed = existsSync(HERMES_PYTHON) && existsSync(HERMES_SCRIPT);
  const configured = existsSync(HERMES_ENV_FILE);
  let hasApiKey = false;
  const verified = installed;

  // Local/custom providers don't need an API key. OAuth-backed providers
  // can be configured through Hermes auth.json instead of .env.
  try {
    const mc = getModelConfig();
    const localProviders = ["custom", "lmstudio", "ollama", "vllm", "llamacpp"];
    if (
      localProviders.includes(mc.provider) ||
      hasHermesAuthCredential(mc.provider)
    ) {
      hasApiKey = true;
    }
  } catch {
    /* ignore */
  }

  if (!hasApiKey && configured) {
    try {
      const content = readFileSync(HERMES_ENV_FILE, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#")) continue;
        const match = trimmed.match(
          /^(OPENROUTER_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY|OPENCODE_ZEN_API_KEY|OPENCODE_GO_API_KEY)=(.+)$/,
        );
        if (
          match &&
          match[2].trim() &&
          !['""', "''", ""].includes(match[2].trim())
        ) {
          hasApiKey = true;
          break;
        }
      }
    } catch {
      /* ignore read errors */
    }
  }

  return { installed, configured, hasApiKey, verified };
}

// Lazy background verification: actually invoke Python to confirm the
// install runs. Called from the renderer after the UI is already up.
let _verifyCache: { ok: boolean; ts: number } | null = null;
const VERIFY_TTL_MS = 5 * 60 * 1000;

export async function verifyInstall(): Promise<boolean> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) return false;
  if (_verifyCache && Date.now() - _verifyCache.ts < VERIFY_TTL_MS) {
    return _verifyCache.ok;
  }
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "--version"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 15000,
      },
      (error) => {
        const ok = !error;
        _verifyCache = { ok, ts: Date.now() };
        resolve(ok);
      },
    );
  });
}

// Cached version to avoid re-running the Python process
let _cachedVersion: string | null = null;
let _versionFetching = false;

export async function getHermesVersion(): Promise<string | null> {
  if (_cachedVersion !== null) return _cachedVersion;
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) return null;
  if (_versionFetching) {
    // Wait for in-flight fetch
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (!_versionFetching) {
          clearInterval(check);
          resolve(_cachedVersion);
        }
      }, 100);
    });
  }
  _versionFetching = true;
  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "--version"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        timeout: 15000,
      },
      (error, stdout) => {
        _versionFetching = false;
        if (error) {
          resolve(null);
        } else {
          _cachedVersion = stdout.toString().trim();
          resolve(_cachedVersion);
        }
      },
    );
  });
}

export function clearVersionCache(): void {
  _cachedVersion = null;
}

export function runHermesDoctor(): string {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return "Hermes is not installed.";
  }
  try {
    const output = execSync(`"${HERMES_PYTHON}" "${HERMES_SCRIPT}" doctor`, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    return stripAnsi(output.toString());
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() || "";
    return stripAnsi(stderr) || "Doctor check failed.";
  }
}

const OPENCLAW_DIR_NAMES = [".openclaw", ".clawdbot", ".moldbot"];

export function checkOpenClawExists(): { found: boolean; path: string | null } {
  for (const name of OPENCLAW_DIR_NAMES) {
    const dir = join(homedir(), name);
    if (existsSync(dir)) {
      return { found: true, path: dir };
    }
  }
  return { found: false, path: null };
}

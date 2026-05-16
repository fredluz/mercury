import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import http from "http";
import https from "https";
import { getConnectionConfig } from "../config";
import { profileHome } from "../utils";
import { getSshTunnelUrl, isSshTunnelActive, isSshTunnelHealthy, startSshTunnel } from "../ssh-tunnel";

const LOCAL_API_HOST = "127.0.0.1";
const LOCAL_API_PORT = 8642;
const LOCAL_API_URL = `http://${LOCAL_API_HOST}:${LOCAL_API_PORT}`;

function normalizeProfile(profile?: string): string {
  const trimmed = profile?.trim();
  return trimmed && trimmed !== "default" ? trimmed : "default";
}

function stableProfilePort(profile: string): number {
  if (profile === "default") return LOCAL_API_PORT;
  let hash = 0;
  for (const char of profile) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return 18_642 + (hash % 10_000);
}

export function defaultLocalApiPortForProfile(profile?: string): number {
  return stableProfilePort(normalizeProfile(profile));
}

function configPathForProfile(profile?: string): string {
  return join(profileHome(profile), "config.yaml");
}

function readConfiguredApiPort(profile?: string): number | null {
  try {
    const configPath = configPathForProfile(profile);
    if (!existsSync(configPath)) return null;
    const content = readFileSync(configPath, "utf-8");
    const apiBlock = content.match(/api_server:[\s\S]*?(?:\n\S|$)/i)?.[0] ?? content;
    const portMatch = apiBlock.match(/\bport:\s*(\d+)/i);
    if (!portMatch) return null;
    const port = Number(portMatch[1]);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function getLocalApiPort(profile?: string): number {
  return readConfiguredApiPort(profile) ?? defaultLocalApiPortForProfile(profile);
}

export function getLocalApiUrl(profile?: string): string {
  const port = getLocalApiPort(profile);
  return `http://${LOCAL_API_HOST}:${port}`;
}

export function getApiUrl(profile?: string): string {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh") {
    const sshUrl = getSshTunnelUrl(profile, conn.ssh);
    if (!sshUrl) throw new Error("SSH tunnel is not active");
    return sshUrl;
  }
  if (conn.mode === "remote" && conn.remoteUrl) {
    return conn.remoteUrl.replace(/\/+$/, "");
  }
  return profile ? getLocalApiUrl(profile) : LOCAL_API_URL;
}

export function isRemoteMode(): boolean {
  const mode = getConnectionConfig().mode;
  return mode === "remote" || mode === "ssh";
}

/** True only for pure remote HTTP — SSH tunnel has full local access via SSH exec */
export function isRemoteOnlyMode(): boolean {
  return getConnectionConfig().mode === "remote";
}

// Cached API key read from the remote .env when SSH tunnel starts
const _sshRemoteApiKeys = new Map<string, string>();

export function setSshRemoteApiKey(key: string, profile?: string): void {
  _sshRemoteApiKeys.set(normalizeProfile(profile), key);
}

export function getRemoteAuthHeader(profile?: string): Record<string, string> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh") {
    const key = _sshRemoteApiKeys.get(normalizeProfile(profile));
    if (key)
      return { Authorization: `Bearer ${key}` };
    return {};
  }
  if (conn.mode === "remote" && conn.apiKey) {
    return { Authorization: `Bearer ${conn.apiKey}` };
  }
  return {};
}

export async function ensureSshTunnelIfNeeded(profile?: string): Promise<void> {
  const conn = getConnectionConfig();
  if (
    conn.mode === "ssh" &&
    (!isSshTunnelActive(conn.ssh, profile) || !(await isSshTunnelHealthy(conn.ssh, profile)))
  ) {
    await startSshTunnel(conn.ssh, profile);
  }
}

export function isApiServerReady(
  apiBaseUrl = getApiUrl(),
  authHeaders: Record<string, string> = getRemoteAuthHeader(),
): Promise<boolean> {
  return new Promise((resolve) => {
    const url = `${apiBaseUrl}/health`;
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(
      url,
      { method: "GET", timeout: 1500, headers: authHeaders },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

// ────────────────────────────────────────────────────
//  Ensure API server is enabled in config
// ────────────────────────────────────────────────────

function apiServerConfigBlock(profile?: string): string {
  return `
# Desktop app API server (auto-configured)
platforms:
  api_server:
    enabled: true
    extra:
      port: ${defaultLocalApiPortForProfile(profile)}
      host: "${LOCAL_API_HOST}"
`;
}

export function ensureApiServerConfig(profile?: string): void {
  try {
    const configPath = configPathForProfile(profile);
    const addition = apiServerConfigBlock(profile);
    if (!existsSync(configPath)) {
      mkdirSync(join(configPath, ".."), { recursive: true });
      writeFileSync(configPath, addition.trimStart(), "utf-8");
      return;
    }
    const content = readFileSync(configPath, "utf-8");
    // If api_server is already configured, preserve the user's explicit config.
    if (/api_server/i.test(content)) return;
    appendFileSync(configPath, addition, "utf-8");
  } catch {
    /* non-fatal */
  }
}


export function testRemoteConnection(
  url: string,
  apiKey?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const target = `${url.replace(/\/+$/, "")}/health`;
    const mod = target.startsWith("https") ? https : http;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const req = mod.request(
      target,
      { method: "GET", timeout: 5000, headers },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

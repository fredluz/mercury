import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import http from "http";
import https from "https";
import { getConnectionConfig } from "../config";
import { profileHome } from "../utils";
import { getSshTunnelUrl, isSshTunnelActive, isSshTunnelHealthy, startSshTunnel } from "../ssh-tunnel";
import type {
  HermesCapabilityDescriptor,
  HermesCapabilityGateResult,
} from "./types";

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
    const apiBlocks = [...content.matchAll(/api_server:[\s\S]*?(?=\n\S|$)/gi)].map(
      (match) => match[0],
    );
    const apiBlock = apiBlocks.at(-1) ?? content;
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

const REQUIRED_CAPABILITY_FEATURES = ["run_submission", "session_resources"] as const;
const OPTIONAL_CAPABILITY_FEATURES = [
  "run_events_sse",
  "run_stop",
  "run_approval_response",
] as const;

function requestJson(
  url: string,
  authHeaders: Record<string, string>,
  timeoutMs: number,
): Promise<{ statusCode: number; raw: string }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(
      url,
      { method: "GET", timeout: timeoutMs, headers: authHeaders },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, raw });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Capability probe timed out."));
    });
    req.end();
  });
}

function parseErrorCode(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    return parsed?.error?.code;
  } catch {
    return undefined;
  }
}

function featureSummary(features: Record<string, unknown>): Record<string, boolean> {
  const summary: Record<string, boolean> = {
    runSubmission: features.run_submission === true,
    sessionResources: features.session_resources === true,
  };
  for (const feature of OPTIONAL_CAPABILITY_FEATURES) {
    summary[feature.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())] =
      features[feature] === true;
  }
  return summary;
}

function normalizeCapabilities(payload: unknown): HermesCapabilityDescriptor | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const features =
    record.features && typeof record.features === "object"
      ? (record.features as Record<string, unknown>)
      : null;
  if (!features) return null;
  const endpoints =
    record.endpoints && typeof record.endpoints === "object"
      ? (record.endpoints as HermesCapabilityDescriptor["endpoints"])
      : {};
  const auth =
    record.auth && typeof record.auth === "object"
      ? (record.auth as Record<string, unknown>)
      : {};
  return {
    object: typeof record.object === "string" ? record.object : undefined,
    platform: typeof record.platform === "string" ? record.platform : undefined,
    model: typeof record.model === "string" ? record.model : undefined,
    authRequired: auth.required === true,
    features: Object.fromEntries(
      Object.entries(features).filter(([, value]) => typeof value === "boolean"),
    ) as Record<string, boolean>,
    endpoints,
    sessionContinuationHeader:
      typeof features.session_continuity_header === "string"
        ? features.session_continuity_header
        : undefined,
    sessionKeyHeader:
      typeof features.session_key_header === "string"
        ? features.session_key_header
        : undefined,
  };
}

export async function probeHermesCapabilities(
  apiBaseUrl: string,
  authHeaders: Record<string, string> = {},
): Promise<HermesCapabilityGateResult> {
  const healthOk = await isApiServerReady(apiBaseUrl, authHeaders);
  if (!healthOk) {
    return {
      ok: false,
      healthOk,
      problem: "network",
      message: "Hermes API health check failed.",
    };
  }

  try {
    const { statusCode, raw } = await requestJson(
      `${apiBaseUrl.replace(/\/+$/, "")}/v1/capabilities`,
      authHeaders,
      5000,
    );
    if (statusCode === 401 && parseErrorCode(raw) === "invalid_api_key") {
      return {
        ok: false,
        healthOk,
        problem: "invalid-api-key",
        statusCode,
        message: "Hermes gateway rejected Mercury's API key.",
      };
    }
    if (statusCode >= 400) {
      return {
        ok: false,
        healthOk,
        problem: "network",
        statusCode,
        message: `Hermes capability probe failed with HTTP ${statusCode}.`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ok: false,
        healthOk,
        problem: "malformed",
        statusCode,
        message: "Hermes capability response was not valid JSON.",
      };
    }
    const descriptor = normalizeCapabilities(parsed);
    if (!descriptor) {
      return {
        ok: false,
        healthOk,
        problem: "malformed",
        statusCode,
        message: "Hermes capability response did not include a features object.",
      };
    }
    const missingFeatures = REQUIRED_CAPABILITY_FEATURES.filter(
      (feature) => descriptor.features[feature] !== true,
    );
    const summary = featureSummary(descriptor.features);
    if (missingFeatures.length > 0) {
      return {
        ok: false,
        healthOk,
        problem: "missing-required-features",
        statusCode,
        missingFeatures: [...missingFeatures],
        featureSummary: summary,
        message: `Hermes must be updated before Mercury can chat. Missing capabilities: ${missingFeatures.join(", ")}.`,
      };
    }
    return {
      ok: true,
      healthOk,
      descriptor,
      featureSummary: summary,
    };
  } catch (error) {
    return {
      ok: false,
      healthOk,
      problem: "network",
      message:
        error instanceof Error
          ? error.message
          : "Hermes capability probe failed.",
    };
  }
}

// ────────────────────────────────────────────────────
//  Ensure API server is enabled in config
// ────────────────────────────────────────────────────

const MERCURY_API_SERVER_CONFIG_START = "# Mercury desktop API server config start";
const MERCURY_API_SERVER_CONFIG_END = "# Mercury desktop API server config end";

function apiServerConfigBlock(profile?: string): string {
  return `
${MERCURY_API_SERVER_CONFIG_START}
platforms:
  api_server:
    enabled: true
    extra:
      port: ${defaultLocalApiPortForProfile(profile)}
      host: "${LOCAL_API_HOST}"
${MERCURY_API_SERVER_CONFIG_END}
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
    const managedBlock = new RegExp(
      `${escapeRegExp(MERCURY_API_SERVER_CONFIG_START)}[\\s\\S]*?${escapeRegExp(MERCURY_API_SERVER_CONFIG_END)}\\n?`,
      "m",
    );
    if (managedBlock.test(content)) {
      writeFileSync(configPath, content.replace(managedBlock, addition.trimStart()), "utf-8");
      return;
    }
    // A stale/disabled api_server block can leave Mercury attached to an old
    // gateway surface. Append Mercury's managed block so our enabled host/port
    // wins without deleting user-authored config.
    appendFileSync(configPath, addition, "utf-8");
  } catch {
    /* non-fatal */
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

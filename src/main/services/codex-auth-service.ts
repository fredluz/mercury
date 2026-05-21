import { chmodSync, existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { HERMES_AUTH_FILE } from "../installer";
import { getModelConfig, setModelConfig } from "../config";
import { addModel } from "../models";
import { safeWriteFile } from "../utils";

const CODEX_ISSUER = "https://auth.openai.com";
const CODEX_DEVICE_URL = `${CODEX_ISSUER}/codex/device`;
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = `${CODEX_ISSUER}/oauth/token`;
const CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_CODEX_MODEL = "gpt-5.5";
const MAX_WAIT_MS = 15 * 60 * 1000;

interface PendingCodexAuth {
  sessionId: string;
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
  expiresAt: number;
}

interface CodexTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

const pendingAuth = new Map<string, PendingCodexAuth>();

function nowIso(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

function readJsonFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function authStoreHasProvider(
  store: Record<string, unknown>,
  provider: string,
): boolean {
  const providers = store.providers;
  if (providers && typeof providers === "object" && provider in providers)
    return true;
  const pool = store.credential_pool;
  if (pool && typeof pool === "object") {
    const entries = (pool as Record<string, unknown>)[provider];
    if (Array.isArray(entries) && entries.length > 0) return true;
  }
  return store.active_provider === provider;
}

function writeHermesCodexTokens(tokens: Required<CodexTokenResponse>): void {
  const store = readJsonFile(HERMES_AUTH_FILE);
  const providers =
    store.providers &&
    typeof store.providers === "object" &&
    !Array.isArray(store.providers)
      ? (store.providers as Record<string, unknown>)
      : {};
  const previous =
    providers["openai-codex"] && typeof providers["openai-codex"] === "object"
      ? (providers["openai-codex"] as Record<string, unknown>)
      : {};

  providers["openai-codex"] = {
    ...previous,
    tokens,
    last_refresh: nowIso(),
    auth_mode: "chatgpt",
    base_url: CODEX_BASE_URL,
  };

  store.version = 1;
  store.providers = providers;
  store.active_provider = "openai-codex";
  store.updated_at = nowIso();
  safeWriteFile(HERMES_AUTH_FILE, `${JSON.stringify(store, null, 2)}\n`);
  try {
    chmodSync(HERMES_AUTH_FILE, 0o600);
  } catch {
    // Best-effort on platforms that support POSIX mode bits.
  }
}

async function postJson(
  url: string,
  body: Record<string, unknown>,
): Promise<{
  status: number;
  payload: Record<string, unknown>;
  text: string;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // Keep text for diagnostics.
  }
  return { status: response.status, payload, text };
}

async function postForm(
  url: string,
  body: Record<string, string>,
): Promise<{
  status: number;
  payload: Record<string, unknown>;
  text: string;
}> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // Keep text for diagnostics.
  }
  return { status: response.status, payload, text };
}

function cleanupExpired(): void {
  const now = Date.now();
  for (const [sessionId, pending] of pendingAuth.entries()) {
    if (pending.expiresAt <= now) pendingAuth.delete(sessionId);
  }
}

export function getCodexAuthStatus(profile?: string): {
  hasHermesAuth: boolean;
  hasCodexCliAuth: boolean;
  selectedProvider: string;
  selectedModel: string;
  hermesAuthPath: string;
  codexAuthPath: string;
} {
  const hermesStore = readJsonFile(HERMES_AUTH_FILE);
  const codexAuthPath = join(homedir(), ".codex", "auth.json");
  const modelConfig = getModelConfig(profile);
  return {
    hasHermesAuth: authStoreHasProvider(hermesStore, "openai-codex"),
    hasCodexCliAuth: existsSync(codexAuthPath),
    selectedProvider: modelConfig.provider,
    selectedModel: modelConfig.model,
    hermesAuthPath: HERMES_AUTH_FILE,
    codexAuthPath,
  };
}

export async function startCodexDeviceAuth(): Promise<{
  sessionId: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: number;
}> {
  cleanupExpired();
  const response = await postJson(
    `${CODEX_ISSUER}/api/accounts/deviceauth/usercode`,
    {
      client_id: CODEX_CLIENT_ID,
    },
  );
  if (response.status !== 200) {
    throw new Error(
      `Device code request failed (${response.status}): ${response.text || "empty response"}`,
    );
  }

  const userCode = String(response.payload.user_code || "");
  const deviceAuthId = String(response.payload.device_auth_id || "");
  const intervalSeconds = Math.max(3, Number(response.payload.interval || 5));
  if (!userCode || !deviceAuthId) {
    throw new Error(
      "Device code response was missing the user code or device auth id.",
    );
  }

  const sessionId = randomUUID();
  const expiresAt = Date.now() + MAX_WAIT_MS;
  pendingAuth.set(sessionId, {
    sessionId,
    deviceAuthId,
    userCode,
    intervalSeconds,
    expiresAt,
  });

  return {
    sessionId,
    userCode,
    verificationUri: CODEX_DEVICE_URL,
    intervalSeconds,
    expiresAt,
  };
}

export async function pollCodexDeviceAuth(
  sessionId: string,
  profile?: string,
): Promise<{
  status: "pending" | "authenticated" | "expired" | "error";
  message?: string;
  provider?: string;
  model?: string;
}> {
  cleanupExpired();
  const pending = pendingAuth.get(sessionId);
  if (!pending)
    return { status: "expired", message: "This Codex login session expired." };

  const poll = await postJson(`${CODEX_ISSUER}/api/accounts/deviceauth/token`, {
    device_auth_id: pending.deviceAuthId,
    user_code: pending.userCode,
  });

  if (poll.status === 403 || poll.status === 404) {
    return { status: "pending" };
  }
  if (poll.status !== 200) {
    return {
      status: "error",
      message: `Device auth polling failed (${poll.status}): ${poll.text || "empty response"}`,
    };
  }

  const authorizationCode = String(poll.payload.authorization_code || "");
  const codeVerifier = String(poll.payload.code_verifier || "");
  if (!authorizationCode || !codeVerifier) {
    return {
      status: "error",
      message:
        "Device auth response was missing the authorization code or verifier.",
    };
  }

  const token = await postForm(CODEX_TOKEN_URL, {
    grant_type: "authorization_code",
    code: authorizationCode,
    redirect_uri: `${CODEX_ISSUER}/deviceauth/callback`,
    client_id: CODEX_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  if (token.status !== 200) {
    return {
      status: "error",
      message: `Token exchange failed (${token.status}): ${token.text || "empty response"}`,
    };
  }

  const accessToken = String(token.payload.access_token || "");
  const refreshToken = String(token.payload.refresh_token || "");
  if (!accessToken || !refreshToken) {
    return {
      status: "error",
      message: "Token exchange did not return both access and refresh tokens.",
    };
  }

  writeHermesCodexTokens({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  configureCodexAppServer(profile);
  pendingAuth.delete(sessionId);
  return {
    status: "authenticated",
    provider: "openai-codex",
    model: DEFAULT_CODEX_MODEL,
  };
}

export function configureCodexAppServer(profile?: string): {
  provider: string;
  model: string;
} {
  setModelConfig("openai-codex", DEFAULT_CODEX_MODEL, "", profile);
  addModel("Codex app server", "openai-codex", DEFAULT_CODEX_MODEL, "");
  return { provider: "openai-codex", model: DEFAULT_CODEX_MODEL };
}

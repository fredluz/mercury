/* eslint-disable @typescript-eslint/explicit-function-return-type */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { blocker } from "./constants.mjs";

export const readOpenCodeGoKey = () => {
  const authPath = path.join(
    os.homedir(),
    ".local",
    "share",
    "opencode",
    "auth.json",
  );
  if (!fs.existsSync(authPath)) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    return auth["opencode-go"]?.key || null;
  } catch {
    return null;
  }
};

export const readHermesAuth = () => {
  const authPath = path.join(os.homedir(), ".hermes", "auth.json");
  if (!fs.existsSync(authPath)) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const hasCredential = Boolean(
      auth.active_provider ||
      (auth.providers && Object.keys(auth.providers).length) ||
      (auth.credential_pool && Object.keys(auth.credential_pool).length),
    );
    return hasCredential ? { path: authPath, auth } : null;
  } catch {
    return null;
  }
};

export const hasHermesProvider = (auth, provider) =>
  Boolean(
    auth?.active_provider === provider ||
      auth?.providers?.[provider] ||
      auth?.credential_pool?.[provider]?.length,
  );

export const readCodexCliAuth = () => {
  const authPath = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "auth.json",
  );
  if (!fs.existsSync(authPath)) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (!auth?.tokens?.access_token || !auth?.tokens?.refresh_token) return null;
    return {
      active_provider: "openai-codex",
      providers: {
        "openai-codex": {
          tokens: auth.tokens,
          last_refresh: auth.last_refresh,
          auth_mode: auth.auth_mode || "chatgpt",
        },
      },
    };
  } catch {
    return null;
  }
};

export const discoverCredentials = () => {
  const explicitProvider = process.env.TRACE_LAB_E2E_PROVIDER;
  const explicitModel = process.env.TRACE_LAB_E2E_MODEL;
  const explicitBaseUrl = process.env.TRACE_LAB_E2E_BASE_URL || "";
  const explicitKeyEnv = process.env.TRACE_LAB_E2E_API_KEY_ENV;
  const explicitKey =
    process.env.TRACE_LAB_E2E_API_KEY ||
    (explicitKeyEnv ? process.env[explicitKeyEnv] : "");

  if (explicitProvider && !explicitModel) {
    throw blocker(
      "TRACE_LAB_E2E_PROVIDER was set, but TRACE_LAB_E2E_MODEL is missing. Set both to constrain the hardening run to a specific provider.",
    );
  }

  if (explicitProvider && explicitModel) {
    const hermesAuth = readHermesAuth();
    if (explicitKey) {
      const providerKey = `${explicitProvider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
      return {
        source: explicitKeyEnv
          ? `TRACE_LAB_E2E_API_KEY_ENV=${explicitKeyEnv}`
          : "TRACE_LAB_E2E_API_KEY",
        provider: explicitProvider,
        model: explicitModel,
        baseUrl: explicitBaseUrl,
        env: {
          [providerKey]: explicitKey,
          ...(explicitKeyEnv ? { [explicitKeyEnv]: explicitKey } : {}),
        },
        auth: { active_provider: explicitProvider },
      };
    }
    if (hermesAuth) {
      return {
        source: "local ~/.hermes/auth.json",
        provider: explicitProvider,
        model: explicitModel,
        baseUrl: explicitBaseUrl,
        env: {},
        authPath: hermesAuth.path,
        auth: hermesAuth.auth,
      };
    }
    throw blocker(
      `TRACE_LAB_E2E_PROVIDER=${explicitProvider} and TRACE_LAB_E2E_MODEL=${explicitModel} were set, but no matching explicit key or local Hermes auth was found. Set TRACE_LAB_E2E_API_KEY(_ENV) or configure ~/.hermes/auth.json.`,
    );
  }

  const hermesAuth = readHermesAuth();
  if (hermesAuth && hasHermesProvider(hermesAuth.auth, "openai-codex")) {
    return {
      source: "local ~/.hermes/auth.json openai-codex",
      provider: "openai-codex",
      model: explicitModel || "gpt-5.5",
      baseUrl: explicitBaseUrl || "https://chatgpt.com/backend-api/codex",
      env: {},
      authPath: hermesAuth.path,
      auth: hermesAuth.auth,
      imageGenProvider: "openai-codex",
    };
  }

  const codexCliAuth = readCodexCliAuth();
  if (codexCliAuth) {
    return {
      source: "local ~/.codex/auth.json ChatGPT/Codex OAuth",
      provider: "openai-codex",
      model: explicitModel || "gpt-5.5",
      baseUrl: explicitBaseUrl || "https://chatgpt.com/backend-api/codex",
      env: {},
      auth: codexCliAuth,
      imageGenProvider: "openai-codex",
    };
  }

  if (process.env.OPENCODE_GO_API_KEY || readOpenCodeGoKey()) {
    return {
      source: process.env.OPENCODE_GO_API_KEY
        ? "OPENCODE_GO_API_KEY"
        : "local OpenCode auth",
      provider: "opencode-go",
      model: explicitModel || "deepseek-v4-flash",
      baseUrl: explicitBaseUrl,
      env: {
        OPENCODE_GO_API_KEY:
          process.env.OPENCODE_GO_API_KEY || readOpenCodeGoKey(),
      },
      auth: { active_provider: "opencode-go" },
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      source: "OPENAI_API_KEY",
      provider: explicitProvider || "openai",
      model: explicitModel || "gpt-4.1-mini",
      baseUrl: explicitBaseUrl,
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
      auth: { active_provider: explicitProvider || "openai" },
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      source: "OPENROUTER_API_KEY",
      provider: explicitProvider || "openrouter",
      model: explicitModel || "openai/gpt-4.1-mini",
      baseUrl: explicitBaseUrl,
      env: { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY },
      auth: { active_provider: explicitProvider || "openrouter" },
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      source: "ANTHROPIC_API_KEY",
      provider: explicitProvider || "anthropic",
      model: explicitModel || "claude-3-5-sonnet-latest",
      baseUrl: explicitBaseUrl,
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
      auth: { active_provider: explicitProvider || "anthropic" },
    };
  }

  throw blocker(
    [
      "Trace Lab hardening requires real model credentials.",
      "Configure one of:",
      "- opencode auth login",
      "- OPENCODE_GO_API_KEY",
      "- OPENAI_API_KEY",
      "- OPENROUTER_API_KEY",
      "- ANTHROPIC_API_KEY",
      "- TRACE_LAB_E2E_PROVIDER + TRACE_LAB_E2E_MODEL + TRACE_LAB_E2E_API_KEY(_ENV)",
    ].join("\n"),
  );
};

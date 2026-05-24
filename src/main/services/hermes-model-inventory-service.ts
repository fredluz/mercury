import http from "http";
import https from "https";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { getConnectionConfig } from "../config";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  getEnhancedPath,
} from "../install/paths";
import { profileHome } from "../utils";
import {
  ensureSshTunnelIfNeeded,
  getApiUrl,
  getRemoteAuthHeader,
  isApiServerReady,
} from "../hermes/connection";
import { sshPython } from "../ssh/transport";
import { inferContextWindow } from "../../shared/chat-metadata";
import {
  normalizeModelCapabilities,
  type ModelInventoryAvailability,
  type ModelInventoryAvailabilitySource,
  type SavedModelDescriptor,
} from "../../shared/models";

const INVENTORY_TIMEOUT_MS = 3_000;
const DIRECT_INVENTORY_TIMEOUT_MS = 5_000;

export interface HermesModelInventoryResult {
  models: SavedModelDescriptor[];
  availability: ModelInventoryAvailability;
}

type HermesOptionsPayload = {
  providers?: unknown;
};

type HermesProviderPayload = {
  slug?: unknown;
  name?: unknown;
  models?: unknown;
  api_url?: unknown;
  source?: unknown;
};

interface LocalInventoryProcessConfig {
  python: string;
  cwd?: string;
  env: NodeJS.ProcessEnv;
}

interface LocalInventoryProcessDeps {
  hermesHome: string;
  hermesPython: string;
  hermesRepo: string;
  enhancedPath: string;
  baseEnv: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
}

function defaultLocalInventoryProcessDeps(hermesHome: string): LocalInventoryProcessDeps {
  return {
    hermesHome,
    hermesPython: HERMES_PYTHON,
    hermesRepo: HERMES_REPO,
    enhancedPath: getEnhancedPath(),
    baseEnv: process.env,
    exists: existsSync,
  };
}

function localInventoryHermesHome(profile?: string): string {
  const trimmed = profile?.trim();
  return trimmed && trimmed !== "default" ? profileHome(trimmed) : HERMES_HOME;
}

function availability(
  ok: boolean,
  source: ModelInventoryAvailabilitySource,
  error?: string,
): ModelInventoryAvailability {
  return {
    ok,
    source,
    refreshedAt: Date.now(),
    ...(error ? { error } : {}),
  };
}

function stableInventoryModelId(provider: string, model: string): string {
  return `hermes:${encodeURIComponent(provider)}:${encodeURIComponent(model)}`;
}

function modelName(providerName: string, model: string): string {
  return providerName ? `${providerName} ${model}` : model;
}

function normalizeProviderModel(
  provider: string,
  providerName: string,
  baseUrl: string,
  entry: unknown,
): SavedModelDescriptor | null {
  const rawModel =
    typeof entry === "string"
      ? entry
      : entry && typeof entry === "object"
        ? ((entry as Record<string, unknown>).id ??
            (entry as Record<string, unknown>).model ??
            (entry as Record<string, unknown>).name)
        : undefined;
  const model = typeof rawModel === "string" ? rawModel.trim() : "";
  if (!provider || !model) return null;

  const contextWindow =
    entry && typeof entry === "object"
      ? (entry as Record<string, unknown>).context_window ??
        (entry as Record<string, unknown>).contextWindow
      : undefined;
  const explicitContextWindow =
    typeof contextWindow === "number" && Number.isFinite(contextWindow)
      ? contextWindow
      : undefined;

  return {
    id: stableInventoryModelId(provider, model),
    name: modelName(providerName, model),
    provider,
    model,
    baseUrl,
    createdAt: 0,
    contextWindow: inferContextWindow(provider, model, explicitContextWindow).tokens,
    capabilities: normalizeModelCapabilities(
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>).capabilities
        : undefined,
    ),
  };
}

export function mapHermesModelOptionsToDescriptors(
  payload: HermesOptionsPayload,
): SavedModelDescriptor[] {
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const byId = new Map<string, SavedModelDescriptor>();

  for (const providerEntry of providers) {
    if (!providerEntry || typeof providerEntry !== "object") continue;
    const provider = providerEntry as HermesProviderPayload;
    const slug = typeof provider.slug === "string" ? provider.slug.trim() : "";
    const name = typeof provider.name === "string" ? provider.name.trim() : slug;
    const baseUrl = typeof provider.api_url === "string" ? provider.api_url : "";
    const models = Array.isArray(provider.models) ? provider.models : [];
    for (const modelEntry of models) {
      const descriptor = normalizeProviderModel(slug, name, baseUrl, modelEntry);
      if (descriptor) byId.set(descriptor.id, descriptor);
    }
  }

  return [...byId.values()].sort((a, b) =>
    `${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`),
  );
}

function requestJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.request(
      url,
      { method: "GET", timeout: timeoutMs, headers },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Hermes inventory HTTP ${res.statusCode ?? "unknown"}`));
            return;
          }
          try {
            resolve(JSON.parse(body || "{}"));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Hermes inventory request timed out"));
    });
    req.end();
  });
}

async function loadFromRuntimeApi(profile?: string): Promise<SavedModelDescriptor[]> {
  await ensureSshTunnelIfNeeded(profile);
  const apiUrl = getApiUrl(profile);
  const headers = getRemoteAuthHeader(profile);
  if (!(await isApiServerReady(apiUrl, headers))) {
    throw new Error("Hermes runtime API is not ready");
  }
  const payload = await requestJson(
    `${apiUrl}/api/model/options`,
    headers,
    INVENTORY_TIMEOUT_MS,
  );
  return mapHermesModelOptionsToDescriptors(payload as HermesOptionsPayload);
}

function directInventoryScript(profile?: string): string {
  return `
import json
import os
import sys

profile = ${JSON.stringify(profile?.trim() || "default")}
hermes_agent_home = os.environ.get(
    "HERMES_AGENT_HOME",
    os.path.expanduser("~/.hermes/hermes-agent"),
)
if hermes_agent_home and hermes_agent_home not in sys.path:
    sys.path.insert(0, hermes_agent_home)

attempts = [
    ("hermes_cli.inventory", "load_picker_context", "build_models_payload"),
    ("hermes.tui.model_picker", "load_picker_context", "build_models_payload"),
    ("hermes.ui.model_picker", "load_picker_context", "build_models_payload"),
    ("hermes.models", "load_picker_context", "build_models_payload"),
]

last_error = None
for module_name, context_name, payload_name in attempts:
    try:
        module = __import__(module_name, fromlist=[context_name, payload_name])
        load_picker_context = getattr(module, context_name)
        build_models_payload = getattr(module, payload_name)
        try:
            context = load_picker_context(profile=profile)
        except TypeError:
            context = load_picker_context()
        try:
            payload = build_models_payload(context, max_models=50)
        except TypeError:
            payload = build_models_payload(context)
        print(json.dumps(payload))
        sys.exit(0)
    except Exception as exc:
        last_error = exc

raise SystemExit(str(last_error) if last_error else "Hermes inventory metadata is unavailable")
`;
}

export function buildLocalInventoryProcessConfig(
  deps: LocalInventoryProcessDeps = defaultLocalInventoryProcessDeps(HERMES_HOME),
): LocalInventoryProcessConfig {
  return {
    python: deps.exists(deps.hermesPython) ? deps.hermesPython : "python3",
    cwd: deps.exists(deps.hermesRepo) ? deps.hermesRepo : undefined,
    env: {
      ...deps.baseEnv,
      PATH: deps.enhancedPath,
      HERMES_HOME: deps.hermesHome,
      HERMES_AGENT_HOME: deps.hermesRepo,
    },
  };
}

function execLocalInventory(profile?: string): Promise<SavedModelDescriptor[]> {
  return new Promise((resolve, reject) => {
    const processConfig = buildLocalInventoryProcessConfig(
      defaultLocalInventoryProcessDeps(localInventoryHermesHome(profile)),
    );
    const child = execFile(
      processConfig.python,
      ["-c", directInventoryScript(profile)],
      {
        timeout: DIRECT_INVENTORY_TIMEOUT_MS,
        cwd: processConfig.cwd,
        env: {
          ...processConfig.env,
          ...(profile ? { MERCURY_HERMES_PROFILE: profile } : {}),
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        try {
          resolve(
            mapHermesModelOptionsToDescriptors(
              JSON.parse(stdout.trim() || "{}") as HermesOptionsPayload,
            ),
          );
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
    child.stdin?.end();
  });
}

async function loadFromDirectMetadata(
  source: "local-metadata" | "ssh-metadata",
  profile?: string,
): Promise<SavedModelDescriptor[]> {
  const conn = getConnectionConfig();
  if (source === "ssh-metadata") {
    if (conn.mode !== "ssh" || !conn.ssh) {
      throw new Error("SSH metadata requested outside SSH mode");
    }
      const stdout = await sshPython(
      conn.ssh,
      directInventoryScript(profile),
      undefined,
      DIRECT_INVENTORY_TIMEOUT_MS,
    );
    return mapHermesModelOptionsToDescriptors(
      JSON.parse(stdout.trim() || "{}") as HermesOptionsPayload,
    );
  }
  return execLocalInventory(profile);
}

export async function getHermesModelInventory(
  profile?: string,
): Promise<HermesModelInventoryResult> {
  const conn = getConnectionConfig();
  try {
    const models = await loadFromRuntimeApi(profile);
    return { models, availability: availability(true, "runtime-api") };
  } catch (runtimeError) {
    if (conn.mode === "remote") {
      return {
        models: [],
        availability: availability(
          false,
          "unavailable",
          runtimeError instanceof Error ? runtimeError.message : "Hermes inventory unavailable",
        ),
      };
    }
  }

  const source = conn.mode === "ssh" && conn.ssh ? "ssh-metadata" : "local-metadata";
  try {
    const models = await loadFromDirectMetadata(source, profile);
    return { models, availability: availability(true, source) };
  } catch (metadataError) {
    return {
      models: [],
      availability: availability(
        false,
        "unavailable",
        metadataError instanceof Error
          ? metadataError.message
          : "Hermes inventory metadata is unavailable",
      ),
    };
  }
}

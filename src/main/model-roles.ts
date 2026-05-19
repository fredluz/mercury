import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { HERMES_HOME, hasHermesAuthCredential } from "./installer";
import { getConfigValue, getModelConfig } from "./config";
import { listModels, type SavedModel } from "./models";
import { getToolsets } from "./tools";
import { profileHome, safeWriteFile } from "./utils";
import { inferContextWindow } from "../shared/chat-metadata";
import {
  MODEL_ROLE_IDS,
  MODEL_ROLES,
  TEXT_MODEL_ROLE_IDS,
  getModelRoleFallbackChain,
  isModelRoleId,
  normalizeModelCapabilities,
  type ModelRoleDefault,
  type ModelRoleDefaultsResult,
  type ModelRoleId,
  type ModelRoleListResult,
  type ModelRoleResolution,
  type ModelRoleResolutionSource,
  type ModelRoleSelection,
  type ModelRolesFile,
  type ResolvedImageModelRole,
  type ResolvedTextModelRole,
  type SavedModelDescriptor,
  type TextModelRoleId,
} from "../shared/model-roles";

const MODEL_ROLES_FILE = "model-roles.json";
const DEFAULT_IMAGE_MODEL = "gpt-image-2-medium";

export function modelRolesPath(profile?: string): string {
  return profile && profile !== "default"
    ? join(profileHome(profile), MODEL_ROLES_FILE)
    : join(HERMES_HOME, MODEL_ROLES_FILE);
}

function emptyRolesFile(): ModelRolesFile {
  return { version: 1, defaults: {} };
}

function sanitizeSelection(
  role: ModelRoleId,
  value: unknown,
): ModelRoleSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const provider = typeof raw.provider === "string" ? raw.provider.trim() : undefined;
  const model = typeof raw.model === "string" ? raw.model.trim() : undefined;
  const modelId = typeof raw.modelId === "string" ? raw.modelId.trim() : undefined;
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl : undefined;
  const contextWindow =
    typeof raw.contextWindow === "number" && Number.isFinite(raw.contextWindow) && raw.contextWindow > 0
      ? Math.floor(raw.contextWindow)
      : undefined;
  const imageMode =
    raw.imageMode === "codex_builtin_image_gen" || raw.imageMode === "codex_imagegen_skill"
      ? raw.imageMode
      : undefined;
  const updatedAt =
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : Date.now();

  if (!modelId && !provider && !model && role !== "image" && !imageMode) return undefined;

  return {
    role,
    ...(modelId ? { modelId } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    capabilities: normalizeModelCapabilities(raw.capabilities),
    ...(imageMode ? { imageMode } : {}),
    updatedAt,
  };
}

export function normalizeModelRolesFile(raw: unknown): ModelRolesFile {
  if (!raw || typeof raw !== "object") return emptyRolesFile();
  const defaults = (raw as { defaults?: unknown }).defaults;
  if (!defaults || typeof defaults !== "object") return emptyRolesFile();

  const normalized: ModelRolesFile = emptyRolesFile();
  for (const [key, value] of Object.entries(defaults as Record<string, unknown>)) {
    if (!isModelRoleId(key)) continue;
    const selection = sanitizeSelection(key, value);
    if (selection) normalized.defaults[key] = selection;
  }
  return normalized;
}

export function readModelRolesFile(profile?: string): ModelRolesFile {
  try {
    const file = modelRolesPath(profile);
    if (!existsSync(file)) return emptyRolesFile();
    return normalizeModelRolesFile(JSON.parse(readFileSync(file, "utf-8")));
  } catch {
    return emptyRolesFile();
  }
}

export function writeModelRolesFile(file: ModelRolesFile, profile?: string): void {
  safeWriteFile(modelRolesPath(profile), JSON.stringify(normalizeModelRolesFile(file), null, 2));
}

export function readGlobalModelRoleDefaults(): ModelRolesFile["defaults"] {
  return readModelRolesFile().defaults;
}

export function readProfileModelRoleOverrides(profile?: string): ModelRolesFile["defaults"] {
  return readModelRolesFile(profile).defaults;
}

export function writeGlobalModelRoleDefault(
  role: ModelRoleId,
  selection: Omit<ModelRoleSelection, "role" | "updatedAt"> & { updatedAt?: number },
): void {
  const file = readModelRolesFile();
  file.defaults[role] = sanitizeSelection(role, {
    ...selection,
    role,
    updatedAt: selection.updatedAt ?? Date.now(),
  });
  writeModelRolesFile(file);
}

export function writeProfileModelRoleOverride(
  role: ModelRoleId,
  selection: Omit<ModelRoleSelection, "role" | "updatedAt"> & { updatedAt?: number },
  profile?: string,
): void {
  const file = readModelRolesFile(profile);
  file.defaults[role] = sanitizeSelection(role, {
    ...selection,
    role,
    updatedAt: selection.updatedAt ?? Date.now(),
  });
  writeModelRolesFile(file, profile);
}

export function clearProfileModelRoleOverride(role: ModelRoleId, profile?: string): boolean {
  const file = readModelRolesFile(profile);
  if (!file.defaults[role]) return false;
  delete file.defaults[role];
  writeModelRolesFile(file, profile);
  return true;
}

function withScope(
  selection: ModelRoleSelection | undefined,
  scope: "global" | "profile",
  profile?: string,
): ModelRoleDefault | undefined {
  if (!selection) return undefined;
  return {
    ...selection,
    scope,
    ...(scope === "profile" && profile ? { profile } : {}),
  };
}

function modelSnapshot(model: SavedModel): SavedModelDescriptor {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    model: model.model,
    baseUrl: model.baseUrl,
    createdAt: model.createdAt,
    contextWindow: model.contextWindow,
    capabilities: normalizeModelCapabilities(model.capabilities),
  };
}

function resolveSelection(
  requestedRole: TextModelRoleId,
  selectedRole: ModelRoleId,
  selection: ModelRoleSelection,
  source: ModelRoleResolutionSource,
  savedModels: SavedModel[],
): ResolvedTextModelRole | undefined {
  const saved = selection.modelId
    ? savedModels.find((model) => model.id === selection.modelId)
    : undefined;

  if (saved) {
    return {
      role: requestedRole,
      kind: "text",
      ok: true,
      source,
      provider: saved.provider,
      model: saved.model,
      baseUrl: saved.baseUrl,
      contextWindow: inferContextWindow(saved.provider, saved.model, saved.contextWindow).tokens,
      capabilities: normalizeModelCapabilities(saved.capabilities),
      modelId: saved.id,
    };
  }

  if (selection.provider && selection.model) {
    return {
      role: requestedRole,
      kind: "text",
      ok: true,
      source: selection.modelId ? "missing-model" : source,
      provider: selection.provider,
      model: selection.model,
      baseUrl: selection.baseUrl ?? "",
      contextWindow: inferContextWindow(
        selection.provider,
        selection.model,
        selection.contextWindow,
      ).tokens,
      capabilities: normalizeModelCapabilities(selection.capabilities),
      ...(selection.modelId ? { missingModelId: selection.modelId } : {}),
    };
  }

  if (selectedRole !== requestedRole) return undefined;
  return undefined;
}

function resolveLegacyTextRole(role: TextModelRoleId, profile?: string): ResolvedTextModelRole {
  const legacy = getModelConfig(profile);
  const source: ModelRoleResolutionSource =
    legacy.provider === "auto" && !legacy.model ? "provider-auto" : "legacy-chat-config";
  return {
    role,
    kind: "text",
    ok: true,
    source,
    provider: legacy.provider,
    model: legacy.model,
    baseUrl: legacy.baseUrl,
    contextWindow: inferContextWindow(legacy.provider, legacy.model).tokens,
    capabilities: ["text"],
  };
}

export function hasLocalCodexAuthCredential(): boolean {
  if (hasHermesAuthCredential("openai-codex")) return true;
  return existsSync(join(homedir(), ".codex", "auth.json"));
}

export function resolveLocalImageCapability(profile?: string): ResolvedImageModelRole {
  const toolsetEnabled = getToolsets(profile).some(
    (toolset) => toolset.key === "image_gen" && toolset.enabled,
  );
  const providerValue = getConfigValue("image_gen.provider", profile) || "";
  const providerConfigured = providerValue === "openai-codex";
  const credentialAvailable = hasLocalCodexAuthCredential();
  const model = getConfigValue("image_gen.model", profile) || DEFAULT_IMAGE_MODEL;

  if (!toolsetEnabled) {
    return {
      role: "image",
      kind: "image",
      ok: false,
      source: "image-capability",
      toolsetEnabled,
      providerConfigured,
      credentialAvailable,
      reason: "image_gen toolset is disabled",
    };
  }

  if (!providerConfigured) {
    return {
      role: "image",
      kind: "image",
      ok: false,
      source: "image-capability",
      toolsetEnabled,
      providerConfigured,
      credentialAvailable,
      reason: "image_gen.provider is not openai-codex",
    };
  }

  if (!credentialAvailable) {
    return {
      role: "image",
      kind: "image",
      ok: false,
      source: "image-capability",
      toolsetEnabled,
      providerConfigured,
      credentialAvailable,
      reason: "Codex OAuth credential was not found",
    };
  }

  return {
    role: "image",
    kind: "image",
    ok: true,
    source: "image-capability",
    imageMode: "codex_builtin_image_gen",
    provider: "openai-codex",
    model,
    toolsetEnabled,
    providerConfigured,
    credentialAvailable,
  };
}

export function resolveModelForRole(
  role: ModelRoleId,
  profile?: string,
  savedModels = listModels(),
): ModelRoleResolution {
  if (role === "image") return resolveLocalImageCapability(profile);

  const profileDefaults = readProfileModelRoleOverrides(profile);
  const globalDefaults = readGlobalModelRoleDefaults();
  for (const fallbackRole of getModelRoleFallbackChain(role)) {
    const profileSelection = profileDefaults[fallbackRole];
    if (profileSelection) {
      const resolved = resolveSelection(
        role,
        fallbackRole,
        profileSelection,
        fallbackRole === role ? "profile-override" : "role-fallback",
        savedModels,
      );
      if (resolved) return resolved;
    }

    const globalSelection = globalDefaults[fallbackRole];
    if (globalSelection) {
      const resolved = resolveSelection(
        role,
        fallbackRole,
        globalSelection,
        fallbackRole === role ? "global-default" : "role-fallback",
        savedModels,
      );
      if (resolved) return resolved;
    }
  }

  return resolveLegacyTextRole(role, profile);
}

export function getModelRoleDefaults(profile?: string): ModelRoleDefaultsResult {
  const global = readGlobalModelRoleDefaults();
  const profileOverrides = readProfileModelRoleOverrides(profile);
  const savedModels = listModels();
  const result: ModelRoleDefaultsResult = {
    global: {},
    profileOverrides: {},
    resolved: {},
  };

  for (const role of MODEL_ROLE_IDS) {
    const globalDefault = withScope(global[role], "global");
    const profileDefault = withScope(profileOverrides[role], "profile", profile);
    if (globalDefault) result.global[role] = globalDefault;
    if (profileDefault) result.profileOverrides[role] = profileDefault;
    result.resolved[role] = resolveModelForRole(role, profile, savedModels);
  }

  return result;
}

export function listModelRoles(profile?: string): ModelRoleListResult {
  const defaults = getModelRoleDefaults(profile);
  const savedModels = listModels();
  const imageCapability = resolveLocalImageCapability(profile);

  return {
    roles: MODEL_ROLES.map((role) => ({
      id: role.id,
      nameKey: role.nameKey,
      descriptionKey: role.descriptionKey,
      global: defaults.global[role.id],
      profileOverride: defaults.profileOverrides[role.id],
      resolved: defaults.resolved[role.id] ?? resolveModelForRole(role.id, profile, savedModels),
    })),
    savedModels: savedModels.map(modelSnapshot),
    imageCapability,
  };
}

export function selectionFromSavedOrDirect(
  role: ModelRoleId,
  input: Partial<ModelRoleSelection>,
  savedModels: SavedModel[],
): ModelRoleSelection {
  const saved = input.modelId
    ? savedModels.find((model) => model.id === input.modelId)
    : undefined;
  const provider = saved?.provider ?? input.provider ?? "";
  const model = saved?.model ?? input.model ?? "";
  const baseUrl = saved?.baseUrl ?? input.baseUrl ?? "";
  return {
    role,
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    baseUrl,
    contextWindow: inferContextWindow(
      provider,
      model,
      saved?.contextWindow ?? input.contextWindow,
    ).tokens,
    capabilities: normalizeModelCapabilities(saved?.capabilities ?? input.capabilities),
    ...(input.imageMode ? { imageMode: input.imageMode } : {}),
    updatedAt: Date.now(),
  };
}

export function isRoleTaxonomyComplete(): boolean {
  return TEXT_MODEL_ROLE_IDS.length === 7 && MODEL_ROLE_IDS.length === 8;
}

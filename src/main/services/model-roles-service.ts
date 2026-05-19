import { getConnectionConfig, setModelConfig } from "../config";
import {
  clearProfileModelRoleOverride,
  getModelRoleDefaults,
  listModelRoles,
  normalizeModelRolesFile,
  readModelRolesFile,
  resolveModelForRole,
  selectionFromSavedOrDirect,
  writeGlobalModelRoleDefault,
  writeProfileModelRoleOverride,
} from "../model-roles";
import {
  isGatewayRunning,
  markAllRuntimesStale,
  markRuntimeStale,
  revalidateRuntime,
  restartGateway,
  setSshRemoteApiKey,
} from "../hermes";
import { startSshTunnel } from "../ssh-tunnel";
import {
  sshGatewayStatus,
  sshGetConfigValue,
  sshGetModelConfig,
  sshGetToolsets,
  sshHasCodexAuthCredential,
  sshReadModelRolesFile,
  sshReadRemoteApiKey,
  sshSetModelConfig,
  sshStartGateway,
  sshStopGateway,
  sshWriteModelRolesFile,
} from "../ssh-remote";
import { listModelsForConnection } from "./models-service";
import { inferContextWindow } from "../../shared/chat-metadata";
import {
  MODEL_ROLE_IDS,
  MODEL_ROLES,
  getModelRoleFallbackChain,
  isTextModelRoleId,
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
} from "../../shared/model-roles";
import type { SavedModel } from "../models";

const DEFAULT_IMAGE_MODEL = "gpt-image-2-medium";

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

function resolveSelection(
  requestedRole: TextModelRoleId,
  _selectedRole: ModelRoleId,
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
      contextWindow: inferContextWindow(selection.provider, selection.model, selection.contextWindow).tokens,
      capabilities: normalizeModelCapabilities(selection.capabilities),
      ...(selection.modelId ? { missingModelId: selection.modelId } : {}),
    };
  }

  return undefined;
}

function resolveTextRoleFromState(
  role: TextModelRoleId,
  _profile: string | undefined,
  savedModels: SavedModel[],
  globalFile: ModelRolesFile,
  profileFile: ModelRolesFile,
  legacy: { provider: string; model: string; baseUrl: string },
): ResolvedTextModelRole {
  for (const fallbackRole of getModelRoleFallbackChain(role)) {
    const profileSelection = profileFile.defaults[fallbackRole];
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

    const globalSelection = globalFile.defaults[fallbackRole];
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

  return {
    role,
    kind: "text",
    ok: true,
    source: legacy.provider === "auto" && !legacy.model ? "provider-auto" : "legacy-chat-config",
    provider: legacy.provider,
    model: legacy.model,
    baseUrl: legacy.baseUrl,
    contextWindow: inferContextWindow(legacy.provider, legacy.model).tokens,
    capabilities: ["text"],
  };
}

function modelsDiffer(a: ModelRoleResolution, b: ModelRoleResolution): boolean {
  if (a.kind !== "text" || b.kind !== "text") return a.ok !== b.ok;
  return a.provider !== b.provider || a.model !== b.model || a.baseUrl !== b.baseUrl;
}

async function restartSshGatewayAndRevalidate(profile?: string): Promise<void> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return;
  await sshStopGateway(conn.ssh, profile);
  await sshStartGateway(conn.ssh, profile);
  await startSshTunnel(conn.ssh, profile);
  const refreshedKey = await sshReadRemoteApiKey(conn.ssh, profile);
  setSshRemoteApiKey(refreshedKey, profile);
  await revalidateRuntime(profile);
}

async function applyChatLegacyCompatibility(
  selection: { provider?: string; model?: string; baseUrl?: string },
  profile?: string,
): Promise<void> {
  if (!selection.provider || !selection.model) return;
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    await sshSetModelConfig(
      conn.ssh,
      selection.provider,
      selection.model,
      selection.baseUrl ?? "",
      profile,
    );
    return;
  }
  setModelConfig(selection.provider, selection.model, selection.baseUrl ?? "", profile);
}

async function markChatChangeIfNeeded(
  previous: ModelRoleResolution,
  profile?: string,
): Promise<void> {
  const next = await resolveModelForRoleForConnection("chat", profile);
  if (!modelsDiffer(previous, next)) return;

  const conn = getConnectionConfig();
  markRuntimeStale(profile, "Chat model role changed for profile runtime.");
  if (conn.mode === "ssh" && conn.ssh) {
    if (await sshGatewayStatus(conn.ssh, profile)) await restartSshGatewayAndRevalidate(profile);
    return;
  }
  if (isGatewayRunning(profile)) restartGateway(profile);
}

async function resolveSshImageCapability(profile?: string): Promise<ResolvedImageModelRole> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) {
    throw new Error("SSH image capability requested outside SSH mode");
  }

  const toolsets = await sshGetToolsets(conn.ssh, profile);
  const toolsetEnabled = toolsets.some((toolset) => toolset.key === "image_gen" && toolset.enabled);
  const providerValue = (await sshGetConfigValue(conn.ssh, "image_gen.provider", profile)) || "";
  const providerConfigured = providerValue === "openai-codex";
  const credentialAvailable = await sshHasCodexAuthCredential(conn.ssh);
  const model = (await sshGetConfigValue(conn.ssh, "image_gen.model", profile)) || DEFAULT_IMAGE_MODEL;

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

async function readSshRolesFile(profile?: string): Promise<ModelRolesFile> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return { version: 1, defaults: {} };
  return normalizeModelRolesFile(await sshReadModelRolesFile(conn.ssh, profile));
}

async function writeSshRolesFile(file: ModelRolesFile, profile?: string): Promise<void> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return;
  await sshWriteModelRolesFile(conn.ssh, normalizeModelRolesFile(file), profile);
}

async function getSshModelRoleDefaults(profile?: string): Promise<ModelRoleDefaultsResult> {
  const savedModels = await listModelsForConnection();
  const globalFile = await readSshRolesFile();
  const profileFile = await readSshRolesFile(profile);
  const legacy = await sshGetModelConfig(getConnectionConfig().ssh, profile);
  const result: ModelRoleDefaultsResult = { global: {}, profileOverrides: {}, resolved: {} };

  for (const role of MODEL_ROLE_IDS) {
    const globalDefault = withScope(globalFile.defaults[role], "global");
    const profileDefault = withScope(profileFile.defaults[role], "profile", profile);
    if (globalDefault) result.global[role] = globalDefault;
    if (profileDefault) result.profileOverrides[role] = profileDefault;
    result.resolved[role] =
      role === "image"
        ? await resolveSshImageCapability(profile)
        : resolveTextRoleFromState(role, profile, savedModels, globalFile, profileFile, legacy);
  }

  return result;
}

export async function listModelRolesForConnection(profile?: string): Promise<ModelRoleListResult> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return listModelRoles(profile);

  const savedModels = await listModelsForConnection();
  const defaults = await getSshModelRoleDefaults(profile);
  const imageCapability = await resolveSshImageCapability(profile);
  return {
    roles: MODEL_ROLES.map((role) => ({
      id: role.id,
      nameKey: role.nameKey,
      descriptionKey: role.descriptionKey,
      global: defaults.global[role.id],
      profileOverride: defaults.profileOverrides[role.id],
      resolved: defaults.resolved[role.id]!,
    })),
    savedModels: savedModels.map(modelSnapshot),
    imageCapability,
  };
}

export async function getModelRoleDefaultsForConnection(
  profile?: string,
): Promise<ModelRoleDefaultsResult> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return getSshModelRoleDefaults(profile);
  return getModelRoleDefaults(profile);
}

export async function resolveModelForRoleForConnection(
  role: ModelRoleId,
  profile?: string,
): Promise<ModelRoleResolution> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return resolveModelForRole(role, profile);
  if (role === "image") return resolveSshImageCapability(profile);

  const savedModels = await listModelsForConnection();
  const globalFile = await readSshRolesFile();
  const profileFile = await readSshRolesFile(profile);
  const legacy = await sshGetModelConfig(conn.ssh, profile);
  return resolveTextRoleFromState(role, profile, savedModels, globalFile, profileFile, legacy);
}

export async function setGlobalModelRoleDefaultForConnection(
  role: ModelRoleId,
  input: Partial<ModelRoleSelection>,
): Promise<boolean> {
  const savedModels = await listModelsForConnection();
  const selection = selectionFromSavedOrDirect(role, input, savedModels);
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const file = await readSshRolesFile();
    file.defaults[role] = selection;
    await writeSshRolesFile(file);
  } else {
    writeGlobalModelRoleDefault(role, selection);
  }

  if (role === "chat") {
    markAllRuntimesStale("Global Chat model role default changed.");
  }
  return true;
}

export async function setProfileModelRoleOverrideForConnection(
  role: ModelRoleId,
  input: Partial<ModelRoleSelection>,
  profile?: string,
): Promise<boolean> {
  const savedModels = await listModelsForConnection();
  const selection = selectionFromSavedOrDirect(role, input, savedModels);
  const previous = role === "chat" ? await resolveModelForRoleForConnection("chat", profile) : undefined;
  const conn = getConnectionConfig();

  if (conn.mode === "ssh" && conn.ssh) {
    const file = await readSshRolesFile(profile);
    file.defaults[role] = selection;
    await writeSshRolesFile(file, profile);
  } else {
    writeProfileModelRoleOverride(role, selection, profile);
  }

  if (role === "chat") {
    await applyChatLegacyCompatibility(selection, profile);
    await markChatChangeIfNeeded(previous!, profile);
  }
  return true;
}

export async function clearProfileModelRoleOverrideForConnection(
  role: ModelRoleId,
  profile?: string,
): Promise<boolean> {
  const previous = role === "chat" ? await resolveModelForRoleForConnection("chat", profile) : undefined;
  const conn = getConnectionConfig();
  let changed = false;
  if (conn.mode === "ssh" && conn.ssh) {
    const file = await readSshRolesFile(profile);
    changed = Boolean(file.defaults[role]);
    delete file.defaults[role];
    if (changed) await writeSshRolesFile(file, profile);
  } else {
    changed = clearProfileModelRoleOverride(role, profile);
  }

  if (changed && role === "chat") {
    const resolved = await resolveModelForRoleForConnection("chat", profile);
    if (resolved.kind === "text") {
      await applyChatLegacyCompatibility(resolved, profile);
    }
    await markChatChangeIfNeeded(previous!, profile);
  }
  return changed;
}

export function assertModelRole(role: string): ModelRoleId {
  if (MODEL_ROLE_IDS.includes(role as ModelRoleId)) return role as ModelRoleId;
  throw new Error(`Unknown model role: ${role}`);
}

export function assertTextModelRole(role: string): TextModelRoleId {
  if (isTextModelRoleId(role)) return role;
  throw new Error(`Expected text model role, got: ${role}`);
}

export function readLocalModelRolesForTests(profile?: string): ModelRolesFile {
  return readModelRolesFile(profile);
}

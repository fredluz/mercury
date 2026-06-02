import { randomUUID } from "crypto";
import { dirname, join } from "path";
import { promises as fs } from "fs";
import {
  RESERVED_AGENT_PROFILE_IDS,
  createAgentDraft as createAgentDraftInStore,
  isValidBackendProfileId,
  markAgentDraftCommitted,
  mutateAgentDraft,
  readAgentsState,
  writeAgentsState,
} from "../agent-store";
import {
  applyDraftSeedSkill,
  attachSeedSkillToDraft,
  seedSkillTargetKey,
} from "./agent-seed-skill-service";
import {
  createProfileForConnection,
  deleteProfileForConnection,
  listProfilesForConnection,
  setActiveProfileForConnection,
} from "./sessions-service";
import { getConnection, setModelConfigForProfile } from "./config-service";
import {
  profileAgentMetadataPath,
  readProfileAgentMetadata,
  writeProfileAgentMetadata,
} from "../profiles";
import {
  sshClearAgentAvatar,
  sshGetAgentAvatarDataUrl,
  sshSetAgentAvatar,
  sshWriteProfileAgentMetadata,
} from "../ssh-remote";
import { profileHome } from "../utils";
import {
  addMemoryEntryForProfile,
  getToolsetsForProfile,
  mutateSkillsForProfile,
  setToolsetEnabledForProfile,
  writeSoulForProfile,
  writeUserProfileForProfile,
} from "./knowledge-service";
import type {
  AgentAvatarDataUrlResult,
  AgentAvatarMutationResult,
  AgentCommitRequest,
  AgentCommitResult,
  AgentCreationDraft,
  AgentDocsPointerSelection,
  AgentDraftChange,
  AgentDraftChangeEvent,
  AgentDraftMutationRequest,
  AgentDraftMutationResult,
  AttachAgentSeedSkillResult,
  CreateAgentDraftRequest,
} from "../../shared/agents";
import {
  AGENT_AVATAR_CONTENT_TYPE,
  AGENT_AVATAR_FILE_NAME,
  AGENT_AVATAR_MAX_BYTES,
  type ProfileAgentMetadata,
  type ProfileAvatarMetadata,
  type ProfileInfo,
} from "../../shared/profiles";
import { isValidProfileName } from "../../shared/profile-identity";
import {
  expandAgentPackSelection,
  validateAgentPackIds,
} from "../../shared/agent-packs";
import type { SkillMutationTarget } from "../../shared/skills";

const TEXT_NOTIFICATION_DEBOUNCE_MS = 500;
const TEXT_NOTIFICATION_PATHS = new Set([
  "displayName",
  "description",
  "persona",
  "memory.userProfile",
]);

type AgentDraftChangeListener = (event: AgentDraftChangeEvent) => void;

type PendingNotification = {
  timer: ReturnType<typeof setTimeout>;
  event: AgentDraftChangeEvent;
  localListeners: Set<AgentDraftChangeListener>;
};

const draftChangeListeners = new Set<AgentDraftChangeListener>();
const pendingTextNotifications = new Map<string, PendingNotification>();
const avatarMutationQueues = new Map<string, Promise<void>>();

export type {
  AgentAvatarDataUrlResult,
  AgentAvatarMutationResult,
} from "../../shared/agents";

export async function setAgentAvatar(
  request: unknown,
): Promise<AgentAvatarMutationResult> {
  const parsed = parseSetAvatarRequest(request);
  if (!parsed.success) return parsed.result;
  const connection = getConnection();
  if (connection.mode === "ssh") {
    if (!connection.ssh) {
      return avatarMutationFailure(
        "unsupported-remote-mode",
        "Agent avatar mutations require SSH configuration in SSH mode.",
      );
    }
    return serializeAvatarMutation(parsed.profile, () =>
      sshSetAgentAvatar(connection.ssh!, parsed.profile, parsed.imageDataUrl),
    );
  }
  if (connection.mode === "remote") {
    return avatarMutationFailure(
      "unsupported-remote-mode",
      "Agent avatar mutations are only available in local and SSH modes because they write profile files.",
    );
  }
  return serializeAvatarMutation(parsed.profile, () =>
    setLocalAgentAvatar(parsed.profile, parsed.imageDataUrl),
  );
}

export async function clearAgentAvatar(
  request: unknown,
): Promise<AgentAvatarMutationResult> {
  const parsed = parseClearAvatarRequest(request);
  if (!parsed.success) return parsed.result;
  const connection = getConnection();
  if (connection.mode === "ssh") {
    if (!connection.ssh) {
      return avatarMutationFailure(
        "unsupported-remote-mode",
        "Agent avatar mutations require SSH configuration in SSH mode.",
      );
    }
    return serializeAvatarMutation(parsed.profile, () =>
      sshClearAgentAvatar(connection.ssh!, parsed.profile),
    );
  }
  if (connection.mode === "remote") {
    return avatarMutationFailure(
      "unsupported-remote-mode",
      "Agent avatar mutations are only available in local and SSH modes because they write profile files.",
    );
  }
  return serializeAvatarMutation(parsed.profile, () => clearLocalAgentAvatar(parsed.profile));
}

export async function getAgentAvatarDataUrl(
  profile: unknown,
): Promise<AgentAvatarDataUrlResult> {
  if (typeof profile !== "string" || !profile.trim()) {
    return avatarReadFailure("validation-error", "profile is required.");
  }
  const profileName = profile.trim();
  if (!isValidProfileName(profileName)) {
    return avatarReadFailure("validation-error", "Invalid agent profile name.");
  }

  const connection = getConnection();
  if (connection.mode === "ssh") {
    if (!connection.ssh) {
      return avatarReadFailure(
        "unsupported-remote-mode",
        "Agent avatar reads require SSH configuration in SSH mode.",
      );
    }
    return sshGetAgentAvatarDataUrl(connection.ssh, profileName);
  }
  if (connection.mode === "remote") {
    return avatarReadFailure(
      "unsupported-remote-mode",
      "Agent avatar reads are only available in local and SSH modes because they read profile files.",
    );
  }

  const agent = await findProfileInfo(profileName);
  if (!agent) return avatarReadFailure("not-found", `Agent profile '${profileName}' was not found.`);
  if (agent.isDefault || agent.kind === "builtin" || agent.immutable) {
    return { success: true, dataUrl: null };
  }

  const metadata = await readProfileAgentMetadata(profileHome(profileName));
  if (!metadata.avatar) return { success: true, dataUrl: null };

  try {
    const buffer = await fs.readFile(agentAvatarPath(profileName));
    if (!isValidPngBuffer(buffer) || buffer.length > AGENT_AVATAR_MAX_BYTES) {
      return { success: true, dataUrl: null, avatar: metadata.avatar };
    }
    return {
      success: true,
      dataUrl: `data:${AGENT_AVATAR_CONTENT_TYPE};base64,${buffer.toString("base64")}`,
      avatar: metadata.avatar,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { success: true, dataUrl: null, avatar: metadata.avatar };
    }
    return avatarReadFailure(
      "read-failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function onAgentDraftChanged(listener: AgentDraftChangeListener): () => void {
  draftChangeListeners.add(listener);
  return () => draftChangeListeners.delete(listener);
}

type ParsedAvatarRequest<T> =
  | { success: true; profile: string } & T
  | { success: false; result: AgentAvatarMutationResult };

function parseSetAvatarRequest(
  request: unknown,
): ParsedAvatarRequest<{ imageDataUrl: string }> {
  const profileResult = parseAvatarMutationProfile(request);
  if (!profileResult.success) return profileResult;
  if (!isRecord(request) || typeof request.imageDataUrl !== "string") {
    return {
      success: false,
      result: avatarMutationFailure(
        "validation-error",
        "imageDataUrl is required.",
      ),
    };
  }
  return {
    success: true,
    profile: profileResult.profile,
    imageDataUrl: request.imageDataUrl,
  };
}

function parseClearAvatarRequest(request: unknown): ParsedAvatarRequest<{}> {
  return parseAvatarMutationProfile(request);
}

function parseAvatarMutationProfile(request: unknown): ParsedAvatarRequest<{}> {
  if (!isRecord(request) || typeof request.profile !== "string" || !request.profile.trim()) {
    return {
      success: false,
      result: avatarMutationFailure("validation-error", "profile is required."),
    };
  }
  const profile = request.profile.trim();
  if (!isValidProfileName(profile)) {
    return {
      success: false,
      result: avatarMutationFailure(
        "validation-error",
        "Invalid agent profile name.",
      ),
    };
  }
  if (RESERVED_AGENT_PROFILE_IDS.has(profile)) {
    return {
      success: false,
      result: avatarMutationFailure(
        "immutable-agent",
        "Mercury/default is immutable and cannot have a custom avatar.",
      ),
    };
  }
  return { success: true, profile };
}

function serializeAvatarMutation<T>(
  profile: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = avatarMutationQueues.get(profile) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const queued = next.then(
    () => undefined,
    () => undefined,
  );
  avatarMutationQueues.set(profile, queued);
  queued.finally(() => {
    if (avatarMutationQueues.get(profile) === queued) {
      avatarMutationQueues.delete(profile);
    }
  });
  return next;
}

async function setLocalAgentAvatar(
  profile: string,
  imageDataUrl: string,
): Promise<AgentAvatarMutationResult> {
  const connectionResult = localAvatarMutationConnectionGuard();
  if (!connectionResult.success) return connectionResult.result;

  const agent = await mutableCustomAgent(profile);
  if (!agent.success) return agent.result;

  const image = decodePngDataUrl(imageDataUrl);
  if (!image.success) return image.result;

  const profilePath = profileHome(profile);
  const desktopDir = dirname(profileAgentMetadataPath(profilePath));
  const avatarPath = join(desktopDir, AGENT_AVATAR_FILE_NAME);
  const nonce = `${process.pid}.${Date.now()}.${randomUUID()}`;
  const tempPath = join(desktopDir, `.avatar.${nonce}.tmp`);
  const backupPath = join(desktopDir, `.avatar.${nonce}.bak`);
  let tempWritten = false;
  let backupCreated = false;
  let avatarReplaced = false;

  try {
    const metadata = await readProfileAgentMetadata(profilePath);
    await fs.mkdir(desktopDir, { recursive: true });
    await fs.writeFile(tempPath, image.buffer);
    tempWritten = true;

    try {
      await fs.rename(avatarPath, backupPath);
      backupCreated = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }

    await fs.rename(tempPath, avatarPath);
    tempWritten = false;
    avatarReplaced = true;

    const avatar: ProfileAvatarMetadata = {
      path: AGENT_AVATAR_FILE_NAME,
      contentType: AGENT_AVATAR_CONTENT_TYPE,
      updatedAt: new Date().toISOString(),
      byteLength: image.buffer.length,
    };
    await writeProfileAgentMetadata(profilePath, { ...metadata, avatar });

    if (backupCreated) await bestEffortRemove(backupPath);
    const updated = await findProfileInfo(profile);
    return {
      success: true,
      agent: updated ?? { ...agent.agent, avatar },
      avatar,
    };
  } catch (error) {
    if (tempWritten) await bestEffortRemove(tempPath);
    if (avatarReplaced) await bestEffortRemove(avatarPath);
    if (backupCreated) {
      try {
        await fs.rename(backupPath, avatarPath);
      } catch {
        // Backup restoration is best-effort; report the original write failure.
      }
    }
    return avatarMutationFailure(
      "write-failed",
      error instanceof Error ? error.message : String(error),
      agent.agent,
    );
  }
}

async function clearLocalAgentAvatar(
  profile: string,
): Promise<AgentAvatarMutationResult> {
  const connectionResult = localAvatarMutationConnectionGuard();
  if (!connectionResult.success) return connectionResult.result;

  const agent = await mutableCustomAgent(profile);
  if (!agent.success) return agent.result;

  const profilePath = profileHome(profile);
  const metadata = await readProfileAgentMetadata(profilePath);
  if (!metadata.avatar) {
    return { success: true, agent: agent.agent, avatar: null };
  }

  try {
    const { avatar: _avatar, ...metadataWithoutAvatar } = metadata;
    await writeProfileAgentMetadata(profilePath, metadataWithoutAvatar);
    await bestEffortRemove(agentAvatarPath(profile));
    const updated = await findProfileInfo(profile);
    const { avatar: _agentAvatar, ...agentWithoutAvatar } = agent.agent;
    return { success: true, agent: updated ?? agentWithoutAvatar, avatar: null };
  } catch (error) {
    return avatarMutationFailure(
      "write-failed",
      error instanceof Error ? error.message : String(error),
      agent.agent,
    );
  }
}

function localAvatarMutationConnectionGuard():
  | { success: true }
  | { success: false; result: AgentAvatarMutationResult } {
  const connection = getConnection();
  if (connection.mode === "local") return { success: true };
  // Item 2 seam: replace this local-only guard with SSH helper routing and pure-remote fail-closed handling.
  return {
    success: false,
    result: avatarMutationFailure(
      "unsupported-remote-mode",
      "Agent avatar mutations are only available locally in this backend slice.",
    ),
  };
}

async function mutableCustomAgent(
  profile: string,
): Promise<
  | { success: true; agent: ProfileInfo }
  | { success: false; result: AgentAvatarMutationResult }
> {
  const agent = await findProfileInfo(profile);
  if (!agent) {
    return {
      success: false,
      result: avatarMutationFailure("not-found", `Agent profile '${profile}' was not found.`),
    };
  }
  if (agent.isDefault || agent.kind === "builtin" || agent.immutable) {
    return {
      success: false,
      result: avatarMutationFailure(
        "immutable-agent",
        "Mercury/default is immutable and cannot have a custom avatar.",
        agent,
      ),
    };
  }
  return { success: true, agent };
}

async function findProfileInfo(profile: string): Promise<ProfileInfo | undefined> {
  const profiles = await listProfilesForConnection();
  return profiles.find((entry) => entry.name === profile);
}

function decodePngDataUrl(
  imageDataUrl: string,
):
  | { success: true; buffer: Buffer }
  | { success: false; result: AgentAvatarMutationResult } {
  const prefix = `data:${AGENT_AVATAR_CONTENT_TYPE};base64,`;
  if (!imageDataUrl.startsWith(prefix)) {
    return {
      success: false,
      result: avatarMutationFailure(
        "validation-error",
        "Agent avatar must be a PNG data URL.",
      ),
    };
  }
  const encoded = imageDataUrl.slice(prefix.length);
  if (!encoded.trim()) {
    return {
      success: false,
      result: avatarMutationFailure("validation-error", "Agent avatar PNG is empty."),
    };
  }

  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length === 0) {
    return {
      success: false,
      result: avatarMutationFailure("validation-error", "Agent avatar PNG is empty."),
    };
  }
  if (buffer.length > AGENT_AVATAR_MAX_BYTES) {
    return {
      success: false,
      result: avatarMutationFailure(
        "validation-error",
        `Agent avatar PNG must be ${AGENT_AVATAR_MAX_BYTES} bytes or smaller.`,
      ),
    };
  }
  if (!isValidPngBuffer(buffer)) {
    return {
      success: false,
      result: avatarMutationFailure(
        "validation-error",
        "Agent avatar data is not a valid PNG file.",
      ),
    };
  }
  return { success: true, buffer };
}

function isValidPngBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  );
}

function agentAvatarPath(profile: string): string {
  return join(dirname(profileAgentMetadataPath(profileHome(profile))), AGENT_AVATAR_FILE_NAME);
}

function avatarMutationFailure(
  code: Exclude<AgentAvatarMutationResult, { success: true }>["code"],
  error: string,
  agent?: ProfileInfo,
): AgentAvatarMutationResult {
  return { success: false, code, error, ...(agent ? { agent } : {}) };
}

function avatarReadFailure(
  code: Exclude<AgentAvatarDataUrlResult, { success: true }>["code"],
  error: string,
): AgentAvatarDataUrlResult {
  return { success: false, code, error };
}

async function bestEffortRemove(path: string): Promise<void> {
  try {
    await fs.rm(path, { force: true });
  } catch {
    // Best effort cleanup must not mask the primary operation result.
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function createAgentDraft(
  request: CreateAgentDraftRequest = {},
): Promise<AgentCreationDraft> {
  const profileId = request.profileId?.trim();
  if (profileId && RESERVED_AGENT_PROFILE_IDS.has(profileId)) {
    throw new Error("Mercury/default is immutable and cannot be targeted by a draft.");
  }
  return createAgentDraftInStore(request);
}

export async function getAgentDraft(
  draftId: string,
): Promise<AgentCreationDraft | null> {
  if (!draftId.trim()) return null;
  const state = await readAgentsState();
  const draft = state.drafts[draftId];
  return draft ? clone(draft) : null;
}

export async function updateAgentDraft(
  request: unknown,
  options: { onChange?: AgentDraftChangeListener } = {},
): Promise<AgentDraftMutationResult> {
  if (!isAgentDraftMutationRequest(request)) {
    return {
      success: false,
      code: "validation-error",
      error: "Invalid agent draft mutation request.",
    };
  }

  const result = await mutateAgentDraft(request);
  if (result.success && result.changed && result.event) {
    coordinateDraftChangeNotification(result.event, options.onChange);
  }
  return result;
}

export async function attachAgentSeedSkill(
  request: unknown,
  options: { onChange?: AgentDraftChangeListener } = {},
): Promise<AttachAgentSeedSkillResult> {
  const result = await attachSeedSkillToDraft(request);
  if (result.success && result.changed && result.event) {
    coordinateDraftChangeNotification(result.event, options.onChange);
  }
  return result;
}

export async function abandonAgentDraft(
  draftId: string,
  options: { onChange?: AgentDraftChangeListener } = {},
): Promise<{ success: boolean; error?: string }> {
  if (!draftId.trim()) return { success: false, error: "draftId is required." };
  flushAgentDraftNotifications(draftId);

  const state = await readAgentsState();
  const draft = state.drafts[draftId];
  if (!draft) return { success: false, error: `Agent draft '${draftId}' was not found.` };
  if (draft.status === "abandoned") return { success: true };

  const previous = draft.status;
  draft.status = "abandoned";
  draft.revision += 1;
  draft.updatedAt = new Date().toISOString();
  await writeAgentsState(state);

  emitDraftChange(
    {
      draftId: draft.id,
      revision: draft.revision,
      changes: [{ path: "status", previous, next: draft.status }],
      snapshot: clone(draft),
      notification: {
        text: "Agent draft abandoned.",
        debounced: false,
      },
    },
    options.onChange ? new Set([options.onChange]) : undefined,
  );
  return { success: true };
}

export async function commitAgentDraft(
  request: AgentCommitRequest,
): Promise<AgentCommitResult> {
  if (!request || !request.draftId?.trim()) {
    return {
      success: false,
      code: "validation-error",
      error: "draftId is required.",
    };
  }

  flushAgentDraftNotifications(request.draftId);
  const connection = getConnection();
  if (connection.mode === "remote") {
    return {
      success: false,
      code: "unsupported-remote-mode",
      error:
        "Agent draft commit is only available in local and SSH modes because it creates profiles and writes profile files.",
    };
  }

  const draft = await getAgentDraft(request.draftId);
  if (!draft) {
    return {
      success: false,
      code: "not-found",
      error: `Agent draft '${request.draftId}' was not found.`,
    };
  }
  if (
    typeof request.expectedRevision === "number" &&
    request.expectedRevision !== draft.revision
  ) {
    return {
      success: false,
      code: "conflict",
      error: `Agent draft '${request.draftId}' is at revision ${draft.revision}, not ${request.expectedRevision}.`,
      draft,
    };
  }

  const validationError = validateDraftForCommit(draft);
  if (validationError) {
    return {
      success: false,
      code: "validation-error",
      error: validationError,
      draft,
    };
  }

  const existingProfiles = await listProfilesForConnection();

  const expanded = expandAgentPackSelection(
    draft.selectedPackIds,
    undefined,
    draft.skillOverrides,
  );
  const docsPointers = mergeDocsPointers(expanded.docsPointers, draft.docsPointers);
  const metadata = profileMetadataFromDraft(draft, expanded.packIds, docsPointers);
  const skillTargets = dedupeSkillTargetsForSeed(
    expanded.skillTargets,
    draft.seedSkill,
  );

  const existingProfile = existingProfiles.find((profile) => profile.name === draft.profile);
  if (existingProfile) {
    if (!profileMatchesMetadata(existingProfile, metadata)) {
      return {
        success: false,
        code: "profile-conflict",
        error: `Agent profile '${draft.profile}' already exists.`,
        draft,
      };
    }

    try {
      await markAgentDraftCommitted(draft.id, draft.revision);
    } catch (error) {
      return {
        success: false,
        code: "commit-failed",
        error: error instanceof Error ? error.message : String(error),
        draft,
      };
    }
    if (request.activate && !setActiveProfileForConnection(draft.profile)) {
      console.warn(`[agents-service] Failed to activate committed agent profile '${draft.profile}'.`);
    }
    return { success: true, agent: existingProfile };
  }

  let profileCreated = false;
  let metadataWritten = false;
  try {
    const created = await createProfileForConnection(draft.profile, true);
    if (!created.success) {
      return {
        success: false,
        code: "commit-failed",
        error: created.error || `Failed to create agent profile '${draft.profile}'.`,
        draft,
      };
    }
    profileCreated = true;

    await applyDraftModel(draft);
    await applyDraftPersonaAndMemory(draft);

    await applyDraftToolsets(draft, expanded.toolKeys);
    await applyDraftSeedSkill(draft);
    await applyDraftSkills(draft, skillTargets);

    await writeProfileMetadataForConnection(connection, draft.profile, metadata);
    metadataWritten = true;
    await markAgentDraftCommitted(draft.id, draft.revision);

    if (request.activate && !setActiveProfileForConnection(draft.profile)) {
      console.warn(`[agents-service] Failed to activate committed agent profile '${draft.profile}'.`);
    }

    return {
      success: true,
      agent: await committedProfileInfo(draft, metadata),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (profileCreated && !metadataWritten) {
      const rollback = await deleteProfileForConnection(draft.profile);
      if (!rollback.success) {
        return {
          success: false,
          code: "rollback-failed",
          error: `${message} Rollback failed: ${rollback.error || "unknown error"}`,
          draft,
        };
      }
    }
    return {
      success: false,
      code: "commit-failed",
      error:
        profileCreated && !metadataWritten
          ? `${message} Rolled back profile '${draft.profile}'.`
          : message,
      draft,
    };
  }
}

function validateDraftForCommit(draft: AgentCreationDraft): string | null {
  if (draft.status !== "draft") return "Only draft agents can be committed.";
  if (!draft.displayName.trim()) return "Agent display name is required.";
  if (!isValidBackendProfileId(draft.profile)) {
    return "Agent profile id must be a valid backend profile id.";
  }
  if (RESERVED_AGENT_PROFILE_IDS.has(draft.profile)) {
    return "Mercury/default is immutable and cannot be targeted by a draft.";
  }
  if (
    !draft.model ||
    typeof draft.model.provider !== "string" ||
    !draft.model.provider.trim() ||
    typeof draft.model.model !== "string" ||
    !draft.model.model.trim() ||
    (draft.model.baseUrl !== undefined && typeof draft.model.baseUrl !== "string")
  ) {
    return "Agent model provider and model are required.";
  }
  const invalidPackIds = validateAgentPackIds(draft.selectedPackIds);
  if (invalidPackIds.length > 0) {
    return `Unknown agent pack ids: ${invalidPackIds.join(", ")}.`;
  }
  return null;
}

async function applyDraftModel(draft: AgentCreationDraft): Promise<void> {
  const model = draft.model;
  if (!model?.provider?.trim() || !model.model?.trim()) {
    throw new Error("Agent model provider and model are required.");
  }
  const applied = await setModelConfigForProfile(
    model.provider.trim(),
    model.model.trim(),
    model.baseUrl?.trim() || "",
    draft.profile,
  );
  if (!applied) throw new Error("Failed to apply model configuration.");
}

async function applyDraftPersonaAndMemory(draft: AgentCreationDraft): Promise<void> {
  if (draft.persona?.trim()) {
    const soulWritten = await writeSoulForProfile(draft.persona, draft.profile);
    if (!soulWritten) throw new Error("Failed to write agent persona.");
  }
  const userProfile = draft.memory?.userProfile?.trim();
  if (userProfile) {
    const result = await writeUserProfileForProfile(userProfile, draft.profile);
    if (!result.success) {
      throw new Error(result.error || "Failed to write agent user profile memory.");
    }
  }
  for (const entry of draft.memory?.entries ?? []) {
    const content = entry.trim();
    if (!content) continue;
    const result = await addMemoryEntryForProfile(content, draft.profile);
    if (!result.success) {
      throw new Error(result.error || "Failed to write agent memory entry.");
    }
  }
}

async function applyDraftToolsets(
  draft: AgentCreationDraft,
  packToolKeys: readonly string[],
): Promise<void> {
  const desired = new Set(packToolKeys);
  for (const [key, enabled] of Object.entries(draft.toolsetOverrides)) {
    if (enabled) desired.add(key);
    else desired.delete(key);
  }

  const toolsets = await getToolsetsForProfile(draft.profile);
  for (const toolset of toolsets) {
    const enabled = desired.has(toolset.key);
    const updated = await setToolsetEnabledForProfile(toolset.key, enabled, draft.profile);
    if (!updated) throw new Error(`Failed to set toolset '${toolset.key}'.`);
  }
}

async function applyDraftSkills(
  draft: AgentCreationDraft,
  skillTargets: SkillMutationTarget[],
): Promise<void> {
  const result = await mutateSkillsForProfile(skillTargets, draft.profile);
  if (!result.success) {
    const failed = result.results.find((item) => !item.success);
    throw new Error(failed && !failed.success ? failed.error : "Failed to apply agent skills.");
  }
}

function dedupeSkillTargetsForSeed(
  skillTargets: SkillMutationTarget[],
  seedSkill: AgentCreationDraft["seedSkill"],
): SkillMutationTarget[] {
  const key = seedSkillTargetKey(seedSkill);
  if (!key) return skillTargets;
  return skillTargets.filter((target) => {
    const targetDirectory = target.directoryName || target.name;
    return `${target.category ?? ""}/${targetDirectory}` !== key;
  });
}

function mergeDocsPointers(
  packDocsPointers: AgentDocsPointerSelection[],
  draftDocsPointers: AgentDocsPointerSelection[],
): AgentDocsPointerSelection[] {
  const merged = new Map<string, AgentDocsPointerSelection>();
  for (const pointer of [...packDocsPointers, ...draftDocsPointers]) {
    if (!pointer.id || !pointer.title) continue;
    merged.set(pointer.id, { ...pointer });
  }
  return [...merged.values()];
}

function profileMetadataFromDraft(
  draft: AgentCreationDraft,
  selectedPackIds: string[],
  docsPointers: AgentDocsPointerSelection[],
): ProfileAgentMetadata {
  return {
    version: 1,
    displayName: draft.displayName.trim(),
    ...(draft.description?.trim() ? { description: draft.description.trim() } : {}),
    selectedPackIds: [...selectedPackIds],
    docsPointers: docsPointers.map((pointer) => ({ ...pointer })),
    ...(draft.seedSkill?.fingerprint
      ? { seedSkillFingerprint: draft.seedSkill.fingerprint }
      : {}),
  };
}

async function writeProfileMetadataForConnection(
  connection: ReturnType<typeof getConnection>,
  profile: string,
  metadata: ProfileAgentMetadata,
): Promise<void> {
  if (connection.mode === "ssh") {
    if (!connection.ssh) throw new Error("SSH agent metadata write requires SSH configuration.");
    await sshWriteProfileAgentMetadata(connection.ssh, profile, metadata);
    return;
  }
  await writeProfileAgentMetadata(profileHome(profile), metadata);
}

async function committedProfileInfo(
  draft: AgentCreationDraft,
  metadata: ProfileAgentMetadata,
): Promise<ProfileInfo> {
  const profiles = await listProfilesForConnection();
  return profiles.find((profile) => profile.name === draft.profile) ?? fallbackProfileInfo(draft, metadata);
}

function fallbackProfileInfo(
  draft: AgentCreationDraft,
  metadata: ProfileAgentMetadata,
): ProfileInfo {
  return {
    name: draft.profile,
    path: profileHome(draft.profile),
    isDefault: false,
    isActive: false,
    model: draft.model?.model ?? "",
    provider: draft.model?.provider ?? "auto",
    hasEnv: false,
    hasSoul: Boolean(draft.persona?.trim()),
    skillCount: 0,
    skillPackCount: 0,
    memoryCount: 0,
    gatewayRunning: false,
    displayName: metadata.displayName || draft.profile,
    kind: "custom",
    immutable: false,
    deletable: true,
    description: metadata.description,
    selectedPackIds: [...(metadata.selectedPackIds ?? [])],
    docsPointers: [...(metadata.docsPointers ?? [])],
  };
}

function profileMatchesMetadata(
  profile: ProfileInfo,
  metadata: ProfileAgentMetadata,
): boolean {
  return (
    profile.displayName === (metadata.displayName || profile.name) &&
    (profile.description ?? undefined) === (metadata.description ?? undefined) &&
    JSON.stringify(profile.selectedPackIds) === JSON.stringify(metadata.selectedPackIds ?? []) &&
    JSON.stringify(profile.docsPointers) === JSON.stringify(metadata.docsPointers ?? []) &&
    (profile.seedSkillFingerprint ?? undefined) ===
      (metadata.seedSkillFingerprint ?? undefined)
  );
}


export function flushAgentDraftNotifications(draftId?: string): void {
  for (const [key, pending] of [...pendingTextNotifications.entries()]) {
    if (draftId && !key.startsWith(`${draftId}:`)) continue;
    clearTimeout(pending.timer);
    pendingTextNotifications.delete(key);
    emitDraftChange(pending.event, pending.localListeners);
  }
}

export function cancelAgentDraftNotifications(draftId?: string): void {
  for (const [key, pending] of [...pendingTextNotifications.entries()]) {
    if (draftId && !key.startsWith(`${draftId}:`)) continue;
    clearTimeout(pending.timer);
    pendingTextNotifications.delete(key);
  }
}

function coordinateDraftChangeNotification(
  event: AgentDraftChangeEvent,
  localListener?: AgentDraftChangeListener,
): void {
  const textChanges: Array<{ path: string; change: AgentDraftChange }> = [];
  const immediateChanges: AgentDraftChange[] = [];

  for (const change of event.changes) {
    const textPath = textNotificationPath(change);
    if (textPath) textChanges.push({ path: textPath, change });
    else immediateChanges.push(change);
  }

  for (const { path, change } of textChanges) {
    scheduleTextNotification(event, path, change, localListener);
  }

  if (immediateChanges.length > 0) {
    emitDraftChange(
      {
        ...event,
        changes: immediateChanges,
        notification: createNotification(immediateChanges[0], false),
      },
      localListener ? new Set([localListener]) : undefined,
    );
  }
}

function scheduleTextNotification(
  event: AgentDraftChangeEvent,
  path: string,
  change: AgentDraftChange,
  localListener?: AgentDraftChangeListener,
): void {
  const key = `${event.draftId}:${path}`;
  const previousPending = pendingTextNotifications.get(key);
  const previous = previousPending?.event.changes[0]?.previous ?? textPrevious(change, path);
  const listeners = previousPending?.localListeners ?? new Set<AgentDraftChangeListener>();
  if (localListener) listeners.add(localListener);
  if (previousPending) clearTimeout(previousPending.timer);

  const next = textNext(change, path);
  const notificationChange: AgentDraftChange = {
    path,
    previous,
    next,
  };
  const pendingEvent: AgentDraftChangeEvent = {
    ...event,
    changes: [notificationChange],
    notification: {
      text: createNotificationText(path),
      previousText: valueToNotificationText(previous),
      nextText: valueToNotificationText(next),
      debounced: true,
    },
  };

  const timer = setTimeout(() => {
    pendingTextNotifications.delete(key);
    emitDraftChange(pendingEvent, listeners);
  }, TEXT_NOTIFICATION_DEBOUNCE_MS);

  pendingTextNotifications.set(key, {
    timer,
    event: pendingEvent,
    localListeners: listeners,
  });
}

function emitDraftChange(
  event: AgentDraftChangeEvent,
  localListeners?: Set<AgentDraftChangeListener>,
): void {
  for (const listener of draftChangeListeners) {
    notifyListener(listener, event);
  }
  for (const listener of localListeners ?? []) {
    notifyListener(listener, event);
  }
}

function notifyListener(
  listener: AgentDraftChangeListener,
  event: AgentDraftChangeEvent,
): void {
  try {
    listener(event);
  } catch (error) {
    console.warn("[agents-service] Agent draft change listener failed", error);
  }
}

function textNotificationPath(change: AgentDraftChange): string | null {
  if (TEXT_NOTIFICATION_PATHS.has(change.path)) return change.path;
  if (change.path === "memory") {
    const previous = isRecord(change.previous) ? change.previous.userProfile : undefined;
    const next = isRecord(change.next) ? change.next.userProfile : undefined;
    if (previous !== next) return "memory.userProfile";
  }
  return null;
}

function textPrevious(change: AgentDraftChange, path: string): unknown {
  if (path === "memory.userProfile") {
    return isRecord(change.previous) ? change.previous.userProfile : undefined;
  }
  return change.previous;
}

function textNext(change: AgentDraftChange, path: string): unknown {
  if (path === "memory.userProfile") {
    return isRecord(change.next) ? change.next.userProfile : undefined;
  }
  return change.next;
}

function createNotification(
  change: AgentDraftChange,
  debounced: boolean,
): AgentDraftChangeEvent["notification"] {
  if (change.path === "seedSkill") {
    return {
      text: change.next ? "Attached seed skill." : "Removed seed skill.",
      debounced,
    };
  }
  return {
    text: createNotificationText(change.path),
    previousText: valueToNotificationText(change.previous),
    nextText: valueToNotificationText(change.next),
    debounced,
  };
}

function createNotificationText(path: string): string {
  const label = path
    .split(".")
    .map((part) => part.replace(/([a-z])([A-Z])/g, "$1 $2"))
    .join(" ");
  return `Updated ${label}.`;
}

function valueToNotificationText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}


function isAgentDraftMutationRequest(
  value: unknown,
): value is AgentDraftMutationRequest {
  if (!isRecord(value)) return false;
  if (typeof value.draftId !== "string" || !value.draftId.trim()) return false;
  if (value.mutationId !== undefined && typeof value.mutationId !== "string") return false;
  if (
    value.expectedRevision !== undefined &&
    (typeof value.expectedRevision !== "number" ||
      !Number.isInteger(value.expectedRevision) ||
      value.expectedRevision < 0)
  ) {
    return false;
  }
  if (!isRecord(value.patch)) return false;
  const patch = value.patch;
  const allowedKeys = [
    "displayName",
    "description",
    "persona",
    "model",
    "memory",
    "selectedPackIds",
    "docsPointers",
    "toolsetOverrides",
    "skillOverrides",
  ];
  const keys = Object.keys(patch);
  return keys.some((key) => allowedKeys.includes(key)) && keys.every((key) => isValidDraftPatchField(key, patch));
}

function isValidDraftPatchField(key: string, patch: Record<string, unknown>): boolean {
  const value = patch[key];
  switch (key) {
    case "displayName":
    case "description":
    case "persona":
      return value === undefined || typeof value === "string";
    case "model":
      return value === undefined || isStringRecord(value, ["provider", "model", "baseUrl"]);
    case "memory":
      return value === undefined || isMemoryPatch(value);
    case "selectedPackIds":
      return value === undefined || isStringArray(value);
    case "docsPointers":
      return value === undefined || isDocsPointerArray(value);
    case "toolsetOverrides":
    case "skillOverrides":
      return value === undefined || isBooleanRecord(value);
    default:
      return false;
  }
}

function isStringRecord(value: unknown, allowedKeys: string[]): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, entry]) => allowedKeys.includes(key) && (entry === undefined || typeof entry === "string"),
  );
}

function isMemoryPatch(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => {
    if (key === "userProfile") return entry === undefined || typeof entry === "string";
    if (key === "entries") return entry === undefined || isStringArray(entry);
    return false;
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isDocsPointerArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.title === "string" &&
        (entry.path === undefined || typeof entry.path === "string") &&
        (entry.url === undefined || typeof entry.url === "string"),
    )
  );
}

function isBooleanRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "boolean");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

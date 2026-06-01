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
  createProfileForConnection,
  deleteProfileForConnection,
  listProfilesForConnection,
  setActiveProfileForConnection,
} from "./sessions-service";
import { getConnection, setModelConfigForProfile } from "./config-service";
import { writeProfileAgentMetadata } from "../profiles";
import { sshWriteProfileAgentMetadata } from "../ssh-remote";
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
  AgentCommitRequest,
  AgentCommitResult,
  AgentCreationDraft,
  AgentDocsPointerSelection,
  AgentDraftChange,
  AgentDraftChangeEvent,
  AgentDraftMutationRequest,
  AgentDraftMutationResult,
  CreateAgentDraftRequest,
} from "../../shared/agents";
import type { ProfileAgentMetadata, ProfileInfo } from "../../shared/profiles";
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

export function onAgentDraftChanged(listener: AgentDraftChangeListener): () => void {
  draftChangeListeners.add(listener);
  return () => draftChangeListeners.delete(listener);
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

  const expanded = expandAgentPackSelection(draft.selectedPackIds);
  const docsPointers = mergeDocsPointers(expanded.docsPointers, draft.docsPointers);
  const metadata = profileMetadataFromDraft(draft, expanded.packIds, docsPointers);

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
    await applyDraftSkills(draft, expanded.skillTargets);

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
    JSON.stringify(profile.docsPointers) === JSON.stringify(metadata.docsPointers ?? [])
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

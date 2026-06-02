import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { HERMES_HOME } from "./installer";
import { listProfiles, type ProfileInfo } from "./profiles";
import {
  deriveProfileIdFromDisplayName,
  isValidProfileName,
  RESERVED_PROFILE_TARGET_NAMES,
  RESERVED_PROFILE_TARGETS,
} from "../shared/profile-identity";
import type {
  AgentCreationDraft,
  AgentDocsPointerSelection,
  AgentDraftChange,
  AgentDraftMutationRequest,
  AgentDraftMutationResult,
  AgentDraftPatch,
  AgentSeedSkill,
  AgentSeedSkillBase,
  AgentSeedSkillSource,
  AttachAgentSeedSkillRequest,
  AttachAgentSeedSkillResult,
  CreateAgentDraftRequest,
} from "../shared/agents";
import { DEFAULT_AGENT_PACK_IDS } from "../shared/agent-packs";

export const AGENTS_STATE_VERSION = 1;
export const MERCURY_AGENT_ID = RESERVED_PROFILE_TARGETS.mercury;
export const MERCURY_BACKEND_PROFILE = RESERVED_PROFILE_TARGETS.default;
export const RESERVED_AGENT_PROFILE_IDS = RESERVED_PROFILE_TARGET_NAMES;

const DEFAULT_DRAFT_DISPLAY_NAME = "Untitled Agent";

export interface AgentsStateV1 {
  version: 1;
  drafts: Record<string, AgentCreationDraft>;
}

export function agentDraftsStateFilePath(): string {
  return join(HERMES_HOME, "desktop", "agent-drafts.json");
}

/** @deprecated Kept as a temporary WI-C compatibility alias for draft-only state. */
export const agentsStateFilePath = agentDraftsStateFilePath;

export async function readAgentsState(
  _profiles?: ProfileInfo[],
): Promise<AgentsStateV1> {
  return readPersistedState();
}

export async function writeAgentsState(state: AgentsStateV1): Promise<void> {
  const filePath = agentDraftsStateFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(normalizeState(state), null, 2)}\n`,
    "utf-8",
  );
}

export async function createAgentDraft(
  request: CreateAgentDraftRequest = {},
  profiles?: ProfileInfo[],
): Promise<AgentCreationDraft> {
  const discoveredProfiles = profiles ?? (await listProfiles());
  const state = await readAgentsState();
  const displayName =
    cleanDisplayName(request.displayName) || DEFAULT_DRAFT_DISPLAY_NAME;
  const occupied = occupiedProfileIds(state, discoveredProfiles);
  const requestedProfile = cleanProfileId(request.profileId);
  if (requestedProfile) {
    if (!isValidBackendProfileId(requestedProfile)) {
      throw new Error(
        "Agent profile ids must start with a lowercase letter or number and contain only lowercase letters, numbers, underscores, or hyphens.",
      );
    }
    if (RESERVED_AGENT_PROFILE_IDS.has(requestedProfile)) {
      throw new Error(
        "Mercury/default is immutable and cannot be targeted by a draft.",
      );
    }
    if (occupied.has(requestedProfile)) {
      throw new Error(`Agent profile '${requestedProfile}' already exists.`);
    }
  }
  const profile =
    requestedProfile || deriveBackendProfileId(displayName, occupied);
  const now = new Date().toISOString();
  const draft: AgentCreationDraft = {
    id: request.draftId ?? randomUUID(),
    status: "draft",
    revision: 0,
    profile,
    displayName,
    selectedPackIds: [...DEFAULT_AGENT_PACK_IDS],
    docsPointers: [],
    toolsetOverrides: {},
    skillOverrides: {},
    mutationIds: [],
    createdAt: now,
    updatedAt: now,
  };
  state.drafts[draft.id] = draft;
  await writeAgentsState(state);
  return cloneDraft(draft);
}

export async function markAgentDraftCommitted(
  draftId: string,
  expectedRevision: number,
): Promise<AgentCreationDraft> {
  const state = await readAgentsState();
  const draft = state.drafts[draftId];
  if (!draft) throw new Error(`Agent draft '${draftId}' was not found.`);
  if (draft.status !== "draft" || draft.revision !== expectedRevision) {
    throw new Error(
      `Agent draft '${draftId}' changed during commit; expected revision ${expectedRevision}, found ${draft.revision}.`,
    );
  }
  draft.status = "committed";
  draft.revision += 1;
  draft.updatedAt = new Date().toISOString();
  state.drafts[draftId] = draft;
  await writeAgentsState(state);
  return cloneDraft(draft);
}

export async function mutateAgentDraft(
  request: AgentDraftMutationRequest,
  _profiles?: ProfileInfo[],
): Promise<AgentDraftMutationResult> {
  const state = await readAgentsState();
  const draft = state.drafts[request.draftId];
  if (!draft) {
    return {
      success: false,
      code: "not-found",
      error: `Agent draft '${request.draftId}' was not found.`,
    };
  }

  if (request.mutationId && draft.mutationIds.includes(request.mutationId)) {
    return { success: true, draft: cloneDraft(draft), changed: false };
  }

  if (
    typeof request.expectedRevision === "number" &&
    request.expectedRevision !== draft.revision
  ) {
    return {
      success: false,
      code: "conflict",
      error: `Agent draft '${request.draftId}' is at revision ${draft.revision}, not ${request.expectedRevision}.`,
      draft: cloneDraft(draft),
    };
  }

  const changes = applyPatch(draft, request.patch);
  if (request.mutationId) draft.mutationIds.push(request.mutationId);

  if (changes.length === 0) {
    await writeAgentsState(state);
    return { success: true, draft: cloneDraft(draft), changed: false };
  }

  draft.revision += 1;
  draft.updatedAt = new Date().toISOString();
  await writeAgentsState(state);

  const snapshot = cloneDraft(draft);
  return {
    success: true,
    draft: snapshot,
    changed: true,
    event: {
      draftId: draft.id,
      revision: draft.revision,
      changes,
      snapshot,
    },
  };
}

export async function setAgentDraftSeedSkill(
  request: Omit<AttachAgentSeedSkillRequest, "seedSkill"> & {
    seedSkill: AgentSeedSkill | null;
  },
): Promise<AttachAgentSeedSkillResult> {
  const state = await readAgentsState();
  const draft = state.drafts[request.draftId];
  if (!draft) {
    return {
      success: false,
      code: "not-found",
      error: `Agent draft '${request.draftId}' was not found.`,
    };
  }

  if (request.mutationId && draft.mutationIds.includes(request.mutationId)) {
    return { success: true, draft: cloneDraft(draft), changed: false };
  }

  if (draft.status !== "draft") {
    return {
      success: false,
      code: "immutable-agent",
      error: "Only draft agents can be modified.",
      draft: cloneDraft(draft),
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
      draft: cloneDraft(draft),
    };
  }

  const changes: AgentDraftChange[] = [];
  setIfChanged(draft, "seedSkill", request.seedSkill, changes);
  if (request.mutationId) draft.mutationIds.push(request.mutationId);

  if (changes.length === 0) {
    await writeAgentsState(state);
    return { success: true, draft: cloneDraft(draft), changed: false };
  }

  draft.revision += 1;
  draft.updatedAt = new Date().toISOString();
  await writeAgentsState(state);

  const snapshot = cloneDraft(draft);
  return {
    success: true,
    draft: snapshot,
    changed: true,
    event: {
      draftId: draft.id,
      revision: draft.revision,
      changes,
      snapshot,
    },
  };
}

export const deriveBackendProfileId = deriveProfileIdFromDisplayName;
export const isValidBackendProfileId = isValidProfileName;

async function readPersistedState(): Promise<AgentsStateV1> {
  try {
    const raw = await readFile(agentDraftsStateFilePath(), "utf-8");
    return normalizeState(JSON.parse(raw) as unknown);
  } catch {
    return emptyState();
  }
}

function normalizeState(value: unknown): AgentsStateV1 {
  if (!isRecord(value) || value.version !== AGENTS_STATE_VERSION) {
    return emptyState();
  }

  const drafts: Record<string, AgentCreationDraft> = {};
  if (isRecord(value.drafts)) {
    for (const [id, draft] of Object.entries(value.drafts)) {
      const normalized = normalizeDraft(id, draft);
      if (normalized) drafts[id] = normalized;
    }
  }

  return { version: AGENTS_STATE_VERSION, drafts };
}

function normalizeDraft(id: string, value: unknown): AgentCreationDraft | null {
  if (!isRecord(value)) return null;
  const displayName =
    cleanDisplayName(value.displayName) || DEFAULT_DRAFT_DISPLAY_NAME;
  const profile = stringValue(value.profile);
  if (!profile || !isValidBackendProfileId(profile)) return null;
  if (RESERVED_AGENT_PROFILE_IDS.has(profile)) return null;
  const now = new Date().toISOString();
  return {
    id: stringValue(value.id) || id,
    status:
      value.status === "committed" || value.status === "abandoned"
        ? value.status
        : "draft",
    revision: nonNegativeInteger(value.revision),
    profile,
    displayName,
    description: stringValue(value.description),
    persona: stringValue(value.persona),
    model: isRecord(value.model) ? { ...value.model } : undefined,
    memory: isRecord(value.memory) ? { ...value.memory } : undefined,
    selectedPackIds: stringArray(value.selectedPackIds),
    docsPointers: docsPointers(value.docsPointers),
    toolsetOverrides: booleanRecord(value.toolsetOverrides),
    skillOverrides: booleanRecord(value.skillOverrides),
    seedSkill: normalizeSeedSkill(value.seedSkill),
    mutationIds: stringArray(value.mutationIds),
    createdAt: stringValue(value.createdAt) || now,
    updatedAt: stringValue(value.updatedAt) || now,
  };
}

function applyPatch(
  draft: AgentCreationDraft,
  patch: AgentDraftPatch,
): AgentDraftChange[] {
  const changes: AgentDraftChange[] = [];
  setIfChanged(
    draft,
    "displayName",
    hasOwn(patch, "displayName")
      ? cleanDisplayName(patch.displayName) || undefined
      : undefined,
    changes,
  );
  setIfChanged(draft, "description", patch.description, changes);
  setIfChanged(draft, "persona", patch.persona, changes);
  setIfChanged(draft, "model", cloneObject(patch.model), changes);
  setIfChanged(draft, "memory", cloneObject(patch.memory), changes);
  setIfChanged(
    draft,
    "selectedPackIds",
    cloneArray(patch.selectedPackIds),
    changes,
  );
  setIfChanged(draft, "docsPointers", cloneArray(patch.docsPointers), changes);
  setIfChanged(
    draft,
    "toolsetOverrides",
    cloneObject(patch.toolsetOverrides),
    changes,
  );
  setIfChanged(
    draft,
    "skillOverrides",
    cloneObject(patch.skillOverrides),
    changes,
  );
  return changes;
}

function setIfChanged<Key extends keyof AgentCreationDraft>(
  draft: AgentCreationDraft,
  key: Key,
  next: AgentCreationDraft[Key] | undefined,
  changes: AgentDraftChange[],
): void {
  if (next === undefined) return;
  const previous = draft[key];
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  draft[key] = next;
  changes.push({ path: key, previous, next });
}

function occupiedProfileIds(
  state: AgentsStateV1,
  profiles: ProfileInfo[],
): Set<string> {
  const occupied = new Set<string>();
  for (const profile of profiles) occupied.add(profile.name);
  for (const draft of Object.values(state.drafts)) occupied.add(draft.profile);
  return occupied;
}

function emptyState(): AgentsStateV1 {
  return { version: AGENTS_STATE_VERSION, drafts: {} };
}

function cleanDisplayName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanProfileId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function docsPointers(value: unknown): AgentDocsPointerSelection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AgentDocsPointerSelection[] => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.title !== "string"
    ) {
      return [];
    }
    return [
      {
        id: entry.id,
        title: entry.title,
        path: stringValue(entry.path),
        url: stringValue(entry.url),
      },
    ];
  });
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled === "boolean") result[key] = enabled;
  }
  return result;
}

function normalizeSeedSkill(value: unknown): AgentSeedSkill | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const base = normalizeSeedSkillBase(value);
  if (!base) return undefined;

  if (value.kind === "markdown") {
    const markdown = stringValue(value.markdown);
    if (!markdown) return undefined;
    return { ...base, kind: "markdown", markdown };
  }

  if (value.kind === "source") {
    const source = stringValue(value.source);
    const candidateId = stringValue(value.candidateId);
    const directoryName = stringValue(value.directoryName);
    if (!source || !candidateId || !directoryName) return undefined;
    if (!isRecord(value.request) || !isRecord(value.candidate)) return undefined;
    return {
      ...base,
      kind: "source",
      source,
      candidateId,
      directoryName,
      request: { ...value.request } as AgentSeedSkillSource["request"],
      candidate: { ...value.candidate } as AgentSeedSkillSource["candidate"],
    };
  }

  return undefined;
}

function normalizeSeedSkillBase(
  value: Record<string, unknown>,
): AgentSeedSkillBase | null {
  const name = stringValue(value.name);
  const category = stringValue(value.category);
  const description = typeof value.description === "string" ? value.description : undefined;
  const fingerprint = stringValue(value.fingerprint);
  const contentPreview = typeof value.contentPreview === "string" ? value.contentPreview : undefined;
  if (!name || !category || !fingerprint || contentPreview === undefined) return null;
  return {
    name,
    category,
    description: description ?? "",
    fingerprint,
    contentPreview,
    contentPreviewTruncated: value.contentPreviewTruncated === true,
    overwrite: value.overwrite === true,
  };
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function cloneDraft(draft: AgentCreationDraft): AgentCreationDraft {
  return JSON.parse(JSON.stringify(draft)) as AgentCreationDraft;
}

function cloneObject<T extends object>(value: T | undefined): T | undefined {
  return value ? ({ ...value } as T) : undefined;
}

function cloneArray<T>(value: T[] | undefined): T[] | undefined {
  return value ? [...value] : undefined;
}

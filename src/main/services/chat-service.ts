import {
  sendMessage,
  startGateway,
  isGatewayRunning,
  stopGateway,
  getRuntimeIdentity,
  ensureSshTunnelIfNeeded,
  setSshRemoteApiKey,
  isRemoteMode,
} from "../hermes";
import {
  createDraftMutationTextParser,
  extractArtifactEventsFromText,
  type DraftMutationBlock,
} from "../hermes/trace-events";
import type {
  ChatCallbacks,
  ChatRunOptions,
  ChatTransportDiagnostic,
  ChatTraceCallbackEvent,
  ProfileRuntimeHandle,
} from "../hermes/types";
import { profileRuntimeManager } from "../hermes/runtime";
import { startSshTunnel, isSshTunnelHealthy } from "../ssh-tunnel";
import { getConnectionConfig } from "../config";
import {
  createTraceRun,
  finishTraceRun,
  recordTraceEvent,
  recordTraceUsage,
} from "../trace-store";
import {
  sshGatewayStatus,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "../ssh-remote";
import {
  updateSessionProfile,
  updateSessionTitle,
  projectCachedSession,
} from "../session-cache";
import {
  cachedSessionFromServerSession,
  createHermesSession,
  readHermesSession,
} from "./hermes-sessions-api";
import {
  resolveRunApproval,
  type RunApprovalChoice,
  type RunApprovalResponse,
} from "../hermes/runs-api";
import { generateChatTitle as resolveChatTitle } from "../hermes/title";
import { isSyntheticChatStreamEnabled } from "../hermes/synthetic-chat";
import type { ChatErrorInfo } from "../../shared/codex-auth-recovery";
import type {
  AgentChatOptions,
  AgentCreationDraft,
  AgentDocsPointerSelection,
  AgentDraftChangeEvent,
  AgentDraftMemorySelection,
  AgentDraftModelSelection,
  AgentDraftPatch,
  AgentSeedSkill,
} from "../../shared/agents";
import type {
  TraceEvent,
  TraceEventType,
  TraceUsage,
} from "../../shared/traces";
import {
  normalizeGenerateChatTitleRequest,
  type GenerateChatTitleRequest,
} from "../../shared/chat-metadata";
import { classifyChatRemediation } from "../../shared/chat-remediation";
import {
  AGENT_PACK_CATALOG,
  agentPackMemberKey,
  agentPackMemberLabel,
} from "../../shared/agent-packs";
import { getAgentDraft, updateAgentDraft } from "./agents-service";

export type ChatResponse = { response: string; sessionId?: string };

type ActiveChatRun = {
  runToken: string;
  traceRunId?: string;
  abort: () => void;
  settleAbort: () => void;
};

export interface RunChatRequest {
  message: string;
  profile?: string;
  resumeSessionId?: string;
  history?: Array<{ role: string; content: string }>;
  callbacks?: ChatServiceCallbacks;
  options?: AgentChatOptions;
}

export interface ChatServiceCallbacks {
  onChunk?: (chunk: string) => void;
  onDone?: (sessionId?: string) => void;
  onError?: (error: string, info?: ChatErrorInfo) => void;
  onLiveTraceEvent?: (event: TraceEvent) => void;
  onAgentDraftChanged?: (event: AgentDraftChangeEvent) => void;
  onToolProgress?: (tool: string) => void;
  onUsage?: (usage: TraceUsage) => void;
  onCompleted?: (result: ChatResponse & { durationMs: number }) => void;
  onFailed?: (error: string) => void;
}

export interface ResolveChatRunApprovalRequest {
  runId: string;
  choice: RunApprovalChoice;
  profile?: string;
  all?: boolean;
  resolveAll?: boolean;
}

let activeChatRun: ActiveChatRun | null = null;

function isLiveChatActivityEvent(type: TraceEventType): boolean {
  return (
    type.startsWith("tool.") ||
    type.startsWith("delegation.") ||
    type === "artifact.created" ||
    type.startsWith("approval.") ||
    type === "transport.error"
  );
}

function reportBestEffortFailure(label: string, error: unknown): void {
  console.warn(`[chat-service] Non-critical ${label} failed`, error);
}

function runBestEffort<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    reportBestEffortFailure(label, error);
    return undefined;
  }
}

function notify(label: string, fn: () => void): void {
  runBestEffort(label, fn);
}

function emitLiveTrace(
  callbacks: ChatServiceCallbacks | undefined,
  event: TraceEvent | null | undefined,
): void {
  if (!event || !isLiveChatActivityEvent(event.type)) return;
  notify("live trace callback", () => callbacks?.onLiveTraceEvent?.(event));
}

function extractAgentDraftMutationPayload(
  traceEvent: ChatTraceCallbackEvent,
): unknown {
  const metadata = traceEvent.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const candidates = [
    metadata.agentDraftMutationRequest,
    metadata.agentDraftMutation,
    metadata.draftMutation,
    metadata.payload,
    typeof metadata.agentDraft === "object" && metadata.agentDraft !== null
      ? (metadata.agentDraft as Record<string, unknown>).mutation
      : undefined,
  ];
  return candidates.find((candidate) => candidate !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftIdFromPayload(payload: unknown): string | undefined {
  return isRecord(payload) && typeof payload.draftId === "string"
    ? payload.draftId
    : undefined;
}

type NormalizedDraftMutationDelta = {
  draftId: string;
  mutationId?: string;
  expectedRevision?: number;
  patch: Record<string, unknown>;
};

async function buildAgentCreationRunOptions(
  options: AgentChatOptions | undefined,
): Promise<ChatRunOptions | undefined> {
  if (!options) return undefined;
  if (options.mode !== "agent-creation") {
    return { agentDraftId: options.agentDraftId, mode: options.mode };
  }
  if (!options.agentDraftId) {
    throw new Error("agentDraftId is required for agent-creation chat.");
  }
  const draft = await getAgentDraft(options.agentDraftId);
  if (!draft) {
    throw new Error(`Agent draft '${options.agentDraftId}' was not found.`);
  }
  return {
    agentDraftId: options.agentDraftId,
    mode: options.mode,
    instructions: buildAgentCreationInstructions(draft),
  };
}

function buildAgentCreationInstructions(draft: AgentCreationDraft): string {
  const packs = AGENT_PACK_CATALOG.map((pack) => ({
    id: pack.id,
    displayName: pack.displayName,
    description: pack.description,
    members: pack.members.map((member) => ({
      key: agentPackMemberKey(member),
      kind: member.kind,
      label: agentPackMemberLabel(member),
      ...(member.kind === "tool" ? { toolsetOverrideKey: member.key } : {}),
      ...(member.kind === "skill"
        ? {
            category: member.category,
            directoryName: member.directoryName,
          }
        : {}),
      ...(member.kind === "docs-pointer"
        ? {
            id: member.id,
            title: member.title,
            path: member.path,
            url: member.url,
          }
        : {}),
    })),
  }));
  const toolsetKeys = [
    ...new Set(
      AGENT_PACK_CATALOG.flatMap((pack) =>
        pack.members.flatMap((member) =>
          member.kind === "tool" ? [member.key] : [],
        ),
      ),
    ),
  ].sort();
  const skillOverrideKeys = [
    ...new Set(
      AGENT_PACK_CATALOG.flatMap((pack) =>
        pack.members.flatMap((member) =>
          member.kind === "docs-pointer" ? [] : [agentPackMemberKey(member)],
        ),
      ),
    ),
  ].sort();
  const docsPointerIds = [
    ...new Set(
      AGENT_PACK_CATALOG.flatMap((pack) =>
        pack.members.flatMap((member) =>
          member.kind === "docs-pointer" ? [member.id] : [],
        ),
      ),
    ),
  ].sort();

  return `You are Mercury helping Fred build an agent draft in Mercury.

Current persisted draft snapshot (authoritative for this turn):
${JSON.stringify(draftForAgentCreationPrompt(draft), null, 2)}${seedSkillBriefing(draft.seedSkill)}

Valid Mercury agent pack/toolset/skill vocabulary:
${JSON.stringify({ packs, toolsetKeys, skillOverrideKeys, docsPointerIds }, null, 2)}

DELTA CONTRACT:
- Reply normally to Fred in conversational prose.
- Whenever you decide or change draft state, include exactly one machine-readable block in your reply:
  <draft-mutation>{"patch":{...}}</draft-mutation>
- The block JSON must be valid JSON, with no comments, markdown fences, or trailing commas.
- Emit ONLY fields that changed in this turn. Omit fields you are preserving.
- Text fields may include displayName, description, and persona.
- Packs are deltas: use addPackIds and removePackIds with valid pack ids. Do not invent pack ids.
- Docs are deltas: use addDocsPointers with complete {id,title,path?,url?} entries and removeDocsPointerIds with ids.
- toolsetOverrides is a touched-key map keyed by toolsetKeys. Use true/false to set; use null to clear an existing override key.
- skillOverrides is a touched-key map keyed by skillOverrideKeys. Use true/false to set; use null to clear an existing override key.
- seedSkill is managed by Mercury UI/import flows only. Do not emit seedSkill in <draft-mutation>; Mercury ignores it.
- For model and memory objects, include only changed keys; Mercury will merge them with the current draft snapshot.
- Never claim a draft change happened unless you emit the corresponding <draft-mutation> block.`;
}

function draftForAgentCreationPrompt(
  draft: AgentCreationDraft,
): Record<string, unknown> {
  const snapshot = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>;
  snapshot.seedSkill = draft.seedSkill
    ? seedSkillPromptSummary(draft.seedSkill)
    : draft.seedSkill;
  return snapshot;
}

function seedSkillPromptSummary(
  seedSkill: AgentSeedSkill,
): Record<string, unknown> {
  const directoryName =
    seedSkill.kind === "source" ? seedSkill.directoryName : seedSkill.name;
  return {
    kind: seedSkill.kind,
    name: seedSkill.name,
    category: seedSkill.category,
    directoryName,
    description: seedSkill.description,
    fingerprint: seedSkill.fingerprint,
    contentPreview: "[redacted: see Seed skill briefing]",
  };
}

function seedSkillBriefing(
  seedSkill: AgentSeedSkill | null | undefined,
): string {
  if (!seedSkill) return "";
  const directoryName =
    seedSkill.kind === "source" ? seedSkill.directoryName : seedSkill.name;
  return `

Seed skill briefing (capped; use for context only, do not copy into mutations):
When a seed skill is attached and the draft is still unnamed/default, proactively analyze the skill and propose displayName, description, and persona via the <draft-mutation> delta contract; never emit seedSkill.
${JSON.stringify(
  {
    kind: seedSkill.kind,
    name: seedSkill.name,
    category: seedSkill.category,
    directoryName,
    description: seedSkill.description,
    fingerprint: seedSkill.fingerprint,
    contentPreview: seedSkill.contentPreview,
    contentPreviewTruncated: seedSkill.contentPreviewTruncated,
  },
  null,
  2,
)}`;
}

function normalizeDraftMutationPayload(
  payload: unknown,
  fallbackDraftId: string,
): NormalizedDraftMutationDelta | null {
  if (!isRecord(payload)) return null;
  const payloadDraftId = draftIdFromPayload(payload);
  if (payloadDraftId && payloadDraftId !== fallbackDraftId) return null;
  const patch = isRecord(payload.patch) ? payload.patch : undefined;
  if (!patch) return null;
  const mutationId =
    typeof payload.mutationId === "string" ? payload.mutationId : undefined;
  const expectedRevision =
    typeof payload.expectedRevision === "number" &&
    Number.isInteger(payload.expectedRevision) &&
    payload.expectedRevision >= 0
      ? payload.expectedRevision
      : undefined;
  return {
    draftId: payloadDraftId || fallbackDraftId,
    mutationId,
    expectedRevision,
    patch,
  };
}

function mergeDraftMutationDelta(
  draft: AgentCreationDraft,
  delta: Record<string, unknown>,
): AgentDraftPatch {
  const patch: AgentDraftPatch = {};

  for (const key of ["displayName", "description", "persona"] as const) {
    if (typeof delta[key] === "string") patch[key] = delta[key];
  }

  if (isRecord(delta.model)) {
    patch.model = mergeModel(draft.model, delta.model);
  }
  if (isRecord(delta.memory)) {
    patch.memory = mergeMemory(draft.memory, delta.memory);
  }

  const selectedPackIds = mergeStringArrayDelta(
    draft.selectedPackIds,
    delta.selectedPackIds,
    delta.addPackIds,
    delta.removePackIds,
  );
  if (selectedPackIds) patch.selectedPackIds = selectedPackIds;

  const docsPointers = mergeDocsPointerDelta(
    draft.docsPointers,
    delta.docsPointers,
    delta.addDocsPointers,
    delta.removeDocsPointerIds,
  );
  if (docsPointers) patch.docsPointers = docsPointers;

  const toolsetOverrides = mergeBooleanOverrideDelta(
    draft.toolsetOverrides,
    delta.toolsetOverrides,
  );
  if (toolsetOverrides) patch.toolsetOverrides = toolsetOverrides;

  const skillOverrides = mergeBooleanOverrideDelta(
    draft.skillOverrides,
    delta.skillOverrides,
  );
  if (skillOverrides) patch.skillOverrides = skillOverrides;

  return patch;
}

function mergeModel(
  current: AgentDraftModelSelection | undefined,
  delta: Record<string, unknown>,
): AgentDraftModelSelection {
  const merged: AgentDraftModelSelection = { ...(current ?? {}) };
  for (const key of ["provider", "model", "baseUrl"] as const) {
    if (typeof delta[key] === "string") merged[key] = delta[key];
  }
  return merged;
}

function mergeMemory(
  current: AgentDraftMemorySelection | undefined,
  delta: Record<string, unknown>,
): AgentDraftMemorySelection {
  const merged: AgentDraftMemorySelection = { ...(current ?? {}) };
  if (typeof delta.userProfile === "string")
    merged.userProfile = delta.userProfile;
  if (isStringArray(delta.entries)) merged.entries = [...delta.entries];
  return merged;
}

function mergeStringArrayDelta(
  current: readonly string[],
  replacement: unknown,
  additions: unknown,
  removals: unknown,
): string[] | undefined {
  let changed = false;
  let next = isStringArray(replacement)
    ? uniqueStrings(replacement)
    : [...current];
  if (isStringArray(replacement)) changed = true;
  if (isStringArray(additions)) {
    next = uniqueStrings([...next, ...additions]);
    changed = true;
  }
  if (isStringArray(removals)) {
    const removed = new Set(removals);
    next = next.filter((entry) => !removed.has(entry));
    changed = true;
  }
  return changed ? next : undefined;
}

function mergeDocsPointerDelta(
  current: readonly AgentDocsPointerSelection[],
  replacement: unknown,
  additions: unknown,
  removals: unknown,
): AgentDocsPointerSelection[] | undefined {
  let changed = false;
  const base = isDocsPointerArray(replacement) ? replacement : current;
  const byId = new Map(base.map((pointer) => [pointer.id, { ...pointer }]));
  if (isDocsPointerArray(replacement)) changed = true;
  if (isStringArray(removals)) {
    for (const id of removals) byId.delete(id);
    changed = true;
  }
  if (isDocsPointerArray(additions)) {
    for (const pointer of additions) byId.set(pointer.id, { ...pointer });
    changed = true;
  }
  return changed ? [...byId.values()] : undefined;
}

function mergeBooleanOverrideDelta(
  current: Readonly<Record<string, boolean>>,
  delta: unknown,
): Record<string, boolean> | undefined {
  if (!isRecord(delta)) return undefined;
  const next: Record<string, boolean> = { ...current };
  let changed = false;
  for (const [key, value] of Object.entries(delta)) {
    if (value === null) {
      delete next[key];
      changed = true;
    } else if (typeof value === "boolean") {
      next[key] = value;
      changed = true;
    }
  }
  return changed ? next : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isDocsPointerArray(
  value: unknown,
): value is AgentDocsPointerSelection[] {
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

function hasPatchFields(patch: AgentDraftPatch): boolean {
  return Object.keys(patch).length > 0;
}

function abortCurrentRun(detail: string): void {
  if (!activeChatRun) return;
  const run = activeChatRun;
  activeChatRun = null;
  runBestEffort("chat abort", () => run.abort());
  if (run.traceRunId) {
    runBestEffort("trace abort finalization", () =>
      finishTraceRun(run.traceRunId!, "aborted", undefined, detail),
    );
  }
  run.settleAbort();
}

export function abortActiveChatRun(
  detail = "Mercury shut down the active Hermes run.",
): void {
  abortCurrentRun(detail);
}

export async function prepareChatBackend(
  profile?: string,
  purpose: "chat" | "title" = "chat",
  sessionId?: string,
): Promise<ProfileRuntimeHandle | undefined> {
  if (isSyntheticChatStreamEnabled()) return undefined;

  const normalizedProfile = profileRuntimeManager.normalizeProfile(profile);
  if (!isRemoteMode()) {
    if (!isGatewayRunning(normalizedProfile)) {
      startGateway(normalizedProfile);
    } else {
      const identity = getRuntimeIdentity(normalizedProfile);
      if (!identity?.startedByMercury) {
        stopGateway(true, normalizedProfile);
        startGateway(normalizedProfile);
      }
    }
  }

  if (!isRemoteMode()) {
    return profileRuntimeManager.resolveRuntime({
      profile: normalizedProfile,
      purpose,
      sessionId,
    });
  }

  await ensureSshTunnelIfNeeded(normalizedProfile);
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const gatewayRunning = await sshGatewayStatus(conn.ssh, normalizedProfile);
    const tunnelHealthy = await isSshTunnelHealthy(conn.ssh, normalizedProfile);
    if (!gatewayRunning || !tunnelHealthy) {
      await sshStartGateway(conn.ssh, normalizedProfile);
      await startSshTunnel(conn.ssh, normalizedProfile);
    }
    const key = await sshReadRemoteApiKey(conn.ssh, normalizedProfile);
    setSshRemoteApiKey(key, normalizedProfile);
  }

  return profileRuntimeManager.resolveRuntime({
    profile: normalizedProfile,
    purpose,
    sessionId,
  });
}

export async function runChatMessage({
  message,
  profile,
  resumeSessionId,
  history,
  callbacks,
  options,
}: RunChatRequest): Promise<ChatResponse> {
  abortCurrentRun("Superseded by a new Hermes message.");
  let effectiveSessionId = resumeSessionId;

  let fullResponse = "";
  let recordedAgentStart = false;
  const chatStartTime = Date.now();
  const traceRun = runBestEffort("trace run creation", () =>
    createTraceRun(message, profile),
  );
  const traceRunId = traceRun?.id;
  const runToken =
    traceRunId ??
    `chat-${chatStartTime}-${Math.random().toString(36).slice(2)}`;
  const recordChatTraceEvent = (
    label: string,
    type: TraceEventType,
    title: string,
    detail?: string,
    metadata?: Record<string, unknown>,
  ): TraceEvent | null | undefined => {
    if (!traceRunId) return undefined;
    return runBestEffort(label, () =>
      recordTraceEvent(traceRunId, type, title, detail, metadata),
    );
  };
  const finishChatTraceRun = (
    label: string,
    status: "completed" | "failed" | "aborted",
    sessionId?: string,
    detail?: string,
  ): void => {
    if (!traceRunId) return;
    runBestEffort(label, () =>
      finishTraceRun(traceRunId, status, sessionId, detail),
    );
  };
  const shouldParseDraftMutationBlocks =
    options?.mode === "agent-creation" && Boolean(options.agentDraftId);
  const draftMutationParser = shouldParseDraftMutationBlocks
    ? createDraftMutationTextParser()
    : undefined;
  const pendingDraftMutationBlocks: DraftMutationBlock[] = [];
  const recordDraftMutationFailure = (
    detail: string,
    metadata: Record<string, unknown> = {},
  ): void => {
    const recordedEvent = recordChatTraceEvent(
      "trace agent draft mutation failed",
      "tool.failed",
      "Agent draft update failed",
      detail,
      {
        source: "agent-draft",
        draftId: options?.agentDraftId,
        ...metadata,
      },
    );
    emitLiveTrace(callbacks, recordedEvent ?? null);
  };
  const processDraftMutationBlock = async (
    block: DraftMutationBlock,
  ): Promise<void> => {
    try {
      if (options?.mode !== "agent-creation" || !options.agentDraftId) return;
      if (block.parseError) {
        recordDraftMutationFailure(block.parseError, {
          code: "invalid-draft-mutation-json",
          raw: block.raw.slice(0, 500),
        });
        return;
      }
      const request = normalizeDraftMutationPayload(
        block.payload,
        options.agentDraftId,
      );
      if (!request || request.draftId !== options.agentDraftId) {
        recordDraftMutationFailure("Invalid agent draft mutation block.", {
          code: "invalid-draft-mutation-payload",
        });
        return;
      }
      const freshDraft = await getAgentDraft(options.agentDraftId);
      if (!freshDraft) {
        recordDraftMutationFailure(
          `Agent draft '${options.agentDraftId}' was not found.`,
          { code: "not-found" },
        );
        return;
      }
      const patch = mergeDraftMutationDelta(freshDraft, request.patch);
      if (!hasPatchFields(patch)) return;
      const result = await updateAgentDraft(
        {
          draftId: options.agentDraftId,
          ...(request.mutationId ? { mutationId: request.mutationId } : {}),
          ...(request.expectedRevision !== undefined
            ? { expectedRevision: request.expectedRevision }
            : {}),
          patch,
        },
        { onChange: callbacks?.onAgentDraftChanged },
      );
      if (!result.success) {
        recordDraftMutationFailure(result.error, {
          code: result.code,
        });
      }
    } catch (error) {
      recordDraftMutationFailure(
        error instanceof Error ? error.message : String(error),
        { code: "draft-mutation-side-effect-failed" },
      );
    }
  };
  const processAgentDraftTraceEvent = async (
    traceEvent: ChatTraceCallbackEvent,
  ): Promise<void> => {
    if (options?.mode !== "agent-creation" || !options.agentDraftId) return;
    if (!traceEvent.type.startsWith("tool.")) return;

    const payload = extractAgentDraftMutationPayload(traceEvent);
    if (payload === undefined) return;
    const request = normalizeDraftMutationPayload(
      payload,
      options.agentDraftId,
    );
    if (!request || request.draftId !== options.agentDraftId) return;
    const freshDraft = await getAgentDraft(options.agentDraftId);
    if (!freshDraft) return;
    const patch = mergeDraftMutationDelta(freshDraft, request.patch);
    if (!hasPatchFields(patch)) return;

    const result = await updateAgentDraft(
      {
        draftId: options.agentDraftId,
        ...(request.mutationId ? { mutationId: request.mutationId } : {}),
        ...(request.expectedRevision !== undefined
          ? { expectedRevision: request.expectedRevision }
          : {}),
        patch,
      },
      {
        onChange: callbacks?.onAgentDraftChanged,
      },
    );
    if (!result.success) {
      const recordedEvent = recordChatTraceEvent(
        "trace agent draft mutation failed",
        "tool.failed",
        "Agent draft update failed",
        result.error,
        {
          source: "agent-draft",
          code: result.code,
          draftId: options.agentDraftId,
        },
      );
      emitLiveTrace(callbacks, recordedEvent ?? null);
    }
  };

  if (resumeSessionId) {
    recordChatTraceEvent(
      "trace session resume",
      "session.resumed",
      "Session resumed",
      resumeSessionId,
      { sessionId: resumeSessionId },
    );
  }
  if (history?.length) {
    recordChatTraceEvent(
      "trace history loaded",
      "message.history.loaded",
      "History loaded",
      `${history.length} previous messages included.`,
      {
        messageCount: history.length,
        userCount: history.filter((msg) => msg.role === "user").length,
        agentCount: history.filter(
          (msg) => msg.role === "agent" || msg.role === "assistant",
        ).length,
      },
    );
  }

  let settled = false;
  let resolveChat!: (v: ChatResponse) => void;
  let rejectChat!: (reason?: unknown) => void;
  const promise = new Promise<ChatResponse>((res, rej) => {
    resolveChat = res;
    rejectChat = rej;
  });
  const settleResolved = (response: ChatResponse): void => {
    if (settled) return;
    settled = true;
    resolveChat(response);
  };
  const settleRejected = (reason: unknown): void => {
    if (settled) return;
    settled = true;
    rejectChat(reason);
  };
  const isActiveRun = (): boolean => activeChatRun?.runToken === runToken;
  const shouldIgnoreCallback = (): boolean =>
    settled || (activeChatRun !== null && !isActiveRun());
  let skipNextLegacyToolTrace = false;
  let missingSessionDiagnosticRecorded = false;
  const recordMissingSessionDiagnostic = (
    diagnostic?: ChatTransportDiagnostic,
  ): void => {
    if (missingSessionDiagnosticRecorded) return;
    missingSessionDiagnosticRecorded = true;
    const normalizedProfile = profileRuntimeManager.normalizeProfile(
      diagnostic?.profile ?? profile,
    );
    const metadata = {
      code: "missing-session-id",
      severity: "warning",
      source: diagnostic?.source ?? "service",
      profile: normalizedProfile,
      resumed: Boolean(effectiveSessionId),
      transport: diagnostic?.transport,
      apiBaseUrl: diagnostic?.apiBaseUrl,
      headerName: "x-hermes-session-id",
      headerShape: diagnostic?.headerShape ?? "missing",
    };
    console.warn(
      "[chat-service] Chat completed without a durable Hermes session id",
      metadata,
    );
    recordChatTraceEvent(
      "trace missing session id diagnostic",
      "transport.error",
      "Missing durable session id",
      "Chat completed successfully, but Hermes did not return x-hermes-session-id; the chat will remain non-persistent.",
      metadata,
    );
  };

  const transportCallbacks: ChatCallbacks = {
    onChunk: (chunk) => {
      if (shouldIgnoreCallback()) return;
      const parsed = draftMutationParser?.push(chunk) ?? {
        visibleText: chunk,
        mutations: [],
      };
      pendingDraftMutationBlocks.push(...parsed.mutations);
      const visibleChunk = parsed.visibleText;
      fullResponse += visibleChunk;
      if (!recordedAgentStart && visibleChunk.trim()) {
        recordedAgentStart = true;
        recordChatTraceEvent(
          "trace agent start",
          "message.agent.delta",
          "Agent response started",
          visibleChunk.trim().slice(0, 180),
        );
      }
      if (visibleChunk) {
        notify("chat chunk callback", () => callbacks?.onChunk?.(visibleChunk));
      }
    },
    onDone: (sessionId) => {
      if (shouldIgnoreCallback()) return;
      const completedSessionId = sessionId || effectiveSessionId;
      if (isActiveRun()) activeChatRun = null;
      void (async () => {
        const flushed = draftMutationParser?.flush() ?? {
          visibleText: "",
          mutations: [],
        };
        pendingDraftMutationBlocks.push(...flushed.mutations);
        if (flushed.visibleText) {
          fullResponse += flushed.visibleText;
          notify("chat chunk callback", () =>
            callbacks?.onChunk?.(flushed.visibleText),
          );
        }
        for (const block of pendingDraftMutationBlocks) {
          await processDraftMutationBlock(block);
        }

        if (fullResponse.trim()) {
          recordChatTraceEvent(
            "trace agent completion",
            "message.agent.delta",
            "Agent response completed",
            fullResponse.trim().slice(0, 320),
          );
        }
        const artifactEvents =
          runBestEffort("artifact extraction", () =>
            extractArtifactEventsFromText(fullResponse),
          ) ?? [];
        for (const artifactEvent of artifactEvents) {
          const recordedEvent = recordChatTraceEvent(
            "trace artifact event",
            artifactEvent.type,
            artifactEvent.title,
            artifactEvent.detail,
            artifactEvent.metadata,
          );
          emitLiveTrace(callbacks, recordedEvent ?? null);
        }
        finishChatTraceRun(
          "trace completion finalization",
          "completed",
          completedSessionId,
          "Hermes returned a completed response.",
        );
        if (!completedSessionId) {
          recordMissingSessionDiagnostic();
        }
        if (completedSessionId) {
          const profileUpdated = runBestEffort("session profile update", () =>
            updateSessionProfile(completedSessionId, profile),
          );
          if (profileUpdated === false) {
            console.warn(
              "[chat-service] Hermes returned a session id, but the session cache/profile row was not updated",
              {
                sessionId: completedSessionId,
                profile: profileRuntimeManager.normalizeProfile(profile),
              },
            );
          }
        }
        notify("chat done callback", () =>
          callbacks?.onDone?.(completedSessionId),
        );
        const response = {
          response: fullResponse,
          sessionId: completedSessionId,
        };
        settleResolved(response);
        notify("chat completion callback", () =>
          callbacks?.onCompleted?.({
            ...response,
            durationMs: Date.now() - chatStartTime,
          }),
        );
      })().catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notify("chat done error callback", () =>
          callbacks?.onError?.(errorMessage),
        );
        settleRejected(error);
      });
    },
    onError: (error, info) => {
      if (shouldIgnoreCallback()) return;
      if (isActiveRun()) activeChatRun = null;
      const visibleError = info?.displayMessage || error;
      const metadata: Record<string, unknown> = { source: "chat" };
      if (info?.recovery) metadata.recovery = info.recovery;
      if (info?.remediation) metadata.remediation = info.remediation;
      const recordedError = recordChatTraceEvent(
        "trace transport error",
        "transport.error",
        "Transport error",
        visibleError,
        metadata,
      );
      emitLiveTrace(callbacks, recordedError ?? null);
      finishChatTraceRun(
        "trace failure finalization",
        "failed",
        undefined,
        visibleError,
      );
      notify("chat error callback", () =>
        callbacks?.onError?.(visibleError, info),
      );
      settleRejected(new Error(error));
      notify("chat failure callback", () =>
        callbacks?.onFailed?.(visibleError),
      );
    },
    onTraceEvent: (traceEvent) => {
      if (shouldIgnoreCallback()) return;
      if (
        traceEvent.type.startsWith("tool.") ||
        traceEvent.type.startsWith("delegation.")
      ) {
        skipNextLegacyToolTrace = true;
      }
      const recordedEvent = recordChatTraceEvent(
        "trace callback event",
        traceEvent.type,
        traceEvent.title,
        traceEvent.detail,
        traceEvent.metadata,
      );
      emitLiveTrace(callbacks, recordedEvent ?? null);
      void processAgentDraftTraceEvent(traceEvent);
    },
    onDiagnostic: (diagnostic) => {
      if (shouldIgnoreCallback()) return;
      if (diagnostic.code === "missing-session-id" && !effectiveSessionId) {
        recordMissingSessionDiagnostic(diagnostic);
      }
    },
    onToolProgress: (tool) => {
      if (shouldIgnoreCallback()) return;
      if (skipNextLegacyToolTrace) {
        skipNextLegacyToolTrace = false;
      } else {
        const recordedEvent = recordChatTraceEvent(
          "trace tool progress",
          "tool.progress",
          "Tool progress",
          tool,
        );
        emitLiveTrace(callbacks, recordedEvent ?? null);
      }
      notify("chat tool progress callback", () =>
        callbacks?.onToolProgress?.(tool),
      );
    },
    onUsage: (usage) => {
      if (shouldIgnoreCallback()) return;
      if (traceRunId) {
        runBestEffort("trace usage", () => recordTraceUsage(traceRunId, usage));
      }
      notify("chat usage callback", () => callbacks?.onUsage?.(usage));
    },
  };

  try {
    const runtime = await prepareChatBackend(
      profile,
      "chat",
      effectiveSessionId,
    );
    if (runtime) {
      const serverSession = effectiveSessionId
        ? await readHermesSession(runtime, effectiveSessionId)
        : await createHermesSession(runtime);
      effectiveSessionId = serverSession.id;
      projectCachedSession(cachedSessionFromServerSession(serverSession));
      if (!resumeSessionId) {
        recordChatTraceEvent(
          "trace session create",
          "session.created",
          "Session created",
          effectiveSessionId,
          { sessionId: effectiveSessionId },
        );
      }
    }
    const enrichedOptions = await buildAgentCreationRunOptions(options);
    const handle = await sendMessage(
      message,
      transportCallbacks,
      profile,
      effectiveSessionId,
      history,
      runtime,
      enrichedOptions,
    );

    if (!settled) {
      activeChatRun = {
        runToken,
        traceRunId,
        abort: handle.abort,
        settleAbort: () => {
          notify("chat abort done callback", () => callbacks?.onDone?.());
          settleResolved({ response: fullResponse });
        },
      };
    }
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const visibleError = code ? `${code}: ${errorMessage}` : errorMessage;
    const info = {
      remediation: classifyChatRemediation({
        source: "chat_setup",
        error: errorMessage,
        profile: profileRuntimeManager.normalizeProfile(profile),
        runtimeErrorCode: code,
      }),
    };
    const recordedError = recordChatTraceEvent(
      "trace send setup error",
      "transport.error",
      "Transport error",
      visibleError,
      { source: "chat-send", code, remediation: info.remediation },
    );
    emitLiveTrace(callbacks, recordedError ?? null);
    finishChatTraceRun(
      "trace send setup failure finalization",
      "failed",
      undefined,
      visibleError,
    );
    notify("chat setup error callback", () =>
      callbacks?.onError?.(visibleError, info.remediation ? info : undefined),
    );
    settleRejected(error);
    notify("chat setup failure callback", () =>
      callbacks?.onFailed?.(visibleError),
    );
  }

  return promise;
}

export async function generateChatTitleForRequest(
  request: GenerateChatTitleRequest,
): Promise<string> {
  const normalizedRequest = normalizeGenerateChatTitleRequest(request);
  if (isSyntheticChatStreamEnabled()) {
    const title = "Synthetic chat benchmark";
    if (normalizedRequest.sessionId) {
      updateSessionTitle(
        normalizedRequest.sessionId,
        title,
        normalizedRequest.profile,
      );
    }
    return title;
  }

  const title = await resolveChatTitle(normalizedRequest);
  if (normalizedRequest.sessionId && title) {
    updateSessionTitle(
      normalizedRequest.sessionId,
      title,
      normalizedRequest.profile,
    );
  }
  return title;
}

export async function resolveChatRunApprovalForRequest({
  runId,
  choice,
  profile,
  all,
  resolveAll,
}: ResolveChatRunApprovalRequest): Promise<RunApprovalResponse> {
  const runtime = await prepareChatBackend(profile, "chat");
  if (!runtime) {
    throw new Error(
      "Synthetic chat mode does not support Hermes run approvals.",
    );
  }
  return resolveRunApproval(runtime, runId, { choice, all, resolveAll });
}

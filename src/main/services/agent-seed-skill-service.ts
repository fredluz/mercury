import { createHash } from "crypto";
import type {
  AgentCreationDraft,
  AgentSeedSkill,
  AgentSeedSkillMarkdown,
  AgentSeedSkillPrepareRequest,
  AgentSeedSkillSource,
  AttachAgentSeedSkillRequest,
  AttachAgentSeedSkillResult,
} from "../../shared/agents";
import type { SkillMarkdownImportRequest, SkillSourceImportRequest } from "../../shared/skills";
import { readAgentsState, setAgentDraftSeedSkill } from "../agent-store";
import { getConnection } from "./config-service";
import {
  importSkillMarkdownForProfile,
  importSkillSourceForProfile,
} from "./knowledge-service";
import { prepareSkillMarkdownImport } from "../skills/importer";
import { fetchSkillSourceDirectory } from "../skills/source-service";

const SEED_SKILL_PREVIEW_MAX_CHARS = 2_000;

export async function attachSeedSkillToDraft(
  request: unknown,
): Promise<AttachAgentSeedSkillResult> {
  const parsed = parseAttachRequest(request);
  if (!parsed.success) return parsed;

  const connection = getConnection();
  if (connection.mode === "remote") {
    return {
      success: false,
      code: "unsupported-remote-mode",
      error:
        "Seed skills are only available in local and SSH modes because agent commit imports them into the selected profile.",
    };
  }

  const preflight = await preflightSeedSkillMutation(parsed.request);
  if (!preflight.success) return preflight.result;

  if (parsed.request.seedSkill === null) {
    return setAgentDraftSeedSkill({ ...parsed.request, seedSkill: null });
  }

  const prepared = await prepareSeedSkill(parsed.request.seedSkill);
  if (!prepared.success) return prepared;

  return setAgentDraftSeedSkill({
    draftId: parsed.request.draftId,
    expectedRevision: parsed.request.expectedRevision,
    mutationId: parsed.request.mutationId,
    seedSkill: prepared.seedSkill,
  });
}

export async function applyDraftSeedSkill(
  draft: AgentCreationDraft,
): Promise<void> {
  const seed = draft.seedSkill;
  if (!seed) return;

  if (seed.kind === "markdown") {
    const result = await importSkillMarkdownForProfile(
      {
        markdown: seed.markdown,
        name: seed.name,
        category: seed.category,
        description: seed.description,
        overwrite: seed.overwrite,
      },
      draft.profile,
    );
    if (!result.success) throw new Error(result.error || "Failed to import seed skill.");
    return;
  }

  const result = await importSkillSourceForProfile(
    {
      ...seed.request,
      source: seed.source,
      candidateId: seed.candidateId,
      name: seed.name,
      category: seed.category,
      description: seed.description,
      directoryName: seed.directoryName,
      overwrite: seed.overwrite,
    },
    draft.profile,
  );
  if (!result.success) throw new Error(result.error || "Failed to import seed skill source.");
}

export function seedSkillTargetKey(seed: AgentSeedSkill | null | undefined): string | null {
  if (!seed) return null;
  const directoryName = seed.kind === "source" ? seed.directoryName : seed.name;
  return `${seed.category}/${directoryName}`;
}

async function preflightSeedSkillMutation(
  request: AttachAgentSeedSkillRequest,
): Promise<
  | { success: true }
  | { success: false; result: AttachAgentSeedSkillResult }
> {
  const state = await readAgentsState();
  const draft = state.drafts[request.draftId];
  if (!draft) {
    return {
      success: false,
      result: {
        success: false,
        code: "not-found",
        error: `Agent draft '${request.draftId}' was not found.`,
      },
    };
  }
  if (request.mutationId && draft.mutationIds.includes(request.mutationId)) {
    return {
      success: false,
      result: { success: true, draft: clone(draft), changed: false },
    };
  }
  if (draft.status !== "draft") {
    return {
      success: false,
      result: {
        success: false,
        code: "immutable-agent",
        error: "Only draft agents can be modified.",
        draft: clone(draft),
      },
    };
  }
  if (
    typeof request.expectedRevision === "number" &&
    request.expectedRevision !== draft.revision
  ) {
    return {
      success: false,
      result: {
        success: false,
        code: "conflict",
        error: `Agent draft '${request.draftId}' is at revision ${draft.revision}, not ${request.expectedRevision}.`,
        draft: clone(draft),
      },
    };
  }
  return { success: true };
}

async function prepareSeedSkill(
  request: AgentSeedSkillPrepareRequest,
): Promise<
  | { success: true; seedSkill: AgentSeedSkill }
  | Extract<AttachAgentSeedSkillResult, { success: false }>
> {
  if (request.kind === "markdown") return prepareMarkdownSeed(request);
  if (request.kind === "source") return prepareSourceSeed(request);
  return validationFailure("Invalid seed skill request.");
}

function prepareMarkdownSeed(
  request: Extract<AgentSeedSkillPrepareRequest, { kind: "markdown" }>,
):
  | { success: true; seedSkill: AgentSeedSkillMarkdown }
  | Extract<AttachAgentSeedSkillResult, { success: false }> {
  const importRequest: SkillMarkdownImportRequest = {
    markdown: request.markdown,
    name: request.name,
    category: request.category,
    description: request.description,
    overwrite: request.overwrite ?? false,
  };
  const prepared = prepareSkillMarkdownImport(importRequest);
  if (!prepared.success) return prepared;
  const preview = cappedPreview(prepared.prepared.markdown);
  return {
    success: true,
    seedSkill: {
      kind: "markdown",
      name: prepared.prepared.name,
      category: prepared.prepared.category,
      description: prepared.prepared.description,
      markdown: prepared.prepared.markdown,
      overwrite: request.overwrite === true,
      contentPreview: preview.content,
      contentPreviewTruncated: preview.truncated,
      fingerprint: fingerprint({
        kind: "markdown",
        name: prepared.prepared.name,
        category: prepared.prepared.category,
        markdown: prepared.prepared.markdown,
      }),
    },
  };
}

async function prepareSourceSeed(
  request: Extract<AgentSeedSkillPrepareRequest, { kind: "source" }>,
): Promise<
  | { success: true; seedSkill: AgentSeedSkillSource }
  | Extract<AttachAgentSeedSkillResult, { success: false }>
> {
  const importRequest: SkillSourceImportRequest = {
    source: request.source,
    candidateId: request.candidateId,
    skillSelector: request.skillSelector,
    name: request.name,
    category: request.category,
    description: request.description,
    directoryName: request.directoryName,
    overwrite: request.overwrite ?? false,
  };
  const fetched = await fetchSkillSourceDirectory(importRequest);
  if (!fetched.success) {
    return {
      success: false,
      code: fetched.code,
      error: fetched.error,
      candidates: fetched.candidates,
    };
  }

  const skillMarkdownFile = fetched.files.find(
    (file) => normalizeRelativePath(file.relativePath) === "SKILL.md",
  );
  if (!skillMarkdownFile) {
    return {
      success: false,
      code: "invalid-markdown",
      error: "Seed skill source must contain a top-level SKILL.md file.",
    };
  }
  const markdown = Buffer.from(skillMarkdownFile.contentBase64, "base64").toString("utf-8");
  const prepared = prepareSkillMarkdownImport({
    markdown,
    name: request.name ?? fetched.candidate.name,
    category: request.category ?? fetched.candidate.category,
    description: request.description ?? fetched.candidate.description,
    overwrite: request.overwrite ?? false,
  });
  if (!prepared.success) return prepared;

  const directoryName =
    request.directoryName?.trim() || fetched.candidate.directoryName || prepared.prepared.name;
  const pinnedRequest: SkillSourceImportRequest = {
    ...importRequest,
    candidateId: fetched.candidate.candidateId,
    name: prepared.prepared.name,
    category: prepared.prepared.category,
    description: prepared.prepared.description,
    directoryName,
    overwrite: request.overwrite === true,
  };
  const preview = cappedPreview(prepared.prepared.markdown);
  return {
    success: true,
    seedSkill: {
      kind: "source",
      source: request.source,
      candidateId: fetched.candidate.candidateId,
      request: pinnedRequest,
      candidate: fetched.candidate,
      name: prepared.prepared.name,
      category: prepared.prepared.category,
      description: prepared.prepared.description,
      directoryName,
      overwrite: request.overwrite === true,
      contentPreview: preview.content,
      contentPreviewTruncated: preview.truncated,
      fingerprint: fingerprint({
        kind: "source",
        candidateId: fetched.candidate.candidateId,
        name: prepared.prepared.name,
        category: prepared.prepared.category,
        directoryName,
        markdown: prepared.prepared.markdown,
      }),
    },
  };
}

function parseAttachRequest(value: unknown):
  | { success: true; request: AttachAgentSeedSkillRequest }
  | Extract<AttachAgentSeedSkillResult, { success: false }> {
  if (!isRecord(value)) return validationFailure("Invalid seed skill attach request.");
  if (typeof value.draftId !== "string" || !value.draftId.trim()) {
    return validationFailure("draftId is required.");
  }
  if (value.mutationId !== undefined && typeof value.mutationId !== "string") {
    return validationFailure("mutationId must be a string when provided.");
  }
  if (
    value.expectedRevision !== undefined &&
    (typeof value.expectedRevision !== "number" ||
      !Number.isInteger(value.expectedRevision) ||
      value.expectedRevision < 0)
  ) {
    return validationFailure("expectedRevision must be a non-negative integer when provided.");
  }
  if (value.seedSkill !== null && !isSeedPrepareRequest(value.seedSkill)) {
    return validationFailure("seedSkill must be a markdown/source request or null.");
  }
  return {
    success: true,
    request: {
      draftId: value.draftId,
      mutationId: value.mutationId,
      expectedRevision: value.expectedRevision,
      seedSkill: value.seedSkill,
    },
  };
}

function isSeedPrepareRequest(value: unknown): value is AgentSeedSkillPrepareRequest {
  if (!isRecord(value)) return false;
  if (value.kind === "markdown") return typeof value.markdown === "string";
  if (value.kind === "source") return typeof value.source === "string";
  return false;
}

function validationFailure(error: string): Extract<AttachAgentSeedSkillResult, { success: false }> {
  return { success: false, code: "validation-error", error };
}

function cappedPreview(content: string): { content: string; truncated: boolean } {
  if (content.length <= SEED_SKILL_PREVIEW_MAX_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: `${content.slice(0, SEED_SKILL_PREVIEW_MAX_CHARS)}…`,
    truncated: true,
  };
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (!isRecord(value)) return JSON.stringify(value);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = value[key];
  return JSON.stringify(sorted);
}

function normalizeRelativePath(path: string): string {
  return path.split(/[\\/]+/).join("/");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

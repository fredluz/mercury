import type {
  ParsedSkillSource,
  SkillSourceCandidate,
  SkillSourceImportRequest,
  SkillSourcePreviewRequest,
  SkillSourcePreviewResult,
} from "../../shared/skills";
import {
  fetchPinnedGitHubSkillDirectory,
  parseGitHubCandidateId,
  resolveGitHubSkillCandidates,
  type GitHubSkillSourceFile,
} from "./github-source";
import { parseSkillSource } from "./source-parser";

export type FetchedSkillSourceDirectoryResult =
  | {
      success: true;
      source: ParsedSkillSource;
      candidate: SkillSourceCandidate;
      files: GitHubSkillSourceFile[];
    }
  | {
      success: false;
      code:
        | "invalid-source"
        | "unsupported-source"
        | "fetch-failed"
        | "rate-limited"
        | "source-too-large"
        | "multiple-candidates"
        | "not-found"
        | "invalid-markdown";
      error: string;
      source?: ParsedSkillSource;
      candidates?: SkillSourceCandidate[];
    };

export async function previewSkillSource(
  request: SkillSourcePreviewRequest,
): Promise<SkillSourcePreviewResult> {
  const parsed = parseSkillSource(request.source);
  if (!parsed.success) {
    return { success: false, code: parsed.code, error: parsed.error };
  }

  const candidates = await resolveGitHubSkillCandidates(parsed.source, {
    skillSelector: request.skillSelector ?? parsed.source.skillSelector,
  });
  if (!candidates.success) {
    return {
      success: false,
      code:
        candidates.code === "multiple-candidates" ||
        candidates.code === "invalid-markdown"
          ? "not-found"
          : candidates.code,
      error: candidates.error,
    };
  }

  return { success: true, source: parsed.source, candidates: candidates.candidates };
}

export async function fetchSkillSourceDirectory(
  request: SkillSourceImportRequest,
): Promise<FetchedSkillSourceDirectoryResult> {
  const parsed = parseSkillSource(request.source);
  if (!parsed.success) {
    return { success: false, code: parsed.code, error: parsed.error };
  }

  if (request.candidateId) {
    const candidate = parseGitHubCandidateId(request.candidateId);
    if (!candidate.success) {
      return {
        success: false,
        code: "invalid-source",
        error: candidate.error,
        source: parsed.source,
      };
    }
    if (
      candidate.owner !== parsed.source.owner ||
      candidate.repo !== parsed.source.repo
    ) {
      return {
        success: false,
        code: "invalid-source",
        error: "Candidate id does not match the requested GitHub source.",
        source: parsed.source,
      };
    }

    const directory = await fetchPinnedGitHubSkillDirectory(
      candidate.owner,
      candidate.repo,
      candidate.commitSha,
      candidate.skillPath,
      request,
    );
    if (!directory.success) {
      return { ...directory, source: parsed.source };
    }
    return {
      success: true,
      source: parsed.source,
      candidate: directory.candidate,
      files: directory.files,
    };
  }

  const candidates = await resolveGitHubSkillCandidates(parsed.source, request);
  if (!candidates.success) {
    return { ...candidates, source: parsed.source };
  }
  const validCandidates = candidates.candidates.filter((candidate) => candidate.valid);
  if (validCandidates.length > 1) {
    return {
      success: false,
      code: "multiple-candidates",
      error: "Multiple GitHub skill candidates were found. Select a candidate before importing.",
      source: parsed.source,
      candidates: candidates.candidates,
    };
  }
  if (validCandidates.length === 0) {
    return {
      success: false,
      code: "not-found",
      error: "No valid GitHub skill candidates were found.",
      source: parsed.source,
      candidates: candidates.candidates,
    };
  }

  const selected = validCandidates[0];
  const directory = await fetchPinnedGitHubSkillDirectory(
    parsed.source.owner,
    parsed.source.repo,
    selected.commitSha,
    selected.skillPath,
    request,
  );
  if (!directory.success) return { ...directory, source: parsed.source };
  return {
    success: true,
    source: parsed.source,
    candidate: directory.candidate,
    files: directory.files,
  };
}

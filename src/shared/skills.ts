export type SkillAction = "install" | "uninstall";

export type InstalledSkillSummary = {
  name: string;
  category: string;
  description: string;
  path: string;
  directoryName: string;
};

export type SkillMutationTarget = {
  action: SkillAction;
  name: string;
  category?: string;
  directoryName?: string;
  path?: string;
};

export type SkillMutationErrorCode =
  | "invalid-target"
  | "not-found"
  | "duplicate"
  | "ambiguous-skill"
  | "unsupported-remote-mode"
  | "command-failed"
  | "timeout"
  | "write-failed"
  | "unknown";

export type SkillMutationItemResult =
  | {
      success: true;
      action: SkillAction;
      target: SkillMutationTarget;
      name: string;
      category?: string;
      changed: boolean;
      skill?: InstalledSkillSummary;
    }
  | {
      success: false;
      action: SkillAction;
      target: SkillMutationTarget;
      name: string;
      category?: string;
      code: SkillMutationErrorCode;
      error: string;
    };

export type SkillMutationBatchResult = {
  success: boolean;
  updated: number;
  failed: number;
  results: SkillMutationItemResult[];
};

export type SkillMarkdownImportRequest = {
  markdown: string;
  name?: string;
  category?: string;
  description?: string;
  overwrite?: boolean;
};

export type SkillMarkdownImportResult =
  | {
      success: true;
      skill: {
        name: string;
        category: string;
        description: string;
        path: string;
      };
      warning?: "gateway-restart-required";
    }
  | {
      success: false;
      code:
        | "invalid-markdown"
        | "invalid-name"
        | "invalid-category"
        | "duplicate"
        | "write-failed";
      error: string;
    };

export type PreparedSkillMarkdownImport = {
  name: string;
  category: string;
  description: string;
  markdown: string;
};

export type ParsedSkillSource = {
  kind: "github";
  owner: string;
  repo: string;
  originalSource: string;
  pathKind: "repo" | "tree" | "blob" | "raw";
  rawRefAndPath?: string[];
  ref?: string;
  path?: string;
  skillSelector?: string;
};

export type SkillSourceCandidateId =
  `github:${string}/${string}@${string}:${string}`;

export type SkillSourceCandidate = {
  candidateId: SkillSourceCandidateId;
  name: string;
  category: string;
  directoryName: string;
  description: string;
  skillPath: string;
  sourceLabel: string;
  commitSha: string;
  treeSha?: string;
  valid: boolean;
  error?: string;
  /**
   * The SKILL.md body for this candidate, captured at preview time so the UI can
   * show a read-only preview before importing. Populated for GitHub sources;
   * may be absent for post-import / directory-derived candidates.
   */
  markdown?: string;
};

export type SkillSourcePreviewRequest = {
  source: string;
  skillSelector?: string;
};

export type SkillSourceFailureCode =
  | "invalid-source"
  | "unsupported-source"
  | "fetch-failed"
  | "rate-limited"
  | "source-too-large"
  | "multiple-candidates"
  | "not-found"
  | "invalid-markdown"
  | "invalid-name"
  | "invalid-category"
  | "duplicate"
  | "write-failed"
  | "unsupported-remote-mode";

export type SkillSourcePreviewResult =
  | {
      success: true;
      source: ParsedSkillSource;
      candidates: SkillSourceCandidate[];
    }
  | {
      success: false;
      code: Extract<
        SkillSourceFailureCode,
        | "invalid-source"
        | "unsupported-source"
        | "fetch-failed"
        | "rate-limited"
        | "source-too-large"
        | "not-found"
      >;
      error: string;
    };

export type SkillSourceImportRequest = {
  source: string;
  candidateId?: string;
  skillSelector?: string;
  name?: string;
  category?: string;
  description?: string;
  directoryName?: string;
  overwrite?: boolean;
};

export type SkillSourceImportResult =
  | {
      success: true;
      skill: {
        name: string;
        category: string;
        description: string;
        path: string;
        directoryName: string;
      };
      source: ParsedSkillSource;
      candidate: SkillSourceCandidate;
      warning?: "gateway-restart-required";
    }
  | {
      success: false;
      code: SkillSourceFailureCode;
      error: string;
      source?: ParsedSkillSource;
      candidates?: SkillSourceCandidate[];
    };

export type SkillAssociatedFile = {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
};

export type SkillMetadata = {
  path: string;
  scripts: SkillAssociatedFile[];
  references: SkillAssociatedFile[];
  metadataAvailable: boolean;
  unavailableReason?: string;
};

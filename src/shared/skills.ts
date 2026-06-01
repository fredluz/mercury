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

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

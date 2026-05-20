export type MigrationSourceKind = "hermes" | "openclaw";

export type CandidateAgentOrigin =
  | "hermes-profile"
  | "openclaw-agent"
  | "openclaw-workspace"
  | "session-cluster"
  | "cron-cluster"
  | "skill-bundle";

export type CandidateConfidence = "high" | "medium" | "low";

export type PrivacyFlag =
  | "credentials-present"
  | "secrets-redacted"
  | "pii-redacted"
  | "transcript-derived"
  | "raw-content-redacted";

export type InventoryArtifactKind =
  | "config"
  | "env"
  | "auth"
  | "persona"
  | "memory"
  | "skill"
  | "session"
  | "cron"
  | "task"
  | "channel"
  | "log"
  | "workspace"
  | "unknown";

export interface CandidateEvidence {
  kind: InventoryArtifactKind;
  path: string;
  label: string;
  count?: number;
  privacyFlags?: PrivacyFlag[];
}

export interface CandidateActivity {
  sessionCount: number;
  messageCount: number;
  cronJobCount: number;
  skillCount: number;
  lastActive: number | null;
  sources: string[];
  models: string[];
}

export interface CandidateAgent {
  id: string;
  sourceKind: MigrationSourceKind;
  origin: CandidateAgentOrigin;
  displayName: string;
  confidence: CandidateConfidence;
  sourceRoots: string[];
  sourceProfiles: string[];
  evidence: CandidateEvidence[];
  personaSummary: string;
  capabilitySummary: string;
  useCaseSummary: string;
  activity: CandidateActivity;
  privacyFlags: PrivacyFlag[];
  proposedTargetProfile: string;
  warnings: string[];
}

export interface MigrationInventorySource {
  kind: MigrationSourceKind;
  path: string;
  label: string;
  exists: boolean;
  markers: string[];
  warnings: string[];
}

export interface MigrationInventoryOptions {
  includeDefaultSources?: boolean;
  hermesRoots?: string[];
  openClawRoots?: string[];
}

export interface MigrationPromptOptions extends MigrationInventoryOptions {
  includeInventory?: boolean;
}

export interface MigrationInventory {
  generatedAt: number;
  sources: MigrationInventorySource[];
  candidates: CandidateAgent[];
  warnings: string[];
}

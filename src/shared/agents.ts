import type { ProfileInfo } from "./profiles";

export interface AgentDocsPointerSelection {
  id: string;
  title: string;
  path?: string;
  url?: string;
}

export type AgentDraftStatus = "draft" | "committed" | "abandoned";

export interface AgentDraftModelSelection {
  provider?: string;
  model?: string;
  baseUrl?: string;
}

export interface AgentDraftMemorySelection {
  userProfile?: string;
  entries?: string[];
}

export interface CreateAgentDraftRequest {
  draftId?: string;
  displayName?: string;
  /** Optional explicit backend profile id; product APIs reject reserved ids such as default/mercury. */
  profileId?: string;
}

export interface AgentCreationDraft {
  id: string;
  status: AgentDraftStatus;
  revision: number;
  /** Locked backend Hermes profile id derived when the draft is created. */
  profile: string;
  displayName: string;
  description?: string;
  persona?: string;
  model?: AgentDraftModelSelection;
  memory?: AgentDraftMemorySelection;
  selectedPackIds: string[];
  docsPointers: AgentDocsPointerSelection[];
  toolsetOverrides: Record<string, boolean>;
  /**
   * Per-member include/exclude overrides within selected packs, keyed by
   * `agentPackMemberKey` (e.g. `skill:research/arxiv`, `tool:web`). A `false`
   * entry trims that member from an otherwise-selected pack; `true` is the
   * implicit default and only persisted when re-enabling a previously excluded
   * member.
   */
  skillOverrides: Record<string, boolean>;
  /** Persisted idempotency keys for deterministic draft mutation retries. */
  mutationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgentDraftPatch {
  displayName?: string;
  description?: string;
  persona?: string;
  model?: AgentDraftModelSelection;
  memory?: AgentDraftMemorySelection;
  selectedPackIds?: string[];
  docsPointers?: AgentDocsPointerSelection[];
  toolsetOverrides?: Record<string, boolean>;
  /** Per-pack-member include/exclude overrides keyed by `agentPackMemberKey`. */
  skillOverrides?: Record<string, boolean>;
}

export interface AgentChatOptions {
  agentDraftId?: string;
  mode?: "agent-creation";
}

export interface AgentDraftMutationRequest {
  draftId: string;
  mutationId?: string;
  expectedRevision?: number;
  patch: AgentDraftPatch;
}

export interface AgentDraftChange {
  path: string;
  previous: unknown;
  next: unknown;
}

export interface AgentDraftChangeEvent {
  draftId: string;
  revision: number;
  changes: AgentDraftChange[];
  snapshot: AgentCreationDraft;
  notification?: {
    text: string;
    previousText?: string;
    nextText?: string;
    debounced: boolean;
  };
}

export interface AgentCommitRequest {
  draftId: string;
  expectedRevision?: number;
  activate?: boolean;
}

export type AgentCommitResult =
  | {
      success: true;
      agent: ProfileInfo;
    }
  | {
      success: false;
      code:
        | "not-found"
        | "conflict"
        | "validation-error"
        | "profile-conflict"
        | "unsupported-remote-mode"
        | "commit-failed"
        | "rollback-failed";
      error: string;
      draft?: AgentCreationDraft;
    };

export type AgentDraftMutationResult =
  | {
      success: true;
      draft: AgentCreationDraft;
      changed: boolean;
      event?: AgentDraftChangeEvent;
    }
  | {
      success: false;
      code: "not-found" | "conflict" | "validation-error" | "immutable-agent";
      error: string;
      draft?: AgentCreationDraft;
    };

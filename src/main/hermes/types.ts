import type { ChatErrorInfo } from "../../shared/codex-auth-recovery";
import type { TraceEventType } from "../../shared/traces";
import type { AgentChatOptions, AgentDraftChangeEvent } from "../../shared/agents";

export type RuntimeMode = "local" | "ssh" | "remote";

export type RuntimePurpose =
  | "chat"
  | "title"
  | "cron"
  | "gateway"
  | "models"
  | "tools"
  | "skills"
  | "memory"
  | "soul"
  | "sessions"
  | "mcp";

export type RuntimeTransport = "api" | "ssh-api" | "remote-api";

export type RuntimeVerificationSource =
  | "identity-endpoint"
  | "managed-process"
  | "declared-remote"
  | "unverified";

export type RuntimeErrorCode =
  | "runtime-profile-mismatch"
  | "runtime-profile-unverified"
  | "runtime-unsupported-remote-profile"
  | "runtime-invalid-api-key"
  | "runtime-capability-missing"
  | "runtime-capability-probe-failed"
  | "runtime-port-conflict"
  | "runtime-auth-conflict"
  | "runtime-token-conflict"
  | "runtime-stale-after-profile-switch"
  | "runtime-unavailable";

export interface ProfileRuntimeRequest {
  profile?: string;
  mode?: RuntimeMode;
  purpose: RuntimePurpose;
  sessionId?: string;
  preferTransport?: "api";
}

export interface RuntimeIdentity {
  requestedProfile: string;
  actualProfile: string | null;
  verified: boolean;
  verificationSource: RuntimeVerificationSource;
  mode: RuntimeMode;
  transport: RuntimeTransport;
  apiBaseUrl?: string;
  localPort?: number;
  remotePort?: number;
  pid?: number;
  pidFile?: string;
  logDir?: string;
  hermesHome?: string;
  configPath?: string;
  authKeyFingerprint?: string;
  startedByMercury: boolean;
  verifiedAt: number;
  capabilities?: Record<string, boolean>;
  capabilityProblem?: HermesCapabilityGateProblem;
  command?: string[];
  mismatchReason?: string;
}

export interface ProfileRuntimeHandle {
  request: ProfileRuntimeRequest & { profile: string; mode: RuntimeMode };
  identity: RuntimeIdentity;
  transport: RuntimeTransport;
  apiBaseUrl?: string;
  authHeaders?: Record<string, string>;
}

export interface HermesCapabilityDescriptor {
  object?: string;
  platform?: string;
  model?: string;
  authRequired: boolean;
  features: Record<string, boolean>;
  endpoints: Record<string, { method?: string; path?: string }>;
  sessionContinuationHeader?: string;
  sessionKeyHeader?: string;
}

export type HermesCapabilityGateProblem =
  | "invalid-api-key"
  | "missing-required-features"
  | "network"
  | "malformed";

export type HermesCapabilityGateResult =
  | {
      ok: true;
      healthOk: true;
      descriptor: HermesCapabilityDescriptor;
      featureSummary: Record<string, boolean>;
    }
  | {
      ok: false;
      healthOk: boolean;
      problem: HermesCapabilityGateProblem;
      message: string;
      statusCode?: number;
      missingFeatures?: string[];
      featureSummary?: Record<string, boolean>;
    };

export class ProfileRuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly identity?: RuntimeIdentity;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    identity?: RuntimeIdentity,
  ) {
    super(message);
    this.name = "ProfileRuntimeError";
    this.code = code;
    this.identity = identity;
  }

  toJSON(): { code: RuntimeErrorCode; message: string; identity?: RuntimeIdentity } {
    return {
      code: this.code,
      message: this.message,
      identity: this.identity,
    };
  }
}

export interface ChatHandle {
  abort: () => void;
}

export interface ChatTraceCallbackEvent {
  type: TraceEventType;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export type ChatSessionIdHeaderShape =
  | "missing"
  | "string"
  | "string-empty"
  | "array"
  | "array-empty"
  | "unsupported";

export interface ChatRunOptions extends AgentChatOptions {
  /** Mercury-internal per-run prompt; never trusted from renderer/IPC input. */
  instructions?: string;
}

export interface ChatTransportDiagnostic {
  code: "missing-session-id";
  severity: "warning";
  source: "api" | "service";
  profile: string;
  resumed: boolean;
  transport?: RuntimeTransport;
  apiBaseUrl?: string;
  headerName: "x-hermes-session-id";
  headerShape: ChatSessionIdHeaderShape;
}

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string, info?: ChatErrorInfo) => void;
  onToolProgress?: (tool: string) => void;
  onTraceEvent?: (event: ChatTraceCallbackEvent) => void;
  onDiagnostic?: (event: ChatTransportDiagnostic) => void;
  onAgentDraftChanged?: (event: AgentDraftChangeEvent) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
  }) => void;
}

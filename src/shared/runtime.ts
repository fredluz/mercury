export type RuntimeMode = "local" | "ssh" | "remote";

export type RuntimeTransport = "api" | "ssh-api" | "remote-api";

export type RuntimeVerificationSource =
  | "identity-endpoint"
  | "managed-process"
  | "declared-remote"
  | "unverified";

export type RuntimeDiagnosticStatus =
  | "verified"
  | "unverified"
  | "mismatch"
  | "stale"
  | "invalid-auth"
  | "update-required"
  | "unsupported";

export type RuntimeApplySource = "skills";

export type RuntimeApplyStatus =
  | "pending-idle"
  | "pending-confirm"
  | "applying"
  | "failed";

export type ChatSessionActivityStatus =
  | "queued"
  | "submitting"
  | "running"
  | "stopping"
  | "idle";

export interface SessionRuntimeActivity {
  sessionId: string | null;
  activeRunCount: number;
  status: ChatSessionActivityStatus;
  runIds: string[];
  updatedAt: number;
}

export interface ProfileSessionRuntimeActivitySnapshot {
  profile: string;
  activeRunCount: number;
  isIdle: boolean;
  sessions: SessionRuntimeActivity[];
}

export interface RuntimeDiagnostic {
  selectedProfile: string;
  requestedProfile: string;
  actualProfile: string | null;
  verified: boolean;
  verificationSource: RuntimeVerificationSource;
  mode: RuntimeMode;
  transport: RuntimeTransport;
  status: RuntimeDiagnosticStatus;
  apiBaseUrl?: string;
  localPort?: number;
  remotePort?: number;
  pid?: number;
  pidFile?: string;
  logDir?: string;
  hermesHome?: string;
  configPath?: string;
  authKeyFingerprint?: string;
  authSource: "profile-env" | "remote-env" | "connection-config" | "none";
  startedByMercury: boolean;
  verifiedAt?: number;
  stale: boolean;
  staleReason?: string;
  staleAt?: number;
  runtimeApplyStatus?: RuntimeApplyStatus;
  runtimeApplySource?: RuntimeApplySource;
  runtimeApplyReason?: string;
  runtimeApplyPendingSince?: number;
  runtimeApplyFailureReason?: string;
  mismatchReason?: string;
  unsupportedReason?: string;
  capabilities?: Record<string, boolean>;
  capabilityProblem?:
    | "invalid-api-key"
    | "missing-required-features"
    | "network"
    | "malformed";
  command?: string[];
}

export type RuntimeDebugAgent = "codex" | "claude" | "pi";

export interface RuntimeDebugAgentRequest {
  agent: RuntimeDebugAgent;
  profile?: string;
}

export interface RuntimeDebugAgentResult {
  success: boolean;
  agent: RuntimeDebugAgent;
  command?: string[];
  promptPath?: string;
  scriptPath?: string;
  error?: string;
}

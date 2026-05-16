import type { TraceEventType } from "../../shared/traces";

export type RuntimeMode = "local" | "ssh" | "remote";

export type RuntimePurpose =
  | "chat"
  | "title"
  | "cron"
  | "gateway"
  | "tools"
  | "skills"
  | "memory"
  | "soul"
  | "sessions"
  | "mcp";

export type RuntimeTransport = "cli" | "api" | "ssh-api" | "remote-api";

export type RuntimeVerificationSource =
  | "identity-endpoint"
  | "managed-process"
  | "declared-remote"
  | "cli-args"
  | "unverified";

export type RuntimeErrorCode =
  | "runtime-profile-mismatch"
  | "runtime-profile-unverified"
  | "runtime-unsupported-remote-profile"
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
  preferTransport?: "api" | "cli";
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
  command?: string[];
  mismatchReason?: string;
}

export interface ProfileRuntimeHandle {
  request: ProfileRuntimeRequest & { profile: string; mode: RuntimeMode };
  identity: RuntimeIdentity;
  transport: RuntimeTransport;
  apiBaseUrl?: string;
  authHeaders?: Record<string, string>;
  cliCommand?: string[];
}

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

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
  onToolProgress?: (tool: string) => void;
  onTraceEvent?: (event: ChatTraceCallbackEvent) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
  }) => void;
}


export type RuntimeMode = "local" | "ssh" | "remote";

export type RuntimeTransport = "cli" | "api" | "ssh-api" | "remote-api";

export type RuntimeVerificationSource =
  | "identity-endpoint"
  | "managed-process"
  | "declared-remote"
  | "cli-args"
  | "unverified";

export type RuntimeDiagnosticStatus =
  | "verified"
  | "unverified"
  | "mismatch"
  | "stale"
  | "unsupported";

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
  mismatchReason?: string;
  unsupportedReason?: string;
  capabilities?: Record<string, boolean>;
  command?: string[];
}

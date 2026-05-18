export const CLI_EXIT_CODES = {
  success: 0,
  generic: 1,
  usage: 2,
  unsupported: 3,
  runtimeVerification: 4,
  install: 5,
  connection: 6,
  notFound: 7,
  validation: 8,
  interrupted: 130,
} as const;

export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];

export interface NormalizedCliError {
  code: string;
  message: string;
  details?: unknown;
  exitCode: CliExitCode;
}

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: CliExitCode;
  readonly details?: unknown;

  constructor(code: string, message: string, exitCode: CliExitCode, details?: unknown) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function usageError(message: string, details?: unknown): CliError {
  return new CliError("invalid-usage", message, CLI_EXIT_CODES.usage, details);
}

export function unsupportedError(message: string, details?: unknown): CliError {
  return new CliError("unsupported-command", message, CLI_EXIT_CODES.unsupported, details);
}

export function validationError(message: string, details?: unknown): CliError {
  return new CliError("validation-failed", message, CLI_EXIT_CODES.validation, details);
}

export function notFoundError(message: string, details?: unknown): CliError {
  return new CliError("not-found", message, CLI_EXIT_CODES.notFound, details);
}

export function interruptedError(message = "Interrupted"): CliError {
  return new CliError("interrupted", message, CLI_EXIT_CODES.interrupted);
}

const RUNTIME_VERIFICATION_CODES = new Set([
  "runtime-profile-mismatch",
  "runtime-profile-unverified",
  "runtime-stale-after-profile-switch",
  "runtime-port-conflict",
  "runtime-auth-conflict",
  "runtime-token-conflict",
  "runtime-unavailable",
]);

const CONNECTION_CODES = new Set([
  "connection-failed",
  "ssh-connection-failed",
  "ssh-tunnel-failed",
  "runtime-connection-failed",
]);

export function exitCodeForErrorCode(code: string): CliExitCode {
  if (code === "runtime-unsupported-remote-profile") return CLI_EXIT_CODES.unsupported;
  if (RUNTIME_VERIFICATION_CODES.has(code)) return CLI_EXIT_CODES.runtimeVerification;
  if (CONNECTION_CODES.has(code)) return CLI_EXIT_CODES.connection;
  if (code === "not-installed" || code === "install-verification-failed") return CLI_EXIT_CODES.install;
  if (code === "not-found") return CLI_EXIT_CODES.notFound;
  if (code === "validation-failed") return CLI_EXIT_CODES.validation;
  if (code === "invalid-usage") return CLI_EXIT_CODES.usage;
  if (code === "interrupted" || code === "aborted") return CLI_EXIT_CODES.interrupted;
  if (code === "unsupported-command") return CLI_EXIT_CODES.unsupported;
  return CLI_EXIT_CODES.generic;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" && maybeCode.length > 0 ? maybeCode : undefined;
}

function getErrorDetails(error: unknown): unknown {
  if (!error || typeof error !== "object") return undefined;
  return (error as { details?: unknown }).details;
}

export function normalizeCliError(error: unknown): NormalizedCliError {
  if (error instanceof CliError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
      exitCode: error.exitCode,
    };
  }

  const code = getErrorCode(error) ?? "runtime-error";
  const message = error instanceof Error ? error.message : String(error);

  return {
    code,
    message,
    details: getErrorDetails(error),
    exitCode: exitCodeForErrorCode(code),
  };
}

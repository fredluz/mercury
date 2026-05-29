export const CODEX_PROVIDER_ID = "openai-codex" as const;

export type CodexAuthRecoveryReason =
  | "refresh-token-consumed"
  | "refresh-token-invalid"
  | "refresh-token-expired"
  | "refresh-token-revoked";

export interface ChatAuthRecovery {
  kind: "codex-auth";
  provider: typeof CODEX_PROVIDER_ID;
  reason: CodexAuthRecoveryReason;
  profile?: string;
  action: "start-codex-device-auth";
}

export interface ChatErrorInfo {
  displayMessage?: string;
  recovery?: ChatAuthRecovery;
}

interface DetectCodexAuthRecoveryArgs {
  error: string;
  provider?: string | null;
  profile?: string;
}

const DISPLAY_MESSAGE =
  "Codex sign-in needs to be refreshed. Re-authenticate with Mercury's in-app Codex login.";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, " ");
}

function detectReason(error: string): CodexAuthRecoveryReason | null {
  const text = normalize(error);
  const mentionsRefreshToken =
    /refresh\s+token/.test(text) || /refresh\s*token/.test(text);

  if (!mentionsRefreshToken) return null;

  if (/already\s+consumed|\bconsumed\b/.test(text)) {
    return "refresh-token-consumed";
  }
  if (/\binvalid\b|invalid\s+grant/.test(text)) {
    return "refresh-token-invalid";
  }
  if (/\bexpired\b/.test(text)) {
    return "refresh-token-expired";
  }
  if (/\brevoked\b/.test(text)) {
    return "refresh-token-revoked";
  }

  return null;
}

export function detectCodexAuthRecovery({
  error,
  provider,
  profile,
}: DetectCodexAuthRecoveryArgs): ChatErrorInfo | null {
  if ((provider || "").trim() !== CODEX_PROVIDER_ID) return null;
  const reason = detectReason(error || "");
  if (!reason) return null;
  return {
    displayMessage: DISPLAY_MESSAGE,
    recovery: {
      kind: "codex-auth",
      provider: CODEX_PROVIDER_ID,
      reason,
      profile,
      action: "start-codex-device-auth",
    },
  };
}

export function isChatAuthRecovery(value: unknown): value is ChatAuthRecovery {
  if (!value || typeof value !== "object") return false;
  const recovery = value as Partial<ChatAuthRecovery>;
  return (
    recovery.kind === "codex-auth" &&
    recovery.provider === CODEX_PROVIDER_ID &&
    recovery.action === "start-codex-device-auth" &&
    (recovery.reason === "refresh-token-consumed" ||
      recovery.reason === "refresh-token-invalid" ||
      recovery.reason === "refresh-token-expired" ||
      recovery.reason === "refresh-token-revoked")
  );
}

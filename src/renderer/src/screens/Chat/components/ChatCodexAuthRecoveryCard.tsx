import { AlertTriangle, CheckCircle2, Copy, LogIn, X } from "lucide-react";
import type React from "react";
import { useCodexAuthFlow } from "../../../hooks/useCodexAuthFlow";
import type { CodexAuthRecoveryState } from "../types";

interface ChatCodexAuthRecoveryCardProps {
  recovery: CodexAuthRecoveryState;
  profile?: string;
  onAuthenticated?: () => Promise<void> | void;
  onDismiss?: () => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export function ChatCodexAuthRecoveryCard({
  recovery,
  profile,
  onAuthenticated,
  onDismiss,
  t,
}: ChatCodexAuthRecoveryCardProps): React.JSX.Element {
  const selectedProfile = profile || recovery.recovery.profile || "default";
  const codexAuth = useCodexAuthFlow({
    profile: selectedProfile,
    active: true,
    onAuthenticated,
  });
  const connected = Boolean(codexAuth.status?.hasHermesAuth);
  const authenticated = codexAuth.phase === "success";
  const busy = codexAuth.phase === "starting" || codexAuth.phase === "waiting";

  return (
    <section className="chat-codex-recovery-card" aria-live="polite">
      <div className="chat-runtime-card-icon chat-codex-recovery-icon">
        {authenticated ? (
          <CheckCircle2 size={18} />
        ) : (
          <AlertTriangle size={18} />
        )}
      </div>
      <div className="chat-runtime-card-body">
        <div className="chat-codex-recovery-head">
          <div className="chat-runtime-card-title">
            {t("chat.codexAuthRecoveryTitle")}
          </div>
          {onDismiss && (
            <button
              type="button"
              className="btn-ghost chat-codex-recovery-dismiss"
              onClick={onDismiss}
              aria-label={t("chat.codexAuthRecoveryDismiss")}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="chat-runtime-card-copy">
          {t("chat.codexAuthRecoveryCopy")}
        </div>
        <div className="chat-runtime-card-reason">
          {t("chat.codexAuthRecoveryProviderContext", {
            profile: selectedProfile,
          })}
        </div>
        <div className="chat-runtime-card-reason">{recovery.displayMessage}</div>

        {codexAuth.pending && codexAuth.phase === "waiting" && (
          <div className="settings-codex-code-box chat-codex-code-box">
            <div>
              {t("chat.codexAuthCodeInstruction")} <code>{codexAuth.pending.verificationUri}</code>
            </div>
            <strong>{codexAuth.pending.userCode}</strong>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void codexAuth.copyCode()}
            >
              <Copy size={13} />
              {t("chat.codexAuthCopyCode")}
            </button>
          </div>
        )}

        <div className="chat-runtime-card-actions">
          <button
            type="button"
            className="btn btn-secondary chat-runtime-action"
            disabled={busy}
            onClick={() => void codexAuth.start()}
          >
            <LogIn size={14} />
            {busy
              ? t("chat.codexAuthStarting")
              : connected
                ? t("chat.codexAuthReauthenticate")
                : t("chat.codexAuthSignIn")}
          </button>
          <span className="chat-runtime-card-reason">
            {t("chat.codexAuthRecoveryRetryHint")}
          </span>
        </div>

        {(codexAuth.errorMessage || authenticated) && (
          <div
            className={
              codexAuth.phase === "error"
                ? "chat-codex-recovery-status error"
                : "chat-codex-recovery-status"
            }
          >
            {codexAuth.errorMessage || t("chat.codexAuthSuccess")}
          </div>
        )}
      </div>
    </section>
  );
}

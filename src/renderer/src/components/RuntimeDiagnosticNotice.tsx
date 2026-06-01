import type React from "react";
import { useState } from "react";
import { getLocale, t as translate } from "../../../shared/i18n";
import type { RuntimeDiagnostic } from "../../../shared/runtime";

function profileLabel(profile: string | null | undefined): string {
  return profile && profile !== "default" ? profile : "default";
}

function i18n(key: string, options?: Record<string, unknown>): string {
  return translate(key, getLocale(), options);
}

function runtimeNoticeLabel(diagnostic: RuntimeDiagnostic): string {
  if (diagnostic.status === "verified") return i18n("chat.runtimeNoticeVerified");
  if (diagnostic.stale) {
    switch (diagnostic.runtimeApplyStatus) {
      case "pending-idle":
        return i18n("chat.runtimeNoticeUpdatePending");
      case "pending-confirm":
        return i18n("chat.runtimeNoticeConfirmPending");
      case "applying":
        return i18n("chat.runtimeNoticeUpdating");
      case "failed":
        return i18n("chat.runtimeNoticeUpdateFailed");
      default:
        // Generic stale (e.g. config/memory change) is not auto-applied.
        return i18n("chat.runtimeNoticeUpdateNeeded");
    }
  }
  return i18n("chat.runtimeNoticeNeedsAttention");
}

export function runtimeDiagnosticMessage(
  diagnostic: RuntimeDiagnostic | null | undefined,
): string | null {
  if (!diagnostic) return null;
  if (diagnostic.stale) {
    switch (diagnostic.runtimeApplyStatus) {
      case "pending-idle":
        return i18n("chat.runtimeNoticePendingIdleMessage");
      case "pending-confirm":
        return i18n("chat.runtimeApplyConfirmCopy");
      case "applying":
        return i18n("chat.runtimeNoticeApplyingMessage");
      case "failed":
        return diagnostic.runtimeApplyFailureReason
          ? i18n("chat.runtimeNoticeFailedWithReason", {
              reason: diagnostic.runtimeApplyFailureReason,
            })
          : i18n("chat.runtimeNoticeFailedMessage");
      default:
        // No auto-apply is scheduled for this stale state — prompt manual repair.
        return diagnostic.staleReason || i18n("chat.runtimeNoticeGenericStaleMessage");
    }
  }
  if (diagnostic.status === "unsupported") {
    return (
      diagnostic.unsupportedReason ||
      "Runtime identity is not verified for this connection mode."
    );
  }
  if (diagnostic.status === "mismatch") {
    return (
      diagnostic.mismatchReason ||
      `Selected Agent ${profileLabel(diagnostic.selectedProfile)} does not match backing runtime profile ${profileLabel(diagnostic.actualProfile)}.`
    );
  }
  if (diagnostic.status === "unverified") {
    return (
      diagnostic.mismatchReason ||
      "Runtime identity has not been verified for the selected Agent."
    );
  }
  return null;
}

export function runtimeDiagnosticSummary(
  diagnostic: RuntimeDiagnostic | null | undefined,
): string {
  if (!diagnostic) return "Runtime diagnostic unavailable";
  const profile = profileLabel(diagnostic.selectedProfile);
  const actual = diagnostic.actualProfile
    ? profileLabel(diagnostic.actualProfile)
    : "unverified";
  const port = diagnostic.localPort
    ? `:${diagnostic.localPort}`
    : diagnostic.remotePort
      ? ` remote:${diagnostic.remotePort}`
      : "";
  return `${diagnostic.mode}/${diagnostic.transport}${port} · agent ${profile} · runtime ${actual}`;
}

interface RuntimeDiagnosticNoticeProps {
  diagnostic?: RuntimeDiagnostic | null;
  compact?: boolean;
  showWhenVerified?: boolean;
  onRuntimeDiagnosticRefresh?: () => void;
}

export function RuntimeDiagnosticNotice({
  diagnostic,
  compact = false,
  showWhenVerified = false,
  onRuntimeDiagnosticRefresh,
}: RuntimeDiagnosticNoticeProps): React.JSX.Element | null {
  const [busyAction, setBusyAction] = useState<"apply" | "later" | null>(null);
  const message = runtimeDiagnosticMessage(diagnostic);
  if (!diagnostic || (!message && !showWhenVerified)) return null;
  const tone =
    diagnostic.status === "verified"
      ? "ok"
      : diagnostic.stale && diagnostic.runtimeApplyStatus !== "failed"
        ? "stale"
        : "warn";
  const titleParts = [
    runtimeDiagnosticSummary(diagnostic),
    diagnostic.apiBaseUrl ? `API ${diagnostic.apiBaseUrl}` : null,
    diagnostic.pid ? `PID ${diagnostic.pid}` : null,
    diagnostic.configPath ? `Config ${diagnostic.configPath}` : null,
    diagnostic.authSource !== "none"
      ? `Auth ${diagnostic.authSource}`
      : "Auth none",
    diagnostic.verifiedAt
      ? `Verified ${new Date(diagnostic.verifiedAt).toLocaleString()}`
      : null,
  ].filter(Boolean);
  const pendingConfirm =
    diagnostic.stale && diagnostic.runtimeApplyStatus === "pending-confirm";
  const actionProfile = diagnostic.selectedProfile || diagnostic.requestedProfile;

  async function handleApplyNow(): Promise<void> {
    if (busyAction) return;
    setBusyAction("apply");
    try {
      await window.hermesAPI.applyPendingRuntimeUpdateNow(actionProfile);
      onRuntimeDiagnosticRefresh?.();
    } catch {
      onRuntimeDiagnosticRefresh?.();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLater(): Promise<void> {
    if (busyAction) return;
    setBusyAction("later");
    try {
      await window.hermesAPI.deferPendingRuntimeUpdate(actionProfile);
      onRuntimeDiagnosticRefresh?.();
    } catch {
      onRuntimeDiagnosticRefresh?.();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div
      className={`runtime-diagnostic runtime-diagnostic-${tone} ${compact ? "runtime-diagnostic-compact" : ""}`}
      title={titleParts.join("\n")}
    >
      <span className="runtime-diagnostic-label">
        {runtimeNoticeLabel(diagnostic)}
      </span>
      <span className="runtime-diagnostic-message">
        {message || runtimeDiagnosticSummary(diagnostic)}
      </span>
      {pendingConfirm && (
        <span className="runtime-diagnostic-actions">
          <button
            className="btn btn-secondary runtime-diagnostic-action"
            disabled={Boolean(busyAction)}
            onClick={() => void handleApplyNow()}
          >
            {busyAction === "apply"
              ? i18n("chat.runtimeApplyApplyingShort")
              : i18n("chat.runtimeApplyNow")}
          </button>
          <button
            className="btn-ghost runtime-diagnostic-action"
            disabled={Boolean(busyAction)}
            onClick={() => void handleLater()}
          >
            {busyAction === "later"
              ? i18n("chat.runtimeApplyDeferringShort")
              : i18n("chat.runtimeApplyLater")}
          </button>
        </span>
      )}
    </div>
  );
}

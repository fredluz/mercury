import type React from "react";
import type { RuntimeDiagnostic } from "../../../shared/runtime";

function profileLabel(profile: string | null | undefined): string {
  return profile && profile !== "default" ? profile : "default";
}

export function runtimeDiagnosticMessage(
  diagnostic: RuntimeDiagnostic | null | undefined,
): string | null {
  if (!diagnostic) return null;
  if (diagnostic.stale) {
    return diagnostic.staleReason || "Runtime is stale and should be restarted or revalidated.";
  }
  if (diagnostic.status === "unsupported") {
    return diagnostic.unsupportedReason || "Runtime identity is not verified for this connection mode.";
  }
  if (diagnostic.status === "mismatch") {
    return diagnostic.mismatchReason ||
      `Selected Agent ${profileLabel(diagnostic.selectedProfile)} does not match backing runtime profile ${profileLabel(diagnostic.actualProfile)}.`;
  }
  if (diagnostic.status === "unverified") {
    return diagnostic.mismatchReason || "Runtime identity has not been verified for the selected Agent.";
  }
  return null;
}

export function runtimeDiagnosticSummary(
  diagnostic: RuntimeDiagnostic | null | undefined,
): string {
  if (!diagnostic) return "Runtime diagnostic unavailable";
  const profile = profileLabel(diagnostic.selectedProfile);
  const actual = diagnostic.actualProfile ? profileLabel(diagnostic.actualProfile) : "unverified";
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
}

export function RuntimeDiagnosticNotice({
  diagnostic,
  compact = false,
  showWhenVerified = false,
}: RuntimeDiagnosticNoticeProps): React.JSX.Element | null {
  const message = runtimeDiagnosticMessage(diagnostic);
  if (!diagnostic || (!message && !showWhenVerified)) return null;
  const tone = diagnostic.status === "verified" ? "ok" : diagnostic.stale ? "stale" : "warn";
  const titleParts = [
    runtimeDiagnosticSummary(diagnostic),
    diagnostic.apiBaseUrl ? `API ${diagnostic.apiBaseUrl}` : null,
    diagnostic.pid ? `PID ${diagnostic.pid}` : null,
    diagnostic.configPath ? `Config ${diagnostic.configPath}` : null,
    diagnostic.authSource !== "none" ? `Auth ${diagnostic.authSource}` : "Auth none",
    diagnostic.verifiedAt ? `Verified ${new Date(diagnostic.verifiedAt).toLocaleString()}` : null,
  ].filter(Boolean);

  return (
    <div
      className={`runtime-diagnostic runtime-diagnostic-${tone} ${compact ? "runtime-diagnostic-compact" : ""}`}
      title={titleParts.join("\n")}
    >
      <span className="runtime-diagnostic-label">
        {diagnostic.status === "verified" ? "Runtime verified" : "Runtime warning"}
      </span>
      <span className="runtime-diagnostic-message">
        {message || runtimeDiagnosticSummary(diagnostic)}
      </span>
    </div>
  );
}

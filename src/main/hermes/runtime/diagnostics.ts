import type {
  RuntimeDiagnostic,
  RuntimeDiagnosticStatus,
} from "../../../shared/runtime";
import type { RuntimeIdentity, RuntimeMode } from "../types";
import type { RuntimeState } from "./state";
import { authSourceFor } from "./identity";

export function buildRuntimeDiagnostic(args: {
  selectedProfile: string;
  state: RuntimeState;
  mode: RuntimeMode;
  identity: RuntimeIdentity;
  modeMismatchReason?: string;
}): RuntimeDiagnostic {
  const { selectedProfile, state, mode, identity, modeMismatchReason } = args;
  const stale = Boolean(state.staleReason || modeMismatchReason);
  const profileMismatch = Boolean(
    identity.actualProfile &&
    identity.actualProfile !== identity.requestedProfile,
  );
  const unsupported =
    mode === "remote" ||
    Boolean(identity.mismatchReason?.includes("unsupported"));
  const invalidAuth = identity.capabilityProblem === "invalid-api-key";
  const updateRequired =
    identity.capabilityProblem === "missing-required-features";
  const status: RuntimeDiagnosticStatus = stale
    ? "stale"
    : invalidAuth
      ? "invalid-auth"
      : updateRequired
        ? "update-required"
        : unsupported
          ? "unsupported"
          : profileMismatch
            ? "mismatch"
            : identity.verified
              ? "verified"
              : "unverified";

  return {
    selectedProfile,
    requestedProfile: identity.requestedProfile,
    actualProfile: identity.actualProfile,
    verified:
      identity.verified &&
      !stale &&
      !profileMismatch &&
      !unsupported &&
      !identity.capabilityProblem,
    verificationSource: identity.verificationSource,
    mode: identity.mode,
    transport: identity.transport,
    status,
    apiBaseUrl: identity.apiBaseUrl,
    localPort: identity.localPort,
    remotePort: identity.remotePort,
    pid: identity.pid,
    pidFile: identity.pidFile,
    logDir: identity.logDir,
    hermesHome: identity.hermesHome,
    configPath: identity.configPath,
    authKeyFingerprint: identity.authKeyFingerprint,
    authSource: authSourceFor(identity),
    startedByMercury: identity.startedByMercury,
    verifiedAt: identity.verifiedAt,
    stale,
    staleReason: state.staleReason ?? modeMismatchReason,
    staleAt: state.staleAt,
    runtimeApplyStatus: state.runtimeApplyState?.status,
    runtimeApplySource: state.runtimeApplyState?.source,
    runtimeApplyReason: state.runtimeApplyState?.reason,
    runtimeApplyPendingSince: state.runtimeApplyState?.pendingSince,
    runtimeApplyFailureReason: state.runtimeApplyState?.failureReason,
    mismatchReason: stale
      ? (state.staleReason ?? modeMismatchReason)
      : identity.mismatchReason,
    unsupportedReason: unsupported
      ? (identity.mismatchReason ?? "Remote runtime identity is not verified.")
      : undefined,
    capabilities: identity.capabilities,
    capabilityProblem: identity.capabilityProblem,
    command: identity.command,
  };
}

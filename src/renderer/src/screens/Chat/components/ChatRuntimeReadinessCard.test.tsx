import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatRuntimeReadinessCard } from "./ChatRuntimeReadinessCard";
import type { RuntimeDiagnostic } from "../../../../../shared/runtime";

const t = (key: string): string => {
  const dictionary: Record<string, string> = {
    "chat.runtimeReadinessTitle": "Chat requires a verified API runtime",
    "chat.runtimeReadinessCopy":
      "Mercury will start the selected Agent gateway, wait for the API, and verify the runtime before chat can run.",
    "chat.runtimeReadinessReasonFallback":
      "API runtime identity has not been verified yet.",
    "chat.runtimeVerify": "Verify API runtime",
    "chat.runtimeVerifying": "Starting and verifying the API runtime...",
    "chat.runtimeVerifyingShort": "Verifying...",
    "chat.runtimeVerified": "API runtime verified. You can start chatting.",
    "chat.runtimeStillUnverified":
      "API runtime is still not verified. Try debugging with an agent.",
    "chat.runtimeVerifyFailed": "API runtime verification failed.",
    "chat.runtimeDebugGroup": "Debug with",
    "chat.runtimeDebugCodex": "Codex",
    "chat.runtimeDebugClaude": "Claude Code",
    "chat.runtimeDebugPi": "Pi",
    "chat.runtimeDebugLaunching": "Launching debugging agent...",
    "chat.runtimeDebugLaunchingShort": "Launching...",
    "chat.runtimeDebugStarted":
      "Debugging agent launched in a terminal window.",
    "chat.runtimeDebugFailed": "Could not launch debugging agent.",
    "chat.runtimeApplyConfirmTitle": "Skill changes are ready",
    "chat.runtimeApplyConfirmCopy":
      "Skill changes are ready, but a background task is still running. Applying now will stop it.",
    "chat.runtimeApplyNow": "Apply now",
    "chat.runtimeApplyLater": "Later",
    "chat.runtimeApplyApplying": "Applying runtime update...",
    "chat.runtimeApplyApplyingShort": "Applying...",
    "chat.runtimeApplyNowQueued": "Runtime update started.",
    "chat.runtimeApplyNoPendingUpdate": "No pending runtime update found.",
    "chat.runtimeApplyNowFailed": "Could not apply runtime update.",
    "chat.runtimeApplyDeferring": "Deferring runtime update...",
    "chat.runtimeApplyDeferringShort": "Deferring...",
    "chat.runtimeApplyDeferred":
      "Runtime update deferred. Mercury will apply it when gateway work is idle.",
    "chat.runtimeApplyDeferFailed": "Could not defer runtime update.",
  };
  return dictionary[key] || key;
};

const unverifiedDiagnostic: RuntimeDiagnostic = {
  selectedProfile: "default",
  requestedProfile: "default",
  actualProfile: null,
  verified: false,
  verificationSource: "unverified",
  mode: "local",
  transport: "api",
  status: "unverified",
  authSource: "none",
  startedByMercury: false,
  stale: false,
  mismatchReason: "Local runtime identity has not been verified yet.",
};

const verifiedDiagnostic: RuntimeDiagnostic = {
  ...unverifiedDiagnostic,
  actualProfile: "default",
  verified: true,
  verificationSource: "managed-process",
  transport: "api",
  status: "verified",
  mismatchReason: undefined,
};

const remoteUnverifiedDiagnostic: RuntimeDiagnostic = {
  ...unverifiedDiagnostic,
  mode: "remote",
  transport: "remote-api",
};

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      startGateway: vi.fn().mockResolvedValue(true),
      restartGateway: vi.fn().mockResolvedValue(true),
      revalidateRuntime: vi.fn().mockResolvedValue(true),
      applyPendingRuntimeUpdateNow: vi.fn().mockResolvedValue(true),
      deferPendingRuntimeUpdate: vi.fn().mockResolvedValue(true),
      launchRuntimeDebugAgent: vi
        .fn()
        .mockResolvedValue({ success: true, agent: "codex" }),
    };
}

describe("ChatRuntimeReadinessCard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it("renders unverified runtime diagnostics in chat space", () => {
    installHermesApiMock();
    render(
      <ChatRuntimeReadinessCard diagnostic={unverifiedDiagnostic} t={t} />,
    );

    expect(
      screen.getByText("Chat requires a verified API runtime"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Local runtime identity has not been verified yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verifying/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Codex/i }),
    ).not.toBeInTheDocument();
  });

  it("shows external debug agents after API verification fails", async () => {
    vi.useFakeTimers();
    installHermesApiMock();
    vi.mocked(window.hermesAPI.revalidateRuntime).mockResolvedValue(false);

    render(
      <ChatRuntimeReadinessCard
        diagnostic={remoteUnverifiedDiagnostic}
        t={t}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Verify API runtime/i }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
      await vi.advanceTimersByTimeAsync(1_400);
    });

    expect(screen.getByRole("button", { name: /Codex/i })).toBeInTheDocument();
    expect(screen.getByText("Debug with")).toBeInTheDocument();
  });

  it("does not render for verified diagnostics", () => {
    installHermesApiMock();
    render(<ChatRuntimeReadinessCard diagnostic={verifiedDiagnostic} t={t} />);

    expect(
      screen.queryByText("Chat requires a verified API runtime"),
    ).not.toBeInTheDocument();
  });

  it("starts the gateway and revalidates local diagnostics automatically", async () => {
    installHermesApiMock();
    const onRuntimeDiagnosticRefresh = vi.fn();
    render(
      <ChatRuntimeReadinessCard
        diagnostic={unverifiedDiagnostic}
        profile="default"
        onRuntimeDiagnosticRefresh={onRuntimeDiagnosticRefresh}
        t={t}
      />,
    );

    await waitFor(() =>
      expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("default"),
    );
    expect(window.hermesAPI.revalidateRuntime).toHaveBeenCalledWith("default");
    await waitFor(() => expect(onRuntimeDiagnosticRefresh).toHaveBeenCalled());
  });

  it("restarts a local gateway automatically if start plus revalidation stays unverified", async () => {
    vi.useFakeTimers();
    installHermesApiMock();
    vi.mocked(window.hermesAPI.revalidateRuntime)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    render(
      <ChatRuntimeReadinessCard
        diagnostic={unverifiedDiagnostic}
        profile="default"
        t={t}
      />,
    );
    await Promise.resolve();
    expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("default");

    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(1_400);
    await Promise.resolve();

    expect(window.hermesAPI.restartGateway).toHaveBeenCalledWith("default");
    expect(window.hermesAPI.revalidateRuntime).toHaveBeenCalledTimes(4);
  });

  it("keeps repairing a local gateway when revalidation rejects transiently", async () => {
    vi.useFakeTimers();
    installHermesApiMock();
    vi.mocked(window.hermesAPI.revalidateRuntime)
      .mockRejectedValueOnce(new Error("runtime-profile-unverified"))
      .mockRejectedValueOnce(new Error("runtime-profile-unverified"))
      .mockRejectedValueOnce(new Error("runtime-profile-unverified"))
      .mockResolvedValueOnce(true);

    render(
      <ChatRuntimeReadinessCard
        diagnostic={unverifiedDiagnostic}
        profile="default"
        t={t}
      />,
    );
    await Promise.resolve();
    expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("default");

    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(1_400);
    await Promise.resolve();

    expect(window.hermesAPI.restartGateway).toHaveBeenCalledWith("default");
    expect(window.hermesAPI.revalidateRuntime).toHaveBeenCalledTimes(4);
  });

  it("launches the selected external debug agent", async () => {
    vi.useFakeTimers();
    installHermesApiMock();
    vi.mocked(window.hermesAPI.revalidateRuntime).mockResolvedValue(false);
    render(
      <ChatRuntimeReadinessCard
        diagnostic={remoteUnverifiedDiagnostic}
        t={t}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Verify API runtime/i }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
      await vi.advanceTimersByTimeAsync(1_400);
    });

    expect(screen.getByRole("button", { name: /Codex/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Codex/i }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(window.hermesAPI.launchRuntimeDebugAgent).toHaveBeenCalledWith({
      agent: "codex",
      profile: "default",
    });
  });

  const staleFailedDiagnostic: RuntimeDiagnostic = {
    ...unverifiedDiagnostic,
    status: "stale",
    stale: true,
    staleReason: "Skills changed for profile runtime.",
    runtimeApplyStatus: "failed",
    runtimeApplyFailureReason: "gateway exited with code 1",
    mismatchReason: undefined,
  };

  const stalePendingDiagnostic: RuntimeDiagnostic = {
    ...unverifiedDiagnostic,
    status: "stale",
    stale: true,
    staleReason: "Skills changed for profile runtime.",
    runtimeApplyStatus: "pending-idle",
    mismatchReason: undefined,
  };

  const stalePendingConfirmDiagnostic: RuntimeDiagnostic = {
    ...unverifiedDiagnostic,
    status: "stale",
    stale: true,
    staleReason: "Skills changed for profile runtime.",
    runtimeApplyStatus: "pending-confirm",
    mismatchReason: undefined,
  };

  it("surfaces a manual repair with the failure reason for a failed apply", () => {
    installHermesApiMock();
    render(
      <ChatRuntimeReadinessCard
        diagnostic={staleFailedDiagnostic}
        profile="default"
        t={t}
      />,
    );

    expect(
      screen.getByText("Chat requires a verified API runtime"),
    ).toBeInTheDocument();
    expect(screen.getByText("gateway exited with code 1")).toBeInTheDocument();
    // Failed apply must not auto-trigger a repair; the user drives it manually.
    expect(window.hermesAPI.startGateway).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /Verify API runtime/i }),
    ).toBeInTheDocument();
  });

  it("repairs the runtime when the failed-apply Verify button is clicked", async () => {
    installHermesApiMock();
    render(
      <ChatRuntimeReadinessCard
        diagnostic={staleFailedDiagnostic}
        profile="default"
        t={t}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Verify API runtime/i }),
    );

    await waitFor(() =>
      expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("default"),
    );
    expect(window.hermesAPI.revalidateRuntime).toHaveBeenCalledWith("default");
  });

  it("shows apply-now and later actions when background gateway work blocks auto-apply", async () => {
    installHermesApiMock();
    const onRuntimeDiagnosticRefresh = vi.fn();
    render(
      <ChatRuntimeReadinessCard
        diagnostic={stalePendingConfirmDiagnostic}
        profile="default"
        onRuntimeDiagnosticRefresh={onRuntimeDiagnosticRefresh}
        t={t}
      />,
    );

    expect(screen.getByText("Skill changes are ready")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Skill changes are ready, but a background task is still running. Applying now will stop it.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Apply now/i }));

    await waitFor(() =>
      expect(window.hermesAPI.applyPendingRuntimeUpdateNow).toHaveBeenCalledWith(
        "default",
      ),
    );
    expect(onRuntimeDiagnosticRefresh).toHaveBeenCalled();
  });

  it("defers pending-confirm skill applies when Later is clicked", async () => {
    installHermesApiMock();
    render(
      <ChatRuntimeReadinessCard
        diagnostic={stalePendingConfirmDiagnostic}
        profile="default"
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Later/i }));

    await waitFor(() =>
      expect(window.hermesAPI.deferPendingRuntimeUpdate).toHaveBeenCalledWith(
        "default",
      ),
    );
  });

  it("hides the readiness card while a skill apply is pending idle", async () => {
    installHermesApiMock();
    render(
      <ChatRuntimeReadinessCard
        diagnostic={stalePendingDiagnostic}
        profile="default"
        t={t}
      />,
    );

    expect(
      screen.queryByText("Chat requires a verified API runtime"),
    ).not.toBeInTheDocument();
    // Backend owns the auto-apply; the card must not race it with a verify.
    await Promise.resolve();
    expect(window.hermesAPI.startGateway).not.toHaveBeenCalled();
  });
});

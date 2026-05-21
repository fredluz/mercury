import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      startGateway: vi.fn().mockResolvedValue(true),
      restartGateway: vi.fn().mockResolvedValue(true),
      revalidateRuntime: vi.fn().mockResolvedValue(true),
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
      screen.getByRole("button", { name: /Verify API runtime/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Codex/i })).toBeInTheDocument();
  });

  it("does not render for verified diagnostics", () => {
    installHermesApiMock();
    render(<ChatRuntimeReadinessCard diagnostic={verifiedDiagnostic} t={t} />);

    expect(
      screen.queryByText("Chat requires a verified API runtime"),
    ).not.toBeInTheDocument();
  });

  it("starts the gateway and revalidates when verifying", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Verify API runtime/i }));

    await waitFor(() =>
      expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("default"),
    );
    expect(window.hermesAPI.revalidateRuntime).toHaveBeenCalledWith("default");
    await waitFor(() => expect(onRuntimeDiagnosticRefresh).toHaveBeenCalled());
  });

  it("restarts a local gateway if start plus revalidation stays unverified", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: /Verify API runtime/i }));

    await Promise.resolve();
    expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("default");

    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(1_400);
    await Promise.resolve();

    expect(window.hermesAPI.restartGateway).toHaveBeenCalledWith("default");
    expect(window.hermesAPI.revalidateRuntime).toHaveBeenCalledTimes(4);
  });

  it("launches the selected external debug agent", async () => {
    installHermesApiMock();
    render(
      <ChatRuntimeReadinessCard diagnostic={unverifiedDiagnostic} t={t} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Codex/i }));

    await waitFor(() =>
      expect(window.hermesAPI.launchRuntimeDebugAgent).toHaveBeenCalledWith({
        agent: "codex",
        profile: "default",
      }),
    );
  });
});

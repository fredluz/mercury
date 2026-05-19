import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatRuntimeReadinessCard } from "./ChatRuntimeReadinessCard";
import type { RuntimeDiagnostic } from "../../../../../shared/runtime";

const t = (key: string): string => {
  const dictionary: Record<string, string> = {
    "chat.runtimeReadinessTitle": "Chat runtime not verified yet",
    "chat.runtimeReadinessCopy":
      "Mercury will verify the selected Agent runtime when chat starts.",
    "chat.runtimeReadinessReasonFallback":
      "Runtime identity has not been verified yet.",
    "chat.runtimeVerify": "Verify runtime",
    "chat.runtimeVerifying": "Starting and verifying the runtime...",
    "chat.runtimeVerifyingShort": "Verifying...",
    "chat.runtimeVerified": "Runtime verified. You can start chatting.",
    "chat.runtimeStillUnverified":
      "Runtime is still not verified. Try debugging with an agent.",
    "chat.runtimeVerifyFailed": "Runtime verification failed.",
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
  verificationSource: "cli-args",
  transport: "cli",
  status: "verified",
  mismatchReason: undefined,
};

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      startGateway: vi.fn().mockResolvedValue(true),
      revalidateRuntime: vi.fn().mockResolvedValue(true),
      launchRuntimeDebugAgent: vi
        .fn()
        .mockResolvedValue({ success: true, agent: "codex" }),
    };
}

describe("ChatRuntimeReadinessCard", () => {
  it("renders unverified runtime diagnostics in chat space", () => {
    installHermesApiMock();
    render(
      <ChatRuntimeReadinessCard diagnostic={unverifiedDiagnostic} t={t} />,
    );

    expect(
      screen.getByText("Chat runtime not verified yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Local runtime identity has not been verified yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Verify runtime/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Codex/i })).toBeInTheDocument();
  });

  it("does not render for verified diagnostics", () => {
    installHermesApiMock();
    render(<ChatRuntimeReadinessCard diagnostic={verifiedDiagnostic} t={t} />);

    expect(
      screen.queryByText("Chat runtime not verified yet"),
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

    fireEvent.click(screen.getByRole("button", { name: /Verify runtime/i }));

    await waitFor(() =>
      expect(window.hermesAPI.startGateway).toHaveBeenCalledWith("default"),
    );
    expect(window.hermesAPI.revalidateRuntime).toHaveBeenCalledWith("default");
    await waitFor(() => expect(onRuntimeDiagnosticRefresh).toHaveBeenCalled());
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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatCodexAuthRecoveryCard } from "./ChatCodexAuthRecoveryCard";
import type { CodexAuthRecoveryState } from "../types";

const t = (key: string, params?: Record<string, unknown>): string => {
  const dictionary: Record<string, string> = {
    "chat.codexAuthRecoveryTitle": "Codex sign-in needs refresh",
    "chat.codexAuthRecoveryCopy": "Reconnect Codex in Mercury.",
    "chat.codexAuthRecoveryDismiss": "Dismiss Codex sign-in recovery",
    "chat.codexAuthRecoveryProviderContext": `Agent: ${params?.profile || "default"}`,
    "chat.codexAuthRecoveryRetryHint": "Retry manually.",
    "chat.codexAuthSignIn": "Sign in to Codex",
    "chat.codexAuthReauthenticate": "Re-authenticate Codex",
    "chat.codexAuthStarting": "Waiting for login...",
    "chat.codexAuthSuccess": "Codex app-server login complete.",
    "chat.codexAuthCopyCode": "Copy code",
    "chat.codexAuthCodeInstruction": "Open this page and enter the code:",
  };
  return dictionary[key] || key;
};

const recovery: CodexAuthRecoveryState = {
  id: "recovery-1",
  displayMessage: "Codex sign-in needs refresh.",
  receivedAt: 1,
  recovery: {
    kind: "codex-auth",
    provider: "openai-codex",
    reason: "refresh-token-consumed",
    profile: "default",
    action: "start-codex-device-auth",
  },
};

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      getCodexAuthStatus: vi.fn().mockResolvedValue({
        hasHermesAuth: false,
        hasCodexCliAuth: false,
        selectedProvider: "openai-codex",
        selectedModel: "gpt-5.5",
        hermesAuthPath: "/tmp/hermes-auth.json",
        codexAuthPath: "/tmp/codex-auth.json",
      }),
      startCodexDeviceAuth: vi.fn().mockResolvedValue({
        sessionId: "codex-session",
        userCode: "ABCD-EFGH",
        verificationUri: "https://auth.openai.com/codex/device",
        intervalSeconds: 10,
        expiresAt: Date.now() + 60_000,
      }),
      pollCodexDeviceAuth: vi.fn().mockResolvedValue({ status: "pending" }),
    };
}

describe("ChatCodexAuthRecoveryCard", () => {
  beforeEach(() => {
    installHermesApiMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts Codex device auth and displays the user code", async () => {
    render(<ChatCodexAuthRecoveryCard recovery={recovery} t={t} />);

    fireEvent.click(screen.getByRole("button", { name: /Sign in to Codex/i }));

    await waitFor(() =>
      expect(window.hermesAPI.startCodexDeviceAuth).toHaveBeenCalled(),
    );
    expect(await screen.findByText("ABCD-EFGH")).toBeInTheDocument();
    expect(
      screen.getByText("https://auth.openai.com/codex/device"),
    ).toBeInTheDocument();
  });

  it("calls onAuthenticated after polling succeeds", async () => {
    const onAuthenticated = vi.fn();
    vi.mocked(window.hermesAPI.pollCodexDeviceAuth).mockResolvedValue({
      status: "authenticated",
      provider: "openai-codex",
      model: "gpt-5.5",
    });

    render(
      <ChatCodexAuthRecoveryCard
        recovery={recovery}
        onAuthenticated={onAuthenticated}
        t={t}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Sign in to Codex/i }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalled());
    expect(screen.getByText("Codex app-server login complete.")).toBeInTheDocument();
  });
});

import { describe, expect, it } from "vitest";
import { detectCodexAuthRecovery } from "../src/shared/codex-auth-recovery";

describe("detectCodexAuthRecovery", () => {
  it("matches the known consumed Codex refresh-token error", () => {
    const info = detectCodexAuthRecovery({
      error: "Codex refresh token was already consumed by another client",
      provider: "openai-codex",
      profile: "default",
    });

    expect(info?.displayMessage).toContain("Codex sign-in needs to be refreshed");
    expect(info?.recovery).toMatchObject({
      kind: "codex-auth",
      provider: "openai-codex",
      reason: "refresh-token-consumed",
      profile: "default",
      action: "start-codex-device-auth",
    });
  });

  it.each([
    ["refresh_token is invalid", "refresh-token-invalid"],
    ["refresh token expired", "refresh-token-expired"],
    ["refresh-token revoked by server", "refresh-token-revoked"],
    ["invalid_grant for refresh token", "refresh-token-invalid"],
  ] as const)("matches %s", (error, reason) => {
    expect(
      detectCodexAuthRecovery({ error, provider: "openai-codex" })?.recovery
        ?.reason,
    ).toBe(reason);
  });

  it("does not match the same text for non-Codex providers", () => {
    expect(
      detectCodexAuthRecovery({
        error: "refresh token was already consumed",
        provider: "openai",
      }),
    ).toBeNull();
  });

  it.each([
    "Unauthorized",
    "API key invalid",
    "invalid_grant",
    "401: missing authentication",
  ])("does not match generic auth errors: %s", (error) => {
    expect(detectCodexAuthRecovery({ error, provider: "openai-codex" })).toBeNull();
  });
});

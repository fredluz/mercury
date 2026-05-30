import { describe, expect, it } from "vitest";
import {
  classifyChatRemediation,
  sanitizeDiagnostics,
} from "../src/shared/chat-remediation";

describe("chat remediation classifier", () => {
  it("classifies Codex refresh-token failures as assisted auth recovery", () => {
    expect(
      classifyChatRemediation({
        source: "run_failed",
        error: "Codex refresh token was already consumed by another client",
        provider: "openai-codex",
        profile: "work",
      }),
    ).toMatchObject({
      kind: "codex-auth",
      tier: "assisted",
      action: "start-codex-device-auth",
      autoRetryAfterRecovery: true,
      reason: "refresh-token-consumed",
      profile: "work",
    });
  });

  it("classifies run failures as redacted debug prompts", () => {
    const remediation = classifyChatRemediation({
      source: "run_failed",
      error:
        "'NoneType' object is not iterable while using Bearer sk_secretvalue1234567890",
      profile: "work",
      provider: "openai",
      model: "gpt-4o",
      runId: "run_1",
      sessionId: "session_1",
      requestShape: {
        model: "gpt-4o",
        Authorization: "Bearer sk_live_secretvalue1234567890",
      },
      responsePreview: "server said token sk_anothersecret1234567890 failed",
    });

    expect(remediation).toMatchObject({
      kind: "debug-prompt",
      tier: "debug-prompt",
      action: "copy-debug-prompt",
    });
    expect(remediation?.kind === "debug-prompt" && remediation.prompt).toContain(
      "Debug this Hermes/Mercury chat failure.",
    );
    expect(JSON.stringify(remediation)).not.toContain("sk_live_secret");
    expect(JSON.stringify(remediation)).not.toContain("sk_anothersecret");
    expect(JSON.stringify(remediation)).not.toContain("sk_secretvalue");
  });

  it("classifies runtime capability setup failures as instruction remediations", () => {
    expect(
      classifyChatRemediation({
        source: "chat_setup",
        error: "Hermes gateway API key is invalid for profile work.",
        runtimeErrorCode: "runtime-invalid-api-key",
        profile: "work",
      }),
    ).toMatchObject({
      kind: "gateway-auth",
      tier: "instruct",
      action: "fix-gateway-api-key",
    });

    expect(
      classifyChatRemediation({
        source: "chat_setup",
        error: "Hermes must be updated.",
        runtimeErrorCode: "runtime-capability-missing",
        profile: "work",
      }),
    ).toMatchObject({
      kind: "update-hermes",
      tier: "instruct",
      action: "update-hermes",
    });
  });

  it("redacts nested secret-shaped diagnostics", () => {
    expect(
      sanitizeDiagnostics({
        source: "run_submission",
        error: "Bearer secret-token-value-abcdefghijklmnopqrstuvwxyz",
        requestShape: {
          apiKey: "abc123",
          nested: { token: "def456" },
        },
      }),
    ).toMatchObject({
      error: "Bearer [REDACTED]",
      requestShape: {
        apiKey: "[REDACTED]",
        nested: { token: "[REDACTED]" },
      },
    });
  });
});

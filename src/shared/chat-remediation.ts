import { detectCodexAuthRecovery } from "./codex-auth-recovery";

export type ChatRemediationTier =
  | "auto-fix"
  | "assisted"
  | "debug-prompt"
  | "instruct";

export type ChatRemediation =
  | {
      kind: "codex-auth";
      tier: "assisted";
      action: "start-codex-device-auth";
      autoRetryAfterRecovery: boolean;
      reason: string;
      profile?: string;
    }
  | {
      kind: "debug-prompt";
      tier: "debug-prompt";
      action: "copy-debug-prompt";
      prompt: string;
      diagnostics: ChatFailureDiagnostics;
    }
  | {
      kind: "gateway-auth";
      tier: "instruct";
      action: "fix-gateway-api-key";
      message: string;
      profile?: string;
    }
  | {
      kind: "update-hermes";
      tier: "instruct";
      action: "update-hermes";
      message: string;
      profile?: string;
    }
  | {
      kind: "queue-retry";
      tier: "auto-fix";
      action: "queue-and-retry";
      message: string;
    };

export interface ChatFailureDiagnostics {
  source:
    | "capability_probe"
    | "run_submission"
    | "run_failed"
    | "run_status"
    | "transport"
    | "chat_setup";
  error: string;
  profile?: string;
  provider?: string;
  model?: string;
  runId?: string;
  sessionId?: string;
  statusCode?: number;
  runtimeErrorCode?: string;
  requestShape?: Record<string, unknown>;
  responsePreview?: string;
}

export function classifyChatRemediation(
  diagnostics: ChatFailureDiagnostics,
): ChatRemediation | undefined {
  const error = diagnostics.error || "";
  const codexRecovery = detectCodexAuthRecovery({
    error,
    provider: diagnostics.provider,
    profile: diagnostics.profile,
  });
  if (codexRecovery?.recovery) {
    return {
      kind: "codex-auth",
      tier: "assisted",
      action: "start-codex-device-auth",
      autoRetryAfterRecovery: true,
      reason: codexRecovery.recovery.reason,
      profile: codexRecovery.recovery.profile,
    };
  }

  if (diagnostics.runtimeErrorCode === "runtime-invalid-api-key") {
    return {
      kind: "gateway-auth",
      tier: "instruct",
      action: "fix-gateway-api-key",
      message:
        "Hermes rejected Mercury's gateway API key. Refresh the profile API key or restart the verified gateway for this profile.",
      profile: diagnostics.profile,
    };
  }

  if (diagnostics.runtimeErrorCode === "runtime-capability-missing") {
    return {
      kind: "update-hermes",
      tier: "instruct",
      action: "update-hermes",
      message:
        "Hermes is reachable but does not expose the Sessions/Runs API Mercury requires. Update Hermes before retrying chat.",
      profile: diagnostics.profile,
    };
  }

  if (
    diagnostics.statusCode === 429 ||
    /rate[_ -]?limit|too many concurrent|concurrent runs|API error 429/i.test(error)
  ) {
    return {
      kind: "queue-retry",
      tier: "auto-fix",
      action: "queue-and-retry",
      message:
        "Hermes is at its run concurrency limit. Mercury queues runs locally and retries as capacity frees.",
    };
  }

  if (
    diagnostics.source === "run_failed" ||
    diagnostics.source === "run_status" ||
    diagnostics.source === "run_submission"
  ) {
    const sanitized = sanitizeDiagnostics(diagnostics);
    return {
      kind: "debug-prompt",
      tier: "debug-prompt",
      action: "copy-debug-prompt",
      diagnostics: sanitized,
      prompt: buildDebugPrompt(sanitized),
    };
  }

  return undefined;
}

function buildDebugPrompt(diagnostics: ChatFailureDiagnostics): string {
  return [
    "Debug this Hermes/Mercury chat failure.",
    "",
    "Failure:",
    `- source: ${diagnostics.source}`,
    `- error: ${diagnostics.error}`,
    `- profile: ${diagnostics.profile || "unknown"}`,
    `- provider: ${diagnostics.provider || "unknown"}`,
    `- model: ${diagnostics.model || "unknown"}`,
    `- runId: ${diagnostics.runId || "unknown"}`,
    `- sessionId: ${diagnostics.sessionId || "unknown"}`,
    diagnostics.statusCode ? `- statusCode: ${diagnostics.statusCode}` : "",
    diagnostics.runtimeErrorCode
      ? `- runtimeErrorCode: ${diagnostics.runtimeErrorCode}`
      : "",
    "",
    "Request shape:",
    JSON.stringify(diagnostics.requestShape || {}, null, 2),
    "",
    "Response preview:",
    diagnostics.responsePreview || "",
    "",
    "Please identify the likely root cause and the smallest safe fix. Do not ask for or expose API keys, bearer tokens, passwords, or other secrets.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function sanitizeDiagnostics(
  diagnostics: ChatFailureDiagnostics,
): ChatFailureDiagnostics {
  return redactValue(diagnostics) as ChatFailureDiagnostics;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/api[_-]?key|authorization|bearer|token|secret|password|credential/i.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactValue(raw);
  }
  return out;
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|pat|ghp|gho|ghu|ghs)_[A-Za-z0-9_]{8,}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
}

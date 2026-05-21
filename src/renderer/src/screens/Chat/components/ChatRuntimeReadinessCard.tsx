import { AlertTriangle, Bot, CheckCircle2, Wrench } from "lucide-react";
import { useState } from "react";
import type React from "react";
import type {
  RuntimeDebugAgent,
  RuntimeDiagnostic,
} from "../../../../../shared/runtime";

const DEBUG_AGENTS: Array<{ agent: RuntimeDebugAgent; labelKey: string }> = [
  { agent: "codex", labelKey: "chat.runtimeDebugCodex" },
  { agent: "claude", labelKey: "chat.runtimeDebugClaude" },
  { agent: "pi", labelKey: "chat.runtimeDebugPi" },
];

interface ChatRuntimeReadinessCardProps {
  diagnostic?: RuntimeDiagnostic | null;
  profile?: string;
  onRuntimeDiagnosticRefresh?: () => void;
  t: (key: string) => string;
}

function shouldShowChatRuntimeReadiness(
  diagnostic?: RuntimeDiagnostic | null,
): boolean {
  return diagnostic?.status === "unverified";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revalidateWithRetry(profile?: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const verified = await window.hermesAPI.revalidateRuntime(profile);
    if (verified) return true;
    if (attempt < 2) await wait(700 * (attempt + 1));
  }
  return false;
}

async function repairLocalRuntime(profile: string): Promise<boolean> {
  await window.hermesAPI.startGateway(profile);
  if (await revalidateWithRetry(profile)) return true;
  await window.hermesAPI.restartGateway(profile);
  return revalidateWithRetry(profile);
}

export function ChatRuntimeReadinessCard({
  diagnostic,
  profile,
  onRuntimeDiagnosticRefresh,
  t,
}: ChatRuntimeReadinessCardProps): React.JSX.Element | null {
  const [busyAction, setBusyAction] = useState<
    "verify" | RuntimeDebugAgent | null
  >(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (!shouldShowChatRuntimeReadiness(diagnostic)) return null;

  const selectedProfile = profile || diagnostic?.selectedProfile || "default";
  const reason =
    diagnostic?.mismatchReason || t("chat.runtimeReadinessReasonFallback");

  async function handleVerify(): Promise<void> {
    if (busyAction) return;
    setBusyAction("verify");
    setStatusMessage(t("chat.runtimeVerifying"));
    try {
      const verified =
        diagnostic?.mode === "local"
          ? await repairLocalRuntime(selectedProfile)
          : await revalidateWithRetry(selectedProfile);
      setStatusMessage(
        verified ? t("chat.runtimeVerified") : t("chat.runtimeStillUnverified"),
      );
      onRuntimeDiagnosticRefresh?.();
    } catch (err) {
      setStatusMessage(
        `${t("chat.runtimeVerifyFailed")} ${(err as Error).message}`.trim(),
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDebug(agent: RuntimeDebugAgent): Promise<void> {
    if (busyAction || !diagnostic) return;
    setBusyAction(agent);
    setStatusMessage(t("chat.runtimeDebugLaunching"));
    try {
      const result = await window.hermesAPI.launchRuntimeDebugAgent({
        agent,
        profile: selectedProfile,
      });
      setStatusMessage(
        result.success
          ? t("chat.runtimeDebugStarted")
          : `${t("chat.runtimeDebugFailed")} ${result.error || ""}`.trim(),
      );
    } catch (err) {
      setStatusMessage(
        `${t("chat.runtimeDebugFailed")} ${(err as Error).message}`.trim(),
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="chat-runtime-card" aria-live="polite">
      <div className="chat-runtime-card-icon">
        <AlertTriangle size={18} />
      </div>
      <div className="chat-runtime-card-body">
        <div className="chat-runtime-card-title">
          {t("chat.runtimeReadinessTitle")}
        </div>
        <div className="chat-runtime-card-copy">
          {t("chat.runtimeReadinessCopy")}
        </div>
        <div className="chat-runtime-card-reason">{reason}</div>
        <div className="chat-runtime-card-actions">
          <button
            className="btn btn-secondary chat-runtime-action"
            disabled={Boolean(busyAction)}
            onClick={handleVerify}
          >
            {busyAction === "verify" ? (
              <CheckCircle2 size={14} />
            ) : (
              <Wrench size={14} />
            )}
            {busyAction === "verify"
              ? t("chat.runtimeVerifyingShort")
              : t("chat.runtimeVerify")}
          </button>
          <div
            className="chat-runtime-debug-actions"
            aria-label={t("chat.runtimeDebugGroup")}
          >
            <span>{t("chat.runtimeDebugGroup")}</span>
            {DEBUG_AGENTS.map(({ agent, labelKey }) => (
              <button
                key={agent}
                className="btn-ghost chat-runtime-debug-btn"
                disabled={Boolean(busyAction)}
                onClick={() => void handleDebug(agent)}
              >
                <Bot size={14} />
                {busyAction === agent
                  ? t("chat.runtimeDebugLaunchingShort")
                  : t(labelKey)}
              </button>
            ))}
          </div>
        </div>
        {statusMessage && (
          <div className="chat-runtime-card-status">{statusMessage}</div>
        )}
      </div>
    </section>
  );
}

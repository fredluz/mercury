import { useCallback, useEffect, useRef, useState } from "react";

export type CodexAuthStatus = Awaited<
  ReturnType<typeof window.hermesAPI.getCodexAuthStatus>
>;
export type CodexDeviceAuthStart = Awaited<
  ReturnType<typeof window.hermesAPI.startCodexDeviceAuth>
>;
export type CodexAuthPhase =
  | "idle"
  | "loading"
  | "starting"
  | "waiting"
  | "success"
  | "error";

export type PendingCodexAuth = CodexDeviceAuthStart & { profile?: string };

interface UseCodexAuthFlowOptions {
  profile?: string;
  active?: boolean;
  onAuthenticated?: () => Promise<void> | void;
}

interface UseCodexAuthFlowResult {
  status: CodexAuthStatus | null;
  pending: PendingCodexAuth | null;
  phase: CodexAuthPhase;
  errorMessage: string;
  refreshStatus: () => Promise<void>;
  start: () => Promise<void>;
  copyCode: () => Promise<void>;
  reset: () => void;
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback);
}

export function useCodexAuthFlow({
  profile,
  active = true,
  onAuthenticated,
}: UseCodexAuthFlowOptions = {}): UseCodexAuthFlowResult {
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [pending, setPending] = useState<PendingCodexAuth | null>(null);
  const [phase, setPhase] = useState<CodexAuthPhase>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const pollTimerRef = useRef<ReturnType<typeof window.setInterval> | null>(
    null,
  );
  const onAuthenticatedRef = useRef(onAuthenticated);

  onAuthenticatedRef.current = onAuthenticated;

  const clearPollTimer = useCallback((): void => {
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!active) return;
    setPhase((current) => (current === "idle" ? "loading" : current));
    const nextStatus = await window.hermesAPI.getCodexAuthStatus(profile);
    setStatus(nextStatus);
    setPhase((current) => (current === "loading" ? "idle" : current));
  }, [active, profile]);

  const reset = useCallback((): void => {
    clearPollTimer();
    setPending(null);
    setErrorMessage("");
    setPhase("idle");
  }, [clearPollTimer]);

  useEffect(() => {
    reset();
    if (active) void refreshStatus().catch((error) => {
      setPhase("error");
      setErrorMessage(messageFrom(error, "Could not load Codex auth status."));
    });
    return clearPollTimer;
  }, [active, clearPollTimer, profile, refreshStatus, reset]);

  const start = useCallback(async (): Promise<void> => {
    if (phase === "starting" || phase === "waiting") return;
    clearPollTimer();
    setPhase("starting");
    setErrorMessage("");
    try {
      const authStart = await window.hermesAPI.startCodexDeviceAuth();
      setPending({ ...authStart, profile });
      setPhase("waiting");
    } catch (error) {
      setPhase("error");
      setErrorMessage(messageFrom(error, "Codex login failed to start."));
    }
  }, [clearPollTimer, phase, profile]);

  const copyCode = useCallback(async (): Promise<void> => {
    if (!pending?.userCode) return;
    try {
      await navigator.clipboard.writeText(pending.userCode);
    } catch (error) {
      setErrorMessage(messageFrom(error, "Could not copy Codex code."));
    }
  }, [pending]);

  useEffect(() => {
    if (!pending || phase !== "waiting") return;
    clearPollTimer();

    let cancelled = false;
    async function poll(): Promise<void> {
      if (!pending || cancelled) return;
      try {
        const result = await window.hermesAPI.pollCodexDeviceAuth(
          pending.sessionId,
          pending.profile,
        );
        if (cancelled || result.status === "pending") return;
        clearPollTimer();
        setPending(null);
        if (result.status === "authenticated") {
          setPhase("success");
          setErrorMessage("");
          await refreshStatus();
          await onAuthenticatedRef.current?.();
          return;
        }
        setPhase("error");
        setErrorMessage(result.message || "Codex login failed.");
      } catch (error) {
        if (cancelled) return;
        clearPollTimer();
        setPending(null);
        setPhase("error");
        setErrorMessage(messageFrom(error, "Codex login failed."));
      }
    }

    pollTimerRef.current = window.setInterval(
      () => void poll(),
      Math.max(3000, pending.intervalSeconds * 1000),
    );
    void poll();

    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [clearPollTimer, pending, phase, refreshStatus]);

  return {
    status,
    pending,
    phase,
    errorMessage,
    refreshStatus,
    start,
    copyCode,
    reset,
  };
}

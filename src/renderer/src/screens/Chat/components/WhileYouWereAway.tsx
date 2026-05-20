import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import type { TraceScheduleRunSummary } from "../../../../../shared/traces";

const CONFIG_KEY = "chat.whileYouWereAway.lastViewedAt";
const LOCAL_STORAGE_KEY_PREFIX = "mercury.chat.whileYouWereAway.lastViewedAt";
const MAX_VISIBLE_RUNS = 5;

type LoadState = "loading" | "ready" | "error";

interface WhileYouWereAwayProps {
  profile?: string;
  onOpenTraceRun?: (runId: string) => void;
  onViewSchedules?: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

function localStorageKey(profile?: string): string {
  return `${LOCAL_STORAGE_KEY_PREFIX}.${profile || "default"}`;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function readLastViewedTimestamp(profile?: string): Promise<number> {
  try {
    const configured = await window.hermesAPI.getConfig(CONFIG_KEY, profile);
    const parsed = parseTimestamp(configured);
    if (parsed) return parsed;
  } catch {
    // Fall through to renderer-local storage when profile config is unavailable.
  }

  const stored = parseTimestamp(localStorage.getItem(localStorageKey(profile)));
  return stored || Date.now();
}

async function writeLastViewedTimestamp(
  timestamp: number,
  profile?: string,
): Promise<void> {
  localStorage.setItem(localStorageKey(profile), String(timestamp));
}

function runTimestamp(run: TraceScheduleRunSummary): number {
  return run.completedAt || run.updatedAt || run.startedAt;
}

function formatTime(timestamp: number, t: WhileYouWereAwayProps["t"]): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  return sameDay ? time : t("chat.whileAwayYesterday", { time });
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return "0s";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function statusClass(status: TraceScheduleRunSummary["status"]): string {
  if (status === "completed") return "completed";
  if (status === "aborted") return "aborted";
  return "failed";
}

function statusLabel(
  status: TraceScheduleRunSummary["status"],
  t: WhileYouWereAwayProps["t"],
): string {
  if (status === "completed") return t("chat.whileAwayStatusSuccess");
  if (status === "aborted") return t("chat.whileAwayStatusAborted");
  return t("chat.whileAwayStatusFailed");
}

function summaryForRun(
  run: TraceScheduleRunSummary,
  t: WhileYouWereAwayProps["t"],
): string {
  if (run.status === "failed" || run.status === "aborted") {
    return run.error || run.summary || t("chat.whileAwayNoSummary");
  }
  return run.summary || t("chat.whileAwayNoSummary");
}

export function WhileYouWereAway({
  profile,
  onOpenTraceRun,
  onViewSchedules,
  t,
}: WhileYouWereAwayProps): React.JSX.Element | null {
  const [state, setState] = useState<LoadState>("loading");
  const [runs, setRuns] = useState<TraceScheduleRunSummary[]>([]);
  const [lastViewedAt, setLastViewedAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const loadRuns = useCallback(async (): Promise<void> => {
    setState("loading");
    setDismissed(false);
    try {
      const timestamp = await readLastViewedTimestamp(profile);
      const completedRuns =
        await window.hermesAPI.listCompletedScheduledRunsSince(
          timestamp,
          profile,
        );
      setLastViewedAt(timestamp);
      setRuns(
        completedRuns
          .filter((run) =>
            ["completed", "failed", "aborted"].includes(run.status),
          )
          .sort((a, b) => runTimestamp(b) - runTimestamp(a)),
      );
      setState("ready");
    } catch {
      setRuns([]);
      setState("error");
    }
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setDismissed(false);
    readLastViewedTimestamp(profile)
      .then(async (timestamp) => {
        const completedRuns =
          await window.hermesAPI.listCompletedScheduledRunsSince(
            timestamp,
            profile,
          );
        if (cancelled) return;
        setLastViewedAt(timestamp);
        setRuns(
          completedRuns
            .filter((run) =>
              ["completed", "failed", "aborted"].includes(run.status),
            )
            .sort((a, b) => runTimestamp(b) - runTimestamp(a)),
        );
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setRuns([]);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const visibleRuns = useMemo(() => runs.slice(0, MAX_VISIBLE_RUNS), [runs]);
  const completedCount = runs.filter(
    (run) => run.status === "completed",
  ).length;
  const failedCount = runs.filter((run) => run.status === "failed").length;
  const abortedCount = runs.filter((run) => run.status === "aborted").length;

  const handleMarkRead = useCallback(async (): Promise<void> => {
    const timestamp = Date.now();
    setDismissed(true);
    setRuns([]);
    setLastViewedAt(timestamp);
    await writeLastViewedTimestamp(timestamp, profile);
  }, [profile]);

  if (dismissed) return null;
  if (state === "ready" && runs.length === 0) return null;

  return (
    <section
      className={`chat-away-section ${state === "error" ? "chat-away-section-error" : ""}`}
      aria-live="polite"
      aria-busy={state === "loading"}
    >
      <div className="chat-away-header">
        <h2>{t("chat.whileAwayTitle")}</h2>
        {state === "ready" && (
          <button className="chat-away-link" onClick={handleMarkRead}>
            {t("chat.whileAwayMarkRead")}
          </button>
        )}
      </div>

      {state === "loading" && (
        <div className="chat-away-state">
          <RefreshCw size={14} className="chat-away-spinner" />
          <span>{t("chat.whileAwayLoading")}</span>
        </div>
      )}

      {state === "error" && (
        <div className="chat-away-state chat-away-error" role="alert">
          <span>{t("chat.whileAwayError")}</span>
          <button className="chat-away-link" onClick={loadRuns}>
            {t("chat.whileAwayRetry")}
          </button>
        </div>
      )}

      {state === "ready" && runs.length > 0 && (
        <>
          <div className="chat-away-run-list" role="list">
            {visibleRuns.map((run, index) => {
              const normalizedStatus = statusClass(run.status);
              const canOpenTrace = Boolean(onOpenTraceRun && run.traceRunId);
              return (
                <button
                  key={run.traceRunId}
                  type="button"
                  className={`chat-away-run chat-away-run-${normalizedStatus}`}
                  style={{ animationDelay: `${Math.min(index, 4) * 40}ms` }}
                  onClick={() => {
                    if (canOpenTrace) onOpenTraceRun?.(run.traceRunId);
                  }}
                  disabled={!canOpenTrace}
                  aria-label={t("chat.whileAwayOpenTrace", {
                    schedule:
                      run.scheduleName || t("chat.whileAwayUnknownSchedule"),
                  })}
                >
                  <span className="chat-away-run-main">
                    <span className="chat-away-run-left">
                      <span
                        className={`chat-away-status-dot chat-away-status-dot-${normalizedStatus}`}
                        aria-label={statusLabel(run.status, t)}
                      />
                      <span className="chat-away-time">
                        {formatTime(runTimestamp(run), t)}
                      </span>
                      <span className="chat-away-name">
                        {run.scheduleName || t("chat.whileAwayUnknownSchedule")}
                      </span>
                    </span>
                    <span className="chat-away-run-right">
                      <span
                        className={`chat-away-status chat-away-status-${normalizedStatus}`}
                      >
                        {statusLabel(run.status, t)}
                      </span>
                      <span className="chat-away-duration">
                        {formatDuration(run.durationMs)}
                      </span>
                      {canOpenTrace && <ExternalLink size={12} />}
                    </span>
                  </span>
                  <span className="chat-away-summary">
                    {summaryForRun(run, t)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="chat-away-footer">
            <span>
              {t("chat.whileAwayCompletedCount", {
                count: completedCount,
              })}
              {failedCount > 0 && (
                <>
                  {" · "}
                  <span className="chat-away-footer-failed">
                    {t("chat.whileAwayFailedCount", { count: failedCount })}
                  </span>
                </>
              )}
              {abortedCount > 0 && (
                <>
                  {" · "}
                  <span className="chat-away-footer-aborted">
                    {t("chat.whileAwayAbortedCount", { count: abortedCount })}
                  </span>
                </>
              )}
              {runs.length > visibleRuns.length && (
                <>
                  {" · "}
                  {t("chat.whileAwayShowingCount", {
                    shown: visibleRuns.length,
                    total: runs.length,
                  })}
                </>
              )}
            </span>
            {onViewSchedules && (
              <button className="chat-away-link" onClick={onViewSchedules}>
                {t("chat.whileAwayViewAllSchedules")}
              </button>
            )}
          </div>
        </>
      )}

      {lastViewedAt ? (
        <span className="sr-only">
          {t("chat.whileAwaySince", { timestamp: String(lastViewedAt) })}
        </span>
      ) : null}
    </section>
  );
}

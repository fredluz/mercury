import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceScheduleRunSummary } from "../../../../../shared/traces";
import { WhileYouWereAway } from "./WhileYouWereAway";

const dictionary: Record<string, string> = {
  "chat.whileAwayTitle": "While You Were Away",
  "chat.whileAwayMarkRead": "Mark all read",
  "chat.whileAwayLoading": "Checking scheduled runs...",
  "chat.whileAwayError": "Failed to load scheduled runs.",
  "chat.whileAwayRetry": "Retry",
  "chat.whileAwayOpenTrace": "View trace for {{schedule}}",
  "chat.whileAwayViewAllSchedules": "View all schedules",
  "chat.whileAwayStatusSuccess": "Success",
  "chat.whileAwayStatusFailed": "Failed",
  "chat.whileAwayStatusAborted": "Aborted",
  "chat.whileAwayUnknownSchedule": "Scheduled run",
  "chat.whileAwayNoSummary": "No summary available.",
  "chat.whileAwayYesterday": "Yesterday {{time}}",
  "chat.whileAwayCompletedCount": "{{count}} completed",
  "chat.whileAwayFailedCount": "{{count}} failed",
  "chat.whileAwayAbortedCount": "{{count}} aborted",
  "chat.whileAwayShowingCount": "Showing {{shown}} of {{total}}",
  "chat.whileAwaySince": "Scheduled runs since {{timestamp}}",
};

function t(key: string, values?: Record<string, string | number>): string {
  return Object.entries(values || {}).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
    dictionary[key] || key,
  );
}

function run(
  index: number,
  status: TraceScheduleRunSummary["status"] = "completed",
): TraceScheduleRunSummary {
  return {
    traceRunId: `run-${index}`,
    scheduleId: `schedule-${index}`,
    scheduleName: `Schedule ${index}`,
    profile: "default",
    status,
    startedAt: 2_000 + index,
    updatedAt: 2_500 + index,
    completedAt: 3_000 + index,
    durationMs: 125_000,
    summary: `Summary ${index}`,
    error: status === "failed" ? "Connection failed" : undefined,
  };
}

function installHermesApiMock(
  runs: TraceScheduleRunSummary[],
): Partial<Window["hermesAPI"]> {
  const api: Partial<Window["hermesAPI"]> = {
    getConfig: vi.fn().mockResolvedValue("1000"),
    setConfig: vi.fn().mockResolvedValue(true),
    listCompletedScheduledRunsSince: vi.fn().mockResolvedValue(runs),
  };
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    api;
  return api;
}

describe("WhileYouWereAway", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders completed runs since the stored timestamp and opens trace links", async () => {
    const api = installHermesApiMock([
      run(0),
      run(1, "failed"),
      run(2),
      run(3),
      run(4),
      run(5),
    ]);
    const onOpenTraceRun = vi.fn();
    const onViewSchedules = vi.fn();

    render(
      <WhileYouWereAway
        profile="work"
        onOpenTraceRun={onOpenTraceRun}
        onViewSchedules={onViewSchedules}
        t={t}
      />,
    );

    expect(screen.getByText("Checking scheduled runs...")).toBeInTheDocument();
    await screen.findByText("Schedule 5");

    expect(api.listCompletedScheduledRunsSince).toHaveBeenCalledWith(
      1000,
      "work",
    );
    expect(screen.getByText("Schedule 1")).toBeInTheDocument();
    expect(screen.queryByText("Schedule 0")).not.toBeInTheDocument();
    expect(
      screen.getByText("While You Were Away").closest("section"),
    ).toHaveTextContent("5 completed");
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(
      screen.getByText("While You Were Away").closest("section"),
    ).toHaveTextContent("Showing 5 of 6");

    fireEvent.click(
      screen.getByRole("button", { name: "View trace for Schedule 5" }),
    );
    expect(onOpenTraceRun).toHaveBeenCalledWith("run-5");

    fireEvent.click(screen.getByRole("button", { name: "View all schedules" }));
    expect(onViewSchedules).toHaveBeenCalled();
  });

  it("hides when no completed scheduled runs are returned", async () => {
    installHermesApiMock([]);

    render(<WhileYouWereAway profile="work" t={t} />);

    await waitFor(() => {
      expect(screen.queryByText("While You Were Away")).not.toBeInTheDocument();
    });
  });

  it("marks all runs read and persists the dismissal timestamp locally", async () => {
    const api = installHermesApiMock([run(1)]);
    vi.spyOn(Date, "now").mockReturnValue(4_000);

    render(<WhileYouWereAway profile="work" t={t} />);
    await screen.findByText("Schedule 1");

    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));

    await waitFor(() => {
      expect(screen.queryByText("While You Were Away")).not.toBeInTheDocument();
    });
    expect(api.setConfig).not.toHaveBeenCalled();
    expect(
      localStorage.getItem("mercury.chat.whileYouWereAway.lastViewedAt.work"),
    ).toBe("4000");
  });
});

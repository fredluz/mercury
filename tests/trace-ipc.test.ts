import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    ipcHandle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    ),
    ipcInvoke: vi.fn(),
    createLocalChatTrace: vi.fn(),
    getTraceRun: vi.fn(),
    listCompletedScheduledRunsSince: vi.fn(),
    listSkillTrainingRuns: vi.fn(),
    listTraceRuns: vi.fn(),
    listTraceRunsForSchedule: vi.fn(),
  };
});

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.ipcHandle },
  ipcRenderer: { invoke: mocks.ipcInvoke },
}));

vi.mock("../src/main/trace-store", () => ({
  createLocalChatTrace: mocks.createLocalChatTrace,
  getTraceRun: mocks.getTraceRun,
  listCompletedScheduledRunsSince: mocks.listCompletedScheduledRunsSince,
  listSkillTrainingRuns: mocks.listSkillTrainingRuns,
  listTraceRuns: mocks.listTraceRuns,
  listTraceRunsForSchedule: mocks.listTraceRunsForSchedule,
}));

import { registerTraceIpc } from "../src/main/ipc/trace";
import { navigationApi } from "../src/preload/api/navigation";

describe("trace schedule IPC", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
  });

  it("registers schedule run history handlers with profile arguments", () => {
    const scheduleSummary = [
      { traceRunId: "trace-1", scheduleId: "schedule-1" },
    ];
    const completedSummary = [
      { traceRunId: "trace-2", scheduleId: "schedule-2" },
    ];
    mocks.listTraceRunsForSchedule.mockReturnValue(scheduleSummary);
    mocks.listCompletedScheduledRunsSince.mockReturnValue(completedSummary);

    registerTraceIpc();

    expect(
      mocks.handlers.get("list-trace-runs-for-schedule")?.(
        {},
        "schedule-1",
        "work",
      ),
    ).toBe(scheduleSummary);
    expect(mocks.listTraceRunsForSchedule).toHaveBeenCalledWith(
      "schedule-1",
      "work",
    );

    expect(
      mocks.handlers.get("list-completed-scheduled-runs-since")?.(
        {},
        12_345,
        "work",
      ),
    ).toBe(completedSummary);
    expect(mocks.listCompletedScheduledRunsSince).toHaveBeenCalledWith(
      12_345,
      "work",
    );
  });

  it("exposes schedule run history through preload navigation APIs", async () => {
    mocks.ipcInvoke.mockResolvedValue([]);

    await navigationApi.listTraceRunsForSchedule("schedule-1", "work");
    await navigationApi.listCompletedScheduledRunsSince(12_345, "work");

    expect(mocks.ipcInvoke).toHaveBeenCalledWith(
      "list-trace-runs-for-schedule",
      "schedule-1",
      "work",
    );
    expect(mocks.ipcInvoke).toHaveBeenCalledWith(
      "list-completed-scheduled-runs-since",
      12_345,
      "work",
    );
  });
});

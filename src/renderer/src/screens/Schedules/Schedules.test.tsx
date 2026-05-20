import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CronJob } from "../../../../shared/schedules";
import Schedules, {
  buildSchedulePayload,
  normalizeScheduleJob,
} from "./Schedules";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      return Object.entries(options).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        key,
      );
    },
  }),
}));

const baseJob: CronJob = {
  id: "job-1",
  name: "Morning Briefing",
  schedule: "0 9 * * *",
  prompt: "Summarize the day",
  state: "active",
  enabled: true,
  next_run_at: null,
  last_run_at: null,
  last_status: null,
  last_error: null,
  repeat: null,
  deliver: ["local"],
  skills: ["calendar"],
  script: null,
};

function installHermesApiMock(jobs: CronJob[]): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      listCronJobs: vi.fn().mockResolvedValue(jobs),
      listProfiles: vi.fn().mockResolvedValue([
        {
          name: "work",
          path: "/profiles/work",
          isDefault: true,
          isActive: true,
          model: "claude",
          provider: "anthropic",
          hasEnv: true,
          hasSoul: false,
          skillCount: 1,
          gatewayRunning: false,
        },
      ]),
      listTraceRunsForSchedule: vi.fn().mockResolvedValue([
        {
          traceRunId: "trace-1",
          scheduleId: "job-1",
          scheduleName: "Morning Briefing",
          profile: "work",
          status: "completed",
          startedAt: Date.now(),
          updatedAt: Date.now(),
          completedAt: Date.now(),
          durationMs: 120_000,
          summary: "Done",
        },
      ]),
      pauseCronJob: vi.fn().mockResolvedValue({ success: true }),
      resumeCronJob: vi.fn().mockResolvedValue({ success: true }),
      triggerCronJob: vi.fn().mockResolvedValue({ success: true }),
      removeCronJob: vi.fn().mockResolvedValue({ success: true }),
      createScheduleJob: vi
        .fn()
        .mockResolvedValue({ success: true, id: "new-job" }),
      updateCronJob: vi.fn().mockResolvedValue({ success: true, id: "job-1" }),
    };
}

describe("Schedules redesign", () => {
  beforeEach(() => {
    installHermesApiMock([baseJob]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes legacy cron jobs into rich daily schedules", () => {
    const schedule = normalizeScheduleJob(baseJob, "work");

    expect(schedule.kind).toBe("daily");
    expect(schedule.timing.time).toBe("09:00");
    expect(schedule.agentProfile).toBe("work");
    expect(schedule.deliver).toEqual(["local"]);
  });

  it("builds a rich one-shot create payload with retained completion state", () => {
    const form = {
      agentProfile: "work",
      name: "Tax reminder",
      nameManuallyEdited: true,
      prompt: "Remind me",
      kind: "once",
      time: "10:30",
      onceDate: "2099-05-20",
      daysOfWeek: [1],
      dayOfMonth: 20,
      every: 30,
      intervalUnit: "minutes",
      customCron: "",
      deliver: ["local", "email"],
      skills: ["finance"],
      skillDraft: "",
    } as Parameters<typeof buildSchedulePayload>[0];

    const payload = buildSchedulePayload(form);

    expect(payload.kind).toBe("once");
    expect(payload.repeat).toEqual({ times: null, completed: 0 });
    expect(payload.deliver).toEqual(["local", "email"]);
    expect(payload.metadata).toMatchObject({ agentProfile: "work" });
  });

  it("opens trace runs from expanded schedule history", async () => {
    const onOpenTraceRun = vi.fn();
    render(<Schedules profile="work" onOpenTraceRun={onOpenTraceRun} />);

    fireEvent.click(await screen.findByText("Morning Briefing"));

    await waitFor(() =>
      expect(window.hermesAPI.listTraceRunsForSchedule).toHaveBeenCalledWith(
        "job-1",
        "work",
      ),
    );

    fireEvent.click(await screen.findByText("2m 0s"));

    expect(onOpenTraceRun).toHaveBeenCalledWith("trace-1");
  });
});

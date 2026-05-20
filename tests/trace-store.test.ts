import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-trace-store-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

import {
  createLocalChatTrace,
  createTraceRun,
  finishTraceRun,
  getTraceRun,
  listCompletedScheduledRunsSince,
  listSkillTrainingRuns,
  listTraceRuns,
  listTraceRunsForSchedule,
  recordTraceEvent,
} from "../src/main/trace-store";

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

function setNow(timestamp: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(timestamp);
}

describe("trace-store core trace events", () => {
  it("persists structured trace events and strips secret metadata", () => {
    const run = createTraceRun("Generate a trace artifact");

    recordTraceEvent(
      run.id,
      "tool.started",
      "Tool started: image_gen",
      "image_gen",
      {
        toolName: "image_gen",
        apiKey: "must-not-persist",
        nested: { token: "hidden", safe: "visible" },
      },
    );
    recordTraceEvent(
      run.id,
      "artifact.created",
      "Artifact created",
      "file.png token=secret",
      {
        artifactType: "image",
        path: "/tmp/file.png",
        authorization: "Bearer secret",
      },
    );

    const [stored] = listTraceRuns();
    const toolEvent = stored.events.find(
      (event) => event.type === "tool.started",
    );
    const artifactEvent = stored.events.find(
      (event) => event.type === "artifact.created",
    );

    expect(toolEvent?.metadata).toMatchObject({ toolName: "image_gen" });
    expect(toolEvent?.metadata).not.toHaveProperty("apiKey");
    expect(String(toolEvent?.metadata?.nested)).not.toContain("hidden");
    expect(artifactEvent?.detail).toBe("file.png token=[redacted]");
    expect(artifactEvent?.metadata).toMatchObject({
      artifactType: "image",
      path: "/tmp/file.png",
    });
    expect(artifactEvent?.metadata).not.toHaveProperty("authorization");
  });

  it("creates a completed local slash command trace", () => {
    const run = createLocalChatTrace({
      command: "/model",
      profile: "default",
      responsePreview: "Current model: hermes-agent",
      metadata: { api_token: "hidden", command: "/model" },
    });

    expect(run.status).toBe("completed");
    expect(run.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.started",
        "message.user",
        "slash.local",
        "message.agent.delta",
        "run.completed",
      ]),
    );
    const slashEvent = run.events.find((event) => event.type === "slash.local");
    expect(slashEvent?.metadata).toMatchObject({ command: "/model" });
    expect(slashEvent?.metadata).not.toHaveProperty("api_token");
  });
});

describe("trace-store scheduled run history", () => {
  it("persists explicit schedule provenance on trace runs", () => {
    setNow(1_000);
    const run = createTraceRun("Run the daily digest", "work", {
      scheduleId: "schedule-digest",
      scheduleName: "Daily Digest",
      schedulePrompt: "Summarize overnight customer activity.",
    });
    setNow(1_600);
    finishTraceRun(run.id, "completed", undefined, "Digest complete.");

    const stored = getTraceRun(run.id);
    expect(stored).toMatchObject({
      scheduleId: "schedule-digest",
      scheduleName: "Daily Digest",
      schedulePrompt: "Summarize overnight customer activity.",
    });

    const [summary] = listTraceRunsForSchedule("schedule-digest");
    expect(summary).toMatchObject({
      traceRunId: run.id,
      scheduleId: "schedule-digest",
      scheduleName: "Daily Digest",
      profile: "work",
      status: "completed",
      startedAt: 1_000,
      completedAt: 1_600,
      durationMs: 600,
      summary: "Digest complete.",
    });
  });

  it("derives schedule provenance from event metadata when run fields are absent", () => {
    setNow(2_000);
    const run = createTraceRun("Legacy scheduled execution", "default");
    setNow(2_100);
    recordTraceEvent(run.id, "tool.started", "Schedule runner", undefined, {
      scheduleId: "legacy-schedule",
      scheduleName: "Legacy Schedule",
      schedulePrompt: "Fallback prompt from metadata.",
    });
    setNow(2_500);
    finishTraceRun(run.id, "completed");

    const [summary] = listTraceRunsForSchedule("legacy-schedule");
    expect(summary).toMatchObject({
      traceRunId: run.id,
      scheduleName: "Legacy Schedule",
      summary: "Fallback prompt from metadata.",
    });
  });

  it("sorts schedule history newest first", () => {
    setNow(3_000);
    const older = createTraceRun("Older run", "default", {
      scheduleId: "sorted-schedule",
      scheduleName: "Sorted Schedule",
    });
    setNow(3_100);
    finishTraceRun(older.id, "completed");

    setNow(4_000);
    const newer = createTraceRun("Newer run", "default", {
      scheduleId: "sorted-schedule",
      scheduleName: "Sorted Schedule",
    });
    setNow(4_200);
    finishTraceRun(newer.id, "completed");

    expect(
      listTraceRunsForSchedule("sorted-schedule").map((run) => run.traceRunId),
    ).toEqual([newer.id, older.id]);
  });

  it("filters completed scheduled runs since a timestamp and excludes running runs", () => {
    setNow(5_000);
    const oldRun = createTraceRun("Old completed run", "default", {
      scheduleId: "completed-schedule",
      scheduleName: "Completed Schedule",
    });
    setNow(5_500);
    finishTraceRun(oldRun.id, "completed");

    setNow(7_000);
    const recentRun = createTraceRun("Recent completed run", "default", {
      scheduleId: "completed-schedule",
      scheduleName: "Completed Schedule",
    });
    setNow(7_500);
    finishTraceRun(recentRun.id, "completed");

    setNow(8_000);
    createTraceRun("Still running", "default", {
      scheduleId: "completed-schedule",
      scheduleName: "Completed Schedule",
    });

    expect(
      listCompletedScheduledRunsSince(6_000).map((run) => run.traceRunId),
    ).toEqual([recentRun.id]);
  });

  it("filters scheduled summaries by profile", () => {
    setNow(9_000);
    const defaultRun = createTraceRun("Default profile run", "default", {
      scheduleId: "profile-schedule",
      scheduleName: "Profile Schedule",
    });
    setNow(9_100);
    finishTraceRun(defaultRun.id, "completed");

    setNow(10_000);
    const workRun = createTraceRun("Work profile run", "work", {
      scheduleId: "profile-schedule",
      scheduleName: "Profile Schedule",
    });
    setNow(10_100);
    finishTraceRun(workRun.id, "completed");

    expect(
      listTraceRunsForSchedule("profile-schedule", "work").map(
        (run) => run.traceRunId,
      ),
    ).toEqual([workRun.id]);
    expect(
      listCompletedScheduledRunsSince(0, "work").map((run) => run.traceRunId),
    ).toEqual([workRun.id]);
  });

  it("ingests Hermes cron output files as scheduled trace runs", () => {
    const outputDir = join(TEST_HOME, "cron", "output", "cron-job-1");
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(join(TEST_HOME, "cron"), { recursive: true });
    writeFileSync(
      join(TEST_HOME, "cron", "jobs.json"),
      JSON.stringify({
        jobs: [
          {
            id: "cron-job-1",
            name: "Live Recap",
            prompt: "Reply with LIVE_CRON_OK",
          },
        ],
      }),
    );
    writeFileSync(
      join(outputDir, "2026-05-20_03-30-00.md"),
      [
        "# Cron Job: Live Recap",
        "",
        "**Job ID:** cron-job-1",
        "**Run Time:** 2026-05-20 03:30:00",
        "**Schedule:** every 1m",
        "",
        "## Prompt",
        "",
        "Reply with LIVE_CRON_OK",
        "",
        "## Response",
        "",
        "LIVE_CRON_OK",
        "LIVE_SKILL_OK",
        "",
      ].join("\n"),
    );

    const [summary] = listTraceRunsForSchedule("cron-job-1");

    expect(summary).toMatchObject({
      scheduleId: "cron-job-1",
      scheduleName: "Live Recap",
      profile: "default",
      status: "completed",
      summary: "LIVE_CRON_OK LIVE_SKILL_OK",
    });
    expect(getTraceRun(summary.traceRunId)).toMatchObject({
      scheduleId: "cron-job-1",
      scheduleName: "Live Recap",
      status: "completed",
    });
  });

  it("uses agent output, schedule prompt, and error fallbacks for summaries", () => {
    setNow(11_000);
    const responseRun = createTraceRun("Response summary run", "default", {
      scheduleId: "summary-schedule",
      scheduleName: "Summary Schedule",
      schedulePrompt: "Prompt fallback.",
    });
    setNow(11_100);
    recordTraceEvent(
      responseRun.id,
      "message.agent.delta",
      "Agent response",
      "First response line\nSecond response line",
    );
    setNow(11_200);
    finishTraceRun(responseRun.id, "completed");

    setNow(12_000);
    const promptRun = createTraceRun("Prompt summary run", "default", {
      scheduleId: "summary-schedule",
      scheduleName: "Summary Schedule",
      schedulePrompt: "Prompt fallback.",
    });
    setNow(12_100);
    finishTraceRun(promptRun.id, "completed");

    setNow(13_000);
    const failedRun = createTraceRun("Failed summary run", "default", {
      scheduleId: "summary-schedule",
      scheduleName: "Summary Schedule",
      schedulePrompt: "Prompt fallback.",
    });
    setNow(13_100);
    finishTraceRun(
      failedRun.id,
      "failed",
      undefined,
      "Network failure\nRetry later",
    );

    const summaries = listTraceRunsForSchedule("summary-schedule");
    expect(
      summaries.find((run) => run.traceRunId === responseRun.id),
    ).toMatchObject({
      summary: "First response line Second response line",
    });
    expect(
      summaries.find((run) => run.traceRunId === promptRun.id),
    ).toMatchObject({
      summary: "Prompt fallback.",
    });
    expect(
      summaries.find((run) => run.traceRunId === failedRun.id),
    ).toMatchObject({
      summary: "Network failure Retry later",
      error: "Network failure Retry later",
      status: "failed",
    });
  });
});

describe("trace-store skill training extraction", () => {
  it("preserves linked run, score, and needs-review status from skill metadata", () => {
    const run = createTraceRun("Improve the visual explainer skill");

    recordTraceEvent(
      run.id,
      "skill.eval",
      "visual-explainer",
      "Visual explainer needs one more review before promotion.",
      {
        skillName: "visual-explainer",
        score: "0.82",
        status: "needs-review",
      },
    );

    const [skillRun] = listSkillTrainingRuns();
    expect(skillRun).toMatchObject({
      skillName: "visual-explainer",
      status: "needs-review",
      score: 0.82,
      linkedRunId: run.id,
      summary: "Visual explainer needs one more review before promotion.",
    });
  });

  it("clamps invalid score metadata to the trust range", () => {
    const run = createTraceRun("Promote a high-scoring skill");
    recordTraceEvent(run.id, "skill.promoted", "trace-compressor", undefined, {
      skillName: "trace-compressor",
      score: 1.4,
    });

    const [skillRun] = listSkillTrainingRuns();
    expect(skillRun.score).toBe(1);
  });
});

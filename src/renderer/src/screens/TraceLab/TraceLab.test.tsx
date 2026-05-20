import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceEvent, TraceRun } from "../../../../shared/traces";
import TraceLab from "./TraceLab";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const baseTime = 1_700_000_000_000;

function traceEvent(
  runId: string,
  id: string,
  title: string,
  timestamp: number,
): TraceEvent {
  return {
    id,
    runId,
    type: "run.started",
    title,
    detail: title,
    timestamp,
  };
}

function traceRun(overrides: Partial<TraceRun> & { id: string }): TraceRun {
  return {
    id: overrides.id,
    title: overrides.title || `Run ${overrides.id}`,
    profile: overrides.profile || "default",
    status: overrides.status || "completed",
    startedAt: overrides.startedAt || baseTime,
    updatedAt: overrides.updatedAt || baseTime + 10,
    sessionId: overrides.sessionId,
    messagePreview: overrides.messagePreview || `message ${overrides.id}`,
    events: overrides.events || [
      traceEvent(
        overrides.id,
        `${overrides.id}-started`,
        `event ${overrides.id}`,
        baseTime,
      ),
    ],
    usage: overrides.usage,
  };
}

function installHermesApiMock(runs: TraceRun[]): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      listTraceRuns: vi.fn().mockResolvedValue(runs),
      listSkillTrainingRuns: vi.fn().mockResolvedValue([]),
    };
}

describe("TraceLab session mode", () => {
  beforeEach(() => {
    installHermesApiMock([
      traceRun({
        id: "selected-run",
        title: "Selected session trace",
        sessionId: "session-a",
        profile: "work",
        events: [
          traceEvent(
            "selected-run",
            "selected-event",
            "Selected event",
            baseTime,
          ),
        ],
      }),
      traceRun({
        id: "other-run",
        title: "Other session trace",
        sessionId: "session-b",
        profile: "work",
        events: [
          traceEvent("other-run", "other-event", "Other event", baseTime + 1),
        ],
      }),
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides the internal conversation list and renders only the matching session trace", async () => {
    render(
      <TraceLab
        mode="session"
        sessionTarget={{
          sessionId: "session-a",
          title: "Work session",
          profile: "work",
        }}
      />,
    );

    await waitFor(() =>
      expect(window.hermesAPI.listTraceRuns).toHaveBeenCalled(),
    );

    expect(
      screen.queryByLabelText("Trace conversations"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Selected session trace"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Selected event").length).toBeGreaterThan(0);
    expect(screen.queryByText("Other session trace")).not.toBeInTheDocument();
  });

  it("shows a session empty state when no trace matches", async () => {
    render(
      <TraceLab
        mode="session"
        sessionTarget={{
          sessionId: "missing-session",
          title: "Missing",
          profile: "work",
        }}
      />,
    );

    expect(
      await screen.findByText("sessions.noSessionTraces"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Trace conversations"),
    ).not.toBeInTheDocument();
  });
});

describe("TraceLab direct run mode", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("selects the requested run after the trace list loads", async () => {
    installHermesApiMock([
      traceRun({
        id: "first-run",
        title: "First session trace",
        sessionId: "session-a",
        profile: "work",
        startedAt: baseTime,
        updatedAt: baseTime + 10,
        events: [
          traceEvent("first-run", "first-event", "First event", baseTime),
        ],
      }),
      traceRun({
        id: "target-run",
        title: "Target scheduled trace",
        sessionId: "session-a",
        profile: "work",
        startedAt: baseTime + 20,
        updatedAt: baseTime + 30,
        events: [
          traceEvent(
            "target-run",
            "target-event",
            "Target event",
            baseTime + 20,
          ),
        ],
      }),
    ]);

    render(<TraceLab mode="run" runId="target-run" />);

    await waitFor(() =>
      expect(window.hermesAPI.listTraceRuns).toHaveBeenCalled(),
    );

    expect(
      await screen.findByRole("heading", { name: "Target event" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Target scheduled trace")).toBeInTheDocument();
    expect(screen.getByLabelText("Trace conversations")).toBeInTheDocument();
  });

  it("falls back to the normal trace selection when the requested run is missing", async () => {
    installHermesApiMock([
      traceRun({
        id: "older-run",
        title: "Older trace",
        updatedAt: baseTime + 10,
        events: [
          traceEvent("older-run", "older-event", "Older event", baseTime),
        ],
      }),
      traceRun({
        id: "newer-run",
        title: "Newer trace",
        updatedAt: baseTime + 20,
        events: [
          traceEvent("newer-run", "newer-event", "Newer event", baseTime + 1),
        ],
      }),
    ]);

    render(<TraceLab mode="run" runId="missing-run" />);

    await waitFor(() =>
      expect(window.hermesAPI.listTraceRuns).toHaveBeenCalled(),
    );

    expect(
      await screen.findByRole("heading", { name: "Newer trace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Newer event" }),
    ).toBeInTheDocument();
  });
});

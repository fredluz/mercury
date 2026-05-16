import { describe, expect, it } from "vitest";
import type { TraceEvent, TraceRun, TraceUsage } from "../../../../shared/traces";
import {
  buildConversationTimeline,
  buildTraceConversations,
  filterTraceConversationsForSessionTarget,
  traceConversationMatchesFilter,
  traceConversationMatchesSearch,
} from "./trace-lab.helpers";

const baseTime = 1_700_000_000_000;

function event(
  runId: string,
  id: string,
  type: TraceEvent["type"],
  timestamp: number,
  overrides: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    id,
    runId,
    type,
    timestamp,
    title: overrides.title || type,
    detail: overrides.detail,
    metadata: overrides.metadata,
  };
}

function usage(totalTokens: number, cost?: number): TraceUsage {
  return {
    promptTokens: Math.floor(totalTokens / 2),
    completionTokens: Math.ceil(totalTokens / 2),
    totalTokens,
    cost,
  };
}

function run(overrides: Partial<TraceRun> & { id: string }): TraceRun {
  const startedAt = overrides.startedAt || baseTime;
  return {
    id: overrides.id,
    title: overrides.title || `Run ${overrides.id}`,
    profile: overrides.profile || "default",
    status: overrides.status || "completed",
    startedAt,
    updatedAt: overrides.updatedAt || startedAt + 10,
    sessionId: overrides.sessionId,
    messagePreview: overrides.messagePreview || `message ${overrides.id}`,
    events:
      overrides.events ||
      [event(overrides.id, `${overrides.id}-started`, "run.started", startedAt)],
    usage: overrides.usage,
  };
}

describe("Trace Lab conversation helpers", () => {
  it("groups runs with the same session id and aggregates status and usage", () => {
    const runs = [
      run({
        id: "run-2",
        title: "Follow up",
        startedAt: baseTime + 100,
        updatedAt: baseTime + 120,
        sessionId: "session-a",
        usage: usage(40, 0.02),
      }),
      run({
        id: "run-1",
        title: "Initial ask",
        startedAt: baseTime,
        updatedAt: baseTime + 20,
        sessionId: "session-a",
        usage: usage(60, 0.03),
      }),
    ];

    const conversations = buildTraceConversations(runs);

    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      key: "session:default:session-a",
      sessionId: "session-a",
      title: "Initial ask",
      runCount: 2,
      status: "completed",
    });
    expect(conversations[0].usage.totalTokens).toBe(100);
    expect(conversations[0].usage.cost).toBeCloseTo(0.05);
    expect(conversations[0].runs.map((item) => item.id)).toEqual(["run-1", "run-2"]);
  });

  it("uses session.resumed metadata to group resumed runs without run.sessionId", () => {
    const completed = run({ id: "completed", sessionId: "session-b", profile: "work" });
    const failedResume = run({
      id: "failed-resume",
      profile: "work",
      status: "failed",
      events: [
        event("failed-resume", "resume", "session.resumed", baseTime + 30, {
          metadata: { sessionId: "session-b" },
        }),
        event("failed-resume", "error", "transport.error", baseTime + 40),
      ],
    });

    const conversations = buildTraceConversations([failedResume, completed]);

    expect(conversations).toHaveLength(1);
    expect(conversations[0].runCount).toBe(2);
    expect(conversations[0].status).toBe("failed");
    expect(conversations[0].hasNeedsAttention).toBe(true);
  });

  it("keeps same session ids in different profiles isolated", () => {
    const conversations = buildTraceConversations([
      run({ id: "default-run", sessionId: "session-shared", profile: "default" }),
      run({ id: "work-run", sessionId: "session-shared", profile: "work" }),
    ]);

    expect(conversations.map((conversation) => conversation.key).sort()).toEqual([
      "session:default:session-shared",
      "session:work:session-shared",
    ]);
    expect(conversations.map((conversation) => conversation.primaryProfile).sort()).toEqual([
      "default",
      "work",
    ]);
  });

  it("keeps no-session runs isolated", () => {
    const conversations = buildTraceConversations([
      run({ id: "local-1" }),
      run({ id: "local-2" }),
    ]);

    expect(conversations.map((conversation) => conversation.key).sort()).toEqual([
      "run:local-1",
      "run:local-2",
    ]);
  });

  it("matches search and filters across nested events and metadata", () => {
    const conversation = buildTraceConversations([
      run({
        id: "skill-run",
        events: [
          event("skill-run", "skill", "skill.eval", baseTime + 1, {
            title: "Skill eval",
            detail: "Reviewed planning skill",
            metadata: { skillName: "planner", verdict: "needs-review" },
          }),
        ],
      }),
    ])[0];

    expect(traceConversationMatchesSearch(conversation, " PLANNER ")).toBe(true);
    expect(traceConversationMatchesSearch(conversation, "")).toBe(true);
    expect(traceConversationMatchesFilter(conversation, "skills")).toBe(true);
    expect(traceConversationMatchesFilter(conversation, "completed")).toBe(true);
  });

  it("filters conversations for session targets using direct ids, resume metadata, and profile", () => {
    const conversations = buildTraceConversations([
      run({ id: "direct-default", sessionId: "session-filter", profile: "default" }),
      run({ id: "direct-work", sessionId: "session-filter", profile: "work" }),
      run({
        id: "resume-work",
        profile: "work",
        events: [
          event("resume-work", "resume", "session.resumed", baseTime + 30, {
            metadata: { sessionId: "session-resumed" },
          }),
        ],
      }),
    ]);

    expect(
      filterTraceConversationsForSessionTarget(conversations, {
        sessionId: "session-filter",
        profile: "work",
      }).map((conversation) => conversation.key),
    ).toEqual(["session:work:session-filter"]);
    expect(
      filterTraceConversationsForSessionTarget(conversations, {
        sessionId: "session-filter",
      }).map((conversation) => conversation.key).sort(),
    ).toEqual(["session:default:session-filter", "session:work:session-filter"]);
    expect(
      filterTraceConversationsForSessionTarget(conversations, {
        sessionId: "session-resumed",
        profile: "work",
      }).map((conversation) => conversation.key),
    ).toEqual(["session:work:session-resumed"]);
  });

  it("builds a merged chronological timeline with parent run context", () => {
    const conversation = buildTraceConversations([
      run({
        id: "run-2",
        sessionId: "session-c",
        startedAt: baseTime + 100,
        events: [event("run-2", "event-2", "run.completed", baseTime + 120)],
      }),
      run({
        id: "run-1",
        sessionId: "session-c",
        startedAt: baseTime,
        events: [
          event("run-1", "event-1", "run.started", baseTime + 1),
          event("run-1", "event-3", "usage.recorded", baseTime + 160),
        ],
      }),
    ])[0];

    const timeline = buildConversationTimeline(conversation);

    expect(timeline.map((item) => item.key)).toEqual([
      "run-1:event-1",
      "run-2:event-2",
      "run-1:event-3",
    ]);
    expect(timeline[1]).toMatchObject({ runIndex: 2, contextLabel: "Run 2 · default · Run run-2" });
  });
});

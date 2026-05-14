import type { TraceEvent, TraceRun, TraceUsage } from "../../../../shared/traces";
import type {
  ConversationTimelineItem,
  Narrative,
  RunFilter,
  TraceConversation,
} from "./trace-lab.types";

export function buildTraceConversations(runs: TraceRun[]): TraceConversation[] {
  const groups = new Map<string, { sessionId?: string; runs: TraceRun[] }>();

  for (const run of runs) {
    const { key, sessionId } = conversationIdentity(run);
    const group = groups.get(key) || { sessionId, runs: [] };
    if (!group.sessionId && sessionId) group.sessionId = sessionId;
    group.runs.push(run);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => buildConversation(key, group.sessionId, group.runs))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function buildConversationTimeline(
  conversation: TraceConversation,
): ConversationTimelineItem[] {
  return conversation.runs
    .flatMap((run, runIndex) =>
      run.events.map((event) => ({
        key: `${run.id}:${event.id}`,
        run,
        runIndex: runIndex + 1,
        event,
        contextLabel: `Run ${runIndex + 1} · ${run.profile} · ${run.title}`,
      })),
    )
    .sort((a, b) => a.event.timestamp - b.event.timestamp);
}

export function traceConversationMatchesSearch(
  conversation: TraceConversation,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  const searchable = [
    conversation.title,
    conversation.profileLabel,
    conversation.status,
    conversation.sessionId || "",
    conversation.messagePreview,
    conversation.latestMessagePreview,
    String(conversation.runCount),
    String(conversation.eventCount),
    String(conversation.usage.totalTokens || ""),
    String(conversation.usage.cost || ""),
    ...conversation.runs.flatMap((run) => [
      run.title,
      run.messagePreview,
      run.profile,
      run.status,
      run.sessionId || "",
      String(run.usage?.totalTokens || ""),
      String(run.usage?.cost || ""),
      ...run.events.flatMap((event) => [
        event.title,
        event.detail || "",
        event.type,
        safeStringify(event.metadata || {}),
      ]),
    ]),
  ]
    .join("\n")
    .toLowerCase();

  return searchable.includes(normalizedQuery);
}

export function traceConversationMatchesFilter(
  conversation: TraceConversation,
  filter: RunFilter,
): boolean {
  if (filter === "completed") return conversation.status === "completed";
  if (filter === "needs-attention") return conversation.hasNeedsAttention;
  if (filter === "skills") return conversation.hasSkillSignals;
  return true;
}

export function traceRunMatchesSearch(run: TraceRun, query: string): boolean {
  return traceConversationMatchesSearch(buildTraceConversations([run])[0], query);
}

export function traceRunMatchesFilter(run: TraceRun, filter: RunFilter): boolean {
  return traceConversationMatchesFilter(buildTraceConversations([run])[0], filter);
}

function buildConversation(
  key: string,
  sessionId: string | undefined,
  runs: TraceRun[],
): TraceConversation {
  const sortedRuns = runs
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt || a.updatedAt - b.updatedAt);
  const firstRun = sortedRuns[0];
  const latestRun = sortedRuns.reduce((latest, run) =>
    run.updatedAt > latest.updatedAt ? run : latest,
  );
  const usage = aggregateUsage(sortedRuns);
  const profileLabel = summarizeProfiles(sortedRuns);

  return {
    key,
    sessionId,
    title: firstRun?.title || (sessionId ? `Session ${shortId(sessionId)}` : "Trace conversation"),
    profileLabel,
    status: aggregateStatus(sortedRuns),
    startedAt: Math.min(...sortedRuns.map((run) => run.startedAt)),
    updatedAt: Math.max(...sortedRuns.map((run) => run.updatedAt)),
    messagePreview: firstRun?.messagePreview || "",
    latestMessagePreview: latestRun?.messagePreview || "",
    runCount: sortedRuns.length,
    eventCount: sortedRuns.reduce((total, run) => total + run.events.length, 0),
    usage,
    runs: sortedRuns,
    hasSkillSignals: sortedRuns.some((run) =>
      run.events.some((event) => event.type.startsWith("skill.")),
    ),
    hasNeedsAttention: sortedRuns.some(runNeedsAttention),
  };
}

function conversationIdentity(run: TraceRun): { key: string; sessionId?: string } {
  const sessionId = firstNonEmptyString(
    run.sessionId,
    sessionIdFromResumeEvent(run),
  );
  if (sessionId) return { key: `session:${sessionId}`, sessionId };
  return { key: `run:${run.id}` };
}

function sessionIdFromResumeEvent(run: TraceRun): string | undefined {
  const resumeEvent = run.events.find((event) => event.type === "session.resumed");
  if (!resumeEvent) return undefined;
  return firstNonEmptyString(resumeEvent.metadata?.sessionId, resumeEvent.detail);
}

function aggregateStatus(runs: TraceRun[]): TraceRun["status"] {
  if (runs.some((run) => run.status === "running")) return "running";
  if (runs.some((run) => run.status === "failed")) return "failed";
  if (runs.some((run) => run.status === "aborted")) return "aborted";
  return "completed";
}

function aggregateUsage(runs: TraceRun[]): TraceUsage {
  let hasCost = false;
  const usage = runs.reduce<TraceUsage>(
    (total, run) => {
      total.promptTokens += run.usage?.promptTokens || 0;
      total.completionTokens += run.usage?.completionTokens || 0;
      total.totalTokens += run.usage?.totalTokens || 0;
      if (run.usage?.cost != null) {
        hasCost = true;
        total.cost = (total.cost || 0) + run.usage.cost;
      }
      return total;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
  if (!hasCost) delete usage.cost;
  return usage;
}

function runNeedsAttention(run: TraceRun): boolean {
  return (
    run.status === "failed" ||
    run.status === "aborted" ||
    run.events.some((event) =>
      ["tool.failed", "delegation.failed", "transport.error"].includes(event.type),
    )
  );
}

function summarizeProfiles(runs: TraceRun[]): string {
  const profiles = Array.from(new Set(runs.map((run) => run.profile).filter(Boolean)));
  if (profiles.length <= 1) return profiles[0] || "default";
  return `${profiles[0]} +${profiles.length - 1}`;
}

function shortId(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function explainEvent(run: TraceRun, event: TraceEvent): Narrative {
  switch (event.type) {
    case "run.started":
      return {
        happened: `Hermes started a new run for "${run.messagePreview || run.title}".`,
        matters:
          "This anchors every later action to one user-visible goal, so the trace can explain the full chain of work.",
      };
    case "message.user":
      return {
        happened: "The user's request was recorded before the agent acted.",
        matters:
          "Keeping the original request next to later actions makes it easier to judge whether the agent stayed on task.",
      };
    case "message.agent.delta":
      return {
        happened:
          event.title === "Agent response completed"
            ? "Hermes finished composing the response shown to the user."
            : "Hermes streamed part of its response.",
        matters:
          "Response events connect the final answer back to the decisions and tool activity that produced it.",
      };
    case "message.history.loaded":
      return {
        happened: "Mercury loaded prior chat history for this request without storing the raw history in the trace.",
        matters:
          "History metadata explains why the answer may depend on earlier turns while keeping previous message content out of the trace store.",
      };
    case "session.resumed":
      return {
        happened: "Hermes resumed an existing session before sending this message.",
        matters:
          "Session resume events prove the run used conversation continuity instead of starting from a blank context.",
      };
    case "slash.local":
      return {
        happened: "Mercury handled this slash command locally and recorded the local response.",
        matters:
          "Local command traces keep renderer-only actions visible in Trace Lab even when they do not call the Hermes backend.",
      };
    case "tool.progress":
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return {
        happened: event.detail || "Hermes reported structured tool activity.",
        matters:
          event.type === "tool.failed"
            ? "Failed tool events identify external-system or permission gaps that may need recovery behavior."
            : "Tool lifecycle events show when the agent touched external systems, files, commands, or project context.",
      };
    case "delegation.started":
    case "delegation.completed":
    case "delegation.failed":
      return {
        happened: event.detail || "Hermes recorded delegated sub-agent work.",
        matters:
          "Delegation events make it clear when another agent contributed evidence or execution to the final answer.",
      };
    case "artifact.created":
      return {
        happened: event.detail || "Hermes attached a generated artifact reference to the trace.",
        matters:
          "Artifact events connect generated files, images, or external outputs to the run that created them.",
      };
    case "approval.requested":
    case "approval.resolved":
      return {
        happened: event.detail || "Hermes recorded an approval checkpoint.",
        matters:
          "Approval events show where user or policy permission affected agent execution.",
      };
    case "transport.error":
      return {
        happened: event.detail || "The chat transport reported an error.",
        matters:
          "Transport errors distinguish model/API/connectivity failures from ordinary agent reasoning or tool failures.",
      };
    case "usage.recorded":
      return {
        happened: "Token and cost usage were attached to the run.",
        matters:
          "Usage data helps compare expensive runs with the quality and learning value they produced.",
      };
    case "run.completed":
      return {
        happened: "Hermes marked the run as completed.",
        matters:
          "Completed runs can be reviewed as examples for skill evaluation, regression checks, and future training notes.",
      };
    case "run.failed":
    case "run.aborted":
      return {
        happened: "Hermes stopped before a successful completion.",
        matters:
          "Failed traces are useful training material because they show where the agent or tools need better recovery behavior.",
      };
    case "skill.used":
    case "skill.eval":
    case "skill.promoted":
    case "skill.rejected":
      return {
        happened: event.detail || "Hermes emitted a skill-learning event.",
        matters:
          "Skill events connect individual runs to the self-improvement loop so users can review what should be reused.",
      };
    default:
      return {
        happened: event.detail || "Hermes recorded this event in the trace.",
        matters:
          "Each event is evidence that helps explain what the agent did, why it did it, and what should improve next time.",
      };
  }
}

export function formatSkillScore(score?: number): string {
  return score == null ? "No score" : `${Math.round(score * 100)}% trust`;
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

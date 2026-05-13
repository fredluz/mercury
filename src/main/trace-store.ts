import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "./installer";
import type {
  SkillTrainingRun,
  TraceEvent,
  TraceEventType,
  TraceRun,
  TraceUsage,
} from "../shared/traces";

const STORE_PATH = join(HERMES_HOME, "desktop-traces.json");
const MAX_RUNS = 200;
const MAX_AGENT_DELTA_EVENTS_PER_RUN = 80;

interface TraceStoreData {
  version: 1;
  runs: TraceRun[];
}

function emptyStore(): TraceStoreData {
  return { version: 1, runs: [] };
}

function readStore(): TraceStoreData {
  try {
    if (!existsSync(STORE_PATH)) return emptyStore();
    const parsed = JSON.parse(
      readFileSync(STORE_PATH, "utf-8"),
    ) as TraceStoreData;
    if (!Array.isArray(parsed.runs)) return emptyStore();
    return { version: 1, runs: parsed.runs };
  } catch {
    return emptyStore();
  }
}

function writeStore(data: TraceStoreData): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const capped = {
    version: 1 as const,
    runs: data.runs
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RUNS),
  };
  writeFileSync(STORE_PATH, JSON.stringify(capped, null, 2), "utf-8");
}

function compactText(value: string, max = 180): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function appendEvent(
  data: TraceStoreData,
  runId: string,
  type: TraceEventType,
  title: string,
  detail?: string,
  metadata?: Record<string, unknown>,
): TraceEvent | null {
  const run = data.runs.find((candidate) => candidate.id === runId);
  if (!run) return null;

  if (
    type === "message.agent.delta" &&
    run.events.filter((event) => event.type === "message.agent.delta").length >=
      MAX_AGENT_DELTA_EVENTS_PER_RUN
  ) {
    run.updatedAt = Date.now();
    return null;
  }

  const event: TraceEvent = {
    id: randomUUID(),
    runId,
    type,
    timestamp: Date.now(),
    title,
    detail,
    metadata,
  };
  run.events.push(event);
  run.updatedAt = event.timestamp;
  return event;
}

export function createTraceRun(message: string, profile?: string): TraceRun {
  const now = Date.now();
  const run: TraceRun = {
    id: randomUUID(),
    title: compactText(message, 72) || "Hermes run",
    profile: profile || "default",
    status: "running",
    startedAt: now,
    updatedAt: now,
    messagePreview: compactText(message),
    events: [],
  };
  const data = readStore();
  data.runs.unshift(run);
  appendEvent(data, run.id, "run.started", "Run started", run.messagePreview, {
    profile: run.profile,
  });
  appendEvent(data, run.id, "message.user", "User message", run.messagePreview);
  writeStore(data);
  return run;
}

export function recordTraceEvent(
  runId: string,
  type: TraceEventType,
  title: string,
  detail?: string,
  metadata?: Record<string, unknown>,
): void {
  const data = readStore();
  appendEvent(data, runId, type, title, detail, metadata);
  writeStore(data);
}

export function recordTraceUsage(runId: string, usage: TraceUsage): void {
  const data = readStore();
  const run = data.runs.find((candidate) => candidate.id === runId);
  if (!run) return;
  run.usage = {
    promptTokens: (run.usage?.promptTokens || 0) + usage.promptTokens,
    completionTokens:
      (run.usage?.completionTokens || 0) + usage.completionTokens,
    totalTokens: (run.usage?.totalTokens || 0) + usage.totalTokens,
    cost:
      usage.cost != null
        ? (run.usage?.cost || 0) + usage.cost
        : run.usage?.cost,
    rateLimitRemaining: usage.rateLimitRemaining,
    rateLimitReset: usage.rateLimitReset,
  };
  appendEvent(data, runId, "usage.recorded", "Usage recorded", undefined, {
    ...usage,
  });
  writeStore(data);
}

export function finishTraceRun(
  runId: string,
  status: Exclude<TraceRun["status"], "running">,
  sessionId?: string,
  detail?: string,
): void {
  const data = readStore();
  const run = data.runs.find((candidate) => candidate.id === runId);
  if (!run) return;
  if (run.status !== "running") return;
  run.status = status;
  if (sessionId) run.sessionId = sessionId;
  const eventType =
    status === "completed"
      ? "run.completed"
      : status === "aborted"
        ? "run.aborted"
        : "run.failed";
  appendEvent(data, runId, eventType, eventTitle(eventType), detail, {
    sessionId,
  });
  writeStore(data);
}

export function listTraceRuns(): TraceRun[] {
  return readStore().runs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getTraceRun(runId: string): TraceRun | null {
  return readStore().runs.find((run) => run.id === runId) || null;
}

export function listSkillTrainingRuns(): SkillTrainingRun[] {
  return listTraceRuns()
    .flatMap((run) =>
      run.events
        .filter((event) => event.type.startsWith("skill."))
        .map((event) => ({
          id: event.id,
          skillName: String(
            event.metadata?.skillName || event.title || "Unknown skill",
          ),
          status: skillStatusFromEvent(event.type, event.metadata),
          score: skillScoreFromEvent(event.metadata?.score),
          linkedRunId: run.id,
          summary: event.detail || run.title,
          updatedAt: event.timestamp,
        })),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function eventTitle(type: TraceEventType): string {
  switch (type) {
    case "run.completed":
      return "Run completed";
    case "run.aborted":
      return "Run aborted";
    case "run.failed":
      return "Run failed";
    default:
      return type;
  }
}

function skillStatusFromEvent(
  type: TraceEventType,
  metadata?: Record<string, unknown>,
): SkillTrainingRun["status"] {
  const status = String(metadata?.status || metadata?.reviewStatus || "");
  if (status === "needs-review") return "needs-review";
  if (type === "skill.promoted") return "promoted";
  if (type === "skill.rejected") return "rejected";
  if (type === "skill.eval") return "evaluating";
  return "candidate";
}

function skillScoreFromEvent(score: unknown): number | undefined {
  const numericScore = typeof score === "number" ? score : Number(score);
  if (!Number.isFinite(numericScore)) return undefined;
  return Math.max(0, Math.min(1, numericScore));
}

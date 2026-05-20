import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "./installer";
import { profileHome } from "./utils";
import { isPerfTelemetryEnabled, withPerfSpanSync } from "./perf/telemetry";
import type {
  LocalChatTraceRequest,
  SkillTrainingRun,
  TraceEvent,
  TraceEventType,
  TraceRun,
  TraceScheduleRunSummary,
  TraceUsage,
} from "../shared/traces";

const STORE_PATH = join(HERMES_HOME, "desktop-traces.json");
const MAX_RUNS = 200;
const MAX_AGENT_DELTA_EVENTS_PER_RUN = 80;
const SECRET_KEY_RE =
  /api[_-]?key|token|authorization|secret|password|credential/i;
const SECRET_TEXT_RE =
  /(api[_-]?key|token|authorization|secret|password|credential)(\s*[:=]\s*)([^\s,;]+)/gi;
const MAX_METADATA_STRING_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 2000;

interface TraceStoreData {
  version: 1;
  runs: TraceRun[];
}

interface TraceRunScheduleOptions {
  scheduleId?: string;
  scheduleName?: string;
  schedulePrompt?: string;
}

interface NormalizedScheduleProvenance {
  scheduleId: string;
  scheduleName?: string;
  schedulePrompt?: string;
}

interface CronOutputRecord {
  jobId: string;
  filePath: string;
  fileName: string;
  profile: string;
  job?: Record<string, unknown>;
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
  const telemetryMeta: Record<string, unknown> | undefined =
    isPerfTelemetryEnabled("trace-store") ? {} : undefined;
  withPerfSpanSync("trace-store", "writeStore", telemetryMeta, () => {
    const capped = {
      version: 1 as const,
      runs: data.runs
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_RUNS),
    };
    const serialized = JSON.stringify(capped, null, 2);
    if (telemetryMeta) {
      Object.assign(telemetryMeta, {
        runCount: capped.runs.length,
        eventCount: countEvents(capped.runs),
        serializedBytes: Buffer.byteLength(serialized, "utf8"),
      });
    }
    mkdirSync(dirname(STORE_PATH), { recursive: true });
    writeFileSync(STORE_PATH, serialized, "utf-8");
  });
}

function readCronJobs(profile?: string): Map<string, Record<string, unknown>> {
  const jobsPath = join(profileHome(profile), "cron", "jobs.json");
  try {
    if (!existsSync(jobsPath)) return new Map();
    const parsed = JSON.parse(readFileSync(jobsPath, "utf-8")) as {
      jobs?: unknown;
    };
    if (!Array.isArray(parsed.jobs)) return new Map();
    return new Map(
      parsed.jobs
        .filter(
          (job): job is Record<string, unknown> =>
            Boolean(job) && typeof job === "object" && "id" in job,
        )
        .map((job) => [String(job.id), job]),
    );
  } catch {
    return new Map();
  }
}

function profileNamesForCronSync(profile?: string): (string | undefined)[] {
  if (profile?.trim()) return [profile];
  const names: (string | undefined)[] = [undefined];
  const profilesDir = join(HERMES_HOME, "profiles");
  try {
    if (!existsSync(profilesDir)) return names;
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) names.push(entry.name);
    }
  } catch {
    return names;
  }
  return names;
}

function listCronOutputRecords(profile?: string): CronOutputRecord[] {
  const records: CronOutputRecord[] = [];
  for (const profileName of profileNamesForCronSync(profile)) {
    const home = profileHome(profileName);
    const outputDir = join(home, "cron", "output");
    if (!existsSync(outputDir)) continue;
    const jobsById = readCronJobs(profileName);
    try {
      for (const jobEntry of readdirSync(outputDir, { withFileTypes: true })) {
        if (!jobEntry.isDirectory()) continue;
        const jobId = jobEntry.name;
        const jobOutputDir = join(outputDir, jobId);
        for (const outputEntry of readdirSync(jobOutputDir, {
          withFileTypes: true,
        })) {
          if (!outputEntry.isFile() || !outputEntry.name.endsWith(".md")) {
            continue;
          }
          records.push({
            jobId,
            fileName: outputEntry.name,
            filePath: join(jobOutputDir, outputEntry.name),
            profile: profileName || "default",
            job: jobsById.get(jobId),
          });
        }
      }
    } catch {
      continue;
    }
  }
  return records;
}

function safeTraceIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function cronTraceId(record: CronOutputRecord): string {
  return `cron-${safeTraceIdPart(record.jobId)}-${safeTraceIdPart(basename(record.fileName, ".md"))}`;
}

function markdownField(markdown: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(`^\\*\\*${escaped}:\\*\\*\\s*(.+)$`, "m"),
  );
  return cleanOptionalText(match?.[1], MAX_DETAIL_LENGTH);
}

function markdownHeading(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+Cron Job:\s+(.+?)\s*$/m);
  return cleanOptionalText(match?.[1]?.replace(/\s+\(FAILED\)\s*$/, ""));
}

function markdownSection(markdown: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(
    new RegExp(
      `(?:^|\\n)##\\s+${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s+|$)`,
    ),
  );
  return cleanOptionalText(match?.[1], MAX_DETAIL_LENGTH);
}

function timestampFromCronOutput(record: CronOutputRecord, markdown: string): number {
  const fromMarkdown = markdownField(markdown, "Run Time");
  if (fromMarkdown) {
    const parsed = Date.parse(fromMarkdown.replace(" ", "T"));
    if (Number.isFinite(parsed)) return parsed;
  }

  const fromFile = basename(record.fileName, ".md").replace("_", "T");
  const parsed = Date.parse(fromFile);
  if (Number.isFinite(parsed)) return parsed;

  try {
    return statSync(record.filePath).mtimeMs;
  } catch {
    return Date.now();
  }
}

function cronOutputToTraceRun(record: CronOutputRecord): TraceRun | null {
  let markdown = "";
  try {
    markdown = readFileSync(record.filePath, "utf-8");
  } catch {
    return null;
  }

  const startedAt = timestampFromCronOutput(record, markdown);
  const updatedAt = (() => {
    try {
      return Math.max(startedAt, statSync(record.filePath).mtimeMs);
    } catch {
      return startedAt;
    }
  })();
  const response = markdownSection(markdown, "Response");
  const error = markdownSection(markdown, "Error");
  const status: TraceRun["status"] =
    error || /\(FAILED\)/.test(markdownHeading(markdown) || "")
      ? "failed"
      : "completed";
  const jobName = cleanOptionalText(record.job?.name) || markdownHeading(markdown);
  const prompt =
    cleanOptionalText(record.job?.prompt, MAX_DETAIL_LENGTH) ||
    markdownSection(markdown, "Prompt");
  const runId = cronTraceId(record);
  const scheduleName = jobName || record.jobId;
  const events: TraceEvent[] = [
    {
      id: randomUUID(),
      runId,
      type: "run.started",
      timestamp: startedAt,
      title: "Scheduled run started",
      detail: prompt,
      metadata: sanitizeMetadata({
        scheduleId: record.jobId,
        scheduleName,
        outputFile: record.filePath,
      }),
    },
  ];

  if (prompt) {
    events.push({
      id: randomUUID(),
      runId,
      type: "message.user",
      timestamp: startedAt,
      title: "Scheduled prompt",
      detail: prompt,
    });
  }

  if (response) {
    events.push({
      id: randomUUID(),
      runId,
      type: "message.agent.delta",
      timestamp: updatedAt,
      title: "Scheduled response",
      detail: response,
    });
  }

  events.push({
    id: randomUUID(),
    runId,
    type: status === "completed" ? "run.completed" : "run.failed",
    timestamp: updatedAt,
    title: status === "completed" ? "Run completed" : "Run failed",
    detail: status === "completed" ? response : error,
    metadata: sanitizeMetadata({
      scheduleId: record.jobId,
      scheduleName,
      outputFile: record.filePath,
    }),
  });

  return {
    id: runId,
    title: compactText(scheduleName, 72) || "Scheduled run",
    profile: record.profile,
    status,
    startedAt,
    updatedAt,
    scheduleId: record.jobId,
    scheduleName,
    schedulePrompt: prompt,
    messagePreview: compactText(prompt || scheduleName),
    events,
  };
}

function syncCronOutputTraceRuns(profile?: string): void {
  const records = listCronOutputRecords(profile);
  if (!records.length) return;
  const data = readStore();
  const existingById = new Map(data.runs.map((run, index) => [run.id, { run, index }]));
  let changed = false;

  for (const record of records) {
    const id = cronTraceId(record);
    const run = cronOutputToTraceRun(record);
    if (!run) continue;
    const existing = existingById.get(id);
    if (existing) {
      const previousDetail = terminalDetail(existing.run);
      const nextDetail = terminalDetail(run);
      if (previousDetail !== nextDetail || existing.run.status !== run.status) {
        data.runs[existing.index] = run;
        changed = true;
      }
      continue;
    }
    data.runs.push(run);
    existingById.set(id, { run, index: data.runs.length - 1 });
    changed = true;
  }

  if (changed) writeStore(data);
}

function terminalDetail(run: TraceRun): string {
  return (
    [...run.events]
      .reverse()
      .find((event) => event.type === "run.completed" || event.type === "run.failed")
      ?.detail || ""
  );
}

function countEvents(runs: TraceRun[]): number {
  return runs.reduce((total, run) => total + run.events.length, 0);
}

function compactText(value: string, max = 180): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function oneLineText(value: string, max = 180): string {
  return compactText(value, max);
}

function sanitizeText(value: string, max = MAX_DETAIL_LENGTH): string {
  return compactText(value.replace(SECRET_TEXT_RE, "$1$2[redacted]"), max);
}

function sanitizeMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY_RE.test(key)) continue;
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (
    value == null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeText(value, MAX_METADATA_STRING_LENGTH);
  }
  if (Array.isArray(value)) {
    return compactText(
      JSON.stringify(value.map((item) => sanitizeValue(item))),
      MAX_METADATA_STRING_LENGTH,
    );
  }
  if (typeof value === "object") {
    return compactText(
      JSON.stringify(sanitizeMetadata(value as Record<string, unknown>) || {}),
      MAX_METADATA_STRING_LENGTH,
    );
  }
  return compactText(String(value), MAX_METADATA_STRING_LENGTH);
}

function cleanOptionalText(value: unknown, max = 180): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = compactText(String(value), max);
  return text || undefined;
}

function normalizeScheduleOptions(
  options?: TraceRunScheduleOptions,
): NormalizedScheduleProvenance | null {
  const scheduleId = cleanOptionalText(options?.scheduleId);
  if (!scheduleId) return null;
  return {
    scheduleId,
    scheduleName: cleanOptionalText(options?.scheduleName),
    schedulePrompt: cleanOptionalText(
      options?.schedulePrompt,
      MAX_DETAIL_LENGTH,
    ),
  };
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
    title: sanitizeText(title, 180),
    detail: detail ? sanitizeText(detail) : undefined,
    metadata: sanitizeMetadata(metadata),
  };
  run.events.push(event);
  run.updatedAt = event.timestamp;
  return event;
}

export function createTraceRun(
  message: string,
  profile?: string,
  schedule?: TraceRunScheduleOptions,
): TraceRun {
  return withPerfSpanSync(
    "trace-store",
    "createTraceRun",
    {
      messageLength: message.length,
      hasProfile: Boolean(profile?.trim()),
      hasSchedule: Boolean(schedule?.scheduleId?.trim()),
    },
    () => {
      const now = Date.now();
      const scheduleProvenance = normalizeScheduleOptions(schedule);
      const run: TraceRun = {
        id: randomUUID(),
        title: compactText(message, 72) || "Hermes run",
        profile: profile || "default",
        status: "running",
        startedAt: now,
        updatedAt: now,
        scheduleId: scheduleProvenance?.scheduleId,
        scheduleName: scheduleProvenance?.scheduleName,
        schedulePrompt: scheduleProvenance?.schedulePrompt,
        messagePreview: compactText(message),
        events: [],
      };
      const data = readStore();
      data.runs.unshift(run);
      appendEvent(
        data,
        run.id,
        "run.started",
        "Run started",
        run.messagePreview,
        {
          profile: run.profile,
          scheduleId: run.scheduleId,
          scheduleName: run.scheduleName,
        },
      );
      appendEvent(
        data,
        run.id,
        "message.user",
        "User message",
        run.messagePreview,
      );
      writeStore(data);
      return run;
    },
  );
}

export function recordTraceEvent(
  runId: string,
  type: TraceEventType,
  title: string,
  detail?: string,
  metadata?: Record<string, unknown>,
): TraceEvent | null {
  return withPerfSpanSync(
    "trace-store",
    "recordTraceEvent",
    {
      type,
      titleLength: title.length,
      detailLength: detail?.length || 0,
      hasMetadata: Boolean(metadata),
    },
    () => {
      const data = readStore();
      const event = appendEvent(data, runId, type, title, detail, metadata);
      writeStore(data);
      return event;
    },
  );
}

export function createLocalChatTrace(request: LocalChatTraceRequest): TraceRun {
  if (!request || typeof request.command !== "string") {
    throw new Error("Local chat trace requires a command string.");
  }
  const command = compactText(request.command, MAX_DETAIL_LENGTH);
  const run = createTraceRun(command || "Local command", request.profile);
  recordTraceEvent(run.id, "slash.local", "Local command", command, {
    ...(request.metadata || {}),
    command,
  });
  if (request.responsePreview?.trim()) {
    recordTraceEvent(
      run.id,
      "message.agent.delta",
      "Local response",
      compactText(request.responsePreview, 320),
    );
  }
  finishTraceRun(run.id, "completed", undefined, "Handled locally in Mercury.");
  return getTraceRun(run.id) || run;
}

export function recordTraceUsage(runId: string, usage: TraceUsage): void {
  withPerfSpanSync(
    "trace-store",
    "recordTraceUsage",
    {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    },
    () => {
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
    },
  );
}

export function finishTraceRun(
  runId: string,
  status: Exclude<TraceRun["status"], "running">,
  sessionId?: string,
  detail?: string,
): void {
  withPerfSpanSync(
    "trace-store",
    "finishTraceRun",
    {
      status,
      hasSessionId: Boolean(sessionId),
      detailLength: detail?.length || 0,
    },
    () => {
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
    },
  );
}

export function listTraceRuns(): TraceRun[] {
  return withPerfSpanSync("trace-store", "listTraceRuns", undefined, () =>
    {
      syncCronOutputTraceRuns();
      return readStore().runs.sort((a, b) => b.updatedAt - a.updatedAt);
    },
  );
}

export function getTraceRun(runId: string): TraceRun | null {
  syncCronOutputTraceRuns();
  return readStore().runs.find((run) => run.id === runId) || null;
}

export function listTraceRunsForSchedule(
  scheduleId: string,
  profile?: string,
): TraceScheduleRunSummary[] {
  return withPerfSpanSync(
    "trace-store",
    "listTraceRunsForSchedule",
    { hasProfile: Boolean(profile?.trim()) },
    () => {
      const targetScheduleId = cleanOptionalText(scheduleId);
      if (!targetScheduleId) return [];
      syncCronOutputTraceRuns(profile);
      return listTraceRuns()
        .filter((run) => profileMatches(run, profile))
        .map((run) => summarizeScheduledRun(run))
        .filter(
          (summary): summary is TraceScheduleRunSummary =>
            summary !== null && summary.scheduleId === targetScheduleId,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
  );
}

export function listCompletedScheduledRunsSince(
  timestamp: number,
  profile?: string,
): TraceScheduleRunSummary[] {
  return withPerfSpanSync(
    "trace-store",
    "listCompletedScheduledRunsSince",
    { timestamp, hasProfile: Boolean(profile?.trim()) },
    () => {
      const since = Number.isFinite(timestamp) ? timestamp : 0;
      syncCronOutputTraceRuns(profile);
      return listTraceRuns()
        .filter((run) => run.status !== "running")
        .filter((run) => profileMatches(run, profile))
        .map((run) => summarizeScheduledRun(run))
        .filter(
          (summary): summary is TraceScheduleRunSummary =>
            summary !== null &&
            (summary.completedAt ?? summary.updatedAt) > since,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },
  );
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

function profileMatches(run: TraceRun, profile?: string): boolean {
  const requestedProfile = profile?.trim();
  return !requestedProfile || run.profile === requestedProfile;
}

function summarizeScheduledRun(run: TraceRun): TraceScheduleRunSummary | null {
  const provenance = scheduleProvenanceFromRun(run);
  if (!provenance) return null;
  const completedAt = completedAtFromRun(run);
  const endAt = completedAt ?? run.updatedAt;
  const error = errorFromRun(run);
  return {
    traceRunId: run.id,
    scheduleId: provenance.scheduleId,
    scheduleName: provenance.scheduleName || provenance.scheduleId,
    profile: run.profile,
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    completedAt,
    durationMs: Math.max(0, endAt - run.startedAt),
    summary: summaryFromRun(run, provenance, error),
    error,
  };
}

function scheduleProvenanceFromRun(
  run: TraceRun,
): NormalizedScheduleProvenance | null {
  const explicit = normalizeScheduleOptions({
    scheduleId: run.scheduleId,
    scheduleName: run.scheduleName,
    schedulePrompt: run.schedulePrompt,
  });
  if (explicit) return explicit;

  for (const event of run.events) {
    const metadata = metadataRecord(event.metadata);
    if (!metadata) continue;
    const scheduleId =
      metadataText(metadata, [
        "scheduleId",
        "schedule_id",
        "cronJobId",
        "cron_job_id",
        "jobId",
        "job_id",
      ]) ?? nestedMetadataText(metadata, ["id", "scheduleId", "schedule_id"]);
    if (!scheduleId) continue;
    return {
      scheduleId,
      scheduleName: metadataText(metadata, [
        "scheduleName",
        "schedule_name",
        "cronJobName",
        "cron_job_name",
        "jobName",
        "job_name",
        "name",
      ]),
      schedulePrompt: metadataText(
        metadata,
        [
          "schedulePrompt",
          "schedule_prompt",
          "jobPrompt",
          "job_prompt",
          "prompt",
        ],
        MAX_DETAIL_LENGTH,
      ),
    };
  }

  return null;
}

function metadataText(
  metadata: Record<string, unknown>,
  keys: string[],
  max = 180,
): string | undefined {
  for (const key of keys) {
    const value = cleanOptionalText(metadata[key], max);
    if (value) return value;
  }

  for (const nestedKey of ["schedule", "cronJob", "cron", "job"]) {
    const nested = metadataRecord(metadata[nestedKey]);
    if (!nested) continue;
    for (const key of keys) {
      const value = cleanOptionalText(nested[key], max);
      if (value) return value;
    }
  }

  return undefined;
}

function nestedMetadataText(
  metadata: Record<string, unknown>,
  keys: string[],
  max = 180,
): string | undefined {
  for (const nestedKey of ["schedule", "cronJob", "cron", "job"]) {
    const nested = metadataRecord(metadata[nestedKey]);
    if (!nested) continue;
    for (const key of keys) {
      const value = cleanOptionalText(nested[key], max);
      if (value) return value;
    }
  }
  return undefined;
}

function metadataRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim().startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function completedAtFromRun(run: TraceRun): number | undefined {
  const terminalEvent = [...run.events]
    .reverse()
    .find(
      (event) =>
        event.type === "run.completed" ||
        event.type === "run.failed" ||
        event.type === "run.aborted",
    );
  return terminalEvent?.timestamp;
}

function errorFromRun(run: TraceRun): string | undefined {
  if (run.status !== "failed" && run.status !== "aborted") return undefined;
  const errorEvent = [...run.events]
    .reverse()
    .find(
      (event) =>
        event.type === "run.failed" ||
        event.type === "run.aborted" ||
        event.type === "transport.error" ||
        event.type === "tool.failed" ||
        event.type === "delegation.failed",
    );
  const metadata = metadataRecord(errorEvent?.metadata);
  return (
    cleanOptionalText(errorEvent?.detail, 320) ||
    (metadata
      ? metadataText(metadata, ["error", "message", "reason"], 320)
      : undefined) ||
    (run.status === "aborted" ? "Run aborted" : "Run failed")
  );
}

function summaryFromRun(
  run: TraceRun,
  provenance: NormalizedScheduleProvenance,
  error?: string,
): string {
  if (error) return oneLineText(error, 160);

  const response = run.events.find(
    (event) => event.type === "message.agent.delta" && event.detail?.trim(),
  );
  if (response?.detail) return oneLineText(response.detail, 160);

  const completed = [...run.events]
    .reverse()
    .find((event) => event.type === "run.completed" && event.detail?.trim());
  if (completed?.detail) return oneLineText(completed.detail, 160);

  return oneLineText(
    provenance.schedulePrompt ||
      run.messagePreview ||
      run.title ||
      provenance.scheduleName ||
      "Scheduled run",
    160,
  );
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

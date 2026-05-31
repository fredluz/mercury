import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { HERMES_HOME, HERMES_PYTHON, HERMES_SCRIPT } from "./installer";
import { profileHome } from "./utils";
import { isRemoteMode } from "./hermes";
import {
  buildHermesProfileCommandArgs,
  profileRuntimeManager,
} from "./hermes/runtime";
import {
  HermesBffError,
  profileHermesBffClientForRuntime,
  type HermesJobsBffClient,
} from "./hermes/bff";
import type {
  CronJob,
  CronMutationResult,
  ScheduleCreatePayload,
  ScheduleKind,
  ScheduleRepeat,
  ScheduleTiming,
  ScheduleUpdatePayload,
} from "../shared/schedules";

type RawJob = Record<string, unknown>;
type JobsShape = {
  jobs: RawJob[];
  write: (jobs: RawJob[]) => unknown;
};

function jobsFilePath(profile?: string): string {
  return join(profileHome(profile), "cron", "jobs.json");
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value) return [value];
  return fallback;
}

function normalizeRepeat(value: unknown): ScheduleRepeat | null {
  if (!value || typeof value !== "object") return null;
  const repeat = value as Record<string, unknown>;
  const times = typeof repeat.times === "number" ? repeat.times : null;
  const completed = typeof repeat.completed === "number" ? repeat.completed : 0;
  return { times, completed };
}

function scheduleValue(schedule: unknown): string {
  if (typeof schedule === "string") return schedule;
  if (schedule && typeof schedule === "object") {
    const record = schedule as Record<string, unknown>;
    if (typeof record.display === "string") return record.display;
    if (typeof record.value === "string") return record.value;
    if (typeof record.cron === "string") return record.cron;
    if (typeof record.cronExpression === "string") return record.cronExpression;
    if (typeof record.expr === "string") return record.expr;
    if (typeof record.run_at === "string") return record.run_at;
    if (record.kind === "interval" && typeof record.minutes === "number") {
      return `every ${record.minutes}m`;
    }
  }
  return "?";
}

function parseableScheduleValue(schedule: unknown): string {
  if (typeof schedule === "string") return schedule;
  if (schedule && typeof schedule === "object") {
    const record = schedule as Record<string, unknown>;
    if (record.kind === "once" && typeof record.run_at === "string") {
      return record.run_at;
    }
    if (record.kind === "interval" && typeof record.minutes === "number") {
      return `every ${record.minutes}m`;
    }
    if (record.kind === "cron" && typeof record.expr === "string") {
      return record.expr;
    }
    if (typeof record.expr === "string") return record.expr;
    if (typeof record.cron === "string") return record.cron;
    if (typeof record.cronExpression === "string") return record.cronExpression;
    if (typeof record.run_at === "string") return record.run_at;
    if (typeof record.value === "string") return record.value;
    if (typeof record.display === "string") return record.display;
  }
  return "?";
}

function normalizeJob(job: RawJob): CronJob | null {
  if (!job.id) return null;
  const enabled = job.enabled !== false;
  let state: CronJob["state"] = "active";
  if (job.state === "completed") state = "completed";
  else if (job.state === "paused" || !enabled) state = "paused";
  return {
    ...job,
    id: String(job.id),
    name: (job.name as string) || "(unnamed)",
    schedule: (job.schedule_display as string) || scheduleValue(job.schedule),
    prompt: (job.prompt as string) || "",
    state,
    enabled,
    next_run_at: (job.next_run_at as string) || null,
    last_run_at: (job.last_run_at as string) || null,
    last_status: (job.last_status as string) || null,
    last_error: (job.last_error as string) || null,
    repeat: normalizeRepeat(job.repeat),
    deliver: asStringArray(job.deliver, ["local"]),
    skills: asStringArray(job.skills, asStringArray(job.skill)),
    script: (job.script as string) || null,
    schedule_type:
      (job.schedule_type as ScheduleKind | undefined) ||
      ((job.timing as ScheduleTiming | undefined)?.kind as
        | ScheduleKind
        | undefined),
    source_session_id:
      (job.source_session_id as string | undefined) ||
      (job.sourceSessionId as string | undefined),
    source_trace_id:
      (job.source_trace_id as string | undefined) ||
      (job.sourceTraceId as string | undefined),
  };
}

async function resolveCronJobsClient(
  profile?: string,
): Promise<HermesJobsBffClient> {
  const requestedProfile = profileRuntimeManager.normalizeProfile(profile);
  const runtime = await profileRuntimeManager.resolveRuntime({
    profile: requestedProfile,
    purpose: "cron",
    preferTransport: "api",
  });
  return profileHermesBffClientForRuntime(runtime, requestedProfile, "cron").jobs;
}

function remoteCronErrorMessage(error: unknown): string {
  if (error instanceof HermesBffError && error.responsePreview) {
    try {
      const body = JSON.parse(error.responsePreview) as {
        error?: unknown;
        message?: unknown;
      };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
      if (typeof body.message === "string" && body.message.trim()) return body.message;
    } catch {
      // Use the structured BFF message below when the preview is not JSON.
    }
  }
  return error instanceof Error ? error.message : "Remote cron operation failed";
}

async function readJobsShape(profile?: string): Promise<JobsShape> {
  const filePath = jobsFilePath(profile);
  if (!existsSync(filePath)) {
    return {
      jobs: [],
      write: (jobs) => ({ jobs }),
    };
  }

  const content = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(content) as unknown;
  if (Array.isArray(parsed)) {
    return {
      jobs: parsed.filter(
        (job): job is RawJob => !!job && typeof job === "object",
      ),
      write: (jobs) => jobs,
    };
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const jobs = Array.isArray(record.jobs)
      ? record.jobs.filter(
          (job): job is RawJob => !!job && typeof job === "object",
        )
      : [];
    return {
      jobs,
      write: (nextJobs) => ({ ...record, jobs: nextJobs }),
    };
  }
  return {
    jobs: [],
    write: (jobs) => ({ jobs }),
  };
}

async function writeJobsShape(
  shape: JobsShape,
  jobs: RawJob[],
  profile?: string,
): Promise<void> {
  const filePath = jobsFilePath(profile);
  const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(
    tmpPath,
    `${JSON.stringify(shape.write(jobs), null, 2)}\n`,
    "utf-8",
  );
  await rename(tmpPath, filePath);
}

/**
 * Read cron jobs from the jobs.json file (async to avoid blocking the main process).
 * In remote mode, fetches from the Hermes API server's /api/jobs endpoint instead.
 */
export async function listCronJobs(
  includeDisabled = true,
  profile?: string,
): Promise<CronJob[]> {
  if (isRemoteMode()) {
    try {
      const jobsClient = await resolveCronJobsClient(profile);
      const raw = await jobsClient.list(includeDisabled);
      const jobs: CronJob[] = [];
      for (const job of raw) {
        const normalized = normalizeJob(job);
        if (!normalized) continue;
        if (!includeDisabled && !normalized.enabled) continue;
        jobs.push(normalized);
      }
      return jobs;
    } catch (err) {
      console.error("[CRON] remote list error:", err);
      return [];
    }
  }

  try {
    const { jobs: raw } = await readJobsShape(profile);
    const jobs: CronJob[] = [];

    for (const job of raw) {
      const normalized = normalizeJob(job);
      if (!normalized) continue;
      if (!includeDisabled && !normalized.enabled) continue;
      jobs.push(normalized);
    }

    return jobs;
  } catch (err) {
    console.error("[CRON] Failed to read jobs file:", err);
    return [];
  }
}

/**
 * Run a hermes cron CLI command and return the result.
 */
function runCronCommand(
  args: string[],
  profile?: string,
): Promise<{ success: boolean; output: string; error?: string }> {
  const cliArgs = buildHermesProfileCommandArgs(HERMES_SCRIPT, profile, [
    "cron",
    ...args,
  ]);

  return new Promise((resolve) => {
    execFile(
      HERMES_PYTHON,
      cliArgs,
      { cwd: join(HERMES_HOME, "hermes-agent"), timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            success: false,
            output: stdout || "",
            error: stderr || err.message,
          });
        } else {
          resolve({ success: true, output: stdout || "" });
        }
      },
    );
  });
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function normalizeTiming(
  payload: ScheduleCreatePayload | ScheduleUpdatePayload,
): ScheduleTiming {
  if (payload.timing) return payload.timing;
  if (payload.schedule && typeof payload.schedule === "object") {
    return payload.schedule;
  }
  return {
    kind: payload.kind || "custom",
    cron: typeof payload.schedule === "string" ? payload.schedule : undefined,
  };
}

function parseTime(value: string | undefined): {
  hour: number;
  minute: number;
} {
  const match = value?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { hour: 9, minute: 0 };
  return {
    hour: Math.max(0, Math.min(23, Number(match[1]))),
    minute: Math.max(0, Math.min(59, Number(match[2]))),
  };
}

function timingToCron(timing: ScheduleTiming): string {
  if (timing.cron) return timing.cron;
  const cronExpression = firstString(timing.cronExpression);
  if (cronExpression) return cronExpression;

  if (timing.kind === "once" && timing.at) {
    const at = new Date(timing.at);
    if (!Number.isNaN(at.getTime())) {
      return `${at.getMinutes()} ${at.getHours()} ${at.getDate()} ${
        at.getMonth() + 1
      } *`;
    }
  }

  const { hour, minute } = parseTime(timing.time);
  if (timing.kind === "interval") {
    const every = Math.max(1, Number(timing.every) || 1);
    if (timing.unit === "hours") return `${minute} */${every} * * *`;
    if (timing.unit === "days") return `${minute} ${hour} */${every} * *`;
    return `*/${every} * * * *`;
  }
  if (timing.kind === "daily") return `${minute} ${hour} * * *`;
  if (timing.kind === "weekly") {
    const days =
      Array.isArray(timing.daysOfWeek) && timing.daysOfWeek.length
        ? timing.daysOfWeek.join(",")
        : "1";
    return `${minute} ${hour} * * ${days}`;
  }
  if (timing.kind === "monthly") {
    const day = Math.max(1, Math.min(31, Number(timing.dayOfMonth) || 1));
    return `${minute} ${hour} ${day} * *`;
  }
  return "* * * * *";
}

function timingToScheduleDisplay(timing: ScheduleTiming): string {
  if (timing.kind === "once" && timing.at) return timing.at;
  if (timing.kind === "interval") {
    const every = Math.max(1, Number(timing.every) || 1);
    const unit = timing.unit || "minutes";
    if (unit === "hours") return `every ${every}h`;
    if (unit === "days") return `every ${every}d`;
    return `every ${every}m`;
  }
  return timingToCron(timing);
}

function intervalMinutes(timing: ScheduleTiming): number {
  const every = Math.max(1, Number(timing.every) || 1);
  if (timing.unit === "hours") return every * 60;
  if (timing.unit === "days") return every * 24 * 60;
  return every;
}

function timingToHermesSchedule(timing: ScheduleTiming): RawJob {
  if (timing.kind === "once") {
    return compactJob({
      kind: "once",
      run_at: timing.at,
      display: timing.at
        ? `once at ${timing.at}`
        : timingToScheduleDisplay(timing),
    });
  }
  if (timing.kind === "interval") {
    const minutes = intervalMinutes(timing);
    return {
      kind: "interval",
      minutes,
      display: `every ${minutes}m`,
    };
  }
  const expr = timingToCron(timing);
  return {
    kind: "cron",
    expr,
    display: expr,
  };
}

function hasHermesScheduleShape(schedule: Record<string, unknown>): boolean {
  return (
    (schedule.kind === "once" && typeof schedule.run_at === "string") ||
    (schedule.kind === "interval" && typeof schedule.minutes === "number") ||
    (schedule.kind === "cron" && typeof schedule.expr === "string")
  );
}

function payloadScheduleToHermesSchedule(
  payload: ScheduleCreatePayload | ScheduleUpdatePayload,
  timing: ScheduleTiming,
): RawJob {
  if (
    payload.schedule &&
    typeof payload.schedule === "object" &&
    hasHermesScheduleShape(payload.schedule as Record<string, unknown>)
  ) {
    return payload.schedule as RawJob;
  }
  return timingToHermesSchedule(timing);
}

function nextRunAtFromTiming(timing: ScheduleTiming): string | null {
  if (timing.kind === "once" && timing.at) {
    const at = new Date(timing.at);
    return Number.isNaN(at.getTime()) ? null : at.toISOString();
  }
  if (timing.kind === "interval") {
    return new Date(
      Date.now() + intervalMinutes(timing) * 60_000,
    ).toISOString();
  }
  return null;
}

function payloadToRemoteJob(
  payload: ScheduleCreatePayload | ScheduleUpdatePayload,
  existing?: RawJob,
): RawJob {
  const local = payloadToJob(payload, existing);
  if (local.schedule && typeof local.schedule === "object") {
    return {
      ...local,
      schedule: parseableScheduleValue(local.schedule),
    };
  }
  return local;
}

function compactJob(job: RawJob): RawJob {
  return Object.fromEntries(
    Object.entries(job).filter(([, value]) => value !== undefined),
  );
}

function payloadToJob(
  payload: ScheduleCreatePayload | ScheduleUpdatePayload,
  existing?: RawJob,
): RawJob {
  const hasTimingChange =
    !existing ||
    payload.schedule !== undefined ||
    payload.timing !== undefined ||
    payload.kind !== undefined;
  const timing = hasTimingChange ? normalizeTiming(payload) : undefined;
  const kind = payload.kind || timing?.kind;
  const schedule = !hasTimingChange
    ? undefined
    : timing
      ? payloadScheduleToHermesSchedule(payload, timing)
      : typeof payload.schedule === "string"
        ? { kind: "cron", expr: payload.schedule, display: payload.schedule }
        : undefined;
  const scheduleDisplay =
    hasTimingChange && timing ? timingToScheduleDisplay(timing) : undefined;
  const nextRunAt =
    hasTimingChange && timing ? nextRunAtFromTiming(timing) : undefined;
  const deliver =
    payload.deliver === undefined
      ? undefined
      : asStringArray(payload.deliver, ["local"]);
  const repeat =
    kind === "once"
      ? {
          times: null,
          completed:
            normalizeRepeat(payload.repeat)?.completed ??
            normalizeRepeat(existing?.repeat)?.completed ??
            0,
        }
      : payload.repeat === undefined
        ? undefined
        : payload.repeat;

  return compactJob({
    ...payload,
    schedule,
    schedule_display: scheduleDisplay,
    schedule_type: kind,
    timing,
    repeat,
    next_run_at: nextRunAt,
    deliver,
    skills: payload.skills,
    source_session_id: payload.sourceSessionId ?? payload.source_session_id,
    source_trace_id: payload.sourceTraceId ?? payload.source_trace_id,
    run_history: payload.runHistory ?? payload.run_history,
    recent_runs: payload.recentRuns ?? payload.recent_runs,
  });
}

async function createRichCronJob(
  payload: ScheduleCreatePayload,
  profile?: string,
): Promise<CronMutationResult> {
  const id = payload.id || randomUUID();
  const now = new Date().toISOString();
  const job = compactJob({
    id,
    name: payload.name || "(unnamed)",
    prompt: payload.prompt || "",
    enabled: payload.enabled !== false,
    state: payload.enabled === false ? "paused" : "scheduled",
    created_at: now,
    updated_at: now,
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    script: payload.script ?? null,
    ...payloadToJob(payload),
  });

  const shape = await readJobsShape(profile);
  if (shape.jobs.some((existing) => existing.id === id)) {
    return { success: false, error: `Cron job already exists: ${id}` };
  }
  await writeJobsShape(shape, [...shape.jobs, job], profile);
  return { success: true, id };
}

async function updateLocalCronJob(
  jobId: string,
  payload: ScheduleUpdatePayload,
  profile?: string,
): Promise<CronMutationResult> {
  const shape = await readJobsShape(profile);
  const index = shape.jobs.findIndex((job) => String(job.id) === jobId);
  if (index < 0)
    return { success: false, error: `Cron job not found: ${jobId}` };

  const existing = shape.jobs[index];
  const patch = payloadToJob(payload, existing);
  const updated = compactJob({
    ...existing,
    ...patch,
    id: existing.id,
    updated_at: new Date().toISOString(),
  });
  const nextJobs = [...shape.jobs];
  nextJobs[index] = updated;
  await writeJobsShape(shape, nextJobs, profile);
  return { success: true, id: String(existing.id) };
}

export async function createCronJob(
  schedule: string,
  prompt?: string,
  name?: string,
  deliver?: string,
  profile?: string,
): Promise<CronMutationResult>;
export async function createCronJob(
  payload: ScheduleCreatePayload,
  profile?: string,
): Promise<CronMutationResult>;
export async function createCronJob(
  scheduleOrPayload: string | ScheduleCreatePayload,
  promptOrProfile?: string,
  name?: string,
  deliver?: string,
  profile?: string,
): Promise<CronMutationResult> {
  if (typeof scheduleOrPayload !== "string") {
    if (isRemoteMode()) {
      try {
        const jobsClient = await resolveCronJobsClient(promptOrProfile);
        const body = await jobsClient.create(payloadToRemoteJob(scheduleOrPayload));
        return {
          success: true,
          id: typeof body.id === "string" ? body.id : scheduleOrPayload.id,
        };
      } catch (err) {
        return { success: false, error: remoteCronErrorMessage(err) };
      }
    }
    return createRichCronJob(scheduleOrPayload, promptOrProfile);
  }

  const schedule = scheduleOrPayload;
  const prompt = promptOrProfile;
  if (isRemoteMode()) {
    try {
      const jobsClient = await resolveCronJobsClient(profile);
      await jobsClient.create({
        name: name || "",
        schedule,
        prompt: prompt || "",
        deliver: deliver || "local",
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: remoteCronErrorMessage(err) };
    }
  }

  // Use -- to prevent prompt from being parsed as a flag
  const args = ["create", schedule];
  if (name) args.push("--name", name);
  if (deliver) args.push("--deliver", deliver);
  if (prompt) {
    args.push("--");
    args.push(prompt);
  }

  const result = await runCronCommand(args, profile);
  return { success: result.success, error: result.error };
}

export async function updateCronJob(
  jobId: string,
  payload: ScheduleUpdatePayload,
  profile?: string,
): Promise<CronMutationResult> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) {
    try {
      const jobsClient = await resolveCronJobsClient(profile);
      await jobsClient.update(jobId, payloadToRemoteJob(payload));
      return { success: true, id: jobId };
    } catch (err) {
      return { success: false, error: remoteCronErrorMessage(err) };
    }
  }
  return updateLocalCronJob(jobId, payload, profile);
}

export async function removeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) {
    try {
      const jobsClient = await resolveCronJobsClient(profile);
      await jobsClient.remove(jobId);
      return { success: true };
    } catch (err) {
      return { success: false, error: remoteCronErrorMessage(err) };
    }
  }
  const result = await runCronCommand(["remove", jobId], profile);
  return { success: result.success, error: result.error };
}

async function remoteJobAction(
  jobId: string,
  action: "pause" | "resume" | "run",
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const jobsClient = await resolveCronJobsClient(profile);
    await jobsClient.action(jobId, action);
    return { success: true };
  } catch (err) {
    return { success: false, error: remoteCronErrorMessage(err) };
  }
}

export async function pauseCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "pause", profile);
  const result = await runCronCommand(["pause", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function resumeCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "resume", profile);
  const result = await runCronCommand(["resume", jobId], profile);
  return { success: result.success, error: result.error };
}

export async function triggerCronJob(
  jobId: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!jobId) return { success: false, error: "Missing job ID" };
  if (isRemoteMode()) return remoteJobAction(jobId, "run", profile);
  const result = await runCronCommand(["run", jobId], profile);
  return { success: result.success, error: result.error };
}

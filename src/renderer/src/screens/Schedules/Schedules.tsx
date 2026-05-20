import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Grid3X3,
  Hash,
  Info,
  Mail,
  MessageCircle,
  Monitor,
  Pencil,
  Phone,
  Plus,
  Repeat,
  Search,
  Shield,
  Smartphone,
  Trash2,
  X,
  Zap,
  Globe,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type {
  CronJob,
  ScheduleContextMetadata,
  ScheduleCreatePayload,
  ScheduleKind,
  ScheduleTiming,
  ScheduleUpdatePayload,
} from "../../../../shared/schedules";
import type { TraceScheduleRunSummary } from "../../../../shared/traces";
import {
  DELIVERY_TARGETS,
  SCHEDULE_KIND_OPTIONS,
  WEEK_DAYS,
} from "./schedule.constants";

type ViewMode = "week" | "month";
type ScreenMode = "view" | "create" | "edit";
type IntervalUnit = "minutes" | "hours" | "days";

interface HermesProfile {
  name: string;
  isDefault?: boolean;
  isActive?: boolean;
  model?: string;
  provider?: string;
  skillCount?: number;
}

export interface ScheduleInitialDraft {
  name?: string;
  prompt?: string;
  kind?: ScheduleKind;
  time?: string;
  at?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  deliver?: string[];
  skills?: string[];
  agentProfile?: string;
  context?: ScheduleContextMetadata | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sourceSessionId?: string;
  sourceTraceId?: string;
}

export interface SchedulesProps {
  profile?: string;
  initialDraft?: ScheduleInitialDraft;
  onOpenTraceRun?: (runId: string) => void;
  onOpenConversation?: (sessionId: string) => void;
}

export interface NormalizedSchedule {
  id: string;
  name: string;
  prompt: string;
  state: CronJob["state"];
  enabled: boolean;
  schedule: string;
  kind: ScheduleKind;
  timing: ScheduleTiming;
  repeat: CronJob["repeat"];
  deliver: string[];
  skills: string[];
  script: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  context?: ScheduleContextMetadata | Record<string, unknown>;
  agentProfile?: string;
  sourceSessionId?: string;
  sourceTraceId?: string;
  recentRuns: TraceScheduleRunSummary[];
  raw: CronJob;
}

interface ScheduleFormState {
  agentProfile: string;
  name: string;
  nameManuallyEdited: boolean;
  prompt: string;
  kind: ScheduleKind;
  time: string;
  onceDate: string;
  daysOfWeek: number[];
  dayOfMonth: number;
  every: number;
  intervalUnit: IntervalUnit;
  customCron: string;
  deliver: string[];
  skills: string[];
  skillDraft: string;
  context?: ScheduleContextMetadata | Record<string, unknown>;
}

const DEFAULT_TIME = "09:00";
const DEFAULT_DELIVER = ["local"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function todayInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toDateInputValue(value?: string | null): string {
  if (!value) return todayInputValue();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return todayInputValue();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeTime(value?: string | null): string {
  const match = value?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return DEFAULT_TIME;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${pad(hour)}:${pad(minute)}`;
}

function timeFromIso(value?: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseCron(schedule: string): Partial<ScheduleTiming> {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    const interval = schedule.match(/^(\d+)(m|h|d)$/);
    if (interval) {
      return {
        kind: "interval",
        every: Number(interval[1]),
        unit:
          interval[2] === "h"
            ? "hours"
            : interval[2] === "d"
              ? "days"
              : "minutes",
      };
    }
    return { kind: "custom", cron: schedule };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const time = `${pad(Number(hour) || 0)}:${pad(Number(minute) || 0)}`;
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return { kind: "daily", time };
  }
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    return {
      kind: "weekly",
      time,
      daysOfWeek: dayOfWeek
        .split(",")
        .flatMap((part) => {
          if (part.includes("-")) {
            const [start, end] = part.split("-").map(Number);
            if (Number.isNaN(start) || Number.isNaN(end)) return [];
            const values: number[] = [];
            for (let day = start; day <= end; day += 1) values.push(day);
            return values;
          }
          const value = Number(part);
          return Number.isNaN(value) ? [] : [value];
        })
        .filter((day) => day >= 0 && day <= 6),
    };
  }
  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    return { kind: "monthly", time, dayOfMonth: Number(dayOfMonth) || 1 };
  }
  return { kind: "custom", cron: schedule, time };
}

function inferTiming(job: CronJob): ScheduleTiming {
  const rawTiming = job.timing;
  if (rawTiming?.kind) return rawTiming;

  const parsed = parseCron(String(job.schedule || ""));
  const kind =
    job.schedule_type ||
    (job.repeat?.times === 1 && job.state === "completed"
      ? "once"
      : parsed.kind) ||
    "custom";

  if (kind === "once") {
    const at =
      typeof parsed.at === "string"
        ? parsed.at
        : job.next_run_at || job.last_run_at || undefined;
    return {
      kind,
      at,
      time: normalizeTime(timeFromIso(at) || parsed.time),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  return {
    ...parsed,
    kind,
    time: normalizeTime(parsed.time),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function asStringRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function normalizeRunLink(
  link: unknown,
  schedule: NormalizedSchedule,
): TraceScheduleRunSummary | null {
  const record = asStringRecord(link);
  const traceRunId = firstString(record.traceRunId, record.traceId, record.id);
  if (!traceRunId) return null;
  const startedAtString = firstString(record.startedAt, record.completedAt);
  const startedAt = startedAtString
    ? new Date(startedAtString).getTime()
    : Date.now();
  return {
    traceRunId,
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    profile: schedule.agentProfile || "default",
    status:
      record.status === "failed" ||
      record.status === "running" ||
      record.status === "aborted"
        ? record.status
        : "completed",
    startedAt,
    updatedAt: startedAt,
    completedAt: startedAt,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : 0,
    summary: firstString(record.summary) || schedule.prompt,
  };
}

export function normalizeScheduleJob(
  job: CronJob,
  activeProfile?: string,
): NormalizedSchedule {
  const timing = inferTiming(job);
  const metadata = asStringRecord(job.metadata);
  const context = job.context || job.conversation;
  const contextRecord = asStringRecord(context);
  const agentProfile =
    firstString(
      metadata.agentProfile,
      metadata.profile,
      contextRecord.agentProfile,
      contextRecord.profile,
      job.profile,
      activeProfile,
    ) || "default";
  const normalized: NormalizedSchedule = {
    id: job.id,
    name: job.name || "(unnamed)",
    prompt: job.prompt || "",
    state: job.state || (job.enabled === false ? "paused" : "active"),
    enabled: job.enabled !== false,
    schedule: String(job.schedule || timing.cron || ""),
    kind: timing.kind,
    timing,
    repeat: job.repeat,
    deliver:
      Array.isArray(job.deliver) && job.deliver.length > 0
        ? job.deliver
        : DEFAULT_DELIVER,
    skills: Array.isArray(job.skills) ? job.skills : [],
    script: job.script || null,
    nextRunAt: job.next_run_at,
    lastRunAt: job.last_run_at,
    lastStatus: job.last_status,
    lastError: job.last_error,
    context,
    agentProfile,
    sourceSessionId: job.source_session_id,
    sourceTraceId: job.source_trace_id,
    recentRuns: [],
    raw: job,
  };
  const embeddedRuns = [
    ...(Array.isArray(job.recent_runs) ? job.recent_runs : []),
    ...(Array.isArray(job.run_history) ? job.run_history : []),
  ];
  normalized.recentRuns = embeddedRuns
    .map((run) => normalizeRunLink(run, normalized))
    .filter((run): run is TraceScheduleRunSummary => Boolean(run));
  return normalized;
}

function buildCronFromForm(form: ScheduleFormState): string {
  const [hour, minute] = form.time.split(":");
  if (form.kind === "once") {
    const at = new Date(`${form.onceDate}T${form.time}:00`);
    return `${at.getMinutes()} ${at.getHours()} ${at.getDate()} ${at.getMonth() + 1} *`;
  }
  if (form.kind === "interval") {
    if (form.intervalUnit === "hours")
      return `${minute} */${form.every || 1} * * *`;
    if (form.intervalUnit === "days")
      return `${minute} ${hour} */${form.every || 1} * *`;
    return `*/${form.every || 1} * * * *`;
  }
  if (form.kind === "daily") return `${minute} ${hour} * * *`;
  if (form.kind === "weekly")
    return `${minute} ${hour} * * ${form.daysOfWeek.join(",")}`;
  if (form.kind === "monthly")
    return `${minute} ${hour} ${form.dayOfMonth} * *`;
  return form.customCron.trim();
}

function buildTimingFromForm(form: ScheduleFormState): ScheduleTiming {
  if (form.kind === "once") {
    return {
      kind: "once",
      at: new Date(`${form.onceDate}T${form.time}:00`).toISOString(),
      time: form.time,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  if (form.kind === "interval") {
    return {
      kind: "interval",
      every: form.every,
      unit: form.intervalUnit,
      time: form.time,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  if (form.kind === "weekly") {
    return {
      kind: "weekly",
      time: form.time,
      daysOfWeek: form.daysOfWeek,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  if (form.kind === "monthly") {
    return {
      kind: "monthly",
      time: form.time,
      dayOfMonth: form.dayOfMonth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  if (form.kind === "custom") {
    return {
      kind: "custom",
      cron: form.customCron.trim(),
      time: form.time,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }
  return {
    kind: "daily",
    time: form.time,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function buildSchedulePayload(
  form: ScheduleFormState,
): ScheduleCreatePayload {
  const timing = buildTimingFromForm(form);
  return {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    schedule: buildCronFromForm(form),
    timing,
    kind: form.kind,
    repeat: form.kind === "once" ? { times: null, completed: 0 } : null,
    deliver: form.deliver,
    skills: form.skills,
    enabled: true,
    context: form.context,
    conversation: form.context,
    metadata: {
      agentProfile: form.agentProfile,
    },
    sourceSessionId: firstString(asStringRecord(form.context).sessionId),
    sourceTraceId: firstString(asStringRecord(form.context).traceId),
  };
}

function initialFormState(
  profile?: string,
  draft?: ScheduleInitialDraft,
): ScheduleFormState {
  const atTime = timeFromIso(draft?.at);
  return {
    agentProfile: draft?.agentProfile || profile || "default",
    name: draft?.name || "",
    nameManuallyEdited: Boolean(draft?.name),
    prompt: draft?.prompt || "",
    kind: draft?.kind || "daily",
    time: normalizeTime(draft?.time || atTime),
    onceDate: toDateInputValue(draft?.at),
    daysOfWeek: draft?.daysOfWeek?.length ? draft.daysOfWeek : [1],
    dayOfMonth: draft?.dayOfMonth || new Date().getDate(),
    every: 30,
    intervalUnit: "minutes",
    customCron: "",
    deliver: draft?.deliver?.length ? draft.deliver : DEFAULT_DELIVER,
    skills: draft?.skills || [],
    skillDraft: "",
    context: draft?.context,
  };
}

function formFromSchedule(schedule: NormalizedSchedule): ScheduleFormState {
  return {
    agentProfile: schedule.agentProfile || "default",
    name: schedule.name,
    nameManuallyEdited: true,
    prompt: schedule.prompt,
    kind: schedule.kind,
    time: normalizeTime(
      schedule.timing.time ||
        timeFromIso(schedule.timing.at) ||
        timeFromIso(schedule.nextRunAt) ||
        DEFAULT_TIME,
    ),
    onceDate: toDateInputValue(
      schedule.timing.at || schedule.nextRunAt || schedule.lastRunAt,
    ),
    daysOfWeek: schedule.timing.daysOfWeek?.length
      ? schedule.timing.daysOfWeek
      : [1],
    dayOfMonth: schedule.timing.dayOfMonth || 1,
    every: schedule.timing.every || 30,
    intervalUnit: schedule.timing.unit || "minutes",
    customCron:
      schedule.timing.cron ||
      (schedule.kind === "custom" ? schedule.schedule : ""),
    deliver: schedule.deliver.length ? schedule.deliver : DEFAULT_DELIVER,
    skills: schedule.skills,
    skillDraft: "",
    context: schedule.context,
  };
}

function getWeekStart(date: Date): Date {
  const start = new Date(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function minutesFromTime(time: string): number {
  const [hour, minute] = normalizeTime(time).split(":").map(Number);
  return hour * 60 + minute;
}

function scheduleTime(schedule: NormalizedSchedule): string {
  return normalizeTime(
    schedule.timing.time ||
      timeFromIso(schedule.timing.at) ||
      timeFromIso(schedule.nextRunAt) ||
      timeFromIso(schedule.lastRunAt) ||
      DEFAULT_TIME,
  );
}

function isCompletedOneShot(schedule: NormalizedSchedule): boolean {
  return schedule.kind === "once" && schedule.state === "completed";
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function scheduleOccursOn(
  schedule: NormalizedSchedule,
  date: Date,
  includeDaily: boolean,
): boolean {
  if (schedule.kind === "daily") return includeDaily;
  if (schedule.kind === "once") {
    const at = schedule.timing.at || schedule.nextRunAt || schedule.lastRunAt;
    return at ? isSameDay(new Date(at), date) : false;
  }
  if (schedule.kind === "weekly") {
    return Boolean(schedule.timing.daysOfWeek?.includes(date.getDay()));
  }
  if (schedule.kind === "monthly") {
    const configuredDay = schedule.timing.dayOfMonth || 1;
    return date.getDate() === Math.min(configuredDay, daysInMonth(date));
  }
  const anchor = schedule.nextRunAt || schedule.lastRunAt;
  return anchor
    ? isSameDay(new Date(anchor), date)
    : isSameDay(date, new Date());
}

function scheduleSort(a: NormalizedSchedule, b: NormalizedSchedule): number {
  return (
    minutesFromTime(scheduleTime(a)) - minutesFromTime(scheduleTime(b)) ||
    a.name.localeCompare(b.name)
  );
}

function statusClass(schedule: NormalizedSchedule): string {
  if (schedule.state === "paused") return "paused";
  if (schedule.state === "completed") return "completed";
  if (
    schedule.lastStatus &&
    !["ok", "success", "completed"].includes(schedule.lastStatus)
  ) {
    return "failed";
  }
  if (schedule.lastRunAt && isSameDay(new Date(schedule.lastRunAt), new Date()))
    return "success";
  return "active";
}

function formatDuration(ms: number): string {
  if (!ms) return "--";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes <= 0) return `${remaining}s`;
  return `${minutes}m ${remaining}s`;
}

function formatRunTime(
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const date = new Date(timestamp);
  const now = new Date();
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (isSameDay(date, now)) return t("schedules.runToday", { time });
  if (isSameDay(date, addDays(now, -1)))
    return t("schedules.runYesterday", { time });
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

function makeAutoName(
  form: ScheduleFormState,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const agent = form.agentProfile || t("schedules.agent");
  if (form.kind === "once") {
    return t("schedules.autoName.once", {
      agent,
      date: form.onceDate,
      time: form.time,
    });
  }
  if (form.kind === "weekly") {
    return t("schedules.autoName.weekly", { agent, time: form.time });
  }
  if (form.kind === "monthly") {
    return t("schedules.autoName.monthly", {
      agent,
      day: form.dayOfMonth,
      time: form.time,
    });
  }
  if (form.kind === "interval") {
    return t("schedules.autoName.interval", {
      agent,
      every: form.every,
      unit: t(`schedules.intervalUnit.${form.intervalUnit}`),
    });
  }
  if (form.kind === "custom") {
    return t("schedules.autoName.custom", { agent });
  }
  return t("schedules.autoName.daily", { agent, time: form.time });
}

function getContextExcerpt(
  context: NormalizedSchedule["context"],
): string | undefined {
  const record = asStringRecord(context);
  return firstString(record.excerpt, record.title);
}

function ToggleSwitch({
  checked,
  disabled,
  label,
  onClick,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`schedules-switch ${checked ? "is-on" : ""}`}
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={onClick}
    >
      <span />
    </button>
  );
}

function DeliveryIcon({
  target,
  size = 14,
}: {
  target: string;
  size?: number;
}): React.JSX.Element {
  if (target === "telegram") return <MessageCircle size={size} />;
  if (target === "discord" || target === "slack" || target === "mattermost")
    return <Hash size={size} />;
  if (target === "whatsapp") return <Phone size={size} />;
  if (target === "signal") return <Shield size={size} />;
  if (target === "matrix") return <Grid3X3 size={size} />;
  if (target === "email") return <Mail size={size} />;
  if (target === "sms") return <Smartphone size={size} />;
  if (target === "webhook") return <Globe size={size} />;
  return <Monitor size={size} />;
}

function ScheduleCard({
  schedule,
  variant,
  expanded,
  runs,
  loadingRuns,
  actionInProgress,
  t,
  onExpand,
  onToggle,
  onEdit,
  onTrigger,
  onDelete,
  onOpenTraceRun,
  onOpenConversation,
  profileModel,
}: {
  schedule: NormalizedSchedule;
  variant: "daily" | "grid" | "panel";
  expanded: boolean;
  runs: TraceScheduleRunSummary[];
  loadingRuns: boolean;
  actionInProgress: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  onExpand: () => void;
  onToggle: (schedule: NormalizedSchedule) => void;
  onEdit: (schedule: NormalizedSchedule) => void;
  onTrigger: (schedule: NormalizedSchedule) => void;
  onDelete: (schedule: NormalizedSchedule) => void;
  onOpenTraceRun?: (runId: string) => void;
  onOpenConversation?: (sessionId: string) => void;
  profileModel?: string;
}): React.JSX.Element {
  const hasConversation = Boolean(
    schedule.sourceSessionId || getContextExcerpt(schedule.context),
  );
  const runItems = runs.length ? runs : schedule.recentRuns;
  const checked = schedule.state === "active";
  const completedOnce = isCompletedOneShot(schedule);
  const className = [
    "schedule-card",
    `schedule-card-${variant}`,
    expanded ? "is-expanded" : "",
    schedule.state === "paused" ? "is-paused" : "",
    completedOnce ? "is-completed-once" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const header = (
    <div className="schedule-card-header">
      {expanded && <ChevronDown className="schedule-card-chevron" size={12} />}
      <div className="schedule-card-time">{scheduleTime(schedule)}</div>
      <div className="schedule-card-copy">
        <div className="schedule-card-name">{schedule.name}</div>
        <div className="schedule-card-desc">
          {schedule.prompt || t("schedules.noPrompt")}
        </div>
        {hasConversation && (
          <div className="schedule-context-pill">
            <MessageCircle size={10} />
            {t("schedules.fromChat")}
          </div>
        )}
        {(schedule.kind === "once" || schedule.kind === "monthly") && (
          <div className={`schedule-kind-badge schedule-kind-${schedule.kind}`}>
            {t(`schedules.kind.${schedule.kind}`)}
          </div>
        )}
      </div>
      <span className={`schedule-status-dot status-${statusClass(schedule)}`} />
      <ToggleSwitch
        checked={checked}
        disabled={
          actionInProgress === schedule.id || schedule.state === "completed"
        }
        label={checked ? t("schedules.pause") : t("schedules.resume")}
        onClick={(event) => {
          event.stopPropagation();
          onToggle(schedule);
        }}
      />
    </div>
  );

  return (
    <article
      className={className}
      tabIndex={0}
      onClick={onExpand}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onExpand();
        }
      }}
    >
      {header}
      {expanded && (
        <div className="schedule-expanded">
          <section className="schedule-expanded-section">
            <div className="schedule-section-label">
              {t("schedules.prompt")}
            </div>
            <div className="schedule-prompt-box">
              {schedule.prompt || t("schedules.noPrompt")}
            </div>
          </section>

          <section className="schedule-meta-row">
            <div>
              <span>{t("schedules.agent")}</span>
              <strong>{schedule.agentProfile}</strong>
            </div>
            <div>
              <span>{t("schedules.harness")}</span>
              <strong>{profileModel || t("schedules.unknownHarness")}</strong>
            </div>
            <div>
              <span>{t("schedules.deliverTo")}</span>
              <strong className="schedule-delivery-inline">
                <DeliveryIcon
                  target={schedule.deliver[0] || "local"}
                  size={10}
                />
                {schedule.deliver.join(", ")}
              </strong>
            </div>
            {schedule.kind === "once" && (
              <div>
                <span>{t("schedules.scheduledFor")}</span>
                <strong>
                  {(schedule.timing.at
                    ? new Date(schedule.timing.at)
                    : new Date()
                  ).toLocaleString()}
                </strong>
              </div>
            )}
          </section>

          {hasConversation && (
            <section className="schedule-context-section">
              <div className="schedule-section-label">
                {t("schedules.createdFrom")}
              </div>
              <div className="schedule-context-row">
                <MessageCircle size={12} />
                <span>
                  {getContextExcerpt(schedule.context) ||
                    t("schedules.fromChat")}
                </span>
                {schedule.sourceSessionId && onOpenConversation && (
                  <button
                    type="button"
                    className="schedule-link-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenConversation(schedule.sourceSessionId!);
                    }}
                  >
                    {t("schedules.openConversation")}
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="schedule-expanded-section">
            <div className="schedule-section-label">
              {t("schedules.skills")}
            </div>
            <div className="schedule-skill-list">
              {schedule.skills.length ? (
                schedule.skills.map((skill) => (
                  <span key={skill} className="schedule-skill-pill">
                    {skill}
                  </span>
                ))
              ) : (
                <span className="schedule-no-skills">
                  {t("schedules.noSkills")}
                </span>
              )}
            </div>
          </section>

          <section className="schedule-expanded-section">
            <div className="schedule-section-label">
              {t("schedules.recentRuns")}
            </div>
            {loadingRuns ? (
              <div className="schedule-runs-empty">
                {t("schedules.loadingRuns")}
              </div>
            ) : runItems.length ? (
              <div className="schedule-run-list">
                {runItems.slice(0, 5).map((run) => (
                  <button
                    type="button"
                    key={run.traceRunId}
                    className="schedule-run-item"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenTraceRun?.(run.traceRunId);
                    }}
                  >
                    <span>{formatRunTime(run.startedAt, t)}</span>
                    <span className={`schedule-run-status run-${run.status}`}>
                      <i />
                      {run.status === "failed"
                        ? t("schedules.failed")
                        : run.status === "running"
                          ? t("schedules.running")
                          : t("schedules.success")}
                    </span>
                    <span>{formatDuration(run.durationMs)}</span>
                    <ChevronRight size={12} />
                  </button>
                ))}
              </div>
            ) : schedule.kind === "once" && !completedOnce ? (
              <div className="schedule-runs-empty">
                {t("schedules.scheduledToRun", {
                  date: schedule.timing.at
                    ? new Date(schedule.timing.at).toLocaleString()
                    : scheduleTime(schedule),
                })}
              </div>
            ) : (
              <div className="schedule-runs-empty">
                {t("schedules.noRecentRuns")}
              </div>
            )}
          </section>

          <div className="schedule-action-bar">
            <div className="schedule-action-left">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(schedule);
                }}
              >
                <Pencil size={12} />
                {t("schedules.edit")}
              </button>
              {schedule.state === "active" && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={actionInProgress === schedule.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTrigger(schedule);
                  }}
                >
                  <Zap size={12} />
                  {t("schedules.runNow")}
                </button>
              )}
            </div>
            <button
              type="button"
              className="btn-ghost schedule-delete-button"
              aria-label={t("schedules.delete")}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(schedule);
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function ClockPicker({
  value,
  onChange,
  t,
}: {
  value: string;
  onChange: (value: string) => void;
  t: (key: string) => string;
}): React.JSX.Element {
  const [stage, setStage] = useState<"hours" | "minutes">("hours");
  const [hour, minute] = normalizeTime(value).split(":").map(Number);
  const numbers =
    stage === "hours"
      ? [
          ...Array.from({ length: 12 }, (_, index) => index + 1),
          ...Array.from({ length: 12 }, (_, index) => (index + 13) % 24),
        ]
      : Array.from({ length: 12 }, (_, i) => i * 5);
  const selected = stage === "hours" ? hour : minute;

  function setPart(next: number): void {
    if (stage === "hours") {
      onChange(`${pad(next)}:${pad(minute)}`);
      window.setTimeout(() => setStage("minutes"), 180);
    } else {
      onChange(`${pad(hour)}:${pad(next)}`);
    }
  }

  return (
    <div className="schedule-clock">
      <div
        className="schedule-clock-stage"
        aria-label={t("schedules.clockTime")}
      >
        <button
          type="button"
          className={stage === "hours" ? "active" : ""}
          onClick={() => setStage("hours")}
        >
          {pad(hour)}
        </button>
        <span>:</span>
        <button
          type="button"
          className={stage === "minutes" ? "active" : ""}
          onClick={() => setStage("minutes")}
        >
          {pad(minute)}
        </button>
      </div>
      <div className="schedule-clock-face">
        <div
          className="schedule-clock-hand"
          style={{
            transform: `rotate(${(stage === "hours" ? (hour % 12) * 30 : minute * 6) - 90}deg)`,
          }}
        />
        <span className="schedule-clock-center" />
        {numbers.map((number, index) => {
          const clockHour = number === 0 ? 12 : number;
          const angle =
            stage === "hours" ? (clockHour % 12) * 30 - 90 : index * 30 - 90;
          const inner = stage === "hours" && (number === 0 || number >= 13);
          const radius = inner ? 52 : 82;
          return (
            <button
              type="button"
              key={number}
              className={`schedule-clock-number ${selected === number ? "active" : ""} ${inner ? "inner" : ""}`}
              style={{
                transform: `translate(${Math.cos((angle * Math.PI) / 180) * radius}px, ${
                  Math.sin((angle * Math.PI) / 180) * radius
                }px)`,
              }}
              onClick={() => setPart(number)}
            >
              {pad(number)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScheduleEditor({
  mode,
  form,
  profiles,
  saving,
  validation,
  t,
  onChange,
  onSave,
}: {
  mode: ScreenMode;
  form: ScheduleFormState;
  profiles: HermesProfile[];
  saving: boolean;
  validation: {
    valid: boolean;
    errors: Partial<Record<"agent" | "time" | "days" | "cron", string>>;
  };
  t: (key: string, options?: Record<string, unknown>) => string;
  onChange: (next: ScheduleFormState) => void;
  onSave: () => void;
}): React.JSX.Element {
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");
  const filteredProfiles = profiles.filter((item) =>
    item.name.toLowerCase().includes(agentQuery.trim().toLowerCase()),
  );

  function patch(patchValue: Partial<ScheduleFormState>): void {
    const next = { ...form, ...patchValue };
    if (!next.nameManuallyEdited) next.name = makeAutoName(next, t);
    onChange(next);
  }

  function toggleDelivery(target: string): void {
    const next = form.deliver.includes(target)
      ? form.deliver.filter((item) => item !== target)
      : [...form.deliver, target];
    patch({ deliver: next.length ? next : DEFAULT_DELIVER });
  }

  function toggleDay(day: number): void {
    const next = form.daysOfWeek.includes(day)
      ? form.daysOfWeek.filter((item) => item !== day)
      : [...form.daysOfWeek, day];
    patch({ daysOfWeek: next.sort((a, b) => a - b) });
  }

  return (
    <div className="schedule-editor">
      <section className="schedule-editor-section">
        <label className="schedule-editor-label">{t("schedules.agent")}</label>
        <div className="schedule-agent-picker">
          <button
            type="button"
            className="input schedule-agent-trigger"
            onClick={() => setAgentOpen(!agentOpen)}
          >
            <span>{form.agentProfile || t("schedules.selectAgent")}</span>
            <ChevronDown size={14} />
          </button>
          {agentOpen && (
            <div className="schedule-agent-menu">
              <div className="schedule-agent-search">
                <Search size={14} />
                <input
                  value={agentQuery}
                  placeholder={t("schedules.searchAgents")}
                  onChange={(event) => setAgentQuery(event.target.value)}
                />
              </div>
              {filteredProfiles.map((item) => (
                <button
                  type="button"
                  key={item.name}
                  className={`schedule-agent-option ${form.agentProfile === item.name ? "active" : ""}`}
                  onClick={() => {
                    patch({ agentProfile: item.name });
                    setAgentOpen(false);
                  }}
                >
                  <span className="schedule-agent-avatar">
                    {item.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.model ||
                        item.provider ||
                        t("schedules.agentProfile")}
                    </small>
                  </span>
                  {form.agentProfile === item.name && <Check size={14} />}
                </button>
              ))}
            </div>
          )}
        </div>
        {validation.errors.agent && (
          <div className="schedule-field-error">{validation.errors.agent}</div>
        )}
      </section>

      <section className="schedule-editor-section">
        <label className="schedule-editor-label">
          {t("schedules.scheduleType")}
        </label>
        <div className="schedule-type-pills">
          {SCHEDULE_KIND_OPTIONS.map((kind) => (
            <button
              type="button"
              key={kind}
              className={form.kind === kind ? "active" : ""}
              onClick={() => patch({ kind })}
            >
              {t(`schedules.kind.${kind}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="schedule-editor-section">
        <label className="schedule-editor-label">
          {t("schedules.timeConfiguration")}
        </label>
        <div className="schedule-time-layout">
          {form.kind !== "custom" && (
            <ClockPicker
              value={form.time}
              onChange={(time) => patch({ time })}
              t={t}
            />
          )}
          <div className="schedule-secondary-picker">
            {form.kind === "once" && (
              <input
                className="input"
                type="date"
                value={form.onceDate}
                onChange={(event) => patch({ onceDate: event.target.value })}
              />
            )}
            {form.kind === "interval" && (
              <div className="schedule-interval-row">
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={form.every}
                  onChange={(event) =>
                    patch({ every: Number(event.target.value) || 1 })
                  }
                />
                <select
                  className="input"
                  value={form.intervalUnit}
                  onChange={(event) =>
                    patch({ intervalUnit: event.target.value as IntervalUnit })
                  }
                >
                  <option value="minutes">{t("schedules.minutes")}</option>
                  <option value="hours">{t("schedules.hours")}</option>
                  <option value="days">{t("schedules.days")}</option>
                </select>
              </div>
            )}
            {form.kind === "weekly" && (
              <>
                <div className="schedule-day-buttons">
                  {WEEK_DAYS.map((day) => (
                    <button
                      type="button"
                      key={day.value}
                      className={
                        form.daysOfWeek.includes(day.value) ? "active" : ""
                      }
                      onClick={() => toggleDay(day.value)}
                    >
                      {t(`schedules.dayShort.${day.key}`)}
                    </button>
                  ))}
                </div>
                <div className="schedule-quick-links">
                  <button
                    type="button"
                    onClick={() => patch({ daysOfWeek: [1, 2, 3, 4, 5] })}
                  >
                    {t("schedules.weekdays")}
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ daysOfWeek: [0, 6] })}
                  >
                    {t("schedules.weekends")}
                  </button>
                  <button
                    type="button"
                    onClick={() => patch({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })}
                  >
                    {t("schedules.everyDay")}
                  </button>
                </div>
                {form.daysOfWeek.length === 7 && (
                  <p className="schedule-hint">{t("schedules.useDailyTip")}</p>
                )}
              </>
            )}
            {form.kind === "monthly" && (
              <div className="schedule-month-days">
                {Array.from({ length: 31 }, (_, index) => index + 1).map(
                  (day) => (
                    <button
                      type="button"
                      key={day}
                      className={form.dayOfMonth === day ? "active" : ""}
                      onClick={() => patch({ dayOfMonth: day })}
                    >
                      {day}
                    </button>
                  ),
                )}
                <p className="schedule-hint">{t("schedules.monthEndHint")}</p>
              </div>
            )}
            {form.kind === "custom" && (
              <>
                <input
                  className="input schedule-cron-input"
                  value={form.customCron}
                  placeholder={t("schedules.cronPlaceholder")}
                  onChange={(event) =>
                    patch({ customCron: event.target.value })
                  }
                />
                <div
                  className={`schedule-cron-preview ${validation.errors.cron ? "is-error" : ""}`}
                >
                  <Info size={12} />
                  {validation.errors.cron || t("schedules.cronHint")}
                </div>
              </>
            )}
          </div>
        </div>
        {validation.errors.time && (
          <div className="schedule-field-error">{validation.errors.time}</div>
        )}
        {validation.errors.days && (
          <div className="schedule-field-error">{validation.errors.days}</div>
        )}
      </section>

      <section className="schedule-editor-section">
        <label className="schedule-editor-label">{t("schedules.prompt")}</label>
        <textarea
          className="input schedules-textarea"
          value={form.prompt}
          placeholder={t("schedules.promptPlaceholder")}
          onChange={(event) => patch({ prompt: event.target.value })}
        />
      </section>

      <section className="schedule-editor-section">
        <label className="schedule-editor-label">{t("schedules.skills")}</label>
        <div className="schedule-editor-skills">
          {form.skills.map((skill) => (
            <div className="schedule-skill-row" key={skill}>
              <span>
                {skill} <em>{t("schedules.addedSkill")}</em>
              </span>
              <ToggleSwitch
                checked
                label={t("schedules.removeSkill")}
                onClick={(event) => {
                  event.stopPropagation();
                  patch({
                    skills: form.skills.filter((item) => item !== skill),
                  });
                }}
              />
            </div>
          ))}
          <div className="schedule-add-skill">
            <input
              className="input"
              value={form.skillDraft}
              placeholder={t("schedules.addSkillPlaceholder")}
              onChange={(event) => patch({ skillDraft: event.target.value })}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                const skill = form.skillDraft.trim();
                if (!skill || form.skills.includes(skill)) return;
                patch({ skills: [...form.skills, skill], skillDraft: "" });
              }}
            >
              <Plus size={12} />
              {t("schedules.addSkill")}
            </button>
          </div>
        </div>
      </section>

      <section className="schedule-editor-section">
        <label className="schedule-editor-label">
          {t("schedules.deliverTo")}
        </label>
        <div className="schedule-delivery-grid">
          {DELIVERY_TARGETS.map((target) => (
            <button
              type="button"
              key={target}
              className={form.deliver.includes(target) ? "active" : ""}
              onClick={() => toggleDelivery(target)}
            >
              <DeliveryIcon target={target} />
              {t(`schedules.delivery.${target}`)}
            </button>
          ))}
        </div>
      </section>

      <section className="schedule-editor-section">
        <label className="schedule-editor-label">{t("schedules.name")}</label>
        <input
          className="input"
          value={form.name}
          placeholder={makeAutoName(form, t)}
          onChange={(event) =>
            onChange({
              ...form,
              name: event.target.value,
              nameManuallyEdited: event.target.value.trim().length > 0,
            })
          }
        />
      </section>

      <button
        type="button"
        className="schedule-editor-hidden-submit"
        disabled={!validation.valid || saving}
        onClick={onSave}
      >
        {mode === "edit"
          ? t("schedules.saveChanges")
          : t("schedules.createSchedule")}
      </button>
    </div>
  );
}

function Schedules({
  profile,
  initialDraft,
  onOpenTraceRun,
  onOpenConversation,
}: SchedulesProps): React.JSX.Element {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<ViewMode>("week");
  const [mode, setMode] = useState<ScreenMode>("view");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleFormState>(() =>
    initialFormState(profile, initialDraft),
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NormalizedSchedule | null>(
    null,
  );
  const [showDailyInMonth, setShowDailyInMonth] = useState(false);
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [selectedMonthDate, setSelectedMonthDate] = useState<Date | null>(null);
  const [runsBySchedule, setRunsBySchedule] = useState<
    Record<string, TraceScheduleRunSummary[]>
  >({});
  const [loadingRunsId, setLoadingRunsId] = useState<string | null>(null);
  const appliedDraftRef = useRef<ScheduleInitialDraft | null>(null);

  const loadJobs = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [list, profileList] = await Promise.all([
        window.hermesAPI.listCronJobs(true, profile),
        window.hermesAPI.listProfiles().catch(() => []),
      ]);
      setJobs(list);
      setProfiles(
        profileList.length
          ? profileList
          : [{ name: profile || "default", isDefault: true, isActive: true }],
      );
      setError("");
    } catch {
      setError(t("schedules.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!initialDraft || appliedDraftRef.current === initialDraft) return;
    appliedDraftRef.current = initialDraft;
    setForm(initialFormState(profile, initialDraft));
    setMode("create");
  }, [initialDraft, profile]);

  const schedules = useMemo(
    () =>
      jobs.map((job) => normalizeScheduleJob(job, profile)).sort(scheduleSort),
    [jobs, profile],
  );

  const profileModelByName = useMemo(() => {
    return Object.fromEntries(
      profiles.map((item) => [item.name, item.model || item.provider || ""]),
    );
  }, [profiles]);

  const dailySchedules = schedules.filter((item) => item.kind === "daily");
  const nonDailySchedules = schedules.filter((item) => item.kind !== "daily");
  const weekStart = getWeekStart(new Date());
  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index),
  );

  const validation = useMemo(() => {
    const errors: Partial<Record<"agent" | "time" | "days" | "cron", string>> =
      {};
    if (!form.agentProfile.trim())
      errors.agent = t("schedules.validation.selectAgent");
    if (form.kind === "weekly" && form.daysOfWeek.length === 0) {
      errors.days = t("schedules.validation.selectDay");
    }
    if (form.kind === "once") {
      const at = new Date(`${form.onceDate}T${form.time}:00`);
      if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
        errors.time = t("schedules.validation.futureTime");
      }
    }
    if (
      form.kind === "custom" &&
      form.customCron.trim().split(/\s+/).length !== 5
    ) {
      errors.cron = t("schedules.validation.invalidCron");
    }
    return { valid: Object.keys(errors).length === 0, errors };
  }, [form, t]);

  async function expandSchedule(schedule: NormalizedSchedule): Promise<void> {
    setExpandedId((current) => (current === schedule.id ? null : schedule.id));
    if (expandedId === schedule.id || runsBySchedule[schedule.id]) return;
    setLoadingRunsId(schedule.id);
    try {
      const runs = await window.hermesAPI.listTraceRunsForSchedule(
        schedule.id,
        profile,
      );
      setRunsBySchedule((current) => ({ ...current, [schedule.id]: runs }));
    } catch {
      setRunsBySchedule((current) => ({ ...current, [schedule.id]: [] }));
    } finally {
      setLoadingRunsId(null);
    }
  }

  function beginCreate(): void {
    const next = initialFormState(profile);
    next.name = makeAutoName(next, t);
    setForm(next);
    setEditingId(null);
    setMode("create");
  }

  function beginEdit(schedule: NormalizedSchedule): void {
    setForm(formFromSchedule(schedule));
    setEditingId(schedule.id);
    setMode("edit");
  }

  function closeEditor(): void {
    setMode("view");
    setEditingId(null);
  }

  async function saveEditor(): Promise<void> {
    if (!validation.valid) return;
    setActionInProgress("saving");
    setError("");
    try {
      const payload = buildSchedulePayload({
        ...form,
        name: form.name.trim() || makeAutoName(form, t),
      });
      const result =
        mode === "edit" && editingId
          ? await window.hermesAPI.updateCronJob(
              editingId,
              payload as ScheduleUpdatePayload,
              profile,
            )
          : await window.hermesAPI.createScheduleJob(payload, profile);
      if (!result.success) {
        setError(result.error || t("schedules.saveFailed"));
        return;
      }
      closeEditor();
      await loadJobs();
    } catch {
      setError(t("schedules.saveFailed"));
    } finally {
      setActionInProgress(null);
    }
  }

  async function toggleSchedule(schedule: NormalizedSchedule): Promise<void> {
    setActionInProgress(schedule.id);
    setError("");
    try {
      const result =
        schedule.state === "paused"
          ? await window.hermesAPI.resumeCronJob(schedule.id, profile)
          : await window.hermesAPI.pauseCronJob(schedule.id, profile);
      if (!result.success)
        setError(result.error || t("schedules.updateFailed"));
      await loadJobs();
    } catch {
      setError(t("schedules.updateFailed"));
    } finally {
      setActionInProgress(null);
    }
  }

  async function triggerSchedule(schedule: NormalizedSchedule): Promise<void> {
    setActionInProgress(schedule.id);
    setError("");
    try {
      const result = await window.hermesAPI.triggerCronJob(
        schedule.id,
        profile,
      );
      if (!result.success)
        setError(result.error || t("schedules.triggerFailed"));
      await loadJobs();
    } catch {
      setError(t("schedules.triggerFailed"));
    } finally {
      setActionInProgress(null);
    }
  }

  async function removeSchedule(): Promise<void> {
    if (!deleteTarget) return;
    setActionInProgress(deleteTarget.id);
    setError("");
    try {
      const result = await window.hermesAPI.removeCronJob(
        deleteTarget.id,
        profile,
      );
      if (!result.success)
        setError(result.error || t("schedules.deleteFailed"));
      setDeleteTarget(null);
      await loadJobs();
    } catch {
      setError(t("schedules.deleteFailed"));
    } finally {
      setActionInProgress(null);
    }
  }

  const cardProps = (schedule: NormalizedSchedule) => ({
    schedule,
    expanded: expandedId === schedule.id,
    runs: runsBySchedule[schedule.id] || [],
    loadingRuns: loadingRunsId === schedule.id,
    actionInProgress,
    t,
    onExpand: () => expandSchedule(schedule),
    onToggle: toggleSchedule,
    onEdit: beginEdit,
    onTrigger: triggerSchedule,
    onDelete: setDeleteTarget,
    onOpenTraceRun,
    onOpenConversation,
    profileModel: profileModelByName[schedule.agentProfile || ""],
  });

  const nowPosition = useMemo(() => {
    if (!dailySchedules.length) return 34;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const index = dailySchedules.findIndex(
      (item) => minutesFromTime(scheduleTime(item)) > currentMinutes,
    );
    const row = index === -1 ? dailySchedules.length : Math.max(0, index);
    return 34 + row * 58;
  }, [dailySchedules]);

  const monthCells = useMemo(() => {
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const start = getWeekStart(first);
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [monthDate]);

  if (loading) {
    return (
      <div className="schedules-container">
        <div className="schedules-header">
          <h2 className="schedules-title">{t("schedules.title")}</h2>
        </div>
        <div className="schedules-shell is-loading">
          <aside className="schedules-daily-strip">
            <div className="schedule-skeleton narrow" />
            <div className="schedule-skeleton" />
            <div className="schedule-skeleton" />
          </aside>
          <main className="schedules-main">
            <div className="schedule-skeleton-grid">
              {Array.from({ length: 14 }, (_, index) => (
                <div key={index} className="schedule-skeleton" />
              ))}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="schedules-container">
      <header
        className={`schedules-header ${mode !== "view" ? "is-editor" : ""}`}
      >
        {mode === "view" ? (
          <>
            <h2 className="schedules-title">{t("schedules.title")}</h2>
            <div
              className="schedules-view-toggle"
              role="tablist"
              aria-label={t("schedules.viewToggle")}
            >
              <button
                type="button"
                className={view === "week" ? "active" : ""}
                onClick={() => setView("week")}
              >
                {t("schedules.week")}
              </button>
              <button
                type="button"
                className={view === "month" ? "active" : ""}
                onClick={() => setView("month")}
              >
                {t("schedules.month")}
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={beginCreate}
            >
              <Plus size={14} />
              {t("schedules.newSchedule")}
            </button>
          </>
        ) : (
          <>
            <div className="schedules-editor-title">
              <button
                type="button"
                className="btn-ghost schedules-back-button"
                onClick={closeEditor}
              >
                <ChevronLeft size={16} />
                {t("schedules.back")}
              </button>
              <h2>
                {mode === "edit"
                  ? t("schedules.editSchedule")
                  : t("schedules.newSchedule")}
              </h2>
            </div>
            <div className="schedules-header-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeEditor}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!validation.valid || actionInProgress === "saving"}
                onClick={saveEditor}
              >
                {actionInProgress === "saving" ? (
                  <span className="loading-spinner" />
                ) : mode === "edit" ? (
                  t("schedules.saveChanges")
                ) : (
                  t("schedules.createSchedule")
                )}
              </button>
            </div>
          </>
        )}
      </header>

      {error && (
        <div className="schedules-error">
          <span>{error}</span>
          <button type="button" onClick={loadJobs}>
            {t("schedules.retry")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {mode !== "view" ? (
        <ScheduleEditor
          mode={mode}
          form={form}
          profiles={profiles}
          saving={actionInProgress === "saving"}
          validation={validation}
          t={t}
          onChange={setForm}
          onSave={saveEditor}
        />
      ) : schedules.length === 0 ? (
        <main className="schedules-empty">
          <CalendarClock size={48} />
          <p className="schedules-empty-text">{t("schedules.empty")}</p>
          <p className="schedules-empty-hint">{t("schedules.emptyHint")}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={beginCreate}
          >
            <Plus size={14} />
            {t("schedules.createSchedule")}
          </button>
        </main>
      ) : (
        <div className="schedules-shell">
          <aside className="schedules-daily-strip">
            <div className="schedules-strip-label">{t("schedules.daily")}</div>
            {dailySchedules.length > 0 && (
              <div
                className="schedules-now-indicator"
                style={{ transform: `translateY(${nowPosition}px)` }}
              >
                <i />
                <span>{t("schedules.now")}</span>
              </div>
            )}
            {dailySchedules.length === 0 ? (
              <div className="schedules-daily-empty">
                <Repeat size={24} />
                <strong>{t("schedules.noDailyAgents")}</strong>
                <span>{t("schedules.dailyHint")}</span>
              </div>
            ) : (
              dailySchedules.map((schedule) => (
                <ScheduleCard
                  key={schedule.id}
                  variant="daily"
                  {...cardProps(schedule)}
                />
              ))
            )}
          </aside>

          <main className="schedules-main">
            {view === "week" ? (
              <div className="schedules-week-grid">
                {weekDays.map((day, index) => {
                  const daySchedules = nonDailySchedules
                    .filter((schedule) =>
                      scheduleOccursOn(schedule, day, false),
                    )
                    .sort(scheduleSort);
                  const today = isSameDay(day, new Date());
                  const past = day < new Date(new Date().setHours(0, 0, 0, 0));
                  return (
                    <section
                      key={day.toISOString()}
                      className={`schedules-week-column ${today ? "is-today" : ""} ${past ? "is-past" : ""}`}
                    >
                      <header>
                        <span>
                          {t(`schedules.dayShort.${WEEK_DAYS[index].key}`)}
                        </span>
                        <strong>{day.getDate()}</strong>
                      </header>
                      <div className="schedules-week-body">
                        {daySchedules.length ? (
                          daySchedules.map((schedule) => (
                            <ScheduleCard
                              key={schedule.id}
                              variant="grid"
                              {...cardProps(schedule)}
                            />
                          ))
                        ) : (
                          <div className="schedules-empty-day">-</div>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="schedules-month-view">
                <div className="schedules-month-nav">
                  <div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        setMonthDate(
                          new Date(
                            monthDate.getFullYear(),
                            monthDate.getMonth() - 1,
                            1,
                          ),
                        )
                      }
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <strong>
                      {monthDate.toLocaleDateString(undefined, {
                        month: "long",
                        year: "numeric",
                      })}
                    </strong>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        setMonthDate(
                          new Date(
                            monthDate.getFullYear(),
                            monthDate.getMonth() + 1,
                            1,
                          ),
                        )
                      }
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <label className="schedules-show-daily">
                    <input
                      type="checkbox"
                      checked={showDailyInMonth}
                      onChange={(event) =>
                        setShowDailyInMonth(event.target.checked)
                      }
                    />
                    <span>{showDailyInMonth && <Check size={10} />}</span>
                    {t("schedules.showDaily")}
                  </label>
                </div>
                <div className="schedules-month-days">
                  {WEEK_DAYS.map((day) => (
                    <span key={day.key}>
                      {t(`schedules.dayShort.${day.key}`)}
                    </span>
                  ))}
                </div>
                <div className="schedules-month-grid">
                  {monthCells.map((day) => {
                    const inMonth = day.getMonth() === monthDate.getMonth();
                    const daySchedules = schedules
                      .filter(
                        (schedule) =>
                          inMonth &&
                          scheduleOccursOn(schedule, day, showDailyInMonth),
                      )
                      .sort(scheduleSort);
                    return (
                      <button
                        type="button"
                        key={day.toISOString()}
                        className={[
                          "schedules-month-cell",
                          inMonth ? "" : "is-outside",
                          isSameDay(day, new Date()) ? "is-today" : "",
                          selectedMonthDate && isSameDay(day, selectedMonthDate)
                            ? "is-selected"
                            : "",
                        ].join(" ")}
                        onClick={() => inMonth && setSelectedMonthDate(day)}
                      >
                        <span>{day.getDate()}</span>
                        <div className="schedules-month-dots">
                          {daySchedules.slice(0, 3).map((schedule) => (
                            <i
                              key={schedule.id}
                              className={schedule.kind === "once" ? "once" : ""}
                            />
                          ))}
                          {daySchedules.length > 3 && (
                            <em>+{daySchedules.length - 3}</em>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {selectedMonthDate && (
                  <div className="schedules-day-panel">
                    <header>
                      <strong>
                        {selectedMonthDate.toLocaleDateString(undefined, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })}
                      </strong>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setSelectedMonthDate(null)}
                      >
                        <X size={14} />
                      </button>
                    </header>
                    {schedules.filter((schedule) =>
                      scheduleOccursOn(
                        schedule,
                        selectedMonthDate,
                        showDailyInMonth,
                      ),
                    ).length ? (
                      schedules
                        .filter((schedule) =>
                          scheduleOccursOn(
                            schedule,
                            selectedMonthDate,
                            showDailyInMonth,
                          ),
                        )
                        .sort(scheduleSort)
                        .map((schedule) => (
                          <ScheduleCard
                            key={schedule.id}
                            variant="panel"
                            {...cardProps(schedule)}
                          />
                        ))
                    ) : (
                      <div className="schedules-panel-empty">
                        {t("schedules.noSchedulesOnDay")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {deleteTarget && (
        <div
          className="skills-detail-overlay"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="schedules-modal schedules-modal-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="schedules-modal-header">
              <h3>{t("schedules.deleteTaskTitle")}</h3>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setDeleteTarget(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="schedules-modal-body">
              <p className="schedules-confirm-text">
                {t("schedules.deleteConfirmText")}
              </p>
            </div>
            <div className="schedules-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDeleteTarget(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={removeSchedule}
                disabled={actionInProgress === deleteTarget.id}
              >
                {actionInProgress === deleteTarget.id
                  ? t("schedules.deleting")
                  : t("schedules.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Schedules;

export type ScheduleState = "active" | "paused" | "completed";

export type ScheduleKind =
  | "once"
  | "interval"
  | "daily"
  | "weekly"
  | "monthly"
  | "custom";

export interface ScheduleRepeat {
  times: number | null;
  completed: number;
}

export interface ScheduleRunLink {
  id?: string;
  traceId?: string;
  sessionId?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
}

export interface ScheduleContextMetadata {
  conversationId?: string;
  sessionId?: string;
  traceId?: string;
  title?: string;
  excerpt?: string;
  [key: string]: unknown;
}

export interface ScheduleTiming {
  kind: ScheduleKind;
  cron?: string;
  at?: string;
  every?: number;
  unit?: "minutes" | "hours" | "days";
  time?: string;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  timezone?: string;
  [key: string]: unknown;
}

export interface ScheduleCreatePayload {
  id?: string;
  name?: string;
  prompt?: string;
  schedule?: string | ScheduleTiming;
  timing?: ScheduleTiming;
  kind?: ScheduleKind;
  repeat?: ScheduleRepeat | null;
  deliver?: string | string[];
  skills?: string[];
  script?: string | null;
  enabled?: boolean;
  context?: ScheduleContextMetadata | Record<string, unknown>;
  conversation?: ScheduleContextMetadata | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  sourceSessionId?: string;
  sourceTraceId?: string;
  runHistory?: ScheduleRunLink[];
  recentRuns?: ScheduleRunLink[];
  [key: string]: unknown;
}

export interface ScheduleUpdatePayload extends Partial<ScheduleCreatePayload> {
  id?: string;
  state?: ScheduleState;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  state: ScheduleState;
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
  repeat: ScheduleRepeat | null;
  deliver: string[];
  skills: string[];
  script: string | null;
  schedule_type?: ScheduleKind;
  timing?: ScheduleTiming;
  context?: ScheduleContextMetadata | Record<string, unknown>;
  conversation?: ScheduleContextMetadata | Record<string, unknown>;
  metadata?: Record<string, unknown>;
  source_session_id?: string;
  source_trace_id?: string;
  run_history?: ScheduleRunLink[];
  recent_runs?: ScheduleRunLink[];
  [key: string]: unknown;
}

export type CronMutationResult = {
  success: boolean;
  id?: string;
  error?: string;
};

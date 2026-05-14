export type TraceEventType =
  | "run.started"
  | "message.user"
  | "message.agent.delta"
  | "message.history.loaded"
  | "session.resumed"
  | "slash.local"
  | "tool.progress"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "delegation.started"
  | "delegation.completed"
  | "delegation.failed"
  | "artifact.created"
  | "approval.requested"
  | "approval.resolved"
  | "transport.error"
  | "usage.recorded"
  | "run.completed"
  | "run.failed"
  | "run.aborted"
  | "skill.used"
  | "skill.eval"
  | "skill.promoted"
  | "skill.rejected";

export interface LocalChatTraceRequest {
  command: string;
  profile?: string;
  responsePreview?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  rateLimitRemaining?: number;
  rateLimitReset?: number;
}

export interface TraceEvent {
  id: string;
  runId: string;
  type: TraceEventType;
  timestamp: number;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceRun {
  id: string;
  title: string;
  profile: string;
  status: "running" | "completed" | "failed" | "aborted";
  startedAt: number;
  updatedAt: number;
  sessionId?: string;
  messagePreview: string;
  events: TraceEvent[];
  usage?: TraceUsage;
}

export interface SkillTrainingRun {
  id: string;
  skillName: string;
  status: "candidate" | "evaluating" | "needs-review" | "promoted" | "rejected";
  score?: number;
  linkedRunId?: string;
  summary: string;
  updatedAt: number;
}

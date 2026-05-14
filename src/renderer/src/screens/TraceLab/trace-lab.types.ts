import {
  Activity,
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Database,
  FileImage,
  FileSearch,
  Gauge,
  History,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import type { TraceEvent } from "../../../../shared/traces";

export const EVENT_LABELS: Record<string, string> = {
  "run.started": "Run started",
  "message.user": "User",
  "message.agent.delta": "Agent",
  "message.history.loaded": "History loaded",
  "session.resumed": "Session resumed",
  "slash.local": "Local command",
  "tool.progress": "Tool progress",
  "tool.started": "Tool started",
  "tool.completed": "Tool completed",
  "tool.failed": "Tool failed",
  "delegation.started": "Delegation started",
  "delegation.completed": "Delegation completed",
  "delegation.failed": "Delegation failed",
  "artifact.created": "Artifact created",
  "approval.requested": "Approval requested",
  "approval.resolved": "Approval resolved",
  "transport.error": "Transport error",
  "usage.recorded": "Usage",
  "run.completed": "Completed",
  "run.failed": "Failed",
  "run.aborted": "Aborted",
  "skill.used": "Skill used",
  "skill.eval": "Skill eval",
  "skill.promoted": "Promoted",
  "skill.rejected": "Rejected",
};

export const EVENT_ICONS: Record<string, typeof Activity> = {
  "run.started": Activity,
  "message.user": FileSearch,
  "message.agent.delta": Sparkles,
  "message.history.loaded": History,
  "session.resumed": Clock3,
  "slash.local": MessageSquareText,
  "tool.progress": Wrench,
  "tool.started": Wrench,
  "tool.completed": CheckCircle2,
  "tool.failed": AlertCircle,
  "delegation.started": Users,
  "delegation.completed": Users,
  "delegation.failed": AlertCircle,
  "artifact.created": FileImage,
  "approval.requested": ShieldCheck,
  "approval.resolved": ShieldCheck,
  "transport.error": AlertCircle,
  "usage.recorded": Gauge,
  "run.completed": CheckCircle2,
  "run.failed": AlertCircle,
  "run.aborted": AlertCircle,
  "skill.used": BrainCircuit,
  "skill.eval": Database,
  "skill.promoted": CheckCircle2,
  "skill.rejected": AlertCircle,
};

export type RunMapStep = {
  key: string;
  label: string;
  caption: string;
  event?: TraceEvent;
  icon: typeof Activity;
  tone: "blue" | "green" | "amber" | "red" | "neutral";
};

export type Narrative = { happened: string; matters: string };
export type RunFilter = "all" | "completed" | "needs-attention" | "skills";

export const RUN_FILTERS: { key: RunFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "completed", label: "Completed" },
  { key: "needs-attention", label: "Needs attention" },
  { key: "skills", label: "Skill signals" },
];

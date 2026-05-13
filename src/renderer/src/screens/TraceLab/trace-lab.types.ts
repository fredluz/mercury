import { Activity, AlertCircle, BrainCircuit, CheckCircle2, Database, FileSearch, Gauge, Sparkles, Wrench } from "lucide-react";
import type { TraceEvent } from "../../../../shared/traces";

export const EVENT_LABELS: Record<string, string> = {
  "run.started": "Run started",
  "message.user": "User",
  "message.agent.delta": "Agent",
  "tool.progress": "Tool",
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
  "tool.progress": Wrench,
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

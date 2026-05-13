import { Activity, AlertCircle, BrainCircuit, CheckCircle2, FileCode2, FileSearch, Route, Wrench } from "lucide-react";
import type { TraceEvent, TraceRun } from "../../../../shared/traces";
import type { Narrative, RunFilter, RunMapStep } from "./trace-lab.types";

export function buildRunMap(run: TraceRun): RunMapStep[] {
  const firstOf = (types: TraceEvent["type"][]): TraceEvent | undefined =>
    run.events.find((event) => types.includes(event.type));
  const anyTool = run.events.find((event) => event.type.includes("tool"));
  const anySkill = run.events.find((event) => event.type.startsWith("skill."));
  const anyFile =
    run.events.find((event) =>
      /file|edit|patch|write/i.test(event.detail || ""),
    ) || anyTool;

  return [
    {
      key: "ask",
      label: "Ask",
      caption: "The user's request was captured as the run goal.",
      event: firstOf(["message.user", "run.started"]),
      icon: FileSearch,
      tone: "blue",
    },
    {
      key: "plan",
      label: "Planning",
      caption: "Hermes framed the work before acting.",
      event: firstOf(["run.started"]),
      icon: Route,
      tone: "green",
    },
    {
      key: "tools",
      label: "Tool Calls",
      caption: anyTool
        ? "The agent used tools to inspect or change the workspace."
        : "No tool activity was emitted for this run.",
      event: anyTool,
      icon: Wrench,
      tone: anyTool ? "blue" : "neutral",
    },
    {
      key: "files",
      label: "Files Edited",
      caption: anyFile
        ? "Workspace changes are linked to the trace."
        : "No file edits were reported in this trace.",
      event: anyFile,
      icon: FileCode2,
      tone: anyFile ? "amber" : "neutral",
    },
    {
      key: "skills",
      label: "Skill Notes",
      caption: anySkill
        ? "A skill signal was captured for evaluation."
        : "No skill-learning signal was emitted yet.",
      event: anySkill,
      icon: BrainCircuit,
      tone: anySkill ? "green" : "neutral",
    },
    {
      key: "answer",
      label: "Answer",
      caption:
        run.status === "completed"
          ? "Hermes returned a completed response."
          : "Hermes has not completed this run yet.",
      event: firstOf(["run.completed", "run.failed", "run.aborted"]),
      icon:
        run.status === "completed"
          ? CheckCircle2
          : run.status === "running"
            ? Activity
            : AlertCircle,
      tone:
        run.status === "completed"
          ? "green"
          : run.status === "running"
            ? "blue"
            : "red",
    },
  ];
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
    case "tool.progress":
      return {
        happened: event.detail || "Hermes reported progress from a tool call.",
        matters:
          "Tool events show when the agent touched external systems, files, commands, or project context.",
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

export function traceRunMatchesSearch(run: TraceRun, query: string): boolean {
  const searchable = [
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
  ]
    .join("\n")
    .toLowerCase();
  return searchable.includes(query);
}

export function traceRunMatchesFilter(run: TraceRun, filter: RunFilter): boolean {
  if (filter === "completed") return run.status === "completed";
  if (filter === "needs-attention") {
    return run.status === "failed" || run.status === "aborted";
  }
  if (filter === "skills") {
    return run.events.some((event) => event.type.startsWith("skill."));
  }
  return true;
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

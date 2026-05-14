import {
  Activity,
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  FileCode2,
  FileImage,
  FileSearch,
  History,
  Route,
  ShieldCheck,
  Users,
  Wrench,
} from "lucide-react";
import type { TraceEvent, TraceRun } from "../../../../shared/traces";
import type { Narrative, RunFilter, RunMapStep } from "./trace-lab.types";

export function buildRunMap(run: TraceRun): RunMapStep[] {
  const firstOf = (types: TraceEvent["type"][]): TraceEvent | undefined =>
    run.events.find((event) => types.includes(event.type));
  const firstMatching = (
    matcher: (event: TraceEvent) => boolean,
  ): TraceEvent | undefined => run.events.find(matcher);

  const contextEvent = firstOf(["session.resumed", "message.history.loaded"]);
  const toolEvents = run.events.filter((event) => event.type.startsWith("tool."));
  const delegationEvents = run.events.filter((event) =>
    event.type.startsWith("delegation."),
  );
  const toolEvent = pickLifecycleEvent(toolEvents);
  const delegationEvent = pickLifecycleEvent(delegationEvents);
  const approvalEvent = firstMatching((event) => event.type.startsWith("approval."));
  const artifactEvent = firstOf(["artifact.created"]);
  const anySkill = firstMatching((event) => event.type.startsWith("skill."));
  const anyFile = toolEvents.find((event) => {
    const metadata = event.metadata || {};
    const toolName = String(
      metadata.toolName || metadata.tool || metadata.name || event.title || "",
    );
    const metadataText = safeStringify(metadata);
    return (
      /file|edit|patch|write/i.test(toolName) ||
      /filePath|workspacePath|filename|diff|patch/i.test(metadataText)
    );
  });
  const terminalEvent = firstOf(["run.completed", "run.failed", "run.aborted"]);

  const steps: RunMapStep[] = [
    {
      key: "ask",
      label: "Ask",
      caption: "The user's request was captured as the run goal.",
      event: firstOf(["message.user", "run.started"]),
      icon: FileSearch,
      tone: "blue",
    },
  ];

  if (contextEvent) {
    steps.push({
      key: "context",
      label: "Context",
      caption:
        contextEvent.type === "session.resumed"
          ? "Hermes resumed an existing conversation before answering."
          : "Prior messages were loaded without storing their raw content in this trace.",
      event: contextEvent,
      icon: contextEvent.type === "session.resumed" ? Clock3 : History,
      tone: "blue",
    });
  }

  steps.push({
    key: "plan",
    label: "Planning",
    caption: "Hermes framed the work before acting.",
    event: firstOf(["run.started"]),
    icon: Route,
    tone: "green",
  });

  if (approvalEvent) {
    steps.push({
      key: "approval",
      label: "Approval",
      caption: "A permission gate was requested or resolved during the run.",
      event: approvalEvent,
      icon: ShieldCheck,
      tone: approvalEvent.type === "approval.requested" ? "amber" : "green",
    });
  }

  if (toolEvent) {
    steps.push({
      key: "tools",
      label: "Tool Calls",
      caption: "The agent used tools to inspect, create, or change external context.",
      event: toolEvent,
      icon: Wrench,
      tone: toolEvent.type === "tool.failed" ? "red" : "blue",
    });
  }

  if (delegationEvent) {
    steps.push({
      key: "delegation",
      label: "Delegation",
      caption: "A sub-agent or delegated task contributed to the run.",
      event: delegationEvent,
      icon: Users,
      tone: delegationEvent.type === "delegation.failed" ? "red" : "green",
    });
  }

  if (anyFile) {
    steps.push({
      key: "files",
      label: "Files Edited",
      caption: "Workspace file activity was linked to the trace metadata or detail.",
      event: anyFile,
      icon: FileCode2,
      tone: "amber",
    });
  }

  if (artifactEvent) {
    steps.push({
      key: "artifacts",
      label: "Artifacts",
      caption: "A generated file, image, or output reference was attached to the run.",
      event: artifactEvent,
      icon: FileImage,
      tone: "amber",
    });
  }

  if (anySkill) {
    steps.push({
      key: "skills",
      label: "Skill Notes",
      caption: "A skill signal was captured for evaluation.",
      event: anySkill,
      icon: BrainCircuit,
      tone: "green",
    });
  }

  steps.push({
    key: "answer",
    label: "Answer",
    caption:
      run.status === "completed"
        ? "Hermes returned a completed response."
        : run.status === "running"
          ? "Hermes is still working on this run."
          : "Hermes stopped before a successful completion.",
    event: terminalEvent,
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
  });

  return steps;
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
    return (
      run.status === "failed" ||
      run.status === "aborted" ||
      run.events.some((event) =>
        ["tool.failed", "delegation.failed", "transport.error"].includes(
          event.type,
        ),
      )
    );
  }
  if (filter === "skills") {
    return run.events.some((event) => event.type.startsWith("skill."));
  }
  return true;
}

function pickLifecycleEvent(events: TraceEvent[]): TraceEvent | undefined {
  return (
    events.find((event) => event.type.endsWith(".failed")) ||
    events.find((event) => event.type.endsWith(".completed")) ||
    events.find((event) => event.type.endsWith(".started")) ||
    events[0]
  );
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

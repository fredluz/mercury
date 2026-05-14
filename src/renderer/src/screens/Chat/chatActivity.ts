import type { TraceEvent, TraceEventType } from "../../../../shared/traces";
import type { ChatActivityGroupStatus } from "./types";

export interface ChatActivitySummary {
  key: string;
  label: string;
  count: number;
  status: "running" | "completed" | "failed" | "waiting" | "info";
}

const TOOL_LABELS: Record<string, string> = {
  read_file: "Read File",
  file_search: "Search Files",
  get_file_tree: "File Tree",
  apply_edits: "Edit File",
  apply_patch: "Edit File",
  exec_command: "Run Command",
  imagegen: "Generate Image",
};

export function isChatActivityEvent(event: TraceEvent): boolean {
  return isChatActivityEventType(event.type);
}

export function isChatActivityEventType(type: TraceEventType): boolean {
  return (
    type.startsWith("tool.") ||
    type.startsWith("delegation.") ||
    type === "artifact.created" ||
    type.startsWith("approval.") ||
    type === "transport.error"
  );
}

export function summarizeActivityEvents(events: TraceEvent[]): ChatActivitySummary[] {
  const summaries = new Map<string, ChatActivitySummary>();
  for (const event of events.filter(isChatActivityEvent)) {
    const key = activityKeyForEvent(event);
    const current = summaries.get(key);
    if (!current) {
      summaries.set(key, {
        key,
        label: activityLabelForEvent(event),
        count: 1,
        status: activityStatusForEvent(event),
      });
      continue;
    }
    current.count += 1;
    current.status = mergeSummaryStatus(current.status, activityStatusForEvent(event));
  }
  return Array.from(summaries.values());
}

export function activityStatusForGroup(events: TraceEvent[], fallback: ChatActivityGroupStatus): ChatActivitySummary["status"] {
  const statuses = events.map(activityStatusForEvent);
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("waiting")) return "waiting";
  if (fallback === "failed") return "failed";
  if (fallback === "aborted") return "failed";
  if (fallback === "running") return statuses.includes("running") ? "running" : "info";
  return "completed";
}

export function activityStatusForEvent(event: TraceEvent): ChatActivitySummary["status"] {
  if (event.type === "transport.error" || event.type.endsWith(".failed")) return "failed";
  if (event.type === "approval.requested") return "waiting";
  if (event.type.endsWith(".started") || event.type === "tool.progress") return "running";
  if (event.type.endsWith(".completed") || event.type === "approval.resolved") return "completed";
  return "info";
}

export function activityLabelForEvent(event: TraceEvent): string {
  if (event.type.startsWith("tool.")) return humanizeToolName(toolNameForEvent(event));
  if (event.type.startsWith("delegation.")) return "Delegation";
  if (event.type === "artifact.created") {
    const kind = stringMeta(event, "artifactType");
    return kind ? `${capitalize(kind)} artifact` : "Artifact";
  }
  if (event.type.startsWith("approval.")) return "Approval";
  if (event.type === "transport.error") return "Transport error";
  return event.title || event.type;
}

export function formatActivityMetadata(metadata?: Record<string, unknown>): string[] {
  if (!metadata) return [];
  return Object.entries(metadata)
    .filter(([, value]) => value !== undefined && value !== "")
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${formatValue(value)}`);
}

function activityKeyForEvent(event: TraceEvent): string {
  if (event.type.startsWith("tool.")) return `tool:${toolNameForEvent(event).toLowerCase()}`;
  if (event.type.startsWith("delegation.")) return "delegation";
  if (event.type === "artifact.created") return `artifact:${stringMeta(event, "artifactType") || "file"}`;
  if (event.type.startsWith("approval.")) return "approval";
  if (event.type === "transport.error") return "transport";
  return event.type;
}

function toolNameForEvent(event: TraceEvent): string {
  return (
    stringMeta(event, "toolName") ||
    stringMeta(event, "tool") ||
    stringMeta(event, "name") ||
    event.title.replace(/^Tool (?:started|completed|failed|progress):\s*/i, "") ||
    "Tool"
  );
}

function stringMeta(event: TraceEvent, key: string): string | undefined {
  const value = event.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function humanizeToolName(name: string): string {
  const normalized = name.trim();
  if (!normalized) return "Tool";
  const known = TOOL_LABELS[normalized.toLowerCase()];
  if (known) return known;
  return normalized
    .replace(/^[^\p{Letter}\p{Number}]+/u, "")
    .replace(/[_.-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function mergeSummaryStatus(
  current: ChatActivitySummary["status"],
  next: ChatActivitySummary["status"],
): ChatActivitySummary["status"] {
  const priority: Record<ChatActivitySummary["status"], number> = {
    failed: 5,
    waiting: 4,
    running: 3,
    completed: 2,
    info: 1,
  };
  return priority[next] > priority[current] ? next : current;
}

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 159)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 160 ? `${serialized.slice(0, 159)}…` : serialized;
  } catch {
    return String(value);
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

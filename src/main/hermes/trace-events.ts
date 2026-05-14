import type { ChatTraceCallbackEvent } from "./types";

type JsonRecord = Record<string, unknown>;

const SECRET_KEY_RE = /api[_-]?key|token|authorization|secret|password|credential/i;
const MAX_STRING_LENGTH = 2000;
const MAX_DETAIL_LENGTH = 500;
const IMAGE_URL_RE = /https?:\/\/\S+?(?:\.png|\.jpe?g|\.gif|\.webp|\.svg)(?:[?#][^\s)]*)?/gi;
const IMAGE_PATH_RE =
  /(?:saved|wrote|written|created|exported|returned)\s*(?:to|at|:)?\s+((?:file:\/\/)?[~/\w.-][^\s`)]*\.(?:png|jpe?g|gif|webp|svg))/gi;
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function sanitizeTraceMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) continue;
    sanitized[key] = sanitizeTraceValue(raw);
  }
  return sanitized;
}

function sanitizeTraceValue(value: unknown): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return cap(value, MAX_STRING_LENGTH);
  if (Array.isArray(value)) {
    return cap(JSON.stringify(value.map((item) => sanitizeTraceValue(item))), MAX_STRING_LENGTH);
  }
  if (isRecord(value)) {
    const nested: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) continue;
      nested[key] = sanitizeTraceValue(raw);
    }
    return cap(JSON.stringify(nested), MAX_STRING_LENGTH);
  }
  return cap(String(value), MAX_STRING_LENGTH);
}

export function normalizeHermesStreamEvent(
  eventType: string,
  payload: unknown,
): ChatTraceCallbackEvent[] {
  const metadata = buildMetadata(payload, { streamEvent: eventType });
  const record = isRecord(payload) ? payload : {};

  if (eventType === "hermes.tool.progress") {
    return normalizeToolEvent(record, metadata);
  }

  if (eventType.startsWith("hermes.approval.")) {
    const resolved = /approved|denied|resolved/i.test(eventType);
    return [
      {
        type: resolved ? "approval.resolved" : "approval.requested",
        title: resolved ? "Approval resolved" : "Approval requested",
        detail: detailFromPayload(record),
        metadata,
      },
    ];
  }

  if (eventType === "hermes.artifact.created") {
    return [
      {
        type: "artifact.created",
        title: "Artifact created",
        detail: detailFromPayload(record),
        metadata: { ...metadata, artifactType: metadata.artifactType || "file" },
      },
    ];
  }

  return [];
}

export function normalizeCliProgressLine(line: string): ChatTraceCallbackEvent[] {
  const text = line.trim();
  if (!text) return [];
  if (/delegate|subagent/i.test(text)) {
    return [
      {
        type: /fail|error/i.test(text) ? "delegation.failed" : "delegation.started",
        title: /fail|error/i.test(text) ? "Delegation failed" : "Delegation progress",
        detail: cap(text, MAX_DETAIL_LENGTH),
        metadata: { source: "cli" },
      },
    ];
  }
  if (/tool|running|executing|calling|🔧|🛠️/i.test(text)) {
    const events: ChatTraceCallbackEvent[] = [
      {
        type: /fail|error/i.test(text) ? "tool.failed" : "tool.progress",
        title: /fail|error/i.test(text) ? "Tool failed" : "Tool progress",
        detail: cap(text, MAX_DETAIL_LENGTH),
        metadata: { source: "cli" },
      },
    ];
    events.push(...extractArtifactEventsFromText(text));
    return events;
  }
  return [];
}

export function extractArtifactEventsFromText(text: string): ChatTraceCallbackEvent[] {
  const events: ChatTraceCallbackEvent[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const alt = match[1] || undefined;
    const url = match[2]?.trim();
    if (url) addArtifact(events, seen, { url, alt, source: "response-scan" });
  }

  for (const match of text.matchAll(IMAGE_URL_RE)) {
    const url = match[0].replace(/[),.;]+$/, "");
    addArtifact(events, seen, { url, source: "response-scan" });
  }

  for (const match of text.matchAll(IMAGE_PATH_RE)) {
    const path = match[1]?.replace(/[),.;]+$/, "");
    if (path) addArtifact(events, seen, { path, source: "response-scan" });
  }

  return events;
}

function normalizeToolEvent(
  record: JsonRecord,
  metadata: JsonRecord,
): ChatTraceCallbackEvent[] {
  const label = toolLabel(record);
  const status = String(record.status || record.phase || "").toLowerCase();
  const isDelegation = /delegate|subagent|delegate_task/i.test(label);
  const failed = /fail|error|denied/i.test(status);
  const completed = /complete|completed|done|success/i.test(status);
  const started = /start|started|begin|running/i.test(status);
  const type = isDelegation
    ? failed
      ? "delegation.failed"
      : completed
        ? "delegation.completed"
        : started
          ? "delegation.started"
          : "delegation.started"
    : failed
      ? "tool.failed"
      : completed
        ? "tool.completed"
        : started
          ? "tool.started"
          : "tool.progress";
  const title = isDelegation ? delegationTitle(type) : toolTitle(type, label);
  const events: ChatTraceCallbackEvent[] = [
    {
      type,
      title,
      detail: detailFromPayload(record) || label,
      metadata: { ...metadata, toolName: label || undefined },
    },
  ];

  if (/image|generate_image|image_gen/i.test(label)) {
    const artifact = firstString(
      record.image,
      record.url,
      record.path,
      record.artifact,
      record.output,
      record.result,
      resultField(record.result, "image"),
      resultField(record.result, "url"),
      resultField(record.result, "path"),
    );
    if (artifact) {
      events.push({
        type: "artifact.created",
        title: "Image artifact created",
        detail: cap(artifact, MAX_DETAIL_LENGTH),
        metadata: {
          ...metadata,
          artifactType: "image",
          source: "tool-progress",
          url: /^https?:\/\//i.test(artifact) ? artifact : undefined,
          path: /^https?:\/\//i.test(artifact) ? undefined : artifact,
        },
      });
    }
  }

  return events;
}

function buildMetadata(payload: unknown, extra: JsonRecord): JsonRecord {
  const payloadMetadata = isRecord(payload) ? sanitizeTraceMetadata(payload) || {} : {};
  return { ...payloadMetadata, ...extra };
}

function toolLabel(record: JsonRecord): string {
  return firstString(record.tool, record.tool_name, record.name, record.label, record.function) || "tool";
}

function detailFromPayload(record: JsonRecord): string | undefined {
  return firstString(record.label, record.message, record.detail, record.status, record.phase)?.slice(0, MAX_DETAIL_LENGTH);
}

function addArtifact(
  events: ChatTraceCallbackEvent[],
  seen: Set<string>,
  metadata: JsonRecord,
): void {
  const key = String(metadata.url || metadata.path || "");
  if (!key || seen.has(key)) return;
  seen.add(key);
  events.push({
    type: "artifact.created",
    title: "Artifact created",
    detail: cap(key, MAX_DETAIL_LENGTH),
    metadata: { ...metadata, artifactType: "image" },
  });
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function resultField(value: unknown, key: string): string | undefined {
  if (isRecord(value)) return firstString(value[key]);
  if (typeof value !== "string" || !value.trim().startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? firstString(parsed[key]) : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cap(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toolTitle(type: ChatTraceCallbackEvent["type"], label: string): string {
  if (type === "tool.started") return `Tool started: ${label}`;
  if (type === "tool.completed") return `Tool completed: ${label}`;
  if (type === "tool.failed") return `Tool failed: ${label}`;
  return `Tool progress: ${label}`;
}

function delegationTitle(type: ChatTraceCallbackEvent["type"]): string {
  if (type === "delegation.completed") return "Delegation completed";
  if (type === "delegation.failed") return "Delegation failed";
  return "Delegation started";
}

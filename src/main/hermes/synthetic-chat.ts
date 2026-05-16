import type { ChatCallbacks, ChatHandle } from "./types";

const SYNTHETIC_STREAM_FLAG = "MERCURY_CHAT_SYNTHETIC_STREAM";
const DEFAULT_CHUNKS = 80;
const DEFAULT_INTERVAL_MS = 8;
const MAX_CHUNKS = 10_000;
const MAX_INTERVAL_MS = 60_000;

type SyntheticPayloadKind = "plain" | "markdown" | "code";

let syntheticSessionCounter = 0;

function envEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.floor(parsed);
  if (integer < min) return fallback;
  return Math.min(integer, max);
}

function getPayloadKind(value: string | undefined): SyntheticPayloadKind {
  if (value === "markdown" || value === "code" || value === "plain") return value;
  return "plain";
}

export function isSyntheticChatStreamEnabled(): boolean {
  return envEnabled(process.env[SYNTHETIC_STREAM_FLAG]);
}

function syntheticChunk(index: number, total: number, payload: SyntheticPayloadKind): string {
  const ordinal = String(index + 1).padStart(3, "0");
  switch (payload) {
    case "markdown":
      return index === 0
        ? `## Synthetic chat stream\n\n- chunk ${ordinal} of ${total}\n`
        : `- deterministic markdown chunk ${ordinal} of ${total}\n`;
    case "code":
      if (index === 0) return "```ts\n";
      if (index === total - 1) return `const syntheticChunk${ordinal} = ${index + 1};\n\`\`\`\n`;
      return `const syntheticChunk${ordinal} = ${index + 1};\n`;
    case "plain":
    default:
      return `Synthetic chat chunk ${ordinal} of ${total}. `;
  }
}

export function sendSyntheticChatStream(
  _message: string,
  cb: ChatCallbacks,
  _profile?: string,
  resumeSessionId?: string,
  _history?: Array<{ role: string; content: string }>,
): ChatHandle {
  const totalChunks = parseBoundedInteger(
    process.env.MERCURY_CHAT_SYNTHETIC_CHUNKS,
    DEFAULT_CHUNKS,
    1,
    MAX_CHUNKS,
  );
  const intervalMs = parseBoundedInteger(
    process.env.MERCURY_CHAT_SYNTHETIC_INTERVAL_MS,
    DEFAULT_INTERVAL_MS,
    0,
    MAX_INTERVAL_MS,
  );
  const payload = getPayloadKind(process.env.MERCURY_CHAT_SYNTHETIC_PAYLOAD);
  const sessionId = resumeSessionId || `synthetic-session-${++syntheticSessionCounter}`;

  let aborted = false;
  let emitted = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const emitNext = (): void => {
    if (aborted) return;
    if (emitted >= totalChunks) {
      cb.onDone(sessionId);
      return;
    }
    cb.onChunk(syntheticChunk(emitted, totalChunks, payload));
    emitted += 1;
    if (emitted >= totalChunks) {
      cb.onDone(sessionId);
      return;
    }
    timer = setTimeout(emitNext, intervalMs);
  };

  timer = setTimeout(emitNext, intervalMs);

  return {
    abort: () => {
      aborted = true;
      clearTimer();
    },
  };
}

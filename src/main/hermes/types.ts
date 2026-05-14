import type { TraceEventType } from "../../shared/traces";

export interface ChatHandle {
  abort: () => void;
}

export interface ChatTraceCallbackEvent {
  type: TraceEventType;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatCallbacks {
  onChunk: (text: string) => void;
  onDone: (sessionId?: string) => void;
  onError: (error: string) => void;
  onToolProgress?: (tool: string) => void;
  onTraceEvent?: (event: ChatTraceCallbackEvent) => void;
  onUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: number;
  }) => void;
}


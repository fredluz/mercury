import type React from "react";
import type { MutableRefObject } from "react";
import type { AgentChatOptions } from "../../../../../shared/agents";
import type { ChatActivityGroupStatus, ChatMessage } from "../types";
import type { ChatPerfTracker } from "./chatPerf";

type HistoryMessage = { role: string; content: string };

interface BaseSendFlowContext {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  profile?: string;
  chatOptions?: AgentChatOptions;
  beginChatRun: () => number;
  finalizeChatRun: (runSeq: number, status: ChatActivityGroupStatus) => boolean;
  beginActivityGroup: (anchorMessageId: string) => void;
  getResumeSessionId: () => string | undefined;
  appendFallbackSendError: (error: unknown) => void;
}

interface NormalSendFlowContext extends BaseSendFlowContext {
  text: string;
  perf: ChatPerfTracker;
  titleRequestSeqRef: MutableRefObject<number>;
  isSendRunCurrentOrFinalized: (runSeq: number) => boolean;
  setHermesSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  sessionIdRef: MutableRefObject<string | null>;
  requestGeneratedTitleOnce: (
    resolvedSessionId: string | undefined,
    conversationMessages: ChatMessage[],
    requestSeq: number,
  ) => Promise<void>;
  onSessionStarted?: () => void;
  onSessionResolved?: (sessionId: string) => void;
}

interface QuickAskSendFlowContext extends BaseSendFlowContext {
  text: string;
  perf: ChatPerfTracker;
  isSendRunCurrentOrFinalized: (runSeq: number) => boolean;
  setHermesSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  sessionIdRef: MutableRefObject<string | null>;
  onSessionResolved?: (sessionId: string) => void;
}

interface ApprovalSendFlowContext extends BaseSendFlowContext {
  command: "/approve" | "/deny";
}

function historyFrom(messages: ChatMessage[]): HistoryMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function sendMessageWithOptionalOptions(
  message: string,
  profile: string | undefined,
  resumeSessionId: string | undefined,
  history: HistoryMessage[],
  options: AgentChatOptions | undefined,
): Promise<{ response: string; sessionId?: string }> {
  return options
    ? window.hermesAPI.sendMessage(message, profile, resumeSessionId, history, options)
    : window.hermesAPI.sendMessage(message, profile, resumeSessionId, history);
}

export async function sendNormalMessage(ctx: NormalSendFlowContext): Promise<void> {
  const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: "user", content: ctx.text };
  const requestSeq = ctx.titleRequestSeqRef.current;
  const historyMessages = historyFrom(ctx.messages);
  const runSeq = ctx.beginChatRun();
  const resumeSessionId = ctx.getResumeSessionId();
  ctx.perf.markRunStart("send", runSeq, ctx.text.length, historyMessages.length, Boolean(resumeSessionId));
  ctx.setMessages((prev) => [...prev, userMessage]);
  ctx.beginActivityGroup(userMessage.id);
  ctx.onSessionStarted?.();
  try {
    const result = await sendMessageWithOptionalOptions(
      ctx.text,
      ctx.profile,
      resumeSessionId,
      historyMessages,
      ctx.chatOptions,
    );
    ctx.perf.markIpcResolved({
      runSeq,
      kind: "send",
      messageLength: ctx.text.length,
      historyCount: historyMessages.length,
      responseLength: result.response.length,
      sessionIdPresent: Boolean(result.sessionId || resumeSessionId),
    });
    const resolvedSessionId = result.sessionId || resumeSessionId;
    const shouldApplyResult = ctx.isSendRunCurrentOrFinalized(runSeq);
    if (shouldApplyResult && resolvedSessionId) {
      ctx.setHermesSessionId(resolvedSessionId);
      ctx.sessionIdRef.current = resolvedSessionId;
      ctx.onSessionResolved?.(resolvedSessionId);
    }
    const titleMessages: ChatMessage[] = [
      ...ctx.messages,
      userMessage,
      ...(result.response.trim()
        ? [
            {
              id: `agent-title-${Date.now()}`,
              role: "agent" as const,
              content: result.response,
            },
          ]
        : []),
    ];
    ctx.finalizeChatRun(runSeq, "completed");
    if (shouldApplyResult) await ctx.requestGeneratedTitleOnce(resolvedSessionId, titleMessages, requestSeq);
  } catch (error) {
    ctx.perf.markIpcRejected({
      runSeq,
      kind: "send",
      messageLength: ctx.text.length,
      historyCount: historyMessages.length,
      errorType: errorType(error),
    });
    // Error is usually handled by onChatError IPC listener; only show fallback when no terminal IPC arrived.
    if (ctx.finalizeChatRun(runSeq, "failed")) ctx.appendFallbackSendError(error);
  }
}

export async function sendQuickAskMessage(ctx: QuickAskSendFlowContext): Promise<void> {
  const userMessage: ChatMessage = { id: `user-btw-${Date.now()}`, role: "user", content: `💭 ${ctx.text}` };
  const historyMessages = historyFrom(ctx.messages);
  const runSeq = ctx.beginChatRun();
  const resumeSessionId = ctx.getResumeSessionId();
  ctx.perf.markRunStart("quick-ask", runSeq, ctx.text.length, historyMessages.length, Boolean(resumeSessionId));
  ctx.setMessages((prev) => [...prev, userMessage]);
  ctx.beginActivityGroup(userMessage.id);
  try {
    const result = await sendMessageWithOptionalOptions(
      `/btw ${ctx.text}`,
      ctx.profile,
      resumeSessionId,
      historyMessages,
      ctx.chatOptions,
    );
    ctx.perf.markIpcResolved({
      runSeq,
      kind: "quick-ask",
      messageLength: ctx.text.length,
      historyCount: historyMessages.length,
      responseLength: result.response.length,
      sessionIdPresent: Boolean(result.sessionId || resumeSessionId),
    });
    const resolvedSessionId = result.sessionId || resumeSessionId;
    const shouldApplyResult = ctx.isSendRunCurrentOrFinalized(runSeq);
    if (shouldApplyResult && resolvedSessionId) {
      ctx.setHermesSessionId(resolvedSessionId);
      ctx.sessionIdRef.current = resolvedSessionId;
      ctx.onSessionResolved?.(resolvedSessionId);
    }
    ctx.finalizeChatRun(runSeq, "completed");
  } catch (error) {
    ctx.perf.markIpcRejected({
      runSeq,
      kind: "quick-ask",
      messageLength: ctx.text.length,
      historyCount: historyMessages.length,
      errorType: errorType(error),
    });
    // Error is usually handled by onChatError IPC listener; only show fallback when no terminal IPC arrived.
    if (ctx.finalizeChatRun(runSeq, "failed")) ctx.appendFallbackSendError(error);
  }
}

export function sendApprovalCommand(ctx: ApprovalSendFlowContext): void {
  const userMessage: ChatMessage = {
    id: `user-${ctx.command.slice(1)}-${Date.now()}`,
    role: "user",
    content: ctx.command,
  };
  const runSeq = ctx.beginChatRun();
  ctx.setMessages((prev) => [...prev, userMessage]);
  ctx.beginActivityGroup(userMessage.id);
  sendMessageWithOptionalOptions(
    ctx.command,
    ctx.profile,
    ctx.getResumeSessionId(),
    historyFrom(ctx.messages),
    ctx.chatOptions,
  )
    .then(() => ctx.finalizeChatRun(runSeq, "completed"))
    .catch((error) => {
      if (ctx.finalizeChatRun(runSeq, "failed")) ctx.appendFallbackSendError(error);
    });
}

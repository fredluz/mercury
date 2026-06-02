import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useChatController } from "./useChatController";
import type { ChatMessage } from "../types";

const perfMocks = vi.hoisted(() => ({
  markRendererPerf: vi.fn(),
}));

vi.mock("../../../perf", () => ({
  markRendererPerf: perfMocks.markRendererPerf,
}));

vi.mock("../../../components/useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      getModelConfig: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o",
        baseUrl: "",
      }),
      listCachedSessions: vi.fn().mockResolvedValue([]),
      getConfig: vi.fn().mockResolvedValue(null),
      sendMessage: vi.fn().mockResolvedValue({
        response: "done",
        sessionId: "session-new",
      }),
      abortChat: vi.fn().mockResolvedValue(undefined),
      generateChatTitle: vi.fn().mockResolvedValue("Generated title"),
      onChatChunk: vi.fn().mockReturnValue(vi.fn()),
      onChatTraceEvent: vi.fn().mockReturnValue(vi.fn()),
      onChatUsage: vi.fn().mockReturnValue(vi.fn()),
      onChatDone: vi.fn().mockReturnValue(vi.fn()),
      onChatError: vi.fn().mockReturnValue(vi.fn()),
    };
}

function useControllerProbe() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const controller = useChatController({
    messages,
    setMessages,
    conversationVersion: 0,
    profile: "default",
  });
  return { controller, messages };
}

function sendMessageMock(): ReturnType<typeof vi.fn> {
  return window.hermesAPI.sendMessage as unknown as ReturnType<typeof vi.fn>;
}

describe("useChatController override send", () => {
  beforeEach(() => {
    installHermesApiMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends override text without clearing or echoing the composer input", async () => {
    const { result } = renderHook(() => useControllerProbe());

    await act(async () => {
      result.current.controller.setInput("draft still in composer");
    });
    await act(async () => {
      await result.current.controller.handleSend(
        "  analyze attached seed skill  ",
      );
    });

    expect(sendMessageMock()).toHaveBeenCalledWith(
      "analyze attached seed skill",
      "default",
      undefined,
      [],
    );
    expect(result.current.controller.input).toBe("draft still in composer");
    expect(
      result.current.messages.some(
        (message) => message.content === "analyze attached seed skill",
      ),
    ).toBe(false);
  });
});

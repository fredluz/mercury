import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { useChatController } from "./useChatController";
import type { ChatMessage } from "../types";

vi.mock("../../../components/useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

type ChatDoneCallback = (sessionId?: string) => void;
type ChatErrorCallback = (error: string) => void;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const listenerCleanups = {
  done: [] as ReturnType<typeof vi.fn>[],
  error: [] as ReturnType<typeof vi.fn>[],
};
const listenerCallbacks = {
  done: [] as ChatDoneCallback[],
  error: [] as ChatErrorCallback[],
};

function installHermesApiMock(): void {
  listenerCleanups.done = [];
  listenerCleanups.error = [];
  listenerCallbacks.done = [];
  listenerCallbacks.error = [];

  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    getModelConfig: vi.fn().mockResolvedValue({ provider: "auto", model: "", baseUrl: "" }),
    listModels: vi.fn().mockResolvedValue([]),
    getConfig: vi.fn().mockResolvedValue(null),
    setModelConfig: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ response: "", sessionId: "session-1" }),
    abortChat: vi.fn().mockResolvedValue(undefined),
    generateChatTitle: vi.fn().mockResolvedValue("Generated title"),
    onChatChunk: vi.fn().mockReturnValue(vi.fn()),
    onChatTraceEvent: vi.fn().mockReturnValue(vi.fn()),
    onChatUsage: vi.fn().mockReturnValue(vi.fn()),
    onChatDone: vi.fn((callback: ChatDoneCallback) => {
      listenerCallbacks.done.push(callback);
      const cleanup = vi.fn();
      listenerCleanups.done.push(cleanup);
      return cleanup;
    }),
    onChatError: vi.fn((callback: ChatErrorCallback) => {
      listenerCallbacks.error.push(callback);
      const cleanup = vi.fn();
      listenerCleanups.error.push(cleanup);
      return cleanup;
    }),
  };
}

function useControllerProbe({
  conversationVersion = 0,
  onSessionResolved,
}: {
  conversationVersion?: number;
  onSessionResolved?: (sessionId: string) => void;
} = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const controller = useChatController({
    messages,
    setMessages,
    conversationVersion,
    profile: "default",
    onSessionResolved,
  });
  return { controller, messages };
}

function sendMessageMock(): ReturnType<typeof vi.fn> {
  return window.hermesAPI.sendMessage as unknown as ReturnType<typeof vi.fn>;
}

describe("useChatController send lifecycle", () => {
  beforeEach(() => {
    installHermesApiMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["handleSend", "hello", "hello"],
    ["handleQuickAsk", "quick question", "/btw quick question"],
  ] as const)("clears loading when %s resolves without terminal IPC", async (handlerName, input, expectedMessage) => {
    const send = deferred<{ response: string; sessionId?: string }>();
    sendMessageMock().mockReturnValueOnce(send.promise);
    const { result } = renderHook(() => useControllerProbe());

    await act(async () => {
      result.current.controller.setInput(input);
    });
    act(() => {
      void result.current.controller[handlerName]();
    });

    expect(result.current.controller.isLoading).toBe(true);
    expect(sendMessageMock()).toHaveBeenCalledWith(expectedMessage, "default", undefined, []);

    await act(async () => {
      send.resolve({ response: "done", sessionId: "session-1" });
      await send.promise;
    });

    await waitFor(() => expect(result.current.controller.isLoading).toBe(false));
  });

  it.each([
    ["handleSend", "hello"],
    ["handleQuickAsk", "quick question"],
  ] as const)("clears loading when %s rejects without terminal IPC", async (handlerName, input) => {
    const send = deferred<{ response: string; sessionId?: string }>();
    sendMessageMock().mockReturnValueOnce(send.promise);
    const { result } = renderHook(() => useControllerProbe());

    await act(async () => {
      result.current.controller.setInput(input);
    });
    act(() => {
      void result.current.controller[handlerName]();
    });

    expect(result.current.controller.isLoading).toBe(true);

    await act(async () => {
      send.reject(new Error("boom"));
      await send.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.controller.isLoading).toBe(false));
  });

  it.each([
    ["handleApprove", "/approve"],
    ["handleDeny", "/deny"],
  ] as const)("clears loading when %s resolves without terminal IPC", async (handlerName, expectedMessage) => {
    const send = deferred<{ response: string; sessionId?: string }>();
    sendMessageMock().mockReturnValueOnce(send.promise);
    const { result } = renderHook(() => useControllerProbe());

    act(() => {
      result.current.controller[handlerName]();
    });

    expect(result.current.controller.isLoading).toBe(true);
    expect(sendMessageMock()).toHaveBeenCalledWith(expectedMessage, "default", undefined, []);

    await act(async () => {
      send.resolve({ response: "", sessionId: "session-1" });
      await send.promise;
    });

    await waitFor(() => expect(result.current.controller.isLoading).toBe(false));
  });

  it.each(["handleApprove", "handleDeny"] as const)(
    "clears loading when %s rejects without terminal IPC",
    async (handlerName) => {
      const send = deferred<{ response: string; sessionId?: string }>();
      sendMessageMock().mockReturnValueOnce(send.promise);
      const { result } = renderHook(() => useControllerProbe());

      act(() => {
        result.current.controller[handlerName]();
      });

      expect(result.current.controller.isLoading).toBe(true);

      await act(async () => {
        send.reject(new Error("boom"));
        await send.promise.catch(() => undefined);
      });

      await waitFor(() => expect(result.current.controller.isLoading).toBe(false));
    },
  );

  it("clears loading on conversation reset and ignores the stale send result", async () => {
    const send = deferred<{ response: string; sessionId?: string }>();
    const onSessionResolved = vi.fn();
    sendMessageMock().mockReturnValueOnce(send.promise);
    const { result, rerender } = renderHook(
      ({ conversationVersion }) => useControllerProbe({ conversationVersion, onSessionResolved }),
      { initialProps: { conversationVersion: 0 } },
    );

    await act(async () => {
      result.current.controller.setInput("hello");
    });
    act(() => {
      void result.current.controller.handleSend();
    });
    expect(result.current.controller.isLoading).toBe(true);

    rerender({ conversationVersion: 1 });

    await waitFor(() => expect(result.current.controller.isLoading).toBe(false));

    await act(async () => {
      send.resolve({ response: "late", sessionId: "stale-session" });
      await send.promise;
    });

    expect(onSessionResolved).not.toHaveBeenCalled();
    expect(result.current.controller.hermesSessionId).toBeNull();
  });

  it("does not re-register terminal listeners when model and context state changes", async () => {
    const { result } = renderHook(() => useControllerProbe());

    await waitFor(() => expect(window.hermesAPI.onChatDone).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.onChatError).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.controller.selectModel("openai", "gpt-4o", "", 128_000);
    });

    expect(window.hermesAPI.onChatDone).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.onChatError).toHaveBeenCalledTimes(1);
    expect(listenerCleanups.done[0]).not.toHaveBeenCalled();
    expect(listenerCleanups.error[0]).not.toHaveBeenCalled();
  });
});

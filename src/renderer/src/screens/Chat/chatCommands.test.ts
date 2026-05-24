import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { executeLocalCommand } from "./chatCommands";
import type { ChatMessage } from "./types";

function installHermesApiMock(): { messages: ChatMessage[]; setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>> } {
  const messages: ChatMessage[] = [];
  const setMessages = vi.fn((updater: React.SetStateAction<ChatMessage[]>) => {
    const next = typeof updater === "function" ? updater(messages) : updater;
    messages.splice(0, messages.length, ...next);
  });
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    getModelConfig: vi.fn().mockResolvedValue({ provider: "openai", model: "gpt-4o", baseUrl: "" }),
    recordLocalChatTrace: vi.fn().mockResolvedValue({ id: "trace", events: [] }),
  };
  return { messages, setMessages };
}

describe("chat local /model command", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the current agent model from direct config", async () => {
    const { messages, setMessages } = installHermesApiMock();

    await executeLocalCommand("/model", {
      profile: "default",
      usage: null,
      t: (key) => key,
      handleClear: vi.fn(),
      setFastMode: vi.fn(),
      setMessages,
    });

    expect(window.hermesAPI.getModelConfig).toHaveBeenCalledWith("default");
    expect(messages[0].content).toContain("Current agent model");
    expect(messages[0].content).toContain("gpt-4o");
    expect(messages[0].content).toContain("agent config");
  });
});

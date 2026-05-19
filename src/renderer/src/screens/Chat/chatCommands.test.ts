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
    resolveModelForRole: vi.fn().mockResolvedValue({
      role: "chat",
      kind: "text",
      ok: true,
      source: "profile-override",
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "",
      contextWindow: 128_000,
      capabilities: ["text"],
    }),
    getModelConfig: vi.fn().mockResolvedValue({ provider: "legacy", model: "legacy-model", baseUrl: "" }),
    recordLocalChatTrace: vi.fn().mockResolvedValue({ id: "trace", events: [] }),
  };
  return { messages, setMessages };
}

describe("chat local /model command", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the resolved Chat role model and source", async () => {
    const { messages, setMessages } = installHermesApiMock();

    await executeLocalCommand("/model", {
      profile: "default",
      usage: null,
      t: (key) => key,
      handleClear: vi.fn(),
      setFastMode: vi.fn(),
      setMessages,
    });

    expect(window.hermesAPI.resolveModelForRole).toHaveBeenCalledWith("chat", "default");
    expect(window.hermesAPI.getModelConfig).not.toHaveBeenCalled();
    expect(messages[0].content).toContain("Current Chat model");
    expect(messages[0].content).toContain("gpt-4o");
    expect(messages[0].content).toContain("profile-override");
  });

  it("falls back to legacy model config if Chat role resolution is unavailable", async () => {
    const { messages, setMessages } = installHermesApiMock();
    window.hermesAPI.resolveModelForRole = vi.fn().mockRejectedValue(new Error("missing role api"));

    await executeLocalCommand("/model", {
      profile: "default",
      usage: null,
      t: (key) => key,
      handleClear: vi.fn(),
      setFastMode: vi.fn(),
      setMessages,
    });

    expect(window.hermesAPI.getModelConfig).toHaveBeenCalledWith("default");
    expect(messages[0].content).toContain("legacy-model");
    expect(messages[0].content).toContain("legacy-chat-config");
  });
});

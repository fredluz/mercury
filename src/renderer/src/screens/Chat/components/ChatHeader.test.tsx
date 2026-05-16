import type React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatHeader } from "./ChatHeader";
import type { ChatContextUsage, ChatMessage } from "../types";

const t = (key: string, values?: Record<string, string>): string => {
  const dictionary: Record<string, string> = {
    "chat.title": "New Chat",
    "chat.defaultAgent": "Default",
    "chat.agentIdentity": "Agent: {{profile}}",
    "chat.generatingTitle": "Generating title…",
    "chat.untitledChat": "Untitled chat",
    "chat.contextUsed": "{{percent}} context",
    "chat.contextTooltip": "{{used}} of {{limit}} tokens used in {{model}}'s context window.",
    "chat.contextTooltipEstimated": "Estimated: {{used}} of {{limit}} tokens used in {{model}}'s context window.",
    "chat.fastMode": "Fast Mode",
    "chat.fastModeOn": "Fast Mode ON",
    "chat.fastModeActive": "Priority processing active.",
    "chat.fastModeInactive": "Enable priority processing.",
    "chat.newChat": "New chat",
    "chat.clearChat": "Clear chat",
  };
  return Object.entries(values || {}).reduce(
    (text, [name, value]) => text.replace(`{{${name}}}`, value),
    dictionary[key] || key,
  );
};

function renderHeader(overrides: Partial<React.ComponentProps<typeof ChatHeader>> = {}) {
  const messages: ChatMessage[] = [{ id: "u1", role: "user", content: "Hello" }];
  const contextUsage: ChatContextUsage = {
    usedTokens: 6_400,
    contextWindow: 128_000,
    percent: 5,
    source: "known-model",
    model: "gpt-4o",
  };

  return render(
    <ChatHeader
      sessionId="session-123456"
      sessionTitle="Chat Metadata Plan"
      titlePending={false}
      contextUsage={contextUsage}
      fastMode={false}
      messages={messages}
      profile="Research Agent"
      onFastModeChange={vi.fn()}
      onNewChat={vi.fn()}
      onClear={vi.fn()}
      t={t}
      {...overrides}
    />,
  );
}

describe("ChatHeader metadata", () => {
  it("renders generated title, agent identity, and context percent", () => {
    renderHeader();

    expect(screen.getByText("Chat Metadata Plan")).toBeInTheDocument();
    expect(screen.getByText("Agent: Research Agent")).toBeInTheDocument();
    expect(screen.getByText("5% context")).toBeInTheDocument();
    expect(screen.queryByText(/6,400 tokens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0\./)).not.toBeInTheDocument();
  });

  it("renders pending and untitled title fallbacks", () => {
    const { rerender } = renderHeader({ sessionTitle: null, titlePending: true });
    expect(screen.getByText("Generating title…")).toBeInTheDocument();

    rerender(
      <ChatHeader
        sessionId="session-123456"
        sessionTitle={null}
        titlePending={false}
        contextUsage={null}
        fastMode={false}
        messages={[{ id: "u1", role: "user", content: "Hello" }]}
        profile="default"
        onFastModeChange={vi.fn()}
        onNewChat={vi.fn()}
        onClear={vi.fn()}
        t={t}
      />,
    );
    expect(screen.getByText("Untitled chat")).toBeInTheDocument();
    expect(screen.getByText("Agent: Default")).toBeInTheDocument();
  });
});

import type React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Chat from "./Chat";
import type { ChatController, ChatMessage } from "./types";

const useChatControllerMock = vi.hoisted(() => vi.fn());

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string, values?: Record<string, string>) => {
      const dictionary: Record<string, string> = {
        "chat.agentIdentity": "Agent: {{profile}}",
        "chat.contextUsed": "{{percent}} context",
        "chat.createScheduleFromConversation":
          "Create schedule from conversation",
        "chat.defaultAgent": "Default",
        "chat.fastMode": "Fast Mode",
        "chat.fastModeActive": "Priority processing active.",
        "chat.fastModeInactive": "Enable priority processing.",
        "chat.fastModeOn": "Fast Mode ON",
        "chat.noModel": "No model set",
        "chat.title": "New Chat",
        "chat.untitledChat": "Untitled chat",
      };
      return Object.entries(values || {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, value),
        dictionary[key] || key,
      );
    },
  }),
}));

vi.mock("./hooks/useChatController", () => ({
  useChatController: useChatControllerMock,
}));

function ref<T>(): React.RefObject<T | null> {
  return { current: null };
}

function controllerFor(messages: ChatMessage[]): ChatController {
  return {
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    activityGroups: [],
    toggleActivityGroup: vi.fn(),
    usage: null,
    contextUsage: null,
    titleGenerationPending: false,
    fastMode: false,
    setFastMode: vi.fn(),
    messagesEndRef: ref<HTMLDivElement>(),
    messagesContainerRef: ref<HTMLDivElement>(),
    inputRef: ref<HTMLTextAreaElement>(),
    pickerRef: ref<HTMLDivElement>(),
    slashMenuRef: ref<HTMLDivElement>(),
    slashMenuOpen: false,
    filteredSlashCommands: [],
    slashSelectedIndex: 0,
    setSlashSelectedIndex: vi.fn(),
    currentModel: "",
    currentProvider: "auto",
    modelGroups: [],
    showModelPicker: false,
    setShowModelPicker: vi.fn(),
    customModelInput: "",
    setCustomModelInput: vi.fn(),
    displayModel: "Auto",
    visibleMessages: messages,
    lastMessageIsAgent: messages.at(-1)?.role === "agent",
    hermesSessionId: "session-from-controller",
    loadModelConfig: vi.fn(),
    selectModel: vi.fn(),
    handleCustomModelSubmit: vi.fn(),
    handleSend: vi.fn(),
    handleQuickAsk: vi.fn(),
    handleKeyDown: vi.fn(),
    handleInputChange: vi.fn(),
    handleSlashSelect: vi.fn(),
    handleAbort: vi.fn(),
    handleClear: vi.fn(),
    handleApprove: vi.fn(),
    handleDeny: vi.fn(),
  };
}

describe("Chat schedule handoff", () => {
  it("calls the conversation schedule callback with a context draft", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: "Remind me to check payroll every Friday",
      },
      {
        id: "a1",
        role: "agent",
        content: "I can turn that into a recurring schedule.",
      },
    ];
    useChatControllerMock.mockReturnValue(controllerFor(messages));
    (
      window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }
    ).hermesAPI = {
      getConfig: vi.fn().mockResolvedValue(null),
      setConfig: vi.fn().mockResolvedValue(true),
      listCompletedScheduledRunsSince: vi.fn().mockResolvedValue([]),
    };
    const onCreateScheduleFromConversation = vi.fn();

    render(
      <Chat
        messages={messages}
        setMessages={vi.fn()}
        sessionId="session-123"
        sessionTitle="Payroll reminder"
        conversationVersion={0}
        profile="work"
        onCreateScheduleFromConversation={onCreateScheduleFromConversation}
      />,
    );

    fireEvent.click(screen.getByTitle("Create schedule from conversation"));

    expect(onCreateScheduleFromConversation).toHaveBeenCalledTimes(1);
    expect(onCreateScheduleFromConversation.mock.calls[0][0]).toMatchObject({
      sourceSessionId: "session-123",
      context: {
        source: "chat",
        sessionId: "session-123",
        title: "Payroll reminder",
        excerpt: "Remind me to check payroll every Friday",
        profile: "work",
        messageCount: 2,
        messages: [
          {
            index: 0,
            role: "user",
            content: "Remind me to check payroll every Friday",
          },
          {
            index: 1,
            role: "agent",
            content: "I can turn that into a recurring schedule.",
          },
        ],
      },
    });
    expect(
      onCreateScheduleFromConversation.mock.calls[0][0],
    ).not.toHaveProperty("prompt");
  });
});

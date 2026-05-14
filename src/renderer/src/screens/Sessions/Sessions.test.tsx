import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sessions from "./Sessions";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const cachedRows = [
  {
    id: "session-shared",
    title: "Default session",
    startedAt: 1_700_000_000,
    source: "local",
    messageCount: 2,
    model: "openai/gpt-4o",
    profile: "default",
  },
  {
    id: "session-shared",
    title: "Work session",
    startedAt: 1_700_000_100,
    source: "local",
    messageCount: 3,
    model: "openai/gpt-4o",
    profile: "work",
  },
];

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    listCachedSessions: vi.fn().mockResolvedValue(cachedRows),
    syncSessionCache: vi.fn().mockResolvedValue(cachedRows),
    searchSessions: vi.fn().mockResolvedValue([
      {
        sessionId: "search-hit",
        title: "Search hit",
        startedAt: 1_700_000_200,
        source: "local",
        messageCount: 4,
        model: "openai/gpt-4o",
        snippet: "matched <<text>>",
        profile: "research",
      },
    ]),
  };
}

describe("Sessions resume profile flow", () => {
  beforeEach(() => {
    installHermesApiMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes cached row profile and matches active rows by session/profile", async () => {
    const onResumeSession = vi.fn();
    render(
      <Sessions
        onResumeSession={onResumeSession}
        onNewChat={vi.fn()}
        currentSessionId="session-shared"
        currentSessionProfile="work"
      />,
    );

    const workRow = await screen.findByRole("button", { name: /Work session/i });
    const defaultRow = screen.getByRole("button", { name: /Default session/i });

    expect(workRow).toHaveClass("sessions-card--active");
    expect(defaultRow).not.toHaveClass("sessions-card--active");

    fireEvent.click(workRow);
    expect(onResumeSession).toHaveBeenCalledWith("session-shared", "Work session", "work");
  });

  it("passes search result profile when resuming", async () => {
    const onResumeSession = vi.fn();
    render(
      <Sessions
        onResumeSession={onResumeSession}
        onNewChat={vi.fn()}
        currentSessionId={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("sessions.searchPlaceholder"), {
      target: { value: "text" },
    });
    await waitFor(() => expect(window.hermesAPI.searchSessions).toHaveBeenCalledWith("text"));

    const searchRow = await screen.findByRole("button", { name: /Search hit/i });
    fireEvent.click(searchRow);

    expect(onResumeSession).toHaveBeenCalledWith("search-hit", "Search hit", "research");
  });
});

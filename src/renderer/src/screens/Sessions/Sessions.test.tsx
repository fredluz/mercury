import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sessions from "./Sessions";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title ? `${key}:${String(options.title)}` : key,
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
        onOpenSessionTrace={vi.fn()}
        onNewChat={vi.fn()}
        currentSessionId="session-shared"
        currentSessionProfile="work"
      />,
    );

    await screen.findByText("Work session");
    const workRow = screen
      .getAllByRole("button", { name: /Work session/i })
      .find((button) => button.classList.contains("sessions-card-primary"));
    const defaultRow = screen
      .getAllByRole("button", { name: /Default session/i })
      .find((button) => button.classList.contains("sessions-card-primary"));

    expect(workRow?.closest(".sessions-card")).toHaveClass("sessions-card--active");
    expect(defaultRow?.closest(".sessions-card")).not.toHaveClass("sessions-card--active");

    fireEvent.click(workRow!);
    expect(onResumeSession).toHaveBeenCalledWith("session-shared", "Work session", "work");
  });

  it("passes search result profile when resuming", async () => {
    const onResumeSession = vi.fn();
    render(
      <Sessions
        onResumeSession={onResumeSession}
        onOpenSessionTrace={vi.fn()}
        onNewChat={vi.fn()}
        currentSessionId={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("sessions.searchPlaceholder"), {
      target: { value: "text" },
    });
    await waitFor(() => expect(window.hermesAPI.searchSessions).toHaveBeenCalledWith("text"));

    await screen.findByText("Search hit");
    const searchRow = screen
      .getAllByRole("button", { name: /Search hit/i })
      .find((button) => button.classList.contains("sessions-card-primary"));
    fireEvent.click(searchRow!);

    expect(onResumeSession).toHaveBeenCalledWith("search-hit", "Search hit", "research");
  });

  it("opens traces for a cached row without resuming it", async () => {
    const onResumeSession = vi.fn();
    const onOpenSessionTrace = vi.fn();
    render(
      <Sessions
        onResumeSession={onResumeSession}
        onOpenSessionTrace={onOpenSessionTrace}
        onNewChat={vi.fn()}
        currentSessionId={null}
      />,
    );

    await screen.findByText("Work session");
    fireEvent.click(
      screen.getByRole("button", { name: "sessions.viewTracesAria:Work session" }),
    );

    expect(onOpenSessionTrace).toHaveBeenCalledWith("session-shared", "Work session", "work");
    expect(onResumeSession).not.toHaveBeenCalled();
  });

  it("opens traces for a search result without resuming it", async () => {
    const onResumeSession = vi.fn();
    const onOpenSessionTrace = vi.fn();
    render(
      <Sessions
        onResumeSession={onResumeSession}
        onOpenSessionTrace={onOpenSessionTrace}
        onNewChat={vi.fn()}
        currentSessionId={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("sessions.searchPlaceholder"), {
      target: { value: "text" },
    });
    await waitFor(() => expect(window.hermesAPI.searchSessions).toHaveBeenCalledWith("text"));

    fireEvent.click(
      await screen.findByRole("button", { name: "sessions.viewTracesAria:Search hit" }),
    );

    expect(onOpenSessionTrace).toHaveBeenCalledWith("search-hit", "Search hit", "research");
    expect(onResumeSession).not.toHaveBeenCalled();
  });

  it("opens all trace activity from the header", async () => {
    const onOpenTraceActivity = vi.fn();
    render(
      <Sessions
        onResumeSession={vi.fn()}
        onOpenSessionTrace={vi.fn()}
        onOpenTraceActivity={onOpenTraceActivity}
        onNewChat={vi.fn()}
        currentSessionId={null}
      />,
    );

    await screen.findByText("Default session");
    fireEvent.click(screen.getByRole("button", { name: "sessions.traceActivity" }));

    expect(onOpenTraceActivity).toHaveBeenCalledTimes(1);
  });
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "./Layout";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../components/common/MercuryLockup", () => ({
  default: ({ className }: { className?: string }) => (
    <div className={className}>Mercury</div>
  ),
}));

vi.mock("../../components/RemoteNotice", () => ({
  default: ({ feature }: { feature: string }) => <div>Remote {feature}</div>,
}));

vi.mock("../Chat/Chat", () => ({
  default: ({
    messages = [],
    sessionId,
    profile,
    activeAgentProfile,
    onCreateScheduleFromConversation,
    onOpenTraceRun,
    onOpenTrace,
    onViewSchedules,
    onSessionResolved,
  }: {
    messages?: Array<{ id: string; role: string; content: string }>;
    sessionId?: string | null;
    profile?: string;
    activeAgentProfile?: { name: string; displayName: string } | null;
    onCreateScheduleFromConversation?: (draft: {
      name?: string;
      prompt?: string;
      context?: { title?: string; sessionId?: string };
      sourceSessionId?: string;
      metadata?: Record<string, unknown>;
    }) => void;
    onOpenTraceRun?: (runId: string) => void;
    onOpenTrace?: () => void;
    onViewSchedules?: () => void;
    onSessionResolved?: (sessionId: string) => void;
  }) => (
    <div>
      Chat mock profile:{profile} activeAgent:{activeAgentProfile?.displayName ?? "none"} session:
      {sessionId ?? "none"} messages:{messages.length}
      <button
        onClick={() =>
          onCreateScheduleFromConversation?.({
            context: { title: "Draft title", sessionId: "session-draft" },
            sourceSessionId: "session-draft",
            metadata: { profile: "work" },
          })
        }
      >
        Create schedule draft
      </button>
      <button onClick={() => onOpenTraceRun?.("run-from-chat")}>
        Open chat trace
      </button>
      <button onClick={() => onOpenTrace?.()}>Open conversation trace</button>
      <button onClick={onViewSchedules}>View schedules from chat</button>
      <button onClick={() => onSessionResolved?.("session-resolved")}>Resolve chat session</button>
    </div>
  ),
}));
vi.mock("../Agents/Agents", () => ({
  default: ({ onSelectProfile }: { onSelectProfile?: (name: string) => void }) => (
    <div>
      Agents mock
      <button onClick={() => onSelectProfile?.("work")}>Select work agent</button>
    </div>
  ),
}));
vi.mock("../Settings/Settings", () => ({
  default: () => <div>Settings mock</div>,
}));
vi.mock("../Skills/Skills", () => ({ default: () => <div>Skills mock</div> }));
vi.mock("../Soul/Soul", () => ({ default: () => <div>Soul mock</div> }));
vi.mock("../Memory/Memory", () => ({ default: () => <div>Memory mock</div> }));
vi.mock("../Tools/Tools", () => ({ default: () => <div>Tools mock</div> }));
vi.mock("../Gateway/Gateway", () => ({
  default: () => <div>Gateway mock</div>,
}));
vi.mock("../Providers/Providers", () => ({
  default: () => <div>Providers mock</div>,
}));
vi.mock("../Schedules/Schedules", () => ({
  default: ({
    initialDraft,
    onOpenTraceRun,
  }: {
    initialDraft?: { context?: { title?: string } };
    onOpenTraceRun?: (runId: string) => void;
  }) => (
    <div>
      Schedules mock {initialDraft?.context?.title}
      <button onClick={() => onOpenTraceRun?.("run-from-schedules")}>
        Open schedule trace
      </button>
    </div>
  ),
}));

vi.mock("../TraceLab/TraceLab", () => ({
  default: ({
    mode,
    sessionTarget,
    runId,
  }: {
    mode?: "all" | "session" | "run";
    sessionTarget?: {
      sessionId: string;
      title?: string | null;
      profile?: string | null;
    } | null;
    runId?: string | null;
  }) => (
    <div>
      TraceLab mock {mode} {sessionTarget?.sessionId} {sessionTarget?.profile}{" "}
      {runId}
    </div>
  ),
}));

const layoutCachedRows = [
  {
    id: "session-default",
    title: "Default session",
    startedAt: 1_700_000_000,
    source: "local",
    messageCount: 2,
    model: "openai/gpt-4o",
    profile: "default",
  },
  {
    id: "session-work",
    title: "Work session",
    startedAt: 1_700_000_100,
    source: "local",
    messageCount: 3,
    model: "anthropic/claude-sonnet",
    profile: "work",
  },
];

let currentLayoutCachedRows = layoutCachedRows;

const layoutProfiles = [
  {
    name: "default",
    path: "/profiles/default",
    isDefault: true,
    isActive: true,
    model: "openai/gpt-4o",
    provider: "openai",
    hasEnv: true,
    hasSoul: true,
    skillCount: 1,
    gatewayRunning: false,
    displayName: "Mercury",
    kind: "builtin" as const,
    immutable: true,
    deletable: false,
    selectedPackIds: [],
    docsPointers: [],
  },
  {
    name: "work",
    path: "/profiles/work",
    isDefault: false,
    isActive: false,
    model: "anthropic/claude-sonnet",
    provider: "anthropic",
    hasEnv: true,
    hasSoul: true,
    skillCount: 2,
    gatewayRunning: false,
    displayName: "work",
    kind: "custom" as const,
    immutable: false,
    deletable: true,
    description: "Work agent",
    selectedPackIds: [],
    docsPointers: [],
  },
];

function installHermesApiMock(
  remoteOnly = false,
  runtimeDiagnostic: Awaited<
    ReturnType<Window["hermesAPI"]["getRuntimeDiagnostic"]>
  > = {
    selectedProfile: "default",
    requestedProfile: "default",
    actualProfile: "default",
    verified: true,
    verificationSource: "managed-process",
    mode: "local",
    transport: "api",
    status: "verified",
    authSource: "none",
    startedByMercury: false,
    stale: false,
  },
): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      isRemoteOnlyMode: vi.fn().mockResolvedValue(remoteOnly),
      getRuntimeDiagnostic: vi.fn().mockResolvedValue(runtimeDiagnostic),
      onUpdateAvailable: vi.fn(() => vi.fn()),
      onUpdateDownloadProgress: vi.fn(() => vi.fn()),
      onUpdateDownloaded: vi.fn(() => vi.fn()),
      onUpdateNotAvailable: vi.fn(() => vi.fn()),
      onUpdateError: vi.fn(() => vi.fn()),
      onMenuNewChat: vi.fn(() => vi.fn()),
      onMenuSearchSessions: vi.fn(() => vi.fn()),
      checkForUpdates: vi.fn().mockResolvedValue(null),
      abortChat: vi.fn().mockResolvedValue(undefined),
      listCachedSessions: vi.fn().mockImplementation(() =>
        Promise.resolve(currentLayoutCachedRows),
      ),
      syncSessionCache: vi.fn().mockImplementation(() =>
        Promise.resolve(currentLayoutCachedRows),
      ),
      listProfiles: vi.fn().mockResolvedValue(layoutProfiles),
      listTraceRuns: vi.fn().mockResolvedValue([]),
      setActiveProfile: vi.fn().mockResolvedValue(true),
      getSessionMessages: vi.fn().mockResolvedValue([
        { id: 1, role: "user", content: "hello", timestamp: 1 },
        { id: 2, role: "assistant", content: "hi", timestamp: 2 },
      ]),
    };
}

describe("Layout trace routing", () => {
  beforeEach(() => {
    currentLayoutCachedRows = layoutCachedRows;
    installHermesApiMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("removes Models from the primary sidebar while keeping Settings", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    expect(
      screen.queryByRole("button", { name: "navigation.models" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "navigation.settings" }),
    ).toBeInTheDocument();
  });

  it("removes Sessions from the primary sidebar", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    expect(
      screen.queryByRole("button", { name: "navigation.sessions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "navigation.agents" }),
    ).toBeInTheDocument();
  });

  it("opens session-scoped Trace Lab from the chat header", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Resolve chat session" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Open conversation trace" }),
    );

    expect(
      screen.getByText(/TraceLab mock session session-resolved default/),
    ).toBeInTheDocument();
  });

  it("opens all-trace Trace Lab from the chat header when no session is active", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open conversation trace" }),
    );

    expect(screen.getByText(/TraceLab mock all/)).toBeInTheDocument();
  });

  it("opens a specific trace run from the Layout trace-run navigation event", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("mercury:open-trace-run", {
          detail: { runId: "run-from-history" },
        }),
      );
    });

    await waitFor(() =>
      expect(
        screen.getByText(/TraceLab mock run\s+run-from-history/),
      ).toBeInTheDocument(),
    );
  });

  it("routes a Chat conversation schedule draft into Schedules", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create schedule draft" }),
    );

    expect(
      await screen.findByText(/Schedules mock Draft title/),
    ).toBeInTheDocument();
  });

  it("uses Agents terminology for the remote-only Agents view", async () => {
    installHermesApiMock(true);
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.agents" }));

    expect(await screen.findByText("Remote Agents")).toBeInTheDocument();
  });

  it("keeps the Mercury brand for the default agent on agent-scoped views", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.skills" }));

    expect(document.querySelector(".sidebar-brand-lockup")).toBeInTheDocument();
    expect(document.querySelector(".sidebar-agent-brand")).not.toBeInTheDocument();
  });

  it("shows the active custom agent brand on agent-scoped views only", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.agents" }));
    fireEvent.click(screen.getByRole("button", { name: "Select work agent" }));
    fireEvent.click(screen.getByRole("button", { name: "navigation.skills" }));

    await waitFor(() =>
      expect(document.querySelector(".sidebar-agent-brand")).toBeInTheDocument(),
    );
    expect(document.querySelector(".sidebar-agent-brand-name")).toHaveTextContent(
      "work",
    );
    expect(document.querySelector(".sidebar-brand-lockup")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "navigation.providers" }));

    expect(document.querySelector(".sidebar-brand-lockup")).toBeInTheDocument();
    expect(document.querySelector(".sidebar-agent-brand")).not.toBeInTheDocument();
  });

  it("opens the compact chat-list sidebar from Chat nav and Back restores main sidebar", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.isRemoteOnlyMode).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.chat" }));

    expect(await screen.findByText("chat.sidebarTitle")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "navigation.agents" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "chat.sidebarBack" }));

    expect(
      screen.getByRole("button", { name: "navigation.agents" }),
    ).toBeInTheDocument();
  });

  it("refreshes the compact chat sidebar when a chat session is resolved", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.isRemoteOnlyMode).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.chat" }));
    await screen.findByText("Work session");
    const callsBeforeResolution = (
      window.hermesAPI.listCachedSessions as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.length;

    currentLayoutCachedRows = [
      {
        id: "session-resolved",
        title: "Resolved first send",
        startedAt: 1_700_000_200,
        source: "local",
        messageCount: 2,
        model: "openai/gpt-4o",
        profile: "default",
      },
      ...layoutCachedRows,
    ];
    fireEvent.click(screen.getByRole("button", { name: "Resolve chat session" }));

    await waitFor(() =>
      expect(window.hermesAPI.listCachedSessions).toHaveBeenCalledTimes(
        callsBeforeResolution + 1,
      ),
    );
    expect(await screen.findByText("Resolved first send")).toBeInTheDocument();
  });

  it("keeps the main sidebar when Chat nav is clicked in remote-only mode", async () => {
    installHermesApiMock(true);
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.isRemoteOnlyMode).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.chat" }));

    expect(screen.queryByText("chat.sidebarTitle")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "navigation.agents" }),
    ).toBeInTheDocument();
    expect(window.hermesAPI.listCachedSessions).not.toHaveBeenCalled();
  });

  it("toggles compact sidebar between Agents and All chats", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.isRemoteOnlyMode).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.chat" }));
    await screen.findByText("Work session");

    const agentsToggle = screen.getByRole("button", {
      name: "chat.sidebarModeAgents",
    });
    const allToggle = screen.getByRole("button", {
      name: "chat.sidebarModeAll",
    });
    expect(agentsToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(allToggle);

    expect(allToggle).toHaveAttribute("aria-pressed", "true");
    expect(agentsToggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Default session")).toBeInTheDocument();
  });

  it("shows a main-pane agent picker before starting a new compact-sidebar chat", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.isRemoteOnlyMode).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.chat" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "chat.sidebarNewChat" }),
    );

    expect(screen.getByText("chat.agentPickerTitle")).toBeInTheDocument();
    expect(window.hermesAPI.setActiveProfile).not.toHaveBeenCalled();

    await screen.findByText("chat.agentPickerTitle");
    const workProfileOption = document.querySelector(
      ".chat-agent-picker-card:not(.chat-agent-picker-card-active)",
    );
    fireEvent.click(workProfileOption!);

    await waitFor(() =>
      expect(window.hermesAPI.setActiveProfile).toHaveBeenCalledWith("work"),
    );
    expect(window.hermesAPI.abortChat).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByText(
          /Chat mock profile:work activeAgent:work session:\s*none messages:\s*0/,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("resumes profile-aware sessions from the compact sidebar", async () => {
    render(<Layout />);
    await waitFor(() =>
      expect(window.hermesAPI.isRemoteOnlyMode).toHaveBeenCalled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "navigation.chat" }));
    const workRow = await screen.findByRole("button", {
      name: /Work session/i,
    });
    fireEvent.click(workRow);

    await waitFor(() =>
      expect(window.hermesAPI.getSessionMessages).toHaveBeenCalledWith(
        "session-work",
        "work",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          /Chat mock profile:work activeAgent:work session:\s*session-work messages:\s*2/,
        ),
      ).toBeInTheDocument(),
    );
  });

  it("keeps idle unverified runtime diagnostics out of the global Chat banner", async () => {
    installHermesApiMock(false, {
      selectedProfile: "default",
      requestedProfile: "default",
      actualProfile: null,
      verified: false,
      verificationSource: "unverified",
      mode: "local",
      transport: "api",
      status: "unverified",
      authSource: "none",
      startedByMercury: false,
      stale: false,
      mismatchReason: "Local runtime identity has not been verified yet.",
    });
    render(<Layout />);

    await waitFor(() =>
      expect(window.hermesAPI.getRuntimeDiagnostic).toHaveBeenCalled(),
    );

    expect(screen.queryByText("Runtime warning")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Local runtime identity has not been verified yet."),
    ).not.toBeInTheDocument();
  });
});

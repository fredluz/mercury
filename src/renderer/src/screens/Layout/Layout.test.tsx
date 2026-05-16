import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "./Layout";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../components/common/MercuryLockup", () => ({
  default: () => <div>Mercury</div>,
}));

vi.mock("../../components/RemoteNotice", () => ({
  default: ({ feature }: { feature: string }) => <div>Remote {feature}</div>,
}));

vi.mock("../Chat/Chat", () => ({ default: () => <div>Chat mock</div> }));
vi.mock("../Agents/Agents", () => ({ default: () => <div>Agents mock</div> }));
vi.mock("../Settings/Settings", () => ({ default: () => <div>Settings mock</div> }));
vi.mock("../Skills/Skills", () => ({ default: () => <div>Skills mock</div> }));
vi.mock("../Soul/Soul", () => ({ default: () => <div>Soul mock</div> }));
vi.mock("../Memory/Memory", () => ({ default: () => <div>Memory mock</div> }));
vi.mock("../Tools/Tools", () => ({ default: () => <div>Tools mock</div> }));
vi.mock("../Gateway/Gateway", () => ({ default: () => <div>Gateway mock</div> }));
vi.mock("../Models/Models", () => ({ default: () => <div>Models mock</div> }));
vi.mock("../Providers/Providers", () => ({ default: () => <div>Providers mock</div> }));
vi.mock("../Schedules/Schedules", () => ({ default: () => <div>Schedules mock</div> }));

vi.mock("../Sessions/Sessions", () => ({
  default: ({
    onOpenSessionTrace,
    onOpenTraceActivity,
  }: {
    onOpenSessionTrace: (sessionId: string, title?: string | null, profile?: string) => void;
    onOpenTraceActivity?: () => void;
  }) => (
    <div>
      <button onClick={() => onOpenSessionTrace("session-a", "Session A", "work")}>
        Open session trace
      </button>
      <button onClick={onOpenTraceActivity}>Open all traces</button>
    </div>
  ),
}));

vi.mock("../TraceLab/TraceLab", () => ({
  default: ({
    mode,
    sessionTarget,
  }: {
    mode?: "all" | "session";
    sessionTarget?: { sessionId: string; title?: string | null; profile?: string | null } | null;
  }) => (
    <div>
      TraceLab mock {mode} {sessionTarget?.sessionId} {sessionTarget?.profile}
    </div>
  ),
}));

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    isRemoteOnlyMode: vi.fn().mockResolvedValue(false),
    onUpdateAvailable: vi.fn(() => vi.fn()),
    onUpdateDownloadProgress: vi.fn(() => vi.fn()),
    onUpdateDownloaded: vi.fn(() => vi.fn()),
    onUpdateNotAvailable: vi.fn(() => vi.fn()),
    onUpdateError: vi.fn(() => vi.fn()),
    onMenuNewChat: vi.fn(() => vi.fn()),
    onMenuSearchSessions: vi.fn(() => vi.fn()),
    checkForUpdates: vi.fn().mockResolvedValue(null),
  };
}

describe("Layout trace routing", () => {
  beforeEach(() => {
    installHermesApiMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("removes Trace Lab from sidebar and opens session trace detail with Sessions nav active", () => {
    render(<Layout />);

    expect(screen.queryByRole("button", { name: /Trace Lab/i })).not.toBeInTheDocument();

    const sessionsNav = screen.getByRole("button", { name: "navigation.sessions" });
    fireEvent.click(sessionsNav);
    fireEvent.click(screen.getByRole("button", { name: "Open session trace" }));

    expect(screen.getByText(/TraceLab mock session session-a work/)).toBeInTheDocument();
    expect(sessionsNav).toHaveClass("active");
  });

  it("opens the all-trace activity fallback from Sessions", () => {
    render(<Layout />);

    fireEvent.click(screen.getByRole("button", { name: "navigation.sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "Open all traces" }));

    expect(screen.getByText(/TraceLab mock all/)).toBeInTheDocument();
  });
});

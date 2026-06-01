import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentCreationDraft,
  AgentDraftChangeEvent,
} from "../../../../shared/agents";
import type { ProfileInfo } from "../../../../shared/profiles";
import Agents from "./Agents";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) {
        return Object.entries(params).reduce(
          (message, [name, value]) =>
            message.replaceAll(`{{${name}}}`, String(value)),
          key,
        );
      }
      return key;
    },
  }),
}));

const mercuryProfile: ProfileInfo = {
  name: "default",
  path: "/profiles/default",
  isDefault: true,
  isActive: true,
  model: "gpt-4o",
  provider: "openai",
  hasEnv: true,
  hasSoul: true,
  skillCount: 0,
  gatewayRunning: false,
  displayName: "Mercury",
  kind: "builtin",
  immutable: true,
  deletable: false,
  description: "Built-in assistant",
  selectedPackIds: [],
  docsPointers: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

const draft: AgentCreationDraft = {
  id: "draft-1",
  status: "draft",
  revision: 1,
  profile: "research-buddy",
  displayName: "Research Buddy",
  description: "Finds sources",
  persona: "Careful researcher",
  model: { provider: "openai", model: "gpt-4o", baseUrl: "" },
  memory: { userProfile: "Prefers concise citations" },
  selectedPackIds: ["research"],
  docsPointers: [{ id: "docs", title: "Research docs" }],
  toolsetOverrides: { web: true },
  mutationIds: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

let draftChangedCallback: ((event: AgentDraftChangeEvent) => void) | null = null;

function installHermesApiMock(overrides: Partial<Window["hermesAPI"]> = {}): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      listProfiles: vi.fn().mockResolvedValue([mercuryProfile]),
      onAgentDraftChanged: vi.fn((callback) => {
        draftChangedCallback = callback;
        return vi.fn();
      }),
      createAgentDraft: vi.fn().mockResolvedValue(draft),
      getAgentDraft: vi.fn().mockResolvedValue(draft),
      commitAgentDraft: vi.fn().mockResolvedValue({
        success: false,
        code: "commit-failed",
        error: "stub",
        draft,
      }),
      sendMessage: vi.fn().mockResolvedValue({ response: "Let's shape it." }),
      setActiveProfile: vi.fn().mockResolvedValue(true),
      deleteProfile: vi.fn().mockResolvedValue({ success: true }),
      listModels: vi.fn().mockResolvedValue([]),
      getEnv: vi.fn().mockResolvedValue({}),
      getCredentialPool: vi.fn().mockResolvedValue({}),
      getCodexAuthStatus: vi.fn().mockResolvedValue(null),
      setModelConfig: vi.fn().mockResolvedValue(true),
      ...overrides,
    };
}

function renderAgents() {
  const onSelectProfile = vi.fn();
  const onProfileAction = vi.fn();
  render(
    <Agents
      activeProfile="default"
      onSelectProfile={onSelectProfile}
      onProfileAction={onProfileAction}
    />,
  );
  return { onSelectProfile, onProfileAction };
}

describe("Agents conversational creator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    draftChangedCallback = null;
    installHermesApiMock();
  });

  it("renders Mercury from listProfiles without showing the backend default label", async () => {
    renderAgents();

    expect(await screen.findByText("Mercury")).toBeInTheDocument();
    expect(screen.queryByText("default")).not.toBeInTheDocument();
    expect(window.hermesAPI.listProfiles).toHaveBeenCalled();
  });

  it("does not show delete or edit controls for immutable Mercury", async () => {
    renderAgents();

    expect(await screen.findByText("Mercury")).toBeInTheDocument();
    expect(screen.queryByTitle("agents.deleteTitle")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.configureModel")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionSkills")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionTools")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionPersona")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionMemory")).not.toBeInTheDocument();
    expect(screen.getByTitle("agents.actionChat")).toBeInTheDocument();
  });

  it("New Agent creates an authoritative draft and shows the review panel", async () => {
    renderAgents();

    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );

    expect(await screen.findByText("Research Buddy")).toBeInTheDocument();
    expect(screen.getByText("research-buddy")).toBeInTheDocument();
    expect(screen.getByText("openai / gpt-4o")).toBeInTheDocument();
    expect(window.hermesAPI.createAgentDraft).toHaveBeenCalledWith();
    expect(window.hermesAPI.getAgentDraft).toHaveBeenCalledWith("draft-1");
  });

  it("draft-change events update visible draft fields with prev/new notifications", async () => {
    renderAgents();
    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );
    await screen.findByText("Research Buddy");

    const updatedDraft = {
      ...draft,
      revision: 2,
      displayName: "Source Scout",
    };
    act(() => {
      draftChangedCallback?.({
        draftId: draft.id,
        revision: 2,
        snapshot: updatedDraft,
        changes: [
          { path: "displayName", previous: "Research Buddy", next: "Source Scout" },
        ],
        notification: {
          text: "Updated display name.",
          previousText: "Research Buddy",
          nextText: "Source Scout",
          debounced: true,
        },
      });
    });

    expect(await screen.findByText("Source Scout")).toBeInTheDocument();
    expect(screen.getByText(/Research Buddy/)).toBeInTheDocument();
    expect(screen.getAllByText(/Source Scout/).length).toBeGreaterThan(0);
  });

  it("commit success selects the returned backend profile and navigates to chat", async () => {
    const committedAgent: ProfileInfo = {
      ...mercuryProfile,
      name: "research-buddy",
      path: "/profiles/research-buddy",
      isDefault: false,
      isActive: true,
      displayName: "Research Buddy",
      kind: "custom",
      immutable: false,
      deletable: true,
    };
    installHermesApiMock({
      commitAgentDraft: vi.fn().mockResolvedValue({
        success: true,
        agent: committedAgent,
      }),
      listProfiles: vi.fn().mockResolvedValue([mercuryProfile, committedAgent]),
    });
    const { onSelectProfile, onProfileAction } = renderAgents();

    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "agents.creatorCommit" }),
    );

    await waitFor(() => {
      expect(window.hermesAPI.commitAgentDraft).toHaveBeenCalledWith({
        draftId: "draft-1",
        expectedRevision: 1,
        activate: true,
      });
      expect(onSelectProfile).toHaveBeenCalledWith("research-buddy");
      expect(onProfileAction).toHaveBeenCalledWith("chat");
    });
  });

  it("commit failure keeps the draft visible with typed failure details", async () => {
    installHermesApiMock({
      commitAgentDraft: vi.fn().mockResolvedValue({
        success: false,
        code: "commit-failed",
        error: "Item 5 stub",
        draft,
      }),
    });
    renderAgents();

    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "agents.creatorCommit" }),
    );

    expect(await screen.findByText("commit-failed: Item 5 stub")).toBeInTheDocument();
    expect(screen.getByText("Research Buddy")).toBeInTheDocument();
  });
});

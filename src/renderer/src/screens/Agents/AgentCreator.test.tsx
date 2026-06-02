import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentCreationDraft,
  AgentSeedSkill,
  AgentSeedSkillPrepareRequest,
  AttachAgentSeedSkillResult,
} from "../../../../shared/agents";
import { AgentCreator } from "./AgentCreator";

const chatMocks = vi.hoisted(() => ({
  handleSend: vi.fn(),
  isLoading: false,
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key;
      return Object.entries(params).reduce(
        (message, [name, value]) =>
          message.replaceAll(`{{${name}}}`, String(value)),
        key,
      );
    },
  }),
}));

vi.mock("../Chat/hooks/useChatController", () => ({
  useChatController: ({ messages }: { messages: unknown[] }) => ({
    input: "",
    setInput: vi.fn(),
    isLoading: chatMocks.isLoading,
    activityGroups: [],
    toggleActivityGroup: vi.fn(),
    usage: null,
    contextUsage: null,
    titleGenerationPending: false,
    fastMode: false,
    setFastMode: vi.fn(),
    messagesEndRef: { current: null },
    messagesContainerRef: { current: null },
    inputRef: { current: null },
    pickerRef: { current: null },
    slashMenuRef: { current: null },
    slashMenuOpen: false,
    filteredSlashCommands: [],
    slashSelectedIndex: 0,
    setSlashSelectedIndex: vi.fn(),
    currentModel: "gpt-4o",
    currentProvider: "openai",
    modelGroups: [],
    displayModel: "gpt-4o",
    visibleMessages: messages,
    lastMessageIsAgent: false,
    hermesSessionId: null,
    codexAuthRecovery: null,
    showCodexAuthRecovery: vi.fn(),
    dismissCodexAuthRecovery: vi.fn(),
    loadModelConfig: vi.fn(),
    handleSend: chatMocks.handleSend,
    handleQuickAsk: vi.fn(),
    handleKeyDown: vi.fn(),
    handleInputChange: vi.fn(),
    handleSlashSelect: vi.fn(),
    handleAbort: vi.fn(),
    handleClear: vi.fn(),
    handleApprove: vi.fn(),
    handleDeny: vi.fn(),
  }),
}));

vi.mock("./AgentSeedSkillModal", () => ({
  AgentSeedSkillModal: ({
    onAttach,
  }: {
    onAttach: (seed: {
      kind: "markdown";
      markdown: string;
      name: string;
      category: string;
      description: string;
    }) => Promise<AttachAgentSeedSkillResult>;
  }) => (
    <button
      type="button"
      onClick={() =>
        void onAttach({
          kind: "markdown",
          markdown: "# seed skill",
          name: "seed-skill",
          category: "custom",
          description: "Seed skill",
        })
      }
    >
      attach-seed
    </button>
  ),
}));

vi.mock("./AgentDraftNotifications", () => ({
  AgentDraftNotifications: () => <div data-testid="notifications" />,
}));

vi.mock("./AgentDraftReview", () => ({
  AgentDraftReview: () => <div data-testid="draft-review" />,
}));

type OnAttachSeedSkill = (
  seed: AgentSeedSkillPrepareRequest | null,
) => Promise<AttachAgentSeedSkillResult>;

const seedSkill: AgentSeedSkill = {
  kind: "markdown",
  name: "seed-skill",
  category: "custom",
  description: "Seed skill",
  fingerprint: "sha256:seed",
  contentPreview: "# seed skill",
  contentPreviewTruncated: false,
  overwrite: false,
  markdown: "# seed skill",
};

const draft: AgentCreationDraft = {
  id: "draft-1",
  status: "draft",
  revision: 1,
  profile: "draft-agent",
  displayName: "Draft Agent",
  description: "",
  persona: "",
  model: { provider: "openai", model: "gpt-4o", baseUrl: "" },
  memory: {},
  selectedPackIds: ["default"],
  docsPointers: [],
  toolsetOverrides: {},
  skillOverrides: {},
  mutationIds: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

function renderCreator({
  currentDraft = draft,
  onAttachSeedSkill = vi.fn<OnAttachSeedSkill>().mockResolvedValue({
    success: true,
    draft: { ...draft, seedSkill },
    changed: true,
  } satisfies AttachAgentSeedSkillResult),
}: {
  currentDraft?: AgentCreationDraft;
  onAttachSeedSkill?: OnAttachSeedSkill;
} = {}) {
  return {
    onAttachSeedSkill,
    ...render(
      <AgentCreator
        draft={currentDraft}
        notifications={[]}
        committing={false}
        commitError={null}
        remoteOnly={false}
        onCommit={vi.fn()}
        onUpdateDraft={vi.fn()}
        onAttachSeedSkill={onAttachSeedSkill}
        onClose={vi.fn()}
      />,
    ),
  };
}

describe("AgentCreator seed skill auto-analysis", () => {
  beforeEach(() => {
    chatMocks.handleSend.mockReset();
    chatMocks.handleSend.mockResolvedValue(undefined);
    chatMocks.isLoading = false;
  });

  it("auto-sends an analysis prompt once for a successful newly attached seed skill", async () => {
    renderCreator();

    fireEvent.click(
      screen.getByRole("button", { name: "agents.seedCreateFromSkill" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "attach-seed" }));

    await waitFor(() => expect(chatMocks.handleSend).toHaveBeenCalledTimes(1));
    const prompt = chatMocks.handleSend.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("A seed skill is now attached");
    expect(prompt).toContain("acknowledge that you can see it");
    expect(prompt).toContain("displayName");
    expect(prompt).toContain("description");
    expect(prompt).toContain("persona");
    expect(
      await screen.findByText("agents.seedAutoAnalyzing"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "agents.seedCreateFromSkill" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "attach-seed" }));

    await waitFor(() => expect(chatMocks.handleSend).toHaveBeenCalledTimes(1));
  });

  it("does not auto-send when clearing the attached seed skill", async () => {
    const onAttachSeedSkill = vi.fn<OnAttachSeedSkill>().mockResolvedValue({
      success: true,
      draft: { ...draft, seedSkill: null },
      changed: true,
    } satisfies AttachAgentSeedSkillResult);
    renderCreator({
      currentDraft: { ...draft, seedSkill },
      onAttachSeedSkill,
    });

    fireEvent.click(screen.getByLabelText("agents.seedClear"));

    await waitFor(() => expect(onAttachSeedSkill).toHaveBeenCalledWith(null));
    expect(chatMocks.handleSend).not.toHaveBeenCalled();
  });
});

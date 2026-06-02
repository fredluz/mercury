import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentCreationDraft,
  AgentDraftChangeEvent,
} from "../../../../shared/agents";
import type { ProfileInfo } from "../../../../shared/profiles";
import { normalizeAvatarFileToPngDataUrl } from "../../utils/agent-avatar-image";
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

vi.mock("../../utils/agent-avatar-image", () => ({
  normalizeAvatarFileToPngDataUrl: vi
    .fn()
    .mockResolvedValue("data:image/png;base64,normalized"),
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

const customProfile: ProfileInfo = {
  ...mercuryProfile,
  name: "research-buddy",
  path: "/profiles/research-buddy",
  isDefault: false,
  isActive: false,
  displayName: "Research Buddy",
  kind: "custom",
  immutable: false,
  deletable: true,
  description: "Finds sources",
};

const customProfileWithAvatar: ProfileInfo = {
  ...customProfile,
  avatar: {
    path: "avatar.png",
    contentType: "image/png",
    updatedAt: "2026-06-02T12:00:00.000Z",
    byteLength: 1024,
  },
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
  skillOverrides: {},
  mutationIds: [],
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

let draftChangedCallback: ((event: AgentDraftChangeEvent) => void) | null =
  null;

function installHermesApiMock(
  overrides: Partial<Window["hermesAPI"]> = {},
): void {
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
      onChatChunk: vi.fn(() => vi.fn()),
      onChatDone: vi.fn(() => vi.fn()),
      onChatToolProgress: vi.fn(() => vi.fn()),
      onChatTraceEvent: vi.fn(() => vi.fn()),
      onChatUsage: vi.fn(() => vi.fn()),
      onChatError: vi.fn(() => vi.fn()),
      setActiveProfile: vi.fn().mockResolvedValue(true),
      deleteProfile: vi.fn().mockResolvedValue({ success: true }),
      getAgentAvatarDataUrl: vi.fn().mockResolvedValue({
        success: true,
        dataUrl: "data:image/png;base64,cached",
        avatar: customProfileWithAvatar.avatar,
      }),
      setAgentAvatar: vi.fn().mockResolvedValue({
        success: true,
        agent: customProfileWithAvatar,
        avatar: customProfileWithAvatar.avatar,
      }),
      clearAgentAvatar: vi.fn().mockResolvedValue({
        success: true,
        agent: customProfile,
        avatar: null,
      }),
      listModels: vi.fn().mockResolvedValue([]),
      getEnv: vi.fn().mockResolvedValue({}),
      getConfig: vi.fn().mockResolvedValue(null),
      setConfig: vi.fn().mockResolvedValue(true),
      getCredentialPool: vi.fn().mockResolvedValue({}),
      getCodexAuthStatus: vi.fn().mockResolvedValue(null),
      getModelConfig: vi.fn().mockResolvedValue({
        provider: "openai",
        model: "gpt-4o",
        baseUrl: "",
      }),
      setModelConfig: vi.fn().mockResolvedValue(true),
      ...overrides,
    };
}

function renderAgents() {
  const onSelectProfile = vi.fn();
  const onProfileAction = vi.fn();
  const view = render(
    <Agents
      activeProfile="default"
      onSelectProfile={onSelectProfile}
      onProfileAction={onProfileAction}
    />,
  );
  return { onSelectProfile, onProfileAction, ...view };
}

describe("Agents conversational creator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(normalizeAvatarFileToPngDataUrl).mockResolvedValue(
      "data:image/png;base64,normalized",
    );
    draftChangedCallback = null;
    Element.prototype.scrollIntoView = vi.fn();
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
    expect(
      screen.queryByTitle("agents.configureModel"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionSkills")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionTools")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionPersona")).not.toBeInTheDocument();
    expect(screen.queryByTitle("agents.actionMemory")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("agents.setAvatarFor")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("agents.clearAvatarFor")).not.toBeInTheDocument();
    expect(screen.getByTitle("agents.actionChat")).toBeInTheDocument();
  });

  it("uploads a normalized avatar for a custom agent and reloads profiles", async () => {
    const listProfiles = vi
      .fn()
      .mockResolvedValue([mercuryProfile, customProfileWithAvatar])
      .mockResolvedValueOnce([mercuryProfile, customProfile]);
    installHermesApiMock({ listProfiles });
    const { container } = renderAgents();

    expect(await screen.findByText("Research Buddy")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("agents.setAvatarFor"));

    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    expect(input).toBeTruthy();
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    await waitFor(() => {
      expect(normalizeAvatarFileToPngDataUrl).toHaveBeenCalledWith(file);
      expect(window.hermesAPI.setAgentAvatar).toHaveBeenCalledWith({
        profile: "research-buddy",
        imageDataUrl: "data:image/png;base64,normalized",
      });
      expect(listProfiles).toHaveBeenCalledTimes(2);
    });
  });

  it("clears an existing custom avatar and reloads profiles", async () => {
    const listProfiles = vi
      .fn()
      .mockResolvedValue([mercuryProfile, customProfile])
      .mockResolvedValueOnce([mercuryProfile, customProfileWithAvatar]);
    installHermesApiMock({ listProfiles });
    renderAgents();

    expect(await screen.findByText("Research Buddy")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("agents.clearAvatarFor"));

    await waitFor(() => {
      expect(window.hermesAPI.clearAgentAvatar).toHaveBeenCalledWith({
        profile: "research-buddy",
      });
      expect(listProfiles).toHaveBeenCalledTimes(2);
    });
  });

  it("shows a localized upload failure message", async () => {
    installHermesApiMock({
      listProfiles: vi.fn().mockResolvedValue([mercuryProfile, customProfile]),
      setAgentAvatar: vi.fn().mockResolvedValue({
        success: false,
        code: "write-failed",
        error: "disk full",
      }),
    });
    const { container } = renderAgents();

    expect(await screen.findByText("Research Buddy")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("agents.setAvatarFor"));
    const input = container.querySelector<HTMLInputElement>("input[type='file']");
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });
    fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

    expect(
      await screen.findByText("agents.avatarUploadFailed: disk full"),
    ).toBeInTheDocument();
  });

  it("shows a localized clear failure message", async () => {
    installHermesApiMock({
      listProfiles: vi.fn().mockResolvedValue([mercuryProfile, customProfileWithAvatar]),
      clearAgentAvatar: vi.fn().mockResolvedValue({
        success: false,
        code: "write-failed",
        error: "locked",
      }),
    });
    renderAgents();

    expect(await screen.findByText("Research Buddy")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("agents.clearAvatarFor"));

    expect(
      await screen.findByText("agents.avatarClearFailed: locked"),
    ).toBeInTheDocument();
  });

  it("New Agent creates an authoritative draft and opens the stepped flow", async () => {
    renderAgents();

    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );

    // Identity step shows the draft name in an editable field.
    expect(
      await screen.findByDisplayValue("Research Buddy"),
    ).toBeInTheDocument();
    expect(window.hermesAPI.createAgentDraft).toHaveBeenCalledWith();
    expect(window.hermesAPI.getAgentDraft).toHaveBeenCalledWith("draft-1");

    // Walk to the Review step to confirm the profile id and model summary.
    fireEvent.click(
      screen.getByRole("button", { name: /agents\.creatorContinue/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /agents\.creatorContinue/ }),
    );
    expect(await screen.findByText("research-buddy")).toBeInTheDocument();
    expect(screen.getByText("openai / gpt-4o")).toBeInTheDocument();
  });

  it("draft-change events update visible draft fields with prev/new notifications", async () => {
    renderAgents();
    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );
    await screen.findByDisplayValue("Research Buddy");

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
          {
            path: "displayName",
            previous: "Research Buddy",
            next: "Source Scout",
          },
        ],
        notification: {
          text: "Updated display name.",
          previousText: "Research Buddy",
          nextText: "Source Scout",
          debounced: true,
        },
      });
    });

    // The Identity name field reflects the new value...
    expect(await screen.findByDisplayValue("Source Scout")).toBeInTheDocument();
    // ...and the diff chip surfaces the prev -> new transition.
    expect(screen.getByText("Research Buddy")).toBeInTheDocument();
    expect(screen.getByText("Source Scout")).toBeInTheDocument();
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
    await screen.findByDisplayValue("Research Buddy");
    fireEvent.click(
      screen.getByRole("button", { name: /agents\.creatorContinue/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /agents\.creatorContinue/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /agents\.creatorCreateAgent/ }),
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
    await screen.findByDisplayValue("Research Buddy");
    fireEvent.click(
      screen.getByRole("button", { name: /agents\.creatorContinue/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /agents\.creatorContinue/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /agents\.creatorCreateAgent/ }),
    );

    expect(
      await screen.findByText("commit-failed: Item 5 stub"),
    ).toBeInTheDocument();
    // The draft stays visible on the Review step.
    expect(screen.getByText("research-buddy")).toBeInTheDocument();
  });
});

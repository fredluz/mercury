import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileInfo } from "../../../../shared/profiles";
import ChatAgentPicker from "./ChatAgentPicker";

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

const profiles: ProfileInfo[] = [
  {
    name: "default",
    path: "/profiles/default",
    isDefault: true,
    isActive: true,
    model: "gpt-4o",
    provider: "openai",
    hasEnv: true,
    hasSoul: true,
    skillCount: 0,
      skillPackCount: 0,
      memoryCount: 0,
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
  },
  {
    name: "source-scout",
    path: "/profiles/source-scout",
    isDefault: false,
    isActive: false,
    model: "gpt-4o",
    provider: "openai",
    hasEnv: true,
    hasSoul: true,
    skillCount: 1,
      skillPackCount: 1,
      memoryCount: 0,
      gatewayRunning: false,
    displayName: "Source Scout",
    kind: "custom",
    immutable: false,
    deletable: true,
    description: "Finds sources",
    selectedPackIds: ["research"],
    docsPointers: [{ id: "docs", title: "Research docs" }],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      listProfiles: vi.fn().mockResolvedValue(profiles),
    };
}

describe("ChatAgentPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installHermesApiMock();
  });

  it("lists extended profiles without showing the raw default label", async () => {
    render(<ChatAgentPicker activeProfile="default" onStartNewChat={vi.fn()} />);

    expect(await screen.findByText("Mercury")).toBeInTheDocument();
    expect(screen.getByText("Source Scout")).toBeInTheDocument();
    expect(screen.queryByText("default")).not.toBeInTheDocument();
    expect(window.hermesAPI.listProfiles).toHaveBeenCalled();
  });

  it("starts chat with the backend profile, not the display name", async () => {
    const onStartNewChat = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatAgentPicker
        activeProfile="default"
        onStartNewChat={onStartNewChat}
      />,
    );

    fireEvent.click(await screen.findByText("Source Scout"));

    await waitFor(() => {
      expect(onStartNewChat).toHaveBeenCalledWith("source-scout");
    });
    expect(onStartNewChat).not.toHaveBeenCalledWith("Source Scout");
  });
});

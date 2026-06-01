import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Agents from "./Agents";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const profiles = [
  {
    name: "default",
    path: "/tmp/hermes/default",
    isDefault: true,
    isActive: true,
    model: "gpt-4o",
    provider: "openai",
    hasEnv: true,
    hasSoul: true,
    skillCount: 0,
    gatewayRunning: false,
  },
];

const inventoryModels = [
  {
    id: "hermes:anthropic:claude-haiku",
    name: "Claude Haiku",
    provider: "anthropic",
    model: "claude-haiku",
    baseUrl: "",
    createdAt: 0,
  },
  {
    id: "hermes:copilot:gpt-4.1",
    name: "Copilot GPT 4.1",
    provider: "copilot",
    model: "gpt-4.1",
    baseUrl: "",
    createdAt: 0,
  },
  {
    id: "hermes:openai:gpt-4o",
    name: "OpenAI GPT-4o",
    provider: "openai",
    model: "gpt-4o",
    baseUrl: "",
    createdAt: 0,
  },
  {
    id: "hermes:opencode-go:qwen3",
    name: "OpenCode Go Qwen3",
    provider: "opencode-go",
    model: "qwen3-coder",
    baseUrl: "",
    createdAt: 0,
  },
];

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI =
    {
      listProfiles: vi.fn().mockResolvedValue(profiles),
      listModels: vi.fn().mockResolvedValue(inventoryModels),
      getEnv: vi.fn().mockResolvedValue({ OPENAI_API_KEY: "sk-test" }),
      getCredentialPool: vi.fn().mockResolvedValue({
        "opencode-go": [{ key: "pool-key", label: "Pool key" }],
      }),
      getCodexAuthStatus: vi.fn().mockResolvedValue({
        hasHermesAuth: false,
        hasCodexCliAuth: false,
        selectedProvider: "",
        selectedModel: "",
        hermesAuthPath: "",
        codexAuthPath: "",
      }),
      setActiveProfile: vi.fn().mockResolvedValue(true),
      createProfile: vi.fn().mockResolvedValue({ success: true }),
      setModelConfig: vi.fn().mockResolvedValue(true),
    };
}

describe("Agents create model picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installHermesApiMock();
  });

  it("creates agents with config-copy enabled by default", async () => {
    render(
      <Agents
        activeProfile="work"
        onSelectProfile={vi.fn()}
        onProfileAction={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );
    fireEvent.change(
      await screen.findByPlaceholderText("agents.namePlaceholder"),
      {
        target: { value: "coder" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "agents.create" }));

    await waitFor(() => {
      expect(window.hermesAPI.createProfile).toHaveBeenCalledWith(
        "coder",
        true,
      );
    });
  });

  it("lists only providers connected in Mercury Providers settings", async () => {
    render(
      <Agents
        activeProfile="work"
        onSelectProfile={vi.fn()}
        onProfileAction={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "agents.newAgent" }),
    );

    await waitFor(() => {
      expect(screen.getAllByRole("combobox")[0]).toHaveValue("openai");
    });

    const providerSelect = screen.getAllByRole(
      "combobox",
    )[0] as HTMLSelectElement;
    const providerOptions = Array.from(providerSelect.options).map(
      (option) => option.value,
    );

    expect(window.hermesAPI.getEnv).toHaveBeenCalledWith("default");
    expect(window.hermesAPI.getCodexAuthStatus).toHaveBeenCalledWith("default");
    expect(providerOptions).toEqual(["openai", "opencode-go"]);
    expect(providerOptions).not.toContain("anthropic");
    expect(providerOptions).not.toContain("copilot");
  });
});

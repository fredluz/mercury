import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Models from "./Models";
import { MODEL_ROLES, type ModelRoleEntry, type ModelRoleListResult } from "../../../../shared/model-roles";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.tokens ? `${key}:${params.tokens}` : key,
  }),
}));

const textModel = {
  id: "model-text",
  name: "Claude Sonnet",
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4",
  baseUrl: "",
  createdAt: 1,
  contextWindow: 200000,
  capabilities: ["text" as const],
};

const imageInputOnlyModel = {
  id: "model-image-input",
  name: "Vision Only",
  provider: "openrouter",
  model: "vision-only",
  baseUrl: "",
  createdAt: 2,
  contextWindow: 100000,
  capabilities: ["image_input" as const],
};

function makeRoles(overrides: Partial<Record<string, Partial<ModelRoleEntry>>> = {}): ModelRoleEntry[] {
  return MODEL_ROLES.map((role) => {
    const isImage = role.id === "image";
    const base: ModelRoleEntry = {
      id: role.id,
      nameKey: role.nameKey,
      descriptionKey: role.descriptionKey,
      resolved: isImage
        ? {
            role: "image",
            kind: "image",
            ok: false,
            source: "image-capability",
            toolsetEnabled: false,
            providerConfigured: false,
            credentialAvailable: false,
            reason: "image_gen toolset is disabled",
          }
        : {
            role: role.id,
            kind: "text",
            ok: true,
            source: role.id === "chat" ? "profile-override" : "legacy-chat-config",
            provider: textModel.provider,
            model: textModel.model,
            baseUrl: textModel.baseUrl,
            contextWindow: textModel.contextWindow,
            capabilities: ["text"],
            modelId: textModel.id,
          },
    } as ModelRoleEntry;
    return { ...base, ...overrides[role.id] } as ModelRoleEntry;
  });
}

function makeResult(roles = makeRoles()): ModelRoleListResult {
  return {
    roles,
    savedModels: [textModel, imageInputOnlyModel],
    imageCapability: roles.find((role) => role.id === "image")!.resolved as ModelRoleListResult["imageCapability"],
  };
}

function installHermesApiMock(result: ModelRoleListResult): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    listModelRoles: vi.fn().mockResolvedValue(result),
    setProfileModelRoleOverride: vi.fn().mockResolvedValue(true),
    setGlobalModelRoleDefault: vi.fn().mockResolvedValue(true),
    clearProfileModelRoleOverride: vi.fn().mockResolvedValue(true),
    addModel: vi.fn().mockResolvedValue(textModel),
    updateModel: vi.fn().mockResolvedValue(true),
    removeModel: vi.fn().mockResolvedValue(true),
    setEnv: vi.fn().mockResolvedValue(true),
  };
}

describe("Models settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installHermesApiMock(makeResult());
  });

  it("renders all model roles, filters text role choices, and keeps Image as Codex capability status", async () => {
    render(<Models profile="work" />);

    await screen.findByText("models.roleDefaultsTitle");

    for (const role of MODEL_ROLES) {
      expect(screen.getByText(role.nameKey)).toBeInTheDocument();
    }

    const selectors = screen.getAllByRole("combobox");
    expect(selectors).toHaveLength(7);
    expect(within(selectors[0]).getByText(/Claude Sonnet/)).toBeInTheDocument();
    for (const selector of selectors) {
      expect(within(selector).queryByText(/Vision Only/)).not.toBeInTheDocument();
    }
    expect(screen.getByText("models.image.codexNativeOnly")).toBeInTheDocument();
    expect(screen.getByText("image_gen toolset is disabled")).toBeInTheDocument();
  });

  it("sets and clears profile overrides for text roles", async () => {
    const roles = makeRoles({
      chat: {
        profileOverride: {
          role: "chat",
          scope: "profile",
          profile: "work",
          modelId: textModel.id,
          provider: textModel.provider,
          model: textModel.model,
          baseUrl: "",
          contextWindow: textModel.contextWindow,
          capabilities: ["text"],
          updatedAt: 1,
        },
      },
    });
    installHermesApiMock(makeResult(roles));

    render(<Models profile="work" />);
    await screen.findByText("models.roleDefaultsTitle");

    fireEvent.click(screen.getAllByRole("button", { name: "models.setProfileOverride" })[0]);

    await waitFor(() =>
      expect(window.hermesAPI.setProfileModelRoleOverride).toHaveBeenCalledWith(
        "chat",
        expect.objectContaining({ modelId: textModel.id, model: textModel.model }),
        "work",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "models.useGlobalDefault" }));

    await waitFor(() =>
      expect(window.hermesAPI.clearProfileModelRoleOverride).toHaveBeenCalledWith("chat", "work"),
    );
  });

  it("shows missing saved model state and preserves library management controls", async () => {
    installHermesApiMock(
      makeResult(
        makeRoles({
          chat: {
            resolved: {
              role: "chat",
              kind: "text",
              ok: true,
              source: "missing-model",
              provider: "openrouter",
              model: "deleted-model",
              baseUrl: "",
              contextWindow: 100000,
              capabilities: ["text"],
              missingModelId: "deleted-id",
            },
          },
        }),
      ),
    );

    render(<Models profile="work" />);
    await screen.findByText("models.missingModelDescription");

    expect(screen.getByRole("button", { name: "models.addModel" })).toBeInTheDocument();
    const library = screen.getByText("models.modelLibraryTitle").closest("section")!;
    expect(within(library).getByText("Claude Sonnet")).toBeInTheDocument();
  });
});

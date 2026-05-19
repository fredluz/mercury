import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getModelRoleFallbackChain,
  MODEL_ROLE_IDS,
  normalizeModelCapabilities,
} from "../src/shared/model-roles";

async function loadModelRoles(home: string) {
  vi.resetModules();
  vi.doMock("../src/main/installer", () => ({
    HERMES_HOME: home,
    hasHermesAuthCredential: () => false,
  }));
  return import("../src/main/model-roles");
}

describe("model role taxonomy", () => {
  it("defines the stable role set and fallback chains", () => {
    expect(MODEL_ROLE_IDS).toEqual([
      "chat",
      "plan",
      "code",
      "explore",
      "research",
      "review",
      "design",
      "image",
    ]);
    expect(getModelRoleFallbackChain("explore")).toEqual(["explore", "code", "chat"]);
    expect(getModelRoleFallbackChain("image")).toEqual(["image"]);
  });

  it("defaults saved model capabilities to text without inferring image generation", () => {
    expect(normalizeModelCapabilities(undefined)).toEqual(["text"]);
    expect(normalizeModelCapabilities(["image_input", "codex_image_gen", "bad"])).toEqual([
      "image_input",
      "codex_image_gen",
    ]);
  });
});

describe("local model role storage and resolution", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "mercury-model-roles-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.doUnmock("../src/main/installer");
    vi.resetModules();
  });

  it("ignores malformed storage", async () => {
    writeFileSync(join(home, "model-roles.json"), "{not json", "utf-8");
    const roles = await loadModelRoles(home);
    expect(roles.readGlobalModelRoleDefaults()).toEqual({});
  });

  it("persists global defaults and lets profile overrides shadow them", async () => {
    const roles = await loadModelRoles(home);
    roles.writeGlobalModelRoleDefault("plan", {
      provider: "openai",
      model: "gpt-4.1",
      baseUrl: "",
    });
    roles.writeProfileModelRoleOverride(
      "plan",
      { provider: "anthropic", model: "claude-sonnet-4-20250514", baseUrl: "" },
      "work",
    );

    expect(roles.resolveModelForRole("plan").provider).toBe("openai");
    const resolved = roles.resolveModelForRole("plan", "work");
    expect(resolved.kind).toBe("text");
    expect(resolved.source).toBe("profile-override");
    expect(resolved.provider).toBe("anthropic");
  });

  it("resolves deleted saved model references from their snapshot", async () => {
    writeFileSync(join(home, "models.json"), JSON.stringify([], null, 2), "utf-8");
    const roles = await loadModelRoles(home);
    roles.writeProfileModelRoleOverride("review", {
      modelId: "missing-id",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-20250514",
      baseUrl: "",
    });

    const resolved = roles.resolveModelForRole("review");
    expect(resolved.kind).toBe("text");
    expect(resolved.source).toBe("missing-model");
    expect(resolved.missingModelId).toBe("missing-id");
    expect(resolved.model).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("falls Chat back to legacy config and keeps Code override storage independent", async () => {
    writeFileSync(
      join(home, "config.yaml"),
      'provider: "openrouter"\ndefault: "anthropic/claude-sonnet-4-20250514"\nbase_url: ""\n',
      "utf-8",
    );
    const roles = await loadModelRoles(home);

    expect(roles.resolveModelForRole("chat")).toMatchObject({
      kind: "text",
      source: "legacy-chat-config",
      provider: "openrouter",
    });

    roles.writeProfileModelRoleOverride("chat", {
      provider: "openai",
      model: "gpt-4.1",
      baseUrl: "",
    });
    const file = roles.readProfileModelRoleOverrides();
    expect(file.code).toBeUndefined();
    expect(roles.resolveModelForRole("code")).toMatchObject({
      kind: "text",
      source: "role-fallback",
      provider: "openai",
    });
  });

  it("does not resolve Image through a text fallback", async () => {
    const roles = await loadModelRoles(home);
    roles.writeGlobalModelRoleDefault("chat", {
      provider: "openai",
      model: "gpt-4.1",
      baseUrl: "",
    });

    const resolved = roles.resolveModelForRole("image");
    expect(resolved.kind).toBe("image");
    expect(resolved.ok).toBe(false);
    expect(resolved.source).toBe("image-capability");
  });

  it("recognizes nested image_gen provider config without treating it as a text model", async () => {
    writeFileSync(
      join(home, "config.yaml"),
      "image_gen:\n  provider: openai-codex\n  model: gpt-image-2-medium\n",
      "utf-8",
    );
    const roles = await loadModelRoles(home);

    const resolved = roles.resolveModelForRole("image");
    expect(resolved.kind).toBe("image");
    expect(resolved.toolsetEnabled).toBe(true);
    expect(resolved.providerConfigured).toBe(true);
    expect(typeof resolved.credentialAvailable).toBe("boolean");
  });

  it("normalizes existing saved models with text capability only", async () => {
    writeFileSync(
      join(home, "models.json"),
      JSON.stringify([
        {
          id: "m1",
          name: "Vision input model",
          provider: "openai",
          model: "gpt-4.1",
          baseUrl: "",
          createdAt: 1,
          inputModalities: ["image"],
        },
      ]),
      "utf-8",
    );
    await loadModelRoles(home);
    const { listModels } = await import("../src/main/models");
    expect(listModels()[0].capabilities).toEqual(["text"]);
  });

  it("stores profile role overrides in named profile homes", async () => {
    mkdirSync(join(home, "profiles", "alpha"), { recursive: true });
    const roles = await loadModelRoles(home);
    roles.writeProfileModelRoleOverride(
      "research",
      { provider: "openai", model: "gpt-4.1", baseUrl: "" },
      "alpha",
    );
    expect(roles.readModelRolesFile("alpha").defaults.research?.provider).toBe("openai");
  });
});

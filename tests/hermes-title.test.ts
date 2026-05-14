import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadTitleModule(options: { existingTitle?: string | null } = {}) {
  vi.resetModules();
  vi.doMock("../src/main/session-cache", () => ({
    generateTitle: (message: string) => `Heuristic: ${message || "New Chat"}`,
  }));
  vi.doMock("../src/main/sessions", () => ({
    getSessionTitle: () => options.existingTitle ?? null,
  }));
  vi.doMock("../src/main/config", () => ({
    getModelConfig: () => ({ provider: "openai", model: "gpt-4.1", baseUrl: "" }),
  }));
  vi.doMock("../src/main/hermes/connection", () => ({
    getApiUrl: () => {
      throw new Error("gateway unavailable");
    },
    getRemoteAuthHeader: () => ({}),
  }));
  return import("../src/main/hermes/title");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("generateChatTitle", () => {
  it("returns an existing persisted title before calling the model", async () => {
    const { generateChatTitle } = await loadTitleModule({
      existingTitle: 'Title: "Existing Persisted Title."',
    });

    await expect(
      generateChatTitle({
        sessionId: "s1",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).resolves.toBe("Existing Persisted Title");
  });

  it("falls back to a sanitized heuristic title when the model path fails", async () => {
    const { generateChatTitle } = await loadTitleModule();

    await expect(
      generateChatTitle({
        profile: "default",
        messages: [{ role: "user", content: "Build chat metadata foundations." }],
      }),
    ).resolves.toBe("Heuristic: Build chat metadata foundations");
  });

  it("handles empty messages through the fallback path", async () => {
    const { generateChatTitle } = await loadTitleModule();

    await expect(generateChatTitle({ messages: [] })).resolves.toBe(
      "Heuristic: New Chat",
    );
  });
});

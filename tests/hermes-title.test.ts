import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadTitleModule(
  options: { existingTitle?: string | null; resolvedRuntime?: unknown } = {},
) {
  vi.resetModules();
  vi.doMock("../src/main/session-cache", () => ({
    generateTitle: (message: string) => `Heuristic: ${message || "New Chat"}`,
  }));
  const getSessionTitle = vi.fn(() => options.existingTitle ?? null);
  vi.doMock("../src/main/sessions", () => ({
    getSessionTitle,
  }));
  vi.doMock("../src/main/config", () => ({
    getModelConfig: () => ({ provider: "openai", model: "gpt-4.1", baseUrl: "" }),
  }));
  const request = vi.fn(() => {
    const req = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    req.write = vi.fn();
    req.end = vi.fn(() => queueMicrotask(() => req.emit("error", new Error("model unavailable"))));
    req.destroy = vi.fn();
    return req;
  });
  vi.doMock("http", () => ({ default: { request }, request }));
  vi.doMock("https", () => ({ default: { request }, request }));
  const resolveRuntime = vi.fn().mockResolvedValue(
    options.resolvedRuntime ?? {
      request: { profile: "default", mode: "local", purpose: "title" },
      identity: {
        requestedProfile: "default",
        actualProfile: "default",
        verified: true,
        verificationSource: "managed-process",
        mode: "local",
        transport: "api",
        startedByMercury: true,
        verifiedAt: 1,
      },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19001",
    },
  );
  vi.doMock("../src/main/hermes/runtime", () => ({
    profileRuntimeManager: {
      normalizeProfile: (profile?: string) => profile?.trim() || "default",
      resolveRuntime,
    },
  }));
  const module = await import("../src/main/hermes/title");
  return { ...module, getSessionTitle, resolveRuntime };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("generateChatTitle", () => {
  it("returns an existing persisted title before calling the model", async () => {
    const { generateChatTitle, getSessionTitle } = await loadTitleModule({
      existingTitle: 'Title: "Existing Persisted Title."',
    });

    await expect(
      generateChatTitle({
        profile: "alpha",
        sessionId: "s1",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).resolves.toBe("Existing Persisted Title");
    expect(getSessionTitle).toHaveBeenCalledWith("s1", "alpha");
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

  it("rejects instead of masking a mismatched prepared runtime", async () => {
    const { generateChatTitle } = await loadTitleModule();

    await expect(
      generateChatTitle(
        {
          profile: "alpha",
          messages: [{ role: "user", content: "Profile-specific work" }],
        },
        {
          request: { profile: "beta", mode: "local", purpose: "title" },
          identity: {
            requestedProfile: "beta",
            actualProfile: "beta",
            verified: true,
            verificationSource: "managed-process",
            mode: "local",
            transport: "api",
            startedByMercury: true,
            verifiedAt: 1,
          },
          transport: "api",
          apiBaseUrl: "http://127.0.0.1:19002",
        } as never,
      ),
    ).rejects.toMatchObject({ code: "runtime-profile-mismatch" });
  });

  it("handles empty messages through the fallback path", async () => {
    const { generateChatTitle } = await loadTitleModule();

    await expect(generateChatTitle({ messages: [] })).resolves.toBe(
      "Heuristic: New Chat",
    );
  });
});

import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadChatModelHelper(config = { provider: "openai", model: "gpt-4o", baseUrl: "" }) {
  vi.resetModules();
  const getModelConfigForProfile = vi.fn(() => config);
  vi.doMock("../src/main/services/config-service", () => ({ getModelConfigForProfile }));
  const module = await import("../src/main/hermes/chat-model");
  return { ...module, getModelConfigForProfile };
}

async function loadChatApiWithModel(model: { provider: string; model: string; baseUrl: string }) {
  vi.resetModules();
  const bodies: unknown[] = [];
  const request = vi.fn(() => {
    const req = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    req.write = vi.fn((body: string) => bodies.push(JSON.parse(body)));
    req.end = vi.fn();
    req.destroy = vi.fn();
    return req;
  });
  vi.doMock("http", () => ({ default: { request }, request }));
  vi.doMock("https", () => ({ default: { request }, request }));
  vi.doMock("../src/main/hermes/chat-model", () => ({
    resolveChatRuntimeModel: vi.fn().mockResolvedValue({ ...model, source: "agent-config" }),
  }));
  vi.doMock("../src/main/hermes/trace-events", () => ({
    normalizeHermesStreamEvent: () => [],
    splitLegacyToolProgressContent: (content: string) => ({ prose: content, progressLabels: [] }),
  }));
  const module = await import("../src/main/hermes/chat-api");
  return { ...module, request, bodies };
}

async function loadTitleWithModel(model: { provider: string; model: string; baseUrl: string }) {
  vi.resetModules();
  const bodies: unknown[] = [];
  const request = vi.fn((_url: string, _options: unknown, callback: (res: EventEmitter & { statusCode: number }) => void) => {
    const req = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    req.write = vi.fn((body: string) => bodies.push(JSON.parse(body)));
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 200;
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify({ choices: [{ message: { content: "Agent Title" } }] })));
        res.emit("end");
      });
    });
    return req;
  });
  vi.doMock("http", () => ({ default: { request }, request }));
  vi.doMock("https", () => ({ default: { request }, request }));
  vi.doMock("../src/main/hermes/chat-model", () => ({
    resolveChatRuntimeModel: vi.fn().mockResolvedValue({ ...model, source: "agent-config" }),
  }));
  vi.doMock("../src/main/session-cache", () => ({ generateTitle: (message: string) => `Fallback: ${message}` }));
  vi.doMock("../src/main/sessions", () => ({ getSessionTitle: vi.fn(() => null) }));
  vi.doMock("../src/main/hermes/runtime", () => ({
    profileRuntimeManager: {
      normalizeProfile: (profile?: string) => profile?.trim() || "default",
      resolveRuntime: vi.fn(),
    },
  }));
  const module = await import("../src/main/hermes/title");
  return { ...module, bodies };
}

const runtime = {
  request: { profile: "work", mode: "local", purpose: "chat" as const },
  identity: {
    requestedProfile: "work",
    actualProfile: "work",
    verified: true,
    verificationSource: "managed-process" as const,
    mode: "local" as const,
    transport: "api" as const,
    startedByMercury: true,
    verifiedAt: 1,
  },
  transport: "api" as const,
  apiBaseUrl: "http://127.0.0.1:19001",
};

beforeEach(() => vi.restoreAllMocks());

describe("direct agent runtime model resolution", () => {
  it("uses profile config.yaml model settings", async () => {
    const { resolveChatRuntimeModel, getModelConfigForProfile } = await loadChatModelHelper();

    await expect(resolveChatRuntimeModel("work")).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      source: "agent-config",
    });
    expect(getModelConfigForProfile).toHaveBeenCalledWith("work");
  });

  it("fails before transport when direct agent model config is missing", async () => {
    const { resolveChatRuntimeModel } = await loadChatModelHelper({ provider: "auto", model: "", baseUrl: "" });
    await expect(resolveChatRuntimeModel("work")).rejects.toThrow("Configure the agent model");
  });

  it("passes the direct agent model to API chat requests", async () => {
    const { sendMessageViaApi, bodies } = await loadChatApiWithModel({ provider: "openai", model: "agent-api-model", baseUrl: "" });
    await sendMessageViaApi("hello", { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() }, "work", undefined, undefined, runtime);
    expect(bodies[0]).toMatchObject({ model: "agent-api-model", stream: true });
  });

  it("does not call API transport when direct agent model is unresolved", async () => {
    vi.resetModules();
    const request = vi.fn();
    vi.doMock("http", () => ({ default: { request }, request }));
    vi.doMock("https", () => ({ default: { request }, request }));
    vi.doMock("../src/main/hermes/chat-model", () => ({
      resolveChatRuntimeModel: vi.fn().mockRejectedValue(new Error("No model is configured for this agent. Configure the agent model before sending messages.")),
    }));
    vi.doMock("../src/main/hermes/trace-events", () => ({
      normalizeHermesStreamEvent: () => [],
      splitLegacyToolProgressContent: (content: string) => ({ prose: content, progressLabels: [] }),
    }));
    const { sendMessageViaApi } = await import("../src/main/hermes/chat-api");
    const onError = vi.fn();
    await sendMessageViaApi("hello", { onChunk: vi.fn(), onDone: vi.fn(), onError }, "work", undefined, undefined, runtime);
    expect(request).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Configure the agent model"));
  });

  it("passes the direct agent model to title generation requests", async () => {
    const { generateChatTitle, bodies } = await loadTitleWithModel({ provider: "openai", model: "agent-title-model", baseUrl: "" });
    await expect(
      generateChatTitle(
        { profile: "work", messages: [{ role: "user", content: "Summarize this" }] },
        { ...runtime, request: { profile: "work", mode: "local", purpose: "title" } },
      ),
    ).resolves.toBe("Agent Title");
    expect(bodies[0]).toMatchObject({ model: "agent-title-model", stream: false });
  });
});

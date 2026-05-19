import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadChatModelHelper(options: {
  resolved?: unknown;
  resolverError?: Error;
  legacy?: { provider: string; model: string; baseUrl: string };
} = {}) {
  vi.resetModules();
  const resolveModelForRoleForConnection = vi.fn(async () => {
    if (options.resolverError) throw options.resolverError;
    return options.resolved;
  });
  vi.doMock("../src/main/services/model-roles-service", () => ({
    resolveModelForRoleForConnection,
  }));
  const getModelConfig = vi.fn(() =>
    options.legacy ?? { provider: "legacy", model: "legacy-model", baseUrl: "" },
  );
  vi.doMock("../src/main/config", () => ({ getModelConfig }));
  const module = await import("../src/main/hermes/chat-model");
  return { ...module, resolveModelForRoleForConnection, getModelConfig };
}

async function loadChatApiWithModel(model: { provider: string; model: string; baseUrl: string }) {
  vi.resetModules();
  const bodies: unknown[] = [];
  const request = vi.fn(() => {
    const req = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    req.write = vi.fn((body: string) => {
      bodies.push(JSON.parse(body));
    });
    req.end = vi.fn();
    req.destroy = vi.fn();
    return req;
  });
  vi.doMock("http", () => ({ default: { request }, request }));
  vi.doMock("https", () => ({ default: { request }, request }));
  vi.doMock("../src/main/hermes/chat-model", () => ({
    resolveChatRuntimeModel: vi.fn().mockResolvedValue({ ...model, source: "profile-override" }),
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
    const req = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    req.write = vi.fn((body: string) => {
      bodies.push(JSON.parse(body));
    });
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      const res = new EventEmitter() as EventEmitter & { statusCode: number };
      res.statusCode = 200;
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify({ choices: [{ message: { content: "Role Title" } }] })));
        res.emit("end");
      });
    });
    return req;
  });
  vi.doMock("http", () => ({ default: { request }, request }));
  vi.doMock("https", () => ({ default: { request }, request }));
  vi.doMock("../src/main/hermes/chat-model", () => ({
    resolveChatRuntimeModel: vi.fn().mockResolvedValue({ ...model, source: "profile-override" }),
  }));
  vi.doMock("../src/main/session-cache", () => ({
    generateTitle: (message: string) => `Fallback: ${message}`,
  }));
  vi.doMock("../src/main/sessions", () => ({
    getSessionTitle: vi.fn(() => null),
  }));
  vi.doMock("../src/main/hermes/runtime", () => ({
    profileRuntimeManager: {
      normalizeProfile: (profile?: string) => profile?.trim() || "default",
      resolveRuntime: vi.fn(),
    },
  }));
  const module = await import("../src/main/hermes/title");
  return { ...module, bodies };
}

async function loadChatCliWithModel(model: {
  provider: string;
  model: string;
  baseUrl: string;
}) {
  vi.resetModules();
  const spawn = vi.fn(() => {
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
      killed: boolean;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = vi.fn(() => {
      proc.killed = true;
      return true;
    });
    return proc;
  });
  vi.doMock("child_process", () => ({ default: { spawn }, spawn }));
  vi.doMock("../src/main/install/paths", () => ({
    HERMES_HOME: "/tmp/hermes-home",
    HERMES_PYTHON: "python",
    HERMES_REPO: "/tmp/hermes-repo",
    HERMES_SCRIPT: "hermes",
    getEnhancedPath: () => "/usr/bin",
  }));
  vi.doMock("../src/main/config", () => ({
    readEnv: vi.fn(() => ({})),
  }));
  vi.doMock("../src/main/utils", () => ({
    stripAnsi: (value: string) => value,
  }));
  vi.doMock("../src/main/hermes/runtime", () => ({
    buildHermesProfileCommandArgs: (script: string, profile: string | undefined, args: string[]) =>
      profile && profile !== "default" ? [script, "-p", profile, ...args] : [script, ...args],
  }));
  vi.doMock("../src/main/hermes/trace-events", () => ({
    isStandaloneCliActivityLine: () => false,
    normalizeCliProgressLine: () => [],
  }));
  vi.doMock("../src/main/hermes/chat-model", () => ({
    resolveChatRuntimeModel: vi.fn().mockResolvedValue({ ...model, source: "profile-override" }),
  }));
  const module = await import("../src/main/hermes/chat-cli");
  return { ...module, spawn };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Chat role runtime model resolution", () => {
  it("uses the resolved Chat role when available", async () => {
    const { resolveChatRuntimeModel, resolveModelForRoleForConnection, getModelConfig } =
      await loadChatModelHelper({
        resolved: {
          role: "chat",
          kind: "text",
          ok: true,
          source: "profile-override",
          provider: "openai",
          model: "gpt-4o",
          baseUrl: "",
          contextWindow: 128_000,
          capabilities: ["text"],
          modelId: "saved-chat",
        },
      });

    await expect(resolveChatRuntimeModel("work")).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      source: "profile-override",
      modelId: "saved-chat",
    });
    expect(resolveModelForRoleForConnection).toHaveBeenCalledWith("chat", "work");
    expect(getModelConfig).not.toHaveBeenCalled();
  });

  it("falls back to legacy model config if Chat role resolution fails", async () => {
    const { resolveChatRuntimeModel, getModelConfig } = await loadChatModelHelper({
      resolverError: new Error("role storage unavailable"),
      legacy: { provider: "legacy-provider", model: "legacy-model", baseUrl: "https://legacy.test" },
    });

    await expect(resolveChatRuntimeModel("work")).resolves.toMatchObject({
      provider: "legacy-provider",
      model: "legacy-model",
      baseUrl: "https://legacy.test",
      source: "legacy-chat-config",
    });
    expect(getModelConfig).toHaveBeenCalledWith("work");
  });

  it("passes the resolved Chat role model to API chat requests", async () => {
    const { sendMessageViaApi, bodies } = await loadChatApiWithModel({
      provider: "openai",
      model: "role-api-model",
      baseUrl: "",
    });

    await sendMessageViaApi(
      "hello",
      { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      "work",
      undefined,
      undefined,
      {
        request: { profile: "work", mode: "local", purpose: "chat" },
        identity: { requestedProfile: "work", actualProfile: "work", verified: true, mode: "local", transport: "api", startedByMercury: true, verifiedAt: 1 },
        transport: "api",
        apiBaseUrl: "http://127.0.0.1:19001",
      },
    );

    expect(bodies[0]).toMatchObject({ model: "role-api-model", stream: true });
  });

  it("passes the resolved Chat role model to title generation requests", async () => {
    const { generateChatTitle, bodies } = await loadTitleWithModel({
      provider: "openai",
      model: "role-title-model",
      baseUrl: "",
    });

    await expect(
      generateChatTitle(
        { profile: "work", messages: [{ role: "user", content: "Summarize this" }] },
        {
          request: { profile: "work", mode: "local", purpose: "title" },
          identity: { requestedProfile: "work", actualProfile: "work", verified: true, mode: "local", transport: "api", startedByMercury: true, verifiedAt: 1 },
          transport: "api",
          apiBaseUrl: "http://127.0.0.1:19001",
        },
      ),
    ).resolves.toBe("Role Title");
    expect(bodies[0]).toMatchObject({ model: "role-title-model", stream: false });
  });

  it("passes the resolved Chat role model to the local Hermes CLI", async () => {
    const { sendMessageViaCli, spawn } = await loadChatCliWithModel({
      provider: "custom",
      model: "role-chat-model",
      baseUrl: "http://localhost:1234/v1",
    });

    await sendMessageViaCli(
      "hello",
      { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
      "work",
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    const [, args, options] = spawn.mock.calls[0];
    expect(args).toEqual([
      "hermes",
      "-p",
      "work",
      "chat",
      "-q",
      "hello",
      "-Q",
      "--source",
      "desktop",
      "-m",
      "role-chat-model",
    ]);
    expect(options.env).toMatchObject({
      HERMES_INFERENCE_PROVIDER: "custom",
      OPENAI_BASE_URL: "http://localhost:1234/v1",
      OPENAI_API_KEY: "no-key-required",
    });
  });
});

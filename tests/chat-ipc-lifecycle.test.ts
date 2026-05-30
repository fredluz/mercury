import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCallbacks, ChatHandle } from "../src/main/hermes/types";
import type { TraceEventType } from "../src/shared/traces";

type IpcHandler = (
  event: { sender: FakeSender },
  message: string,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
) => Promise<{ response: string; sessionId?: string }>;

type GenerateTitleHandler = (
  event: unknown,
  request: {
    profile?: string;
    sessionId?: string;
    messages: Array<{ role: "user" | "agent" | "assistant"; content: string }>;
  },
) => Promise<string>;

type FakeSender = {
  send: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handlers,
    capturedCallbacks: undefined as ChatCallbacks | undefined,
    abort: vi.fn(),
    ipcHandle: vi.fn(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler);
      },
    ),
    notificationShow: vi.fn(),
    sendMessage: vi.fn(),
    startGateway: vi.fn(),
    stopGateway: vi.fn(),
    getRuntimeIdentity: vi.fn(),
    isGatewayRunning: vi.fn(),
    ensureSshTunnelIfNeeded: vi.fn(),
    setSshRemoteApiKey: vi.fn(),
    isRemoteMode: vi.fn(),
    extractArtifactEventsFromText: vi.fn(),
    getConnectionConfig: vi.fn(),
    createTraceRun: vi.fn(),
    finishTraceRun: vi.fn(),
    recordTraceEvent: vi.fn(),
    recordTraceUsage: vi.fn(),
    sshGatewayStatus: vi.fn(),
    sshStartGateway: vi.fn(),
    sshReadRemoteApiKey: vi.fn(),
    startSshTunnel: vi.fn(),
    isSshTunnelHealthy: vi.fn(),
    updateSessionProfile: vi.fn(),
    updateSessionTitle: vi.fn(),
    projectCachedSession: vi.fn(),
    createHermesSession: vi.fn(),
    readHermesSession: vi.fn(),
    cachedSessionFromServerSession: vi.fn(),
    generateChatTitle: vi.fn(),
    profileRuntimeManager: {
      normalizeProfile: vi.fn(),
      resolveRuntime: vi.fn(),
    },
  };
});

vi.mock("electron", () => ({
  ipcMain: { handle: mocks.ipcHandle },
  Notification: vi
    .fn()
    .mockImplementation(() => ({ show: mocks.notificationShow })),
}));

vi.mock("../src/main/hermes", () => ({
  sendMessage: mocks.sendMessage,
  startGateway: mocks.startGateway,
  isGatewayRunning: mocks.isGatewayRunning,
  stopGateway: mocks.stopGateway,
  getRuntimeIdentity: mocks.getRuntimeIdentity,
  ensureSshTunnelIfNeeded: mocks.ensureSshTunnelIfNeeded,
  setSshRemoteApiKey: mocks.setSshRemoteApiKey,
  isRemoteMode: mocks.isRemoteMode,
}));

vi.mock("../src/main/hermes/trace-events", () => ({
  extractArtifactEventsFromText: mocks.extractArtifactEventsFromText,
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: mocks.getConnectionConfig,
}));

vi.mock("../src/main/trace-store", () => ({
  createTraceRun: mocks.createTraceRun,
  finishTraceRun: mocks.finishTraceRun,
  recordTraceEvent: mocks.recordTraceEvent,
  recordTraceUsage: mocks.recordTraceUsage,
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshGatewayStatus: mocks.sshGatewayStatus,
  sshStartGateway: mocks.sshStartGateway,
  sshReadRemoteApiKey: mocks.sshReadRemoteApiKey,
}));

vi.mock("../src/main/ssh-tunnel", () => ({
  startSshTunnel: mocks.startSshTunnel,
  isSshTunnelHealthy: mocks.isSshTunnelHealthy,
}));

vi.mock("../src/main/session-cache", () => ({
  updateSessionProfile: mocks.updateSessionProfile,
  updateSessionTitle: mocks.updateSessionTitle,
  projectCachedSession: mocks.projectCachedSession,
}));

vi.mock("../src/main/services/hermes-sessions-api", () => ({
  createHermesSession: mocks.createHermesSession,
  readHermesSession: mocks.readHermesSession,
  cachedSessionFromServerSession: mocks.cachedSessionFromServerSession,
}));

vi.mock("../src/main/hermes/title", () => ({
  generateChatTitle: mocks.generateChatTitle,
}));

vi.mock("../src/main/hermes/runtime", () => ({
  profileRuntimeManager: mocks.profileRuntimeManager,
}));

function resetMockState(): void {
  mocks.handlers.clear();
  mocks.capturedCallbacks = undefined;
  mocks.abort.mockReset();
  mocks.ipcHandle.mockClear();
  mocks.notificationShow.mockReset();
  mocks.startGateway.mockReset();
  mocks.stopGateway.mockReset();
  mocks.getRuntimeIdentity.mockReset().mockReturnValue({
    requestedProfile: "default",
    actualProfile: "default",
    verified: true,
    verificationSource: "managed-process",
    mode: "local",
    transport: "api",
    startedByMercury: true,
    verifiedAt: 1,
  });
  mocks.isGatewayRunning.mockReset().mockReturnValue(true);
  mocks.ensureSshTunnelIfNeeded.mockReset().mockResolvedValue(undefined);
  mocks.setSshRemoteApiKey.mockReset();
  mocks.isRemoteMode.mockReset().mockReturnValue(false);
  mocks.extractArtifactEventsFromText.mockReset().mockReturnValue([]);
  mocks.getConnectionConfig.mockReset().mockReturnValue({ mode: "local" });
  mocks.createTraceRun.mockReset().mockReturnValue({ id: "trace-1" });
  mocks.finishTraceRun.mockReset();
  mocks.recordTraceEvent
    .mockReset()
    .mockImplementation(
      (
        runId: string,
        type: TraceEventType,
        title: string,
        detail?: string,
        metadata?: Record<string, unknown>,
      ) => ({
        id: `event-${type}`,
        runId,
        type,
        timestamp: Date.now(),
        title,
        detail,
        metadata,
      }),
    );
  mocks.recordTraceUsage.mockReset();
  mocks.sshGatewayStatus.mockReset().mockResolvedValue(true);
  mocks.sshStartGateway.mockReset().mockResolvedValue(undefined);
  mocks.sshReadRemoteApiKey.mockReset().mockResolvedValue("remote-key");
  mocks.startSshTunnel.mockReset().mockResolvedValue(undefined);
  mocks.isSshTunnelHealthy.mockReset().mockResolvedValue(true);
  mocks.updateSessionProfile.mockReset();
  mocks.updateSessionTitle.mockReset();
  mocks.projectCachedSession.mockReset();
  mocks.createHermesSession.mockReset().mockResolvedValue({
    id: "server-session-1",
    title: "New Conversation",
    startedAt: 1,
    endedAt: null,
    source: "api",
    messageCount: 0,
    model: "",
    profile: "default",
    raw: {},
  });
  mocks.readHermesSession.mockReset().mockImplementation(async (_runtime, id: string) => ({
    id,
    title: "Existing Conversation",
    startedAt: 1,
    endedAt: null,
    source: "api",
    messageCount: 0,
    model: "",
    profile: "default",
    raw: {},
  }));
  mocks.cachedSessionFromServerSession.mockReset().mockImplementation((session) => ({
    id: session.id,
    title: session.title || "New Conversation",
    startedAt: session.startedAt,
    source: session.source,
    messageCount: session.messageCount,
    model: session.model,
    profile: session.profile,
  }));
  mocks.generateChatTitle.mockReset();
  mocks.profileRuntimeManager.normalizeProfile
    .mockReset()
    .mockImplementation((profile?: string) => profile?.trim() || "default");
  mocks.profileRuntimeManager.resolveRuntime.mockReset().mockResolvedValue({
    request: { profile: "default", mode: "local", purpose: "chat" },
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
  });
  mocks.sendMessage
    .mockReset()
    .mockImplementation(
      async (
        _message: string,
        callbacks: ChatCallbacks,
      ): Promise<ChatHandle> => {
        mocks.capturedCallbacks = callbacks;
        return { abort: mocks.abort };
      },
    );
}

async function setupHandler(): Promise<IpcHandler> {
  vi.resetModules();
  resetMockState();
  const { registerChatIpc } = await import("../src/main/ipc/chat");
  registerChatIpc({ getMainWindow: () => null });
  const handler = mocks.handlers.get("send-message");
  expect(handler).toBeTypeOf("function");
  return handler as IpcHandler;
}

function createEvent(): { sender: FakeSender } {
  return {
    sender: {
      send: vi.fn(),
      isDestroyed: vi.fn().mockReturnValue(false),
    },
  };
}

async function waitForTransportCallbacks(): Promise<ChatCallbacks> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mocks.capturedCallbacks).toBeDefined();
  return mocks.capturedCallbacks!;
}

function sentChannels(sender: FakeSender, channel: string): unknown[][] {
  return sender.send.mock.calls.filter((call) => call[0] === channel);
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.MERCURY_CHAT_SYNTHETIC_STREAM;
  warnSpy.mockRestore();
});

describe("chat IPC lifecycle hardening", () => {
  it("skips backend preparation when synthetic stream mode is explicitly enabled", async () => {
    process.env.MERCURY_CHAT_SYNTHETIC_STREAM = "1";
    const handler = await setupHandler();
    const event = createEvent();

    const invokePromise = handler(event, "hello", "default");
    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("synthetic answer");
    callbacks.onDone("synthetic-session-test");

    await expect(invokePromise).resolves.toEqual({
      response: "synthetic answer",
      sessionId: "synthetic-session-test",
    });
    expect(mocks.startGateway).not.toHaveBeenCalled();
    expect(mocks.ensureSshTunnelIfNeeded).not.toHaveBeenCalled();
    expect(mocks.getConnectionConfig).not.toHaveBeenCalled();
  });

  it("still sends chat-done and resolves when completion side effects throw", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    const invokePromise = handler(event, "hello", "default");
    let settleCount = 0;
    invokePromise.then(
      () => {
        settleCount += 1;
      },
      () => {
        settleCount += 1;
      },
    );

    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("complete answer");
    mocks.finishTraceRun.mockImplementationOnce(() => {
      throw new Error("trace write failed");
    });

    callbacks.onDone("session-1");

    await expect(invokePromise).resolves.toEqual({
      response: "complete answer",
      sessionId: "session-1",
    });
    callbacks.onDone("session-2");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentChannels(event.sender, "chat-chunk")).toHaveLength(1);
    expect(sentChannels(event.sender, "chat-done")).toEqual([
      ["chat-done", "session-1"],
    ]);
    expect(settleCount).toBe(1);
  });

  it("updates the profile-scoped session cache when chat completes with a real session id", async () => {
    const handler = await setupHandler();
    const event = createEvent();

    const invokePromise = handler(event, "hello", "alpha");
    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("complete answer");
    callbacks.onDone("session-alpha");

    await expect(invokePromise).resolves.toEqual({
      response: "complete answer",
      sessionId: "session-alpha",
    });
    expect(mocks.updateSessionProfile).toHaveBeenCalledWith(
      "session-alpha",
      "alpha",
    );
    expect(sentChannels(event.sender, "chat-done")).toEqual([
      ["chat-done", "session-alpha"],
    ]);
  });

  it("uses the pre-created server session when the legacy stream returns no header", async () => {
    const handler = await setupHandler();
    const event = createEvent();

    const invokePromise = handler(event, "hello", "alpha");
    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("complete answer");
    callbacks.onDiagnostic?.({
      code: "missing-session-id",
      severity: "warning",
      source: "api",
      profile: "alpha",
      resumed: false,
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19001",
      headerName: "x-hermes-session-id",
      headerShape: "missing",
    });
    callbacks.onDone(undefined);

    await expect(invokePromise).resolves.toEqual({
      response: "complete answer",
      sessionId: "server-session-1",
    });
    expect(mocks.projectCachedSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: "server-session-1", profile: "default" }),
    );
    expect(sentChannels(event.sender, "chat-done")).toEqual([
      ["chat-done", "server-session-1"],
    ]);
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[chat-service] Chat completed without a durable Hermes session id",
      expect.anything(),
    );
  });

  it("restarts an unmanaged local gateway before resolving chat runtime", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    mocks.getRuntimeIdentity.mockReturnValueOnce(undefined);

    const invokePromise = handler(event, "hello", "default");
    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("answer");
    callbacks.onDone("session-managed");

    await expect(invokePromise).resolves.toEqual({
      response: "answer",
      sessionId: "session-managed",
    });
    expect(mocks.stopGateway).toHaveBeenCalledWith(true, "default");
    expect(mocks.startGateway).toHaveBeenCalledWith("default");
    expect(
      mocks.startGateway.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.profileRuntimeManager.resolveRuntime.mock.invocationCallOrder[0],
    );
  });
  it("resolves a runtime for the selected profile before starting chat transport", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    const runtime = {
      request: { profile: "alpha", mode: "local", purpose: "chat" },
      identity: {
        requestedProfile: "alpha",
        actualProfile: "alpha",
        verified: true,
        verificationSource: "managed-process",
        mode: "local",
        transport: "api",
        startedByMercury: true,
        verifiedAt: 1,
      },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19001",
    };
    mocks.profileRuntimeManager.resolveRuntime.mockResolvedValueOnce(runtime);

    const invokePromise = handler(event, "hello", "alpha", "resume-session");
    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("answer");
    callbacks.onDone("session-alpha");

    await expect(invokePromise).resolves.toEqual({
      response: "answer",
      sessionId: "session-alpha",
    });
    expect(mocks.profileRuntimeManager.resolveRuntime).toHaveBeenCalledWith({
      profile: "alpha",
      purpose: "chat",
      sessionId: "resume-session",
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith(
      "hello",
      expect.any(Object),
      "alpha",
      "resume-session",
      undefined,
      runtime,
    );
  });

  it("blocks default chat when the local API runtime reports sticky story-scout", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    const runtimeError = Object.assign(
      new Error(
        "Selected profile default does not match Hermes runtime profile story-scout on the local API port.",
      ),
      {
        code: "runtime-profile-mismatch",
        identity: {
          requestedProfile: "default",
          actualProfile: "story-scout",
          verified: false,
          verificationSource: "unverified",
          mode: "local",
          transport: "api",
          apiBaseUrl: "http://127.0.0.1:8642",
          localPort: 8_642,
          startedByMercury: false,
          verifiedAt: 1,
          mismatchReason:
            "Hermes sticky active_profile is story-scout while Mercury selected default.",
        },
      },
    );
    mocks.profileRuntimeManager.resolveRuntime.mockRejectedValueOnce(
      runtimeError,
    );

    const invokePromise = handler(event, "hello", "default", "session-default");

    await expect(invokePromise).rejects.toBe(runtimeError);
    expect(mocks.profileRuntimeManager.resolveRuntime).toHaveBeenCalledWith({
      profile: "default",
      purpose: "chat",
      sessionId: "session-default",
    });
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.capturedCallbacks).toBeUndefined();
    expect(sentChannels(event.sender, "chat-error")).toEqual([
      [
        "chat-error",
        "runtime-profile-mismatch: Selected profile default does not match Hermes runtime profile story-scout on the local API port.",
      ],
    ]);
    expect(mocks.recordTraceEvent).toHaveBeenCalledWith(
      "trace-1",
      "transport.error",
      "Transport error",
      "runtime-profile-mismatch: Selected profile default does not match Hermes runtime profile story-scout on the local API port.",
      { source: "chat-send", code: "runtime-profile-mismatch" },
    );
  });

  it("surfaces runtime setup failures through chat-error and rejects", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    const runtimeError = Object.assign(
      new Error("Local API runtime unavailable"),
      {
        code: "runtime-unavailable",
        identity: {
          requestedProfile: "alpha",
          actualProfile: null,
          verified: false,
          verificationSource: "managed-process",
          mode: "local",
          transport: "api",
          startedByMercury: true,
          verifiedAt: 1,
        },
      },
    );
    mocks.profileRuntimeManager.resolveRuntime.mockRejectedValueOnce(
      runtimeError,
    );

    const invokePromise = handler(event, "hello", "alpha");

    await expect(invokePromise).rejects.toBe(runtimeError);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(sentChannels(event.sender, "chat-error")).toEqual([
      ["chat-error", "runtime-unavailable: Local API runtime unavailable"],
    ]);
    expect(mocks.recordTraceEvent).toHaveBeenCalledWith(
      "trace-1",
      "transport.error",
      "Transport error",
      "runtime-unavailable: Local API runtime unavailable",
      { source: "chat-send", code: "runtime-unavailable" },
    );
  });

  it("still starts transport and completes when pre-send trace setup throws", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    mocks.recordTraceEvent.mockImplementationOnce(() => {
      throw new Error("resume trace write failed");
    });

    const invokePromise = handler(event, "hello", "default", "resume-session", [
      { role: "user", content: "previous" },
    ]);

    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("answer after setup failure");
    callbacks.onDone("session-after-setup-failure");

    await expect(invokePromise).resolves.toEqual({
      response: "answer after setup failure",
      sessionId: "session-after-setup-failure",
    });
    expect(sentChannels(event.sender, "chat-done")).toEqual([
      ["chat-done", "session-after-setup-failure"],
    ]);
  });

  it("still starts transport and completes when trace run creation throws", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    mocks.createTraceRun.mockImplementationOnce(() => {
      throw new Error("trace create failed");
    });

    const invokePromise = handler(event, "hello", "default");

    const callbacks = await waitForTransportCallbacks();
    callbacks.onChunk("answer without trace run");
    callbacks.onDone("session-without-trace-run");

    await expect(invokePromise).resolves.toEqual({
      response: "answer without trace run",
      sessionId: "session-without-trace-run",
    });
    expect(sentChannels(event.sender, "chat-done")).toEqual([
      ["chat-done", "session-without-trace-run"],
    ]);
  });

  it("short-circuits generated chat titles in synthetic stream mode", async () => {
    process.env.MERCURY_CHAT_SYNTHETIC_STREAM = "1";
    await setupHandler();
    const handler = mocks.handlers.get("generate-chat-title") as
      | GenerateTitleHandler
      | undefined;
    expect(handler).toBeTypeOf("function");

    await expect(
      handler!(
        {},
        {
          profile: "default",
          sessionId: "synthetic-session-title",
          messages: [
            { role: "user", content: "Distinct prompt should not be sent" },
          ],
        },
      ),
    ).resolves.toBe("Synthetic chat benchmark");

    expect(mocks.generateChatTitle).not.toHaveBeenCalled();
    expect(mocks.startGateway).not.toHaveBeenCalled();
    expect(mocks.ensureSshTunnelIfNeeded).not.toHaveBeenCalled();
    expect(mocks.updateSessionTitle).toHaveBeenCalledWith(
      "synthetic-session-title",
      "Synthetic chat benchmark",
      "default",
    );
  });

  it("passes profile when persisting generated chat titles", async () => {
    await setupHandler();
    const handler = mocks.handlers.get("generate-chat-title") as
      | GenerateTitleHandler
      | undefined;
    expect(handler).toBeTypeOf("function");
    mocks.generateChatTitle.mockResolvedValue("Profile Aware Title");

    await expect(
      handler!(
        {},
        {
          profile: " research-agent ",
          sessionId: " session-title-1 ",
          messages: [{ role: "user", content: "Summarize this session" }],
        },
      ),
    ).resolves.toBe("Profile Aware Title");

    expect(mocks.generateChatTitle).toHaveBeenCalledWith(
      {
        profile: "research-agent",
        sessionId: "session-title-1",
        messages: [{ role: "user", content: "Summarize this session" }],
      }
    );
    expect(mocks.updateSessionTitle).toHaveBeenCalledTimes(1);
    expect(mocks.updateSessionTitle).toHaveBeenNthCalledWith(
      1,
      "session-title-1",
      "Profile Aware Title",
      "research-agent",
    );
  });

  it("forwards structured Codex auth recovery metadata with sanitized trace detail", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    const invokePromise = handler(event, "hello", "alpha");
    const callbacks = await waitForTransportCallbacks();
    const info = {
      displayMessage:
        "Codex sign-in needs to be refreshed. Re-authenticate with Mercury's in-app Codex login.",
      recovery: {
        kind: "codex-auth" as const,
        provider: "openai-codex" as const,
        reason: "refresh-token-consumed" as const,
        profile: "alpha",
        action: "start-codex-device-auth" as const,
      },
    };

    callbacks.onError(
      "Codex refresh token was already consumed by another client",
      info,
    );

    await expect(invokePromise).rejects.toThrow(
      "Codex refresh token was already consumed by another client",
    );
    expect(sentChannels(event.sender, "chat-error")).toEqual([
      ["chat-error", info.displayMessage, info],
    ]);
    expect(mocks.recordTraceEvent).toHaveBeenCalledWith(
      "trace-1",
      "transport.error",
      "Transport error",
      info.displayMessage,
      expect.objectContaining({ source: "chat", recovery: info.recovery }),
    );
    expect(JSON.stringify(mocks.recordTraceEvent.mock.calls)).not.toContain(
      "already consumed",
    );
  });

  it("still sends chat-error and rejects when error side effects throw", async () => {
    const handler = await setupHandler();
    const event = createEvent();
    const invokePromise = handler(event, "hello", "default");
    let settleCount = 0;
    invokePromise.then(
      () => {
        settleCount += 1;
      },
      () => {
        settleCount += 1;
      },
    );

    const callbacks = await waitForTransportCallbacks();
    mocks.recordTraceEvent.mockImplementationOnce(() => {
      throw new Error("trace error write failed");
    });

    callbacks.onError("transport exploded");

    await expect(invokePromise).rejects.toThrow("transport exploded");
    callbacks.onError("second error");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentChannels(event.sender, "chat-error")).toEqual([
      ["chat-error", "transport exploded"],
    ]);
    expect(settleCount).toBe(1);
  });
});

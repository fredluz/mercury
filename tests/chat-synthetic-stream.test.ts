import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCallbacks, ChatHandle } from "../src/main/hermes/types";

const mocks = vi.hoisted(() => ({
  sendMessageViaApi: vi.fn(),
  sendMessageViaCli: vi.fn(),
  ensureApiServerConfig: vi.fn(),
  isApiServerReady: vi.fn(),
  isRemoteMode: vi.fn(),
  readEnv: vi.fn(),
}));

vi.mock("../src/main/hermes/chat-api", () => ({
  sendMessageViaApi: mocks.sendMessageViaApi,
}));

vi.mock("../src/main/hermes/chat-cli", () => ({
  sendMessageViaCli: mocks.sendMessageViaCli,
}));

vi.mock("../src/main/hermes/connection", () => ({
  ensureApiServerConfig: mocks.ensureApiServerConfig,
  isApiServerReady: mocks.isApiServerReady,
  isRemoteMode: mocks.isRemoteMode,
}));

vi.mock("../src/main/config", () => ({
  readEnv: mocks.readEnv,
}));

vi.mock("../src/main/install/paths", () => ({
  HERMES_HOME: "/tmp/hermes-synthetic-test",
  HERMES_PYTHON: "python",
  HERMES_REPO: "/tmp/hermes-repo",
  HERMES_SCRIPT: "hermes",
  getEnhancedPath: () => process.env.PATH || "",
}));

function makeCallbacks(): ChatCallbacks & {
  chunks: string[];
  done: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const chunks: string[] = [];
  const done = vi.fn();
  const error = vi.fn();
  return {
    chunks,
    done,
    error,
    onChunk: (text) => chunks.push(text),
    onDone: done,
    onError: error,
  };
}

async function importGateway(): Promise<typeof import("../src/main/hermes/gateway")> {
  vi.resetModules();
  return import("../src/main/hermes/gateway");
}

function resetEnv(): void {
  delete process.env.MERCURY_CHAT_SYNTHETIC_STREAM;
  delete process.env.MERCURY_CHAT_SYNTHETIC_CHUNKS;
  delete process.env.MERCURY_CHAT_SYNTHETIC_INTERVAL_MS;
  delete process.env.MERCURY_CHAT_SYNTHETIC_PAYLOAD;
}

beforeEach(() => {
  resetEnv();
  mocks.sendMessageViaApi.mockReset();
  mocks.sendMessageViaCli.mockReset().mockReturnValue({ abort: vi.fn() } satisfies ChatHandle);
  mocks.ensureApiServerConfig.mockReset();
  mocks.isApiServerReady.mockReset().mockResolvedValue(false);
  mocks.isRemoteMode.mockReset().mockReturnValue(false);
  mocks.readEnv.mockReset().mockReturnValue({});
});

afterEach(() => {
  resetEnv();
  vi.useRealTimers();
});

describe("synthetic chat stream", () => {
  it("is impossible to trigger by default and leaves the normal gateway path untouched", async () => {
    const gateway = await importGateway();
    const callbacks = makeCallbacks();

    await gateway.sendMessage("hello", callbacks, "default");

    expect(mocks.ensureApiServerConfig).toHaveBeenCalledTimes(1);
    expect(mocks.isApiServerReady).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessageViaCli).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessageViaCli).toHaveBeenCalledWith("hello", callbacks, "default", undefined);
    expect(mocks.sendMessageViaApi).not.toHaveBeenCalled();
    expect(callbacks.chunks).toEqual([]);
  });

  it("produces the configured deterministic chunk count without real transport", async () => {
    vi.useFakeTimers();
    process.env.MERCURY_CHAT_SYNTHETIC_STREAM = "1";
    process.env.MERCURY_CHAT_SYNTHETIC_CHUNKS = "4";
    process.env.MERCURY_CHAT_SYNTHETIC_INTERVAL_MS = "5";
    process.env.MERCURY_CHAT_SYNTHETIC_PAYLOAD = "plain";
    const gateway = await importGateway();
    const callbacks = makeCallbacks();

    const handle = await gateway.sendMessage("hello", callbacks, "default");
    expect(handle.abort).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(20);

    expect(callbacks.chunks).toHaveLength(4);
    expect(callbacks.chunks.join("")).toContain("Synthetic chat chunk 004 of 4.");
    expect(callbacks.done).toHaveBeenCalledTimes(1);
    expect(callbacks.done.mock.calls[0]?.[0]).toMatch(/^synthetic-session-/);
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(mocks.ensureApiServerConfig).not.toHaveBeenCalled();
    expect(mocks.isApiServerReady).not.toHaveBeenCalled();
    expect(mocks.sendMessageViaApi).not.toHaveBeenCalled();
    expect(mocks.sendMessageViaCli).not.toHaveBeenCalled();
  });

  it("supports abort and does not finish after the stream is stopped", async () => {
    vi.useFakeTimers();
    process.env.MERCURY_CHAT_SYNTHETIC_STREAM = "1";
    process.env.MERCURY_CHAT_SYNTHETIC_CHUNKS = "5";
    process.env.MERCURY_CHAT_SYNTHETIC_INTERVAL_MS = "10";
    const gateway = await importGateway();
    const callbacks = makeCallbacks();

    const handle = await gateway.sendMessage("hello", callbacks, "default");
    await vi.advanceTimersByTimeAsync(10);
    handle.abort();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(callbacks.chunks).toHaveLength(1);
    expect(callbacks.done).not.toHaveBeenCalled();
    expect(callbacks.error).not.toHaveBeenCalled();
    expect(mocks.sendMessageViaApi).not.toHaveBeenCalled();
    expect(mocks.sendMessageViaCli).not.toHaveBeenCalled();
  });
});

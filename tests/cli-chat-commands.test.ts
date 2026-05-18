import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

function createIo() {
  let stdout = "";
  let stderr = "";
  return {
    io: {
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
    },
    output: () => ({ stdout, stderr }),
  };
}

async function loadCli() {
  vi.resetModules();
  return import("../src/cli/index");
}

describe("chat CLI commands", () => {
  const homes: string[] = [];
  const oldHome = process.env.HERMES_HOME;

  afterEach(() => {
    process.env.HERMES_HOME = oldHome;
    vi.doUnmock("../src/main/services/chat-service");
    vi.doUnmock("../src/main/services/config-service");
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function tempHome() {
    const home = mkdtempSync(join(tmpdir(), "mercury-cli-chat-"));
    homes.push(home);
    process.env.HERMES_HOME = home;
    return home;
  }

  it("streams chat send as NDJSON events and returns a final done payload", async () => {
    tempHome();
    const runChatMessage = vi.fn(async ({ message, profile, resumeSessionId, history, callbacks }) => {
      callbacks?.onChunk?.("Hello ");
      callbacks?.onLiveTraceEvent?.({ id: "e1", runId: "r1", type: "tool.progress", title: "Tool", timestamp: 1 });
      callbacks?.onToolProgress?.("searching");
      callbacks?.onUsage?.({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
      callbacks?.onChunk?.("world");
      return { response: "Hello world", sessionId: resumeSessionId ?? "session-1", profile, message, history };
    });
    vi.doMock("../src/main/services/chat-service", () => ({
      runChatMessage,
      generateChatTitleForRequest: vi.fn(),
      abortActiveChatRun: vi.fn(),
    }));
    vi.doMock("../src/main/services/config-service", () => ({ getConnection: () => ({ mode: "local" }) }));

    const historyFile = join(tempHome(), "history.json");
    writeFileSync(historyFile, JSON.stringify([{ role: "user", content: "Earlier" }]), "utf-8");
    const { runCli } = await loadCli();
    const { io, output } = createIo();
    const exitCode = await runCli({
      argv: ["--ndjson", "--profile", "work", "chat", "send", "--message", "Hi", "--resume", "session-0", "--history-file", historyFile],
      io,
    });

    const events = output().stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(exitCode).toBe(0);
    expect(output().stderr).toBe("");
    expect(events.map((event) => event.type)).toEqual(["start", "chunk", "trace", "tool", "usage", "chunk", "done"]);
    expect(events.at(-1)).toMatchObject({ type: "done", data: { response: "Hello world", sessionId: "session-0" } });
    expect(runChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "Hi",
      profile: "work",
      resumeSessionId: "session-0",
      history: [{ role: "user", content: "Earlier" }],
    }));
  });

  it("honors output flags after the chat command path", async () => {
    tempHome();
    vi.doMock("../src/main/services/chat-service", () => ({
      runChatMessage: vi.fn(async ({ callbacks }) => {
        callbacks?.onChunk?.("late flag");
        return { response: "late flag", sessionId: "s-late" };
      }),
      generateChatTitleForRequest: vi.fn(),
      abortActiveChatRun: vi.fn(),
    }));
    vi.doMock("../src/main/services/config-service", () => ({ getConnection: () => ({ mode: "local" }) }));

    const { runCli } = await loadCli();
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["chat", "send", "hello", "--ndjson"], io });

    const events = output().stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(exitCode).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["start", "chunk", "done"]);
  });

  it("supports JSON final-only chat send output", async () => {
    tempHome();
    const runChatMessage = vi.fn(async ({ callbacks }) => {
      callbacks?.onChunk?.("hidden in json mode");
      return { response: "Final answer", sessionId: "s-json" };
    });
    vi.doMock("../src/main/services/chat-service", () => ({
      runChatMessage,
      generateChatTitleForRequest: vi.fn(),
      abortActiveChatRun: vi.fn(),
    }));
    vi.doMock("../src/main/services/config-service", () => ({ getConnection: () => ({ mode: "local" }) }));

    const { runCli } = await loadCli();
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["--json", "chat", "send", "positional", "message"], io });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output().stdout)).toMatchObject({
      ok: true,
      command: "chat send positional message",
      data: { response: "Final answer", sessionId: "s-json" },
    });
    expect(output().stdout).not.toContain("hidden in json mode");
  });

  it("streams text chat chunks without duplicating the final response", async () => {
    tempHome();
    vi.doMock("../src/main/services/chat-service", () => ({
      runChatMessage: vi.fn(async ({ callbacks }) => {
        callbacks?.onChunk?.("A");
        callbacks?.onChunk?.("B");
        return { response: "AB", sessionId: "s-text" };
      }),
      generateChatTitleForRequest: vi.fn(),
      abortActiveChatRun: vi.fn(),
    }));
    vi.doMock("../src/main/services/config-service", () => ({ getConnection: () => ({ mode: "local" }) }));

    const { runCli } = await loadCli();
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["chat", "send", "hello"], io });

    expect(exitCode).toBe(0);
    expect(output().stdout).toBe("AB\n");
    expect(output().stderr).toBe("");
  });

  it("generates chat titles from message files and persists session/profile options through the service", async () => {
    tempHome();
    const messagesFile = join(tempHome(), "messages.json");
    writeFileSync(messagesFile, JSON.stringify({ messages: [{ role: "user", content: "Explain Mercury CLI" }] }), "utf-8");
    const generateChatTitleForRequest = vi.fn(async () => "Mercury CLI");
    vi.doMock("../src/main/services/chat-service", () => ({
      runChatMessage: vi.fn(),
      generateChatTitleForRequest,
      abortActiveChatRun: vi.fn(),
    }));
    vi.doMock("../src/main/services/config-service", () => ({ getConnection: () => ({ mode: "local" }) }));

    const { runCli } = await loadCli();
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["--json", "--profile", "work", "chat", "title", "--session", "s1", "--messages-file", messagesFile], io });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output().stdout)).toMatchObject({ data: { title: "Mercury CLI", sessionId: "s1" } });
    expect(generateChatTitleForRequest).toHaveBeenCalledWith({
      profile: "work",
      sessionId: "s1",
      messages: [{ role: "user", content: "Explain Mercury CLI" }],
    });
  });

  it("aborts active chat on SIGINT and exits 130", async () => {
    tempHome();
    let resolveRun!: (value: { response: string }) => void;
    const runChatMessage = vi.fn(({ callbacks }) => new Promise((resolve) => {
      resolveRun = resolve;
      callbacks?.onChunk?.("partial");
    }));
    const abortActiveChatRun = vi.fn(() => resolveRun({ response: "partial" }));
    vi.doMock("../src/main/services/chat-service", () => ({
      runChatMessage,
      generateChatTitleForRequest: vi.fn(),
      abortActiveChatRun,
    }));
    vi.doMock("../src/main/services/config-service", () => ({ getConnection: () => ({ mode: "local" }) }));

    const { runCli } = await loadCli();
    const { io, output } = createIo();
    const run = runCli({ argv: ["--ndjson", "chat", "send", "hello"], io });
    await vi.waitFor(() => expect(runChatMessage).toHaveBeenCalled());
    process.emit("SIGINT", "SIGINT");
    const exitCode = await run;

    const events = output().stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(exitCode).toBe(130);
    expect(abortActiveChatRun).toHaveBeenCalledWith("CLI interrupted the active Hermes run.");
    expect(events.map((event) => event.type)).toContain("error");
    expect(JSON.parse(output().stderr)).toMatchObject({ error: { code: "interrupted" } });
  });
});

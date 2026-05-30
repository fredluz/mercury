import http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCallbacks, ProfileRuntimeHandle } from "../src/main/hermes/types";

vi.mock("../src/main/hermes/chat-model", () => ({
  resolveChatRuntimeModel: vi.fn().mockResolvedValue({
    provider: "openai",
    model: "agent-api-model",
    source: "agent-config",
  }),
}));

type SeenRequest = {
  method?: string;
  url?: string;
  body: string;
  authorization?: string | string[];
};

const servers: http.Server[] = [];

function runtime(baseUrl: string): ProfileRuntimeHandle {
  return {
    request: { profile: "work", mode: "local", purpose: "chat" },
    identity: {
      requestedProfile: "work",
      actualProfile: "work",
      verified: true,
      verificationSource: "managed-process",
      mode: "local",
      transport: "api",
      startedByMercury: true,
      verifiedAt: 1,
    },
    transport: "api",
    apiBaseUrl: baseUrl,
    authHeaders: { Authorization: "Bearer test-key" },
  };
}

function callbacks(): ChatCallbacks & {
  chunks: string[];
  traces: string[];
  usages: unknown[];
  done: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const cb = {
    chunks: [] as string[],
    traces: [] as string[],
    usages: [] as unknown[],
    done: vi.fn(),
    error: vi.fn(),
    onChunk(text: string) {
      cb.chunks.push(text);
    },
    onDone: vi.fn(),
    onError: vi.fn(),
    onTraceEvent(event: { type: string }) {
      cb.traces.push(event.type);
    },
    onUsage(usage: unknown) {
      cb.usages.push(usage);
    },
  };
  cb.done = cb.onDone;
  cb.error = cb.onError;
  return cb;
}

async function fakeHermes(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
): Promise<{ baseUrl: string; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        body,
        authorization: req.headers.authorization,
      });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed");
  return { baseUrl: `http://127.0.0.1:${address.port}`, seen };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition timed out");
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("Hermes runs API transport", () => {
  it("submits a session-bound run, consumes unnamed SSE data events, and never calls chat completions", async () => {
    const { sendMessageViaApi } = await import("../src/main/hermes/chat-api");
    const { baseUrl, seen } = await fakeHermes((req, res, body) => {
      if (req.method === "POST" && req.url === "/v1/runs") {
        expect(JSON.parse(body)).toMatchObject({
          input: "hello",
          model: "agent-api-model",
          session_id: "session-1",
          conversation_history: [{ role: "assistant", content: "older" }],
        });
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_1", status: "started" }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/runs/run_1/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"event":"tool.started","run_id":"run_1","tool":"terminal"}\n\n');
        res.write('data: {"event":"message.delta","run_id":"run_1","delta":"hel"}\n\n');
        res.write('data: {"event":"message.delta","run_id":"run_1","delta":"lo"}\n\n');
        res.write('data: {"event":"approval.request","run_id":"run_1","tool":"terminal"}\n\n');
        res.write('data: {"event":"run.completed","run_id":"run_1","session_id":"session-1","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n\n');
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const cb = callbacks();

    await sendMessageViaApi(
      "hello",
      cb,
      "work",
      "session-1",
      [{ role: "agent", content: "older" }],
      runtime(baseUrl),
    );
    await waitFor(() => cb.done.mock.calls.length > 0);

    expect(cb.chunks.join("")).toBe("hello");
    expect(cb.traces).toEqual(["tool.started", "approval.requested"]);
    expect(cb.usages[0]).toMatchObject({
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
    });
    expect(cb.done).toHaveBeenCalledWith("session-1");
    expect(cb.error).not.toHaveBeenCalled();
    expect(seen.every((request) => request.authorization === "Bearer test-key")).toBe(true);
    expect(seen.map((request) => request.url)).not.toContain("/v1/chat/completions");
  });

  it("polls terminal run status when the SSE stream closes without a terminal event", async () => {
    const { sendMessageViaApi } = await import("../src/main/hermes/chat-api");
    const { baseUrl } = await fakeHermes((req, res) => {
      if (req.method === "POST" && req.url === "/v1/runs") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_2", status: "started" }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/runs/run_2/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"event":"message.delta","run_id":"run_2","delta":"partial"}\n\n');
        res.end();
        return;
      }
      if (req.method === "GET" && req.url === "/v1/runs/run_2") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_2", status: "failed", error: "provider exploded" }));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const cb = callbacks();

    await sendMessageViaApi("hello", cb, "work", "session-1", undefined, runtime(baseUrl));
    await waitFor(() => cb.error.mock.calls.length > 0);

    expect(cb.chunks.join("")).toBe("partial");
    expect(cb.error.mock.calls[0][0]).toBe("provider exploded");
    expect(cb.error.mock.calls[0][1]?.remediation).toMatchObject({
      kind: "debug-prompt",
      diagnostics: { runId: "run_2", sessionId: "session-1" },
    });
    expect(cb.done).not.toHaveBeenCalled();
  });

  it("attaches debug-prompt remediation metadata to run failures", async () => {
    const { sendMessageViaApi } = await import("../src/main/hermes/chat-api");
    const { baseUrl } = await fakeHermes((req, res) => {
      if (req.method === "POST" && req.url === "/v1/runs") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_debug", status: "started" }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/runs/run_debug/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({
          event: "run.failed",
          run_id: "run_debug",
          error: "'NoneType' object is not iterable",
        })}\n\n`);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const cb = callbacks();

    await sendMessageViaApi("hello", cb, "work", "session-1", undefined, runtime(baseUrl));
    await waitFor(() => cb.error.mock.calls.length > 0);

    expect(cb.error.mock.calls[0][0]).toBe("'NoneType' object is not iterable");
    expect(cb.error.mock.calls[0][1]?.remediation).toMatchObject({
      kind: "debug-prompt",
      tier: "debug-prompt",
      action: "copy-debug-prompt",
      diagnostics: {
        source: "run_failed",
        runId: "run_debug",
        sessionId: "session-1",
      },
    });
    expect(cb.error.mock.calls[0][1]?.remediation?.prompt).toContain(
      "Debug this Hermes/Mercury chat failure.",
    );
  });

  it("attaches queue-and-retry remediation metadata to run submission 429s", async () => {
    const { sendMessageViaApi } = await import("../src/main/hermes/chat-api");
    const { baseUrl } = await fakeHermes((req, res) => {
      if (req.method === "POST" && req.url === "/v1/runs") {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "too many concurrent runs", code: "rate_limit_exceeded" },
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const cb = callbacks();

    await sendMessageViaApi("hello", cb, "work", "session-1", undefined, runtime(baseUrl));
    await waitFor(() => cb.error.mock.calls.length > 0);

    expect(cb.error.mock.calls[0][0]).toBe("too many concurrent runs");
    expect(cb.error.mock.calls[0][1]?.remediation).toMatchObject({
      kind: "queue-retry",
      tier: "auto-fix",
      action: "queue-and-retry",
    });
  });

  it("retries transient run-cap 429s before surfacing an error", async () => {
    const { sendMessageViaApi } = await import("../src/main/hermes/chat-api");
    let submissions = 0;
    const { baseUrl, seen } = await fakeHermes((req, res) => {
      if (req.method === "POST" && req.url === "/v1/runs") {
        submissions += 1;
        if (submissions === 1) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "too many concurrent runs", code: "rate_limit_exceeded" },
            }),
          );
          return;
        }
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_after_retry", status: "started" }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/runs/run_after_retry/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          `data: ${JSON.stringify({
            event: "run.completed",
            run_id: "run_after_retry",
            session_id: "session-1",
            output: "ok",
          })}\n\n`,
        );
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    const cb = callbacks();

    await sendMessageViaApi("hello", cb, "work", "session-1", undefined, runtime(baseUrl));
    await waitFor(() => cb.done.mock.calls.length > 0);

    expect(seen.filter((request) => request.url === "/v1/runs")).toHaveLength(2);
    expect(cb.chunks.join("")).toBe("ok");
    expect(cb.done).toHaveBeenCalledWith("session-1");
    expect(cb.error).not.toHaveBeenCalled();
  });

  it("posts a run-specific stop request on abort", async () => {
    const { sendMessageViaApi } = await import("../src/main/hermes/chat-api");
    const { baseUrl, seen } = await fakeHermes((req, res) => {
      if (req.method === "POST" && req.url === "/v1/runs") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run_id: "run_stop", status: "started" }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/runs/run_stop/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/runs/run_stop/stop") {
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "stopping" }));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    const handle = await sendMessageViaApi(
      "hello",
      callbacks(),
      "work",
      "session-1",
      undefined,
      runtime(baseUrl),
    );
    await waitFor(() => seen.some((request) => request.url === "/v1/runs/run_stop/events"));
    handle.abort();
    await waitFor(() => seen.some((request) => request.url === "/v1/runs/run_stop/stop"));
  });

  it("resolves a pending run approval through the run-specific approval endpoint", async () => {
    const { resolveRunApproval } = await import("../src/main/hermes/runs-api");
    const { baseUrl, seen } = await fakeHermes((req, res, body) => {
      if (req.method === "POST" && req.url === "/v1/runs/run_approval/approval") {
        expect(JSON.parse(body)).toEqual({
          choice: "always",
          all: true,
          resolve_all: false,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "hermes.run.approval_response",
            run_id: "run_approval",
            choice: "always",
            resolved: 1,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });

    await expect(
      resolveRunApproval(runtime(baseUrl), "run_approval", {
        choice: "always",
        all: true,
      }),
    ).resolves.toEqual({
      runId: "run_approval",
      choice: "always",
      resolved: 1,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: "/v1/runs/run_approval/approval",
      authorization: "Bearer test-key",
    });
  });
});

import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearHermesBffDiagnostics,
  getHermesBffDiagnostics,
  HermesBffError,
  ProfileHermesBffClient,
} from "../src/main/hermes/bff";
import type { VerifiedApiRuntimeHandle } from "../src/main/hermes/runtime/api-runtime";

const servers: http.Server[] = [];

type SeenRequest = {
  method?: string;
  url?: string;
  body: string;
  headers: http.IncomingHttpHeaders;
};

function runtime(baseUrl: string): VerifiedApiRuntimeHandle {
  return {
    request: { profile: "work", mode: "local", purpose: "chat" },
    identity: {
      requestedProfile: "work",
      actualProfile: "work",
      verified: true,
      verificationSource: "managed-process",
      mode: "local",
      transport: "api",
      authKeyFingerprint: "Bearer runtime-secret-fingerprint",
      startedByMercury: true,
      verifiedAt: 1,
    },
    transport: "api",
    apiBaseUrl: baseUrl,
    authHeaders: { Authorization: "Bearer test-secret-token" },
  };
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
      seen.push({ method: req.method, url: req.url, body, headers: req.headers });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server failed");
  return { baseUrl: `http://127.0.0.1:${address.port}`, seen };
}

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

afterEach(async () => {
  clearHermesBffDiagnostics();
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("ProfileHermesBffClient", () => {
  it("injects verified-runtime auth and request headers for JSON requests", async () => {
    const { baseUrl, seen } = await fakeHermes((req, res, body) => {
      expect(req.method).toBe("POST");
      expect(req.url).toBe("/api/example");
      expect(req.headers.authorization).toBe("Bearer test-secret-token");
      expect(req.headers["x-mercury-request-id"]).toBe("req-json");
      expect(req.headers.accept).toBe("application/json");
      expect(req.headers["content-type"]).toContain("application/json");
      expect(req.headers["x-extra"]).toBe("allowed");
      expect(JSON.parse(body)).toEqual({ ok: true });
      json(res, { accepted: true });
    });

    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-json" });
    await expect(
      client.json({
        family: "sessions",
        method: "POST",
        path: "/api/example",
        body: { ok: true },
        retry: "none",
        headers: {
          Authorization: "Bearer caller-override",
          "X-Mercury-Request-Id": "caller-request-id",
          Accept: "text/plain",
          "Content-Type": "text/plain",
          "X-Extra": "allowed",
        },
      }),
    ).resolves.toEqual({ accepted: true });
    expect(seen).toHaveLength(1);
  });

  it("throws structured errors for unexpected statuses", async () => {
    const { baseUrl } = await fakeHermes((_req, res) => {
      json(res, { error: "nope", api_key: "super-secret-key" }, 418);
    });
    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-status" });

    await expect(
      client.json({ family: "models", method: "GET", path: "/api/model/options", retry: "none" }),
    ).rejects.toMatchObject({
      code: "http-error",
      family: "models",
      method: "GET",
      path: "/api/model/options",
      profile: "work",
      requestId: "req-status",
      statusCode: 418,
    });
  });

  it("throws invalid-json errors for malformed JSON responses", async () => {
    const { baseUrl } = await fakeHermes((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{not json");
    });
    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-json-bad" });

    await expect(
      client.json({ family: "capabilities", method: "GET", path: "/capabilities", retry: "none" }),
    ).rejects.toMatchObject({ code: "invalid-json", requestId: "req-json-bad" });
  });

  it("retries safe transient GETs once after health recovers", async () => {
    let valueAttempts = 0;
    let healthAttempts = 0;
    const { baseUrl, seen } = await fakeHermes((req, res) => {
      if (req.url === "/health") {
        healthAttempts += 1;
        return json(res, { ok: true });
      }
      if (req.method === "GET" && req.url === "/api/value") {
        valueAttempts += 1;
        if (valueAttempts === 1) return json(res, { error: "temporarily unavailable" }, 503);
        return json(res, { value: 42 });
      }
      json(res, { error: "not found" }, 404);
    });
    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-retry" });

    await expect(
      client.json({ family: "jobs", method: "GET", path: "/api/value" }),
    ).resolves.toEqual({ value: 42 });
    expect(valueAttempts).toBe(2);
    expect(healthAttempts).toBe(1);
    expect(seen.map((request) => request.url)).toEqual(["/api/value", "/health", "/api/value"]);
  });

  it("preserves cron jobs wire compatibility for list query and create 204", async () => {
    const { baseUrl, seen } = await fakeHermes((req, res, body) => {
      if (req.method === "GET" && req.url === "/api/jobs?include_disabled=true") {
        return json(res, { jobs: [{ id: "disabled", enabled: false }] });
      }
      if (req.method === "GET" && req.url === "/api/jobs") {
        return json(res, { jobs: [{ id: "active", enabled: true }] });
      }
      if (req.method === "POST" && req.url === "/api/jobs") {
        expect(JSON.parse(body)).toEqual({ id: "created" });
        res.writeHead(204);
        res.end();
        return;
      }
      json(res, { error: "not found" }, 404);
    });
    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-jobs" });

    await expect(client.jobs.list(true)).resolves.toEqual([{ id: "disabled", enabled: false }]);
    await expect(client.jobs.list(false)).resolves.toEqual([{ id: "active", enabled: true }]);
    await expect(client.jobs.create({ id: "created" })).resolves.toEqual({});
    expect(seen.map((request) => request.url)).toEqual([
      "/api/jobs?include_disabled=true",
      "/api/jobs",
      "/api/jobs",
    ]);
  });

  it("does not retry unsafe POSTs after transient failures", async () => {
    let postAttempts = 0;
    const { baseUrl, seen } = await fakeHermes((req, res) => {
      if (req.method === "POST" && req.url === "/v1/runs") {
        postAttempts += 1;
        return json(res, { error: "temporarily unavailable" }, 503);
      }
      if (req.url === "/health") return json(res, { ok: true });
      json(res, { error: "not found" }, 404);
    });
    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-no-retry" });

    await expect(
      client.json({
        family: "runs",
        method: "POST",
        path: "/v1/runs",
        body: { input: "hello" },
        expectedStatuses: [200, 202],
      }),
    ).rejects.toMatchObject({ code: "http-error", statusCode: 503, retryable: false });
    expect(postAttempts).toBe(1);
    expect(seen.map((request) => request.url)).toEqual(["/v1/runs"]);
  });

  it("parses SSE data events and reports SSE HTTP errors", async () => {
    const events: unknown[] = [];
    const { baseUrl } = await fakeHermes((req, res) => {
      if (req.url === "/events-ok") {
        expect(req.headers.accept).toBe("text/event-stream");
        expect(req.headers.authorization).toBe("Bearer test-secret-token");
        expect(req.headers["x-mercury-request-id"]).toBe("req-sse");
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(": keepalive\n\n");
        res.write('event: ignored\ndata: {"event":"one","value":1}\n\n');
        res.write('data: {"event":"two","value":2}\n\n');
        res.end();
        return;
      }
      if (req.url === "/events-fail") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "stream failed" }));
        return;
      }
      json(res, { error: "not found" }, 404);
    });
    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-sse" });

    await client.sse({ family: "runs", path: "/events-ok", onEvent: (event) => events.push(event) });
    expect(events).toEqual([
      { event: "one", value: 1 },
      { event: "two", value: 2 },
    ]);
    await expect(
      client.sse({ family: "runs", path: "/events-fail", onEvent: () => undefined }),
    ).rejects.toMatchObject({ code: "http-error", statusCode: 500 });
  });

  it("redacts secrets from diagnostics", async () => {
    const { baseUrl } = await fakeHermes((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Authorization: Basic leaked-basic api_key=leaked-key token=leaked-token-2",
        }),
      );
    });
    const client = new ProfileHermesBffClient(runtime(baseUrl), { requestId: () => "req-redact" });

    await expect(
      client.json({ family: "sessions", method: "GET", path: "/api/secret", retry: "none" }),
    ).rejects.toBeInstanceOf(HermesBffError);

    const diagnosticsJson = JSON.stringify(getHermesBffDiagnostics());
    expect(diagnosticsJson).toContain("[REDACTED]");
    expect(diagnosticsJson).not.toContain("leaked-basic");
    expect(diagnosticsJson).not.toContain("leaked-token");
    expect(diagnosticsJson).not.toContain("leaked-key");
    expect(diagnosticsJson).not.toContain("test-secret-token");
    expect(diagnosticsJson).not.toContain("runtime-secret-fingerprint");
  });
});

import http from "http";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProfileRuntimeHandle } from "../src/main/hermes/types";
import {
  createHermesSession,
  deleteHermesSession,
  forkHermesSession,
  getHermesSessionMessages,
  listHermesSessions,
  readHermesSession,
  updateHermesSessionTitle,
} from "../src/main/services/hermes-sessions-api";

const servers: http.Server[] = [];

function runtime(baseUrl: string): ProfileRuntimeHandle {
  return {
    request: { profile: "work", mode: "local", purpose: "sessions" },
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

function startServer(
  handler: http.RequestListener,
): Promise<{ baseUrl: string; requests: string[] }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    handler(req, res);
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("bad address");
      resolve({ baseUrl: `http://127.0.0.1:${address.port}`, requests });
    });
  });
}

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("Hermes Sessions API client", () => {
  it("delegates transport to the internal BFF sessions client", () => {
    const source = readFileSync(
      join(__dirname, "../src/main/services/hermes-sessions-api.ts"),
      "utf8",
    );
    expect(source).toContain("profileHermesBffClientForRuntime");
    expect(source).not.toContain('from "http"');
    expect(source).not.toContain('from "https"');
    expect(source).not.toContain("http.request");
    expect(source).not.toContain("https.request");
  });

  it("uses the documented create/list/read/messages/fork/title/delete endpoints", async () => {
    const { baseUrl, requests } = await startServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer test-key");
      if (req.method === "POST" && req.url === "/api/sessions") {
        return json(res, { session: { id: "s1", title: "New", started_at: 10 } });
      }
      if (req.method === "GET" && req.url === "/api/sessions") {
        return json(res, { sessions: [{ id: "s1", title: "New", started_at: 10 }] });
      }
      if (req.method === "GET" && req.url === "/api/sessions/s1") {
        return json(res, { session: { id: "s1", title: "New", started_at: 10 } });
      }
      if (req.method === "GET" && req.url === "/api/sessions/s1/messages") {
        return json(res, { messages: [{ id: 1, role: "user", content: "hi", timestamp: 11 }] });
      }
      if (req.method === "POST" && req.url === "/api/sessions/s1/fork") {
        return json(res, { session: { id: "s2", title: "Fork", started_at: 12 } });
      }
      if (req.method === "PATCH" && req.url === "/api/sessions/s1") {
        return json(res, { session: { id: "s1", title: "Renamed", started_at: 10 } });
      }
      if (req.method === "DELETE" && req.url === "/api/sessions/s1") {
        return json(res, { ok: true });
      }
      json(res, { error: "not found" }, 404);
    });

    const handle = runtime(baseUrl);
    await expect(createHermesSession(handle)).resolves.toMatchObject({ id: "s1", profile: "work" });
    await expect(listHermesSessions(handle)).resolves.toHaveLength(1);
    await expect(readHermesSession(handle, "s1")).resolves.toMatchObject({ id: "s1" });
    await expect(getHermesSessionMessages(handle, "s1")).resolves.toEqual([
      expect.objectContaining({ role: "user", content: "hi" }),
    ]);
    await expect(forkHermesSession(handle, "s1")).resolves.toMatchObject({ id: "s2" });
    await expect(updateHermesSessionTitle(handle, "s1", "Renamed")).resolves.toMatchObject({
      title: "Renamed",
    });
    await expect(deleteHermesSession(handle, "s1")).resolves.toBeUndefined();
    expect(requests).toEqual([
      "POST /api/sessions",
      "GET /api/sessions",
      "GET /api/sessions/s1",
      "GET /api/sessions/s1/messages",
      "POST /api/sessions/s1/fork",
      "PATCH /api/sessions/s1",
      "DELETE /api/sessions/s1",
    ]);
  });

  it("rejects malformed session payloads", async () => {
    const { baseUrl } = await startServer((_req, res) => json(res, { session: { title: "missing id" } }));
    await expect(createHermesSession(runtime(baseUrl))).rejects.toThrow("id");
  });
});

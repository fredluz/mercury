import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import {
  probeHermesCapabilities,
} from "../src/main/hermes/connection";

const servers: http.Server[] = [];

function startServer(
  handler: http.RequestListener,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address.");
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function validCapabilities(featureOverrides: Record<string, unknown> = {}) {
  return {
    object: "hermes.api_server.capabilities",
    platform: "hermes-agent",
    model: "hermes-agent",
    auth: { type: "bearer", required: true },
    features: {
      run_submission: true,
      session_resources: true,
      run_events_sse: true,
      run_stop: true,
      run_approval_response: true,
      session_continuity_header: "X-Hermes-Session-Id",
      session_key_header: "X-Hermes-Session-Key",
      ...featureOverrides,
    },
    endpoints: {
      runs: { method: "POST", path: "/v1/runs" },
      sessions: { method: "GET", path: "/api/sessions" },
    },
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("Hermes capability gate", () => {
  it("accepts healthy current Hermes capabilities", async () => {
    const { baseUrl } = await startServer((req, res) => {
      if (req.url === "/health") return writeJson(res, 200, { ok: true });
      if (req.url === "/v1/capabilities") {
        expect(req.headers.authorization).toBe("Bearer test-key");
        return writeJson(res, 200, validCapabilities());
      }
      writeJson(res, 404, {});
    });

    await expect(
      probeHermesCapabilities(baseUrl, { Authorization: "Bearer test-key" }),
    ).resolves.toMatchObject({
      ok: true,
      featureSummary: {
        runSubmission: true,
        sessionResources: true,
        runEventsSse: true,
        runStop: true,
        runApprovalResponse: true,
      },
    });
  });

  it("classifies gateway invalid API key separately", async () => {
    const { baseUrl } = await startServer((req, res) => {
      if (req.url === "/health") return writeJson(res, 200, { ok: true });
      if (req.url === "/v1/capabilities") {
        return writeJson(res, 401, {
          error: {
            message: "Invalid API key",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        });
      }
      writeJson(res, 404, {});
    });

    await expect(probeHermesCapabilities(baseUrl)).resolves.toMatchObject({
      ok: false,
      healthOk: true,
      problem: "invalid-api-key",
      statusCode: 401,
    });
  });

  it("requires run submission and session resources", async () => {
    const { baseUrl } = await startServer((req, res) => {
      if (req.url === "/health") return writeJson(res, 200, { ok: true });
      if (req.url === "/v1/capabilities") {
        return writeJson(
          res,
          200,
          validCapabilities({
            run_submission: false,
            session_resources: false,
          }),
        );
      }
      writeJson(res, 404, {});
    });

    await expect(probeHermesCapabilities(baseUrl)).resolves.toMatchObject({
      ok: false,
      healthOk: true,
      problem: "missing-required-features",
      missingFeatures: ["run_submission", "session_resources"],
    });
  });

  it("rejects malformed capability payloads", async () => {
    const { baseUrl } = await startServer((req, res) => {
      if (req.url === "/health") return writeJson(res, 200, { ok: true });
      if (req.url === "/v1/capabilities") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{not-json");
        return;
      }
      writeJson(res, 404, {});
    });

    await expect(probeHermesCapabilities(baseUrl)).resolves.toMatchObject({
      ok: false,
      healthOk: true,
      problem: "malformed",
    });
  });

  it("fails cleanly when health is unavailable", async () => {
    const { baseUrl } = await startServer((_req, res) => {
      writeJson(res, 503, { ok: false });
    });

    await expect(probeHermesCapabilities(baseUrl)).resolves.toMatchObject({
      ok: false,
      healthOk: false,
      problem: "network",
    });
  });
});

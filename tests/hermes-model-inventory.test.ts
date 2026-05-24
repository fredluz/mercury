import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Hermes model inventory mapping", () => {
  afterEach(() => {
    vi.doUnmock("child_process");
    vi.doUnmock("fs");
    vi.doUnmock("../src/main/config");
    vi.doUnmock("../src/main/hermes/connection");
    vi.doUnmock("../src/main/install/paths");
    vi.doUnmock("../src/main/utils");
    vi.resetModules();
  });

  it("maps Hermes model options into stable selectable descriptors", async () => {
    const { mapHermesModelOptionsToDescriptors } = await import(
      "../src/main/services/hermes-model-inventory-service"
    );
    const descriptors = mapHermesModelOptionsToDescriptors({
      providers: [
        {
          slug: "openrouter",
          name: "OpenRouter",
          api_url: "https://openrouter.ai/api/v1",
          models: ["anthropic/claude-sonnet-4", "openai/gpt-4.1"],
        },
      ],
    });

    expect(descriptors).toEqual([
      expect.objectContaining({
        id: "hermes:openrouter:anthropic%2Fclaude-sonnet-4",
        name: "OpenRouter anthropic/claude-sonnet-4",
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4",
        baseUrl: "https://openrouter.ai/api/v1",
        createdAt: 0,
        capabilities: ["text"],
      }),
      expect.objectContaining({
        id: "hermes:openrouter:openai%2Fgpt-4.1",
        provider: "openrouter",
        model: "openai/gpt-4.1",
      }),
    ]);
  });

  it("does not create selectable entries for providers without models", async () => {
    const { mapHermesModelOptionsToDescriptors } = await import(
      "../src/main/services/hermes-model-inventory-service"
    );
    expect(
      mapHermesModelOptionsToDescriptors({
        providers: [
          { slug: "anthropic", name: "Anthropic", models: [] },
          { slug: "empty", name: "Empty" },
        ],
      }),
    ).toEqual([]);
  });

  it("builds local metadata fallback with Hermes venv Python and HERMES_HOME", async () => {
    const { buildLocalInventoryProcessConfig } = await import(
      "../src/main/services/hermes-model-inventory-service"
    );
    const config = buildLocalInventoryProcessConfig({
      hermesHome: "/tmp/hermes-home",
      hermesPython: "/tmp/hermes-home/hermes-agent/venv/bin/python",
      hermesRepo: "/tmp/hermes-home/hermes-agent",
      enhancedPath: "/tmp/hermes-home/hermes-agent/venv/bin:/usr/bin",
      baseEnv: { EXISTING: "1" },
      exists: (path) => path.startsWith("/tmp/hermes-home"),
    });

    expect(config).toEqual({
      python: "/tmp/hermes-home/hermes-agent/venv/bin/python",
      cwd: "/tmp/hermes-home/hermes-agent",
      env: {
        EXISTING: "1",
        HERMES_HOME: "/tmp/hermes-home",
        HERMES_AGENT_HOME: "/tmp/hermes-home/hermes-agent",
        PATH: "/tmp/hermes-home/hermes-agent/venv/bin:/usr/bin",
      },
    });
  });

  it("falls back from unavailable runtime API to Hermes venv metadata for the selected profile", async () => {
    vi.resetModules();
    const home = mkdtempSync(join(tmpdir(), "mercury-inventory-fallback-"));
    const hermesRepo = join(home, "hermes-agent");
    const fakePython = join(hermesRepo, "venv", "bin", "python");
    const capturePath = join(home, "capture.json");
    const previousCapturePath = process.env.MERCURY_TEST_CAPTURE_PATH;

    mkdirSync(join(hermesRepo, "venv", "bin"), { recursive: true });
    writeFileSync(
      fakePython,
      `#!/usr/bin/env node
const fs = require("fs");
fs.writeFileSync(process.env.MERCURY_TEST_CAPTURE_PATH, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  env: {
    HERMES_HOME: process.env.HERMES_HOME,
    HERMES_AGENT_HOME: process.env.HERMES_AGENT_HOME,
    MERCURY_HERMES_PROFILE: process.env.MERCURY_HERMES_PROFILE,
    PATH: process.env.PATH,
  },
}));
process.stdout.write(JSON.stringify({
  providers: [{
    slug: "openai-codex",
    name: "Codex App Server",
    models: ["gpt-5.5"],
  }],
}));
`,
    );
    chmodSync(fakePython, 0o755);
    process.env.MERCURY_TEST_CAPTURE_PATH = capturePath;

    vi.doMock("../src/main/config", () => ({
      getConnectionConfig: () => ({ mode: "local" }),
    }));
    vi.doMock("../src/main/hermes/connection", () => ({
      ensureSshTunnelIfNeeded: vi.fn(),
      getApiUrl: () => "http://127.0.0.1:8642",
      getRemoteAuthHeader: () => ({}),
      isApiServerReady: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("../src/main/install/paths", () => ({
      HERMES_HOME: home,
      HERMES_PYTHON: fakePython,
      HERMES_REPO: hermesRepo,
      getEnhancedPath: () => `${join(hermesRepo, "venv", "bin")}:${dirname(process.execPath)}:/usr/bin`,
    }));
    vi.doMock("../src/main/utils", () => ({
      profileHome: (profile: string) => join(home, "profiles", profile),
    }));

    try {
      const { getHermesModelInventory } = await import(
        "../src/main/services/hermes-model-inventory-service"
      );
      const result = await getHermesModelInventory("story-scout");

      expect(result.availability).toMatchObject({
        ok: true,
        source: "local-metadata",
      });
      expect(result.models).toEqual([
        expect.objectContaining({
          provider: "openai-codex",
          model: "gpt-5.5",
        }),
      ]);
      expect(JSON.parse(readFileSync(capturePath, "utf-8"))).toEqual({
        argv: expect.arrayContaining(["-c"]),
        cwd: realpathSync(hermesRepo),
        env: expect.objectContaining({
          HERMES_HOME: join(home, "profiles", "story-scout"),
          HERMES_AGENT_HOME: hermesRepo,
          MERCURY_HERMES_PROFILE: "story-scout",
          PATH: `${join(hermesRepo, "venv", "bin")}:${dirname(process.execPath)}:/usr/bin`,
        }),
      });
    } finally {
      if (previousCapturePath === undefined) {
        delete process.env.MERCURY_TEST_CAPTURE_PATH;
      } else {
        process.env.MERCURY_TEST_CAPTURE_PATH = previousCapturePath;
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});

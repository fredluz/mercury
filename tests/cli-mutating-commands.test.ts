import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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

async function loadCliWithHome(home: string) {
  vi.resetModules();
  process.env.HERMES_HOME = home;
  return import("../src/cli/index");
}

async function runJson(home: string, argv: string[]) {
  const { runCli } = await loadCliWithHome(home);
  const { io, output } = createIo();
  const exitCode = await runCli({ argv: ["--json", ...argv], io });
  const captured = output();
  return {
    exitCode,
    stdout: captured.stdout,
    stderr: captured.stderr,
    json: captured.stdout ? JSON.parse(captured.stdout) : undefined,
    error: captured.stderr ? JSON.parse(captured.stderr) : undefined,
  };
}

describe("mutating CLI commands", () => {
  const homes: string[] = [];
  const oldHome = process.env.HERMES_HOME;

  afterEach(() => {
    process.env.HERMES_HOME = oldHome;
    vi.doUnmock("../src/main/services/cron-service");
    vi.doUnmock("../src/main/services/install-service");
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function tempHome() {
    const home = mkdtempSync(join(tmpdir(), "mercury-cli-mut-"));
    homes.push(home);
    return home;
  }

  it("mutates memory, user profile, SOUL, tools, skills, and gateway platform files", async () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    const userFile = join(home, "user.md");
    const skillFile = join(home, "demo-skill.md");
    writeFileSync(userFile, "User facts", "utf-8");
    writeFileSync(skillFile, "# Demo Skill\nDo useful things.", "utf-8");
    writeFileSync(
      join(home, "config.yaml"),
      "provider: auto\ndefault: \"\"\nbase_url: \"\"\nplatform_toolsets:\n  cli:\n    web: true\n  api_server:\n    web: true\n",
      "utf-8",
    );

    expect((await runJson(home, ["memory", "add", "first memory"])).json.data).toEqual({ success: true });
    expect((await runJson(home, ["memory", "update", "0", "updated memory"])).json.data).toEqual({ success: true });
    expect(readFileSync(join(home, "memories", "MEMORY.md"), "utf-8")).toBe("updated memory");

    expect((await runJson(home, ["user-profile", "write", "--file", userFile])).json.data).toEqual({ success: true });
    expect(readFileSync(join(home, "memories", "USER.md"), "utf-8")).toBe("User facts");

    expect((await runJson(home, ["soul", "write", "Soul text"])).json.data).toEqual({ success: true });
    expect(readFileSync(join(home, "SOUL.md"), "utf-8")).toBe("Soul text");
    expect((await runJson(home, ["soul", "reset"])).json.data.success).toBe(true);

    expect((await runJson(home, ["tools", "set", "web", "false"])).json.data).toEqual({ success: true, key: "web", enabled: false });

    const imported = await runJson(home, ["skills", "import", "--file", skillFile, "--name", "demo_skill", "--category", "custom"]);
    expect(imported.exitCode).toBe(0);
    expect(imported.json.data.skill).toMatchObject({ name: "demo_skill", category: "custom" });
    expect(existsSync(join(home, "skills", "custom", "demo_skill", "SKILL.md"))).toBe(true);

    const platform = await runJson(home, ["gateway", "platform", "set", "telegram", "true"]);
    expect(platform.json.data).toEqual({ success: true, platform: "telegram", enabled: true });
    expect(readFileSync(join(home, "config.yaml"), "utf-8")).toContain("enabled: true");

    expect((await runJson(home, ["memory", "remove", "0"])).json.data).toEqual({ success: true, index: 0 });
  });

  it("mutates env/config/model connection/model/credential state with JSON output", async () => {
    const home = tempHome();
    const entriesFile = join(home, "entries.json");
    writeFileSync(entriesFile, JSON.stringify([{ key: "secret", label: "Primary" }]), "utf-8");
    mkdirSync(join(home, "desktop"), { recursive: true });
    writeFileSync(
      join(home, "desktop", "sessions.json"),
      JSON.stringify({ sessions: [{ id: "s1", title: "Old", startedAt: 1, source: "cli", messageCount: 1, model: "m" }], lastSync: 0 }),
      "utf-8",
    );
    writeFileSync(join(home, "config.yaml"), "theme: light\nprovider: auto\ndefault: old\nbase_url: \"\"\n", "utf-8");

    expect((await runJson(home, ["env", "set", "OPENAI_API_KEY", "test-key"])).json.data).toMatchObject({ success: true, key: "OPENAI_API_KEY" });
    expect(readFileSync(join(home, ".env"), "utf-8")).toContain("OPENAI_API_KEY=test-key");

    expect((await runJson(home, ["config", "set", "theme", "dark"])).json.data).toMatchObject({ success: true, key: "theme" });
    expect(readFileSync(join(home, "config.yaml"), "utf-8")).toContain("theme: \"dark\"");

    expect((await runJson(home, ["model-config", "set", "--provider", "openai", "--model", "gpt-4.1", "--base-url", "https://api.example.test"])).json.data).toMatchObject({ success: true, provider: "openai", model: "gpt-4.1" });
    expect(readFileSync(join(home, "config.yaml"), "utf-8")).toContain("provider: \"openai\"");

    expect((await runJson(home, ["connection", "set", "--mode", "remote", "--url", "https://gateway.example", "--api-key", "k"])).json.data).toMatchObject({ success: true, mode: "remote" });
    expect((await runJson(home, ["connection", "ssh", "set", "--host", "host", "--port", "2222", "--username", "fred", "--key-path", "/tmp/key", "--remote-port", "8765", "--local-port", "19000"])).json.data).toMatchObject({ success: true, host: "host", port: 2222 });

    const added = await runJson(home, ["models", "add", "--name", "Test", "--provider", "openai", "--model", "gpt-test", "--base-url", "https://api.example.test"]);
    expect(added.exitCode).toBe(0);
    const id = added.json.data.id as string;
    expect(id).toBeTruthy();
    expect((await runJson(home, ["models", "update", id, "--name", "Renamed", "--context-window", "12345"])).json.data).toMatchObject({ success: true, id });
    expect((await runJson(home, ["models", "remove", id])).json.data).toEqual({ success: true, id });

    expect((await runJson(home, ["credentials", "set", "openai", "--entries-file", entriesFile])).json.data).toEqual({ success: true, provider: "openai", count: 1 });
    expect(JSON.parse(readFileSync(join(home, "auth.json"), "utf-8")).credential_pool.openai).toEqual([{ key: "secret", label: "Primary" }]);

    expect((await runJson(home, ["sessions", "title", "set", "s1", "New", "Title"])).json.data).toMatchObject({ success: true, sessionId: "s1", title: "New Title" });
    expect(JSON.parse(readFileSync(join(home, "desktop", "sessions.json"), "utf-8")).sessions[0].title).toBe("New Title");
  });

  it("supports mocked cron mutations and ndjson install progress without live services", async () => {
    const home = tempHome();
    vi.doMock("../src/main/services/cron-service", () => ({
      createCronJobForProfile: vi.fn(async () => ({ success: true, id: "job-1" })),
      removeCronJobForProfile: vi.fn(async (id: string) => ({ success: true, id })),
      pauseCronJobForProfile: vi.fn(async (id: string) => ({ success: true, id })),
      resumeCronJobForProfile: vi.fn(async (id: string) => ({ success: true, id })),
      triggerCronJobForProfile: vi.fn(async (id: string) => ({ success: true, id })),
    }));

    expect((await runJson(home, ["cron", "create", "--schedule", "* * * * *", "--prompt", "hello"])).json.data).toEqual({ success: true, id: "job-1" });
    expect((await runJson(home, ["cron", "pause", "job-1"])).json.data).toEqual({ success: true, id: "job-1" });
    expect((await runJson(home, ["cron", "resume", "job-1"])).json.data).toEqual({ success: true, id: "job-1" });
    expect((await runJson(home, ["cron", "run", "job-1"])).json.data).toEqual({ success: true, id: "job-1" });
    expect((await runJson(home, ["cron", "remove", "job-1"])).json.data).toEqual({ success: true, id: "job-1" });

    vi.doMock("../src/main/services/install-service", () => ({
      startInstall: vi.fn(async (onProgress: (event: unknown) => void) => {
        onProgress({ step: 1, totalSteps: 1, title: "Install", detail: "progress detail", log: "progress detail\n" });
        return { success: true };
      }),
    }));
    const { runCli } = await loadCliWithHome(home);
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["--ndjson", "install", "start"], io });
    const lines = output().stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(exitCode).toBe(0);
    expect(lines[0]).toMatchObject({ type: "progress" });
    expect(lines[1]).toMatchObject({ type: "done", data: { success: true } });
  });
});

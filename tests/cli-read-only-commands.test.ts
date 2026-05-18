import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
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

describe("read-only CLI commands", () => {
  const homes: string[] = [];
  const oldHome = process.env.HERMES_HOME;

  afterEach(() => {
    process.env.HERMES_HOME = oldHome;
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function tempHome() {
    const home = mkdtempSync(join(tmpdir(), "mercury-cli-ro-"));
    homes.push(home);
    return home;
  }

  it("reads memory and SOUL through the knowledge service", async () => {
    const home = tempHome();
    mkdirSync(join(home, "memories"), { recursive: true });
    writeFileSync(join(home, "memories", "MEMORY.md"), "remember this", "utf-8");
    writeFileSync(join(home, "memories", "USER.md"), "user profile", "utf-8");
    writeFileSync(join(home, "SOUL.md"), "soul text", "utf-8");

    const memory = await runJson(home, ["memory", "read"]);
    expect(memory.exitCode).toBe(0);
    expect(memory.json).toMatchObject({ ok: true, command: "memory read", mode: "local" });
    expect(memory.json.data.memory.content).toBe("remember this");
    expect(memory.json.data.user.content).toBe("user profile");

    const soul = await runJson(home, ["soul", "read"]);
    expect(soul.exitCode).toBe(0);
    expect(soul.json.data).toBe("soul text");
  });

  it("lists profiles/agents and reads connection state", async () => {
    const home = tempHome();
    mkdirSync(join(home, "profiles", "work"), { recursive: true });
    writeFileSync(join(home, "active_profile"), "work", "utf-8");
    writeFileSync(join(home, "desktop.json"), JSON.stringify({ connectionMode: "local" }), "utf-8");

    const profiles = await runJson(home, ["profiles", "list"]);
    expect(profiles.exitCode).toBe(0);
    expect(profiles.json.data.profiles.map((profile: { name: string }) => profile.name)).toContain("work");

    const agents = await runJson(home, ["agents", "list"]);
    expect(agents.exitCode).toBe(0);
    expect(agents.json.data.agents.map((profile: { name: string }) => profile.name)).toContain("default");

    const connection = await runJson(home, ["connection", "get"]);
    expect(connection.exitCode).toBe(0);
    expect(connection.json.data.mode).toBe("local");
  });

  it("reads skills content and metadata", async () => {
    const home = tempHome();
    const skillDir = join(home, "skills", "custom", "demo");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo\ndescription: Demo skill\n---\n# Demo", "utf-8");
    writeFileSync(join(skillDir, "references", "note.md"), "note", "utf-8");

    const installed = await runJson(home, ["skills", "installed"]);
    expect(installed.exitCode).toBe(0);
    expect(installed.json.data).toMatchObject([{ name: "demo", category: "custom" }]);

    const content = await runJson(home, ["skills", "content", skillDir]);
    expect(content.exitCode).toBe(0);
    expect(content.json.data).toContain("Demo skill");

    const metadata = await runJson(home, ["skills", "metadata", skillDir]);
    expect(metadata.exitCode).toBe(0);
    expect(metadata.json.data).toMatchObject({ metadataAvailable: true });
    expect(metadata.json.data.references).toEqual([{ name: "note.md", relativePath: "references/note.md", kind: "file" }]);
  });

  it("supports sessions, traces, cron, gateway, install, logs, mcp, providers, and dump read commands", async () => {
    const home = tempHome();
    mkdirSync(join(home, "desktop"), { recursive: true });
    mkdirSync(join(home, "cron"), { recursive: true });
    mkdirSync(join(home, "logs"), { recursive: true });
    writeFileSync(join(home, "desktop", "sessions.json"), JSON.stringify({ sessions: [] }), "utf-8");
    writeFileSync(join(home, "cron", "jobs.json"), JSON.stringify([{ id: "job-1", name: "Daily", schedule: "* * * * *" }]), "utf-8");
    writeFileSync(join(home, "logs", "agent.log"), "line1\nline2", "utf-8");
    writeFileSync(join(home, "config.yaml"), "mcp_servers:\n  local:\n    command: node\n    enabled: true\n", "utf-8");
    writeFileSync(
      join(home, "desktop-traces.json"),
      JSON.stringify({ version: 1, runs: [{ id: "run-1", title: "Run", profile: "default", status: "completed", startedAt: 1, updatedAt: 2, messagePreview: "hi", events: [] }] }),
      "utf-8",
    );

    expect((await runJson(home, ["sessions", "list"])).json.data).toEqual([]);
    expect((await runJson(home, ["sessions", "cache", "list"])).json.data).toEqual([]);
    expect((await runJson(home, ["sessions", "search", "hello", "--limit", "2"])).json.data).toEqual([]);
    expect((await runJson(home, ["cron", "list"])).json.data[0].id).toBe("job-1");
    expect((await runJson(home, ["traces", "list"])).json.data[0].id).toBe("run-1");
    expect((await runJson(home, ["traces", "get", "run-1"])).json.data.id).toBe("run-1");
    expect((await runJson(home, ["traces", "skill-runs"])).json.data).toEqual([]);
    expect((await runJson(home, ["gateway", "status"])).json.data).toEqual({ running: false });
    expect((await runJson(home, ["gateway", "platform", "list"])).json.data).toMatchObject({ telegram: false, discord: false });
    expect((await runJson(home, ["install", "status"])).json.data).toMatchObject({ installed: false });
    expect((await runJson(home, ["install", "verify"])).json.data).toEqual({ verified: false });
    expect((await runJson(home, ["hermes", "version"])).json.data).toEqual({ version: null });
    expect((await runJson(home, ["logs", "read", "--lines", "1"])).json.data.content).toBe("line2");
    expect((await runJson(home, ["mcp", "list"])).json.data).toEqual([{ name: "local", type: "stdio", enabled: true, detail: "node" }]);
    expect((await runJson(home, ["memory-providers", "list"])).json.data).toEqual([]);
    expect((await runJson(home, ["tools", "list"])).json.data.length).toBeGreaterThan(0);
    expect((await runJson(home, ["models", "list"])).json.data.length).toBeGreaterThan(0);
    expect((await runJson(home, ["credentials", "get"])).json.data).toEqual({});
    expect((await runJson(home, ["runtime", "diagnostic"])).json.data).toMatchObject({ requestedProfile: "default" });
    expect((await runJson(home, ["hermes", "doctor"])).json.data).toBe("Hermes is not installed.");
    expect((await runJson(home, ["dump"])).json.data).toBe("Hermes is not installed.");
  });
});

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SshConfig } from "../src/main/ssh-tunnel";

const sshConfig: SshConfig = {
  host: "example.test",
  port: 22,
  username: "hermes",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

describe("toolset config serialization", () => {
  const homes: string[] = [];
  const oldHome = process.env.HERMES_HOME;

  afterEach(() => {
    process.env.HERMES_HOME = oldHome;
    vi.resetModules();
    vi.doUnmock("../src/main/ssh/transport");
    for (const home of homes.splice(0)) {
      rmSync(home, { recursive: true, force: true });
    }
  });

  function tempHome(): string {
    const home = mkdtempSync(join(tmpdir(), "mercury-toolsets-"));
    homes.push(home);
    return home;
  }

  it("writes explicit empty arrays for local cli and api_server toolsets", async () => {
    const home = tempHome();
    process.env.HERMES_HOME = home;
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.yaml"),
      "provider: auto\nplatform_toolsets:\n  cli:\n      - web\n  api_server:\n      - web\n",
      "utf-8",
    );

    const { setToolsetEnabled, getToolsets } = await import("../src/main/tools");

    expect(setToolsetEnabled("web", false)).toBe(true);

    const updated = readFileSync(join(home, "config.yaml"), "utf-8");
    expect(updated).toContain("platform_toolsets:\n  cli: []\n  api_server: []");
    expect(updated).not.toMatch(/^  cli:\s*$/m);
    expect(updated).not.toMatch(/^  api_server:\s*$/m);
    expect(getToolsets().every((tool) => !tool.enabled)).toBe(true);
  });

  it("writes explicit empty arrays for SSH cli and api_server toolsets", async () => {
    let written = "";
    vi.doMock("../src/main/ssh/transport", () => ({
      sshReadFile: vi.fn().mockResolvedValue(
        "provider: auto\nplatform_toolsets:\n  cli:\n      - web\n  api_server:\n      - web\n",
      ),
      sshWriteFile: vi.fn(async (_config: SshConfig, _path: string, content: string) => {
        written = content;
      }),
    }));

    const { sshSetToolsetEnabled } = await import("../src/main/ssh/config");

    await expect(sshSetToolsetEnabled(sshConfig, "web", false)).resolves.toBe(true);
    expect(written).toContain("platform_toolsets:\n  cli: []\n  api_server: []");
    expect(written).not.toMatch(/^  cli:\s*$/m);
    expect(written).not.toMatch(/^  api_server:\s*$/m);
  });
});

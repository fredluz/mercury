import { describe, expect, it, vi } from "vitest";
import {
  buildSshHermesProfileCommand,
  parseMcpServersFromConfig,
  sshMutateSkills,
  sshSetConfigValue,
} from "../src/main/ssh-remote";
import { buildSshSkillCommand } from "../src/main/ssh/skills";
import type { SshConfig } from "../src/main/ssh-tunnel";
import { buildSshTunnelIdentityKey } from "../src/main/ssh-tunnel";
import { classifySshCommand } from "../src/main/ssh/transport";

const sshConfig: SshConfig = {
  host: "example.test",
  port: 22,
  username: "hermes",
  keyPath: "",
  remotePort: 8642,
  localPort: 18642,
};

describe("ssh command telemetry metadata", () => {
  it("classifies command shapes without exposing raw commands", () => {
    expect(classifySshCommand("python3 -")).toBe("python-stdin");
    expect(classifySshCommand("python3 -c 'print(1)'")).toBe("python-inline");
    expect(
      classifySshCommand(
        "nohup hermes gateway start > $HOME/.hermes/gateway.log 2>&1 &",
      ),
    ).toBe("gateway-start");
    expect(
      classifySshCommand(
        "nohup hermes -p 'alpha' gateway start > $HOME/.hermes/profiles/alpha/gateway.log 2>&1 &",
      ),
    ).toBe("gateway-start");
    expect(
      classifySshCommand("hermes -p 'alpha' gateway stop 2>/dev/null"),
    ).toBe("gateway-stop");
    expect(
      classifySshCommand("hermes -p 'alpha' doctor 2>&1 || echo nope"),
    ).toBe("hermes-doctor");
    expect(classifySshCommand("printf secret-value")).toBe("shell");
  });
});

describe("ssh profile creation safety", () => {
  it("uses singular profile create with --no-skills and no mkdir fallback", async () => {
    vi.resetModules();
    const sshPython = vi.fn().mockResolvedValue('{"success":true}');
    vi.doMock("../src/main/ssh/transport", async () => {
      const actual = await vi.importActual<
        typeof import("../src/main/ssh/transport")
      >("../src/main/ssh/transport");
      return { ...actual, sshPython };
    });

    const { sshCreateProfile } =
      await import("../src/main/ssh/sessions-profiles");

    await expect(sshCreateProfile(sshConfig, "alpha", true)).resolves.toEqual({
      success: true,
    });

    const script = sshPython.mock.calls[0][1] as string;
    expect(script).toContain(
      '"hermes", "profile", "create", name, "--no-skills"',
    );
    expect(script).not.toContain('"profiles", "create"');
    expect(script).not.toContain("mkdir -p");
    expect(sshPython.mock.calls[0][2]).toBe(
      JSON.stringify({ name: "alpha", copyDefaultConfig: true }),
    );
    vi.doUnmock("../src/main/ssh/transport");
  });
});

describe("ssh profile runtime command construction", () => {
  it("adds -p before gateway subcommands for named profiles", () => {
    expect(buildSshHermesProfileCommand("alpha", "gateway start")).toBe(
      "hermes -p 'alpha' gateway start",
    );
    expect(buildSshHermesProfileCommand("default", "gateway start")).toBe(
      "hermes gateway start",
    );
  });

  it("adds -p before skill subcommands for named profiles", () => {
    expect(buildSshSkillCommand("alpha", "skills install demo --yes")).toBe(
      "hermes -p 'alpha' skills install demo --yes",
    );
  });

  it("exports the batch skill mutation helper from the SSH facade", () => {
    expect(typeof sshMutateSkills).toBe("function");
  });

  it("rejects invalid SSH skill mutation profiles before remote writes", async () => {
    await expect(
      sshMutateSkills(
        sshConfig,
        [{ action: "install", name: "demo", category: "tools", directoryName: "demo" }],
        "../bad",
      ),
    ).resolves.toMatchObject({
      success: false,
      failed: 1,
      results: [expect.objectContaining({ success: false, code: "invalid-target" })],
    });
  });

  it("keys SSH tunnel identity by profile and endpoint", () => {
    expect(buildSshTunnelIdentityKey(sshConfig, "alpha")).toBe(
      "alpha|example.test|hermes|22|8642|18642",
    );
    expect(buildSshTunnelIdentityKey(sshConfig, "beta")).not.toBe(
      buildSshTunnelIdentityKey(sshConfig, "alpha"),
    );
    expect(buildSshTunnelIdentityKey(sshConfig)).not.toBe(
      buildSshTunnelIdentityKey(sshConfig, "alpha"),
    );
    expect(
      buildSshTunnelIdentityKey({ ...sshConfig, localPort: 18643 }, "alpha"),
    ).not.toBe(buildSshTunnelIdentityKey(sshConfig, "alpha"));
  });
});

describe("ssh remote MCP config parsing", () => {
  it("parses remote profile MCP servers without reading local profile config", () => {
    expect(
      parseMcpServersFromConfig(
        `mcp_servers:\n  fs-tools:\n    command: node\n    enabled: false\n  remote-http:\n    url: http://127.0.0.1:9000/mcp\n`,
      ),
    ).toEqual([
      { name: "fs-tools", type: "stdio", enabled: false, detail: "node" },
      {
        name: "remote-http",
        type: "http",
        enabled: true,
        detail: "http://127.0.0.1:9000/mcp",
      },
    ]);
  });
});

describe("ssh remote config writes", () => {
  it.each([
    ["quote", 'bad"value'],
    ["backslash", "bad\\value"],
    ["newline", "bad\nvalue"],
    ["carriage return", "bad\rvalue"],
  ])(
    "rejects YAML-breaking %s values before remote writes",
    async (_name, value) => {
      await expect(
        sshSetConfigValue(sshConfig, "base_url", value),
      ).rejects.toThrow("Config value contains illegal characters");
    },
  );
});

import { describe, expect, it } from "vitest";
import { sshSetConfigValue } from "../src/main/ssh-remote";
import type { SshConfig } from "../src/main/ssh-tunnel";
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
    expect(classifySshCommand("nohup hermes gateway start > $HOME/.hermes/gateway.log 2>&1 &")).toBe(
      "gateway-start",
    );
    expect(classifySshCommand("hermes doctor 2>&1 || echo nope")).toBe("hermes-doctor");
    expect(classifySshCommand("printf secret-value")).toBe("shell");
  });
});

describe("ssh remote config writes", () => {
  it.each([
    ["quote", 'bad"value'],
    ["backslash", "bad\\value"],
    ["newline", "bad\nvalue"],
    ["carriage return", "bad\rvalue"],
  ])("rejects YAML-breaking %s values before remote writes", async (_name, value) => {
    await expect(
      sshSetConfigValue(sshConfig, "base_url", value),
    ).rejects.toThrow("Config value contains illegal characters");
  });
});

import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli/index";

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

describe("CLI entrypoint foundation", () => {
  it("prints help successfully", async () => {
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["--help"], io, packageVersion: "1.2.3" });

    expect(exitCode).toBe(0);
    expect(output().stdout).toContain("Mercury CLI");
    expect(output().stderr).toBe("");
  });

  it("prints version successfully", async () => {
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["--version"], io, packageVersion: "1.2.3" });

    expect(exitCode).toBe(0);
    expect(output().stdout.trim()).toBe("1.2.3");
  });

  it("returns JSON errors for placeholder domain commands", async () => {
    const { io, output } = createIo();
    const exitCode = await runCli({ argv: ["--json", "claw3d", "status"], io });

    expect(exitCode).toBe(3);
    expect(JSON.parse(output().stderr)).toMatchObject({
      ok: false,
      command: "claw3d status",
      error: {
        code: "unsupported-command",
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildCliContext } from "../src/cli/context";
import { normalizeCliError } from "../src/cli/errors";
import { parseCliArgs } from "../src/cli/parser";

describe("CLI parser and global flags", () => {
  it("parses global output, profile, color, stream, raw, and verbosity flags", () => {
    const parsed = parseCliArgs([
      "--profile",
      "work",
      "--json",
      "--quiet",
      "--verbose",
      "--color",
      "never",
      "--stream",
      "--raw",
      "sessions",
      "list",
    ]);

    expect(parsed.commandPath).toEqual(["sessions", "list"]);
    expect(parsed.command).toBe("sessions list");
    expect(parsed.globals).toMatchObject({
      profile: "work",
      output: "json",
      quiet: true,
      verbose: true,
      color: "never",
      stream: true,
      raw: true,
    });
  });

  it("supports equals syntax and env defaults", () => {
    const parsed = parseCliArgs(["--profile=agent-a", "--color=always", "memory", "read"]);
    const context = buildCliContext(parsed, { MERCURY_OUTPUT: "ndjson" } as NodeJS.ProcessEnv, "/tmp/project");

    expect(context.profile).toBe("agent-a");
    expect(context.output).toBe("ndjson");
    expect(context.color).toBe("always");
    expect(context.cwd).toBe("/tmp/project");
  });

  it("maps invalid global flag usage to exit code 2", () => {
    try {
      parseCliArgs(["--color", "sometimes"]);
      throw new Error("Expected parser to fail");
    } catch (error) {
      expect(normalizeCliError(error)).toMatchObject({
        code: "invalid-usage",
        exitCode: 2,
      });
    }
  });
});

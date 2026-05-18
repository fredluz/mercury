import { describe, expect, it } from "vitest";
import type { CliContext } from "../src/cli/context";
import { CliError, CLI_EXIT_CODES, normalizeCliError } from "../src/cli/errors";
import {
  errorEnvelope,
  formatJsonError,
  formatJsonSuccess,
  formatNdjsonEvent,
  successEnvelope,
} from "../src/cli/output";

const baseContext: CliContext = {
  argv: [],
  cwd: "/repo",
  profile: "default",
  output: "json",
  quiet: false,
  verbose: false,
  color: "auto",
  stream: false,
  raw: false,
};

describe("CLI output contract", () => {
  it("formats the JSON success envelope", () => {
    const envelope = successEnvelope("version", baseContext, { version: "0.3.7" });
    expect(JSON.parse(formatJsonSuccess(envelope))).toEqual({
      ok: true,
      command: "version",
      profile: "default",
      data: { version: "0.3.7" },
    });
  });

  it("formats the JSON error envelope", () => {
    const normalized = normalizeCliError(
      new CliError("validation-failed", "Bad input", CLI_EXIT_CODES.validation, { field: "name" }),
    );
    const envelope = errorEnvelope("profiles create", baseContext, normalized);

    expect(JSON.parse(formatJsonError(envelope))).toEqual({
      ok: false,
      command: "profiles create",
      profile: "default",
      error: {
        code: "validation-failed",
        message: "Bad input",
        details: { field: "name" },
      },
    });
  });

  it("formats NDJSON events as one JSON object per line", () => {
    const line = formatNdjsonEvent({ type: "progress", progress: { step: "install" }, ts: 123 });

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: "progress",
      progress: { step: "install" },
      ts: 123,
    });
  });
});

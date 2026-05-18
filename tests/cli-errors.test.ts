import { describe, expect, it } from "vitest";
import { CLI_EXIT_CODES, exitCodeForErrorCode, normalizeCliError, unsupportedError } from "../src/cli/errors";

describe("CLI exit-code mapping", () => {
  it("maps runtime verification failures to exit code 4", () => {
    expect(exitCodeForErrorCode("runtime-profile-mismatch")).toBe(CLI_EXIT_CODES.runtimeVerification);
    expect(exitCodeForErrorCode("runtime-profile-unverified")).toBe(CLI_EXIT_CODES.runtimeVerification);
    expect(exitCodeForErrorCode("runtime-stale-after-profile-switch")).toBe(
      CLI_EXIT_CODES.runtimeVerification,
    );
  });

  it("maps unsupported remote profile execution to exit code 3", () => {
    expect(exitCodeForErrorCode("runtime-unsupported-remote-profile")).toBe(
      CLI_EXIT_CODES.unsupported,
    );
  });

  it("preserves explicit CLI error exit codes", () => {
    expect(normalizeCliError(unsupportedError("Not implemented yet"))).toMatchObject({
      code: "unsupported-command",
      exitCode: CLI_EXIT_CODES.unsupported,
    });
  });
});

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

  it("normalizes ProfileRuntimeError-style identity details", () => {
    const error = Object.assign(new Error("Local API runtime unavailable"), {
      code: "runtime-unavailable",
      identity: { requestedProfile: "work", transport: "api" },
    });

    expect(normalizeCliError(error)).toMatchObject({
      code: "runtime-unavailable",
      exitCode: CLI_EXIT_CODES.runtimeVerification,
      details: { identity: { requestedProfile: "work", transport: "api" } },
    });
  });

  it("normalizes runtime identity details from toJSON", () => {
    const error = new Error("Local API runtime unavailable") as Error & {
      code: string;
      toJSON: () => unknown;
    };
    error.code = "runtime-unavailable";
    error.toJSON = () => ({
      code: "runtime-unavailable",
      message: "Local API runtime unavailable",
      identity: { requestedProfile: "work", transport: "api" },
    });

    expect(normalizeCliError(error)).toMatchObject({
      code: "runtime-unavailable",
      details: { identity: { requestedProfile: "work", transport: "api" } },
    });
  });

  it("preserves explicit CLI error exit codes", () => {
    expect(normalizeCliError(unsupportedError("Not implemented yet"))).toMatchObject({
      code: "unsupported-command",
      exitCode: CLI_EXIT_CODES.unsupported,
    });
  });
});

import type { CliColorMode, CliOutputMode, ParsedCliArgs } from "./parser";

export type CliConnectionMode = "local" | "remote" | "ssh";

export interface CliContext {
  argv: string[];
  cwd: string;
  profile?: string;
  output: CliOutputMode;
  quiet: boolean;
  verbose: boolean;
  color: CliColorMode;
  connectionMode?: CliConnectionMode;
  stream: boolean;
  raw: boolean;
}

const VALID_OUTPUT_MODES = new Set<CliOutputMode>(["json", "ndjson", "text", "table"]);

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value && value.trim().length > 0 ? value : undefined;
}

function outputFromEnv(env: NodeJS.ProcessEnv): CliOutputMode | undefined {
  const output = envValue(env, "MERCURY_OUTPUT");
  return VALID_OUTPUT_MODES.has(output as CliOutputMode) ? (output as CliOutputMode) : undefined;
}

export function buildCliContext(
  parsed: ParsedCliArgs,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): CliContext {
  return {
    argv: parsed.argv,
    cwd,
    profile: parsed.globals.profile ?? envValue(env, "MERCURY_PROFILE"),
    output: parsed.globals.output ?? outputFromEnv(env) ?? "text",
    quiet: parsed.globals.quiet,
    verbose: parsed.globals.verbose,
    color: parsed.globals.color,
    stream: parsed.globals.stream,
    raw: parsed.globals.raw,
  };
}

export function commandName(commandPath: string[]): string {
  return commandPath.length > 0 ? commandPath.join(" ") : "help";
}

import { usageError } from "./errors";

export type CliOutputMode = "json" | "ndjson" | "text" | "table";
export type CliColorMode = "auto" | "always" | "never";

export interface ParsedGlobalFlags {
  profile?: string;
  output?: CliOutputMode;
  quiet: boolean;
  verbose: boolean;
  color: CliColorMode;
  stream: boolean;
  raw: boolean;
}

export interface ParsedCliArgs {
  argv: string[];
  commandPath: string[];
  command: string;
  globals: ParsedGlobalFlags;
  help: boolean;
  version: boolean;
}

const OUTPUT_FLAGS: Record<string, CliOutputMode> = {
  "--json": "json",
  "--ndjson": "ndjson",
  "--text": "text",
  "--table": "table",
};

const VALID_COLOR_MODES = new Set<CliColorMode>(["auto", "always", "never"]);

function readRequiredValue(argv: string[], index: number, flag: string): { value: string; nextIndex: number } {
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw usageError(`Missing value for ${flag}`);
  }
  return { value, nextIndex: index + 1 };
}

function parseLongEquals(token: string): { flag: string; value?: string } {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex === -1) return { flag: token };
  return {
    flag: token.slice(0, equalsIndex),
    value: token.slice(equalsIndex + 1),
  };
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const globals: ParsedGlobalFlags = {
    quiet: false,
    verbose: false,
    color: "auto",
    stream: false,
    raw: false,
  };
  const commandPath: string[] = [];
  let help = false;
  let version = false;
  let afterDoubleDash = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (afterDoubleDash) {
      commandPath.push(token);
      continue;
    }

    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      help = true;
      continue;
    }

    if (token === "--version" || token === "-v") {
      version = true;
      continue;
    }

    if (token === "-p") {
      const result = readRequiredValue(argv, index, token);
      globals.profile = result.value;
      index = result.nextIndex;
      continue;
    }

    if (token.startsWith("--profile=")) {
      const { value } = parseLongEquals(token);
      if (!value) throw usageError("Missing value for --profile");
      globals.profile = value;
      continue;
    }

    if (token === "--profile") {
      const result = readRequiredValue(argv, index, token);
      globals.profile = result.value;
      index = result.nextIndex;
      continue;
    }

    if (token.startsWith("--color=")) {
      const { value } = parseLongEquals(token);
      if (!VALID_COLOR_MODES.has(value as CliColorMode)) {
        throw usageError("--color must be one of: auto, always, never");
      }
      globals.color = value as CliColorMode;
      continue;
    }

    if (token === "--color") {
      const result = readRequiredValue(argv, index, token);
      if (!VALID_COLOR_MODES.has(result.value as CliColorMode)) {
        throw usageError("--color must be one of: auto, always, never");
      }
      globals.color = result.value as CliColorMode;
      index = result.nextIndex;
      continue;
    }

    if (token in OUTPUT_FLAGS) {
      globals.output = OUTPUT_FLAGS[token];
      continue;
    }

    if (token === "--quiet") {
      globals.quiet = true;
      continue;
    }

    if (token === "--verbose") {
      globals.verbose = true;
      continue;
    }

    if (token === "--stream") {
      globals.stream = true;
      continue;
    }

    if (token === "--raw") {
      globals.raw = true;
      continue;
    }

    if (token.startsWith("-") && commandPath.length === 0) {
      throw usageError(`Unknown global flag: ${token}`);
    }

    commandPath.push(token);
  }

  return {
    argv,
    commandPath,
    command: commandPath.length > 0 ? commandPath.join(" ") : "help",
    globals,
    help,
    version,
  };
}

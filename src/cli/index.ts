#!/usr/bin/env node

import { readFileSync } from "fs";
import { join } from "path";
import { buildCliContext, commandName, type CliContext } from "./context";
import { dispatchChatCommand } from "./chat-commands";
import { dispatchMutatingCommand } from "./mutating-commands";
import { dispatchReadOnlyCommand } from "./read-only-commands";
import { CliError, CLI_EXIT_CODES, normalizeCliError, unsupportedError, usageError } from "./errors";
import {
  errorEnvelope,
  formatJsonError,
  formatJsonSuccess,
  formatNdjsonError,
  formatNdjsonEvent,
  renderTextSuccess,
  successEnvelope,
} from "./output";
import { parseCliArgs, type CliOutputMode, type ParsedCliArgs } from "./parser";

export interface CliIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

export interface RunCliOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  io?: CliIo;
  packageVersion?: string;
}

const RESERVED_DOMAIN_COMMANDS = new Set([
  "agents",
  "backup",
  "chat",
  "claw",
  "claw3d",
  "config",
  "connection",
  "credentials",
  "cron",
  "dump",
  "env",
  "gateway",
  "hermes",
  "import",
  "install",
  "logs",
  "mcp",
  "memory",
  "memory-providers",
  "model-config",
  "models",
  "openclaw",
  "profiles",
  "runtime",
  "sessions",
  "skills",
  "soul",
  "ssh",
  "system",
  "tools",
  "traces",
  "user-profile",
]);

export function helpText(): string {
  return `Mercury CLI

Usage:
  mercury [global flags] --help
  mercury [global flags] --version
  mercury [global flags] <domain> [command] [args]

Global flags:
  -p, --profile <name>       Select Mercury profile
      --json                 Emit one JSON envelope
      --ndjson               Emit newline-delimited JSON events
      --text                 Emit human-readable text (default)
      --table                Emit table output when supported
      --quiet                Suppress non-essential text output
      --verbose              Include verbose diagnostics when supported
      --color <mode>         auto, always, or never
      --stream               Prefer streaming output for supported commands
      --raw                  Emit raw command payloads when supported
  -h, --help                 Show help
      --version              Show package version

Reserved command domains:
  chat, sessions, profiles, agents, memory, soul, skills, tools, models,
  cron, traces, runtime, gateway, install, system, config, env, connection,
  ssh, hermes, claw3d

Implemented commands include read/list/status/get/verify/doctor, non-chat mutating CRUD/runtime/install commands,
  and chat send/title streaming automation.
`;
}

function readPackageVersion(env: NodeJS.ProcessEnv): string {
  if (env.npm_package_version) return env.npm_package_version;

  try {
    const packageJson = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")) as {
      version?: unknown;
    };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function inferOutputMode(argv: string[], env: NodeJS.ProcessEnv): CliOutputMode {
  if (argv.includes("--ndjson")) return "ndjson";
  if (argv.includes("--json")) return "json";
  if (argv.includes("--table")) return "table";
  if (argv.includes("--text")) return "text";
  const envOutput = env.MERCURY_OUTPUT;
  if (envOutput === "json" || envOutput === "ndjson" || envOutput === "text" || envOutput === "table") {
    return envOutput;
  }
  return "text";
}

function fallbackContext(argv: string[], env: NodeJS.ProcessEnv, cwd: string): CliContext {
  return {
    argv,
    cwd,
    profile: env.MERCURY_PROFILE,
    output: inferOutputMode(argv, env),
    quiet: argv.includes("--quiet"),
    verbose: argv.includes("--verbose"),
    color: "auto",
    stream: argv.includes("--stream"),
    raw: argv.includes("--raw"),
  };
}

function writeSuccess<T>(io: CliIo, parsed: ParsedCliArgs, context: CliContext, data: T): void {
  const command = commandName(parsed.commandPath);

  if (context.output === "json") {
    io.stdout.write(`${formatJsonSuccess(successEnvelope(command, context, data))}\n`);
    return;
  }

  if (context.output === "ndjson") {
    io.stdout.write(formatNdjsonEvent({ type: "done", data, ts: Date.now() }));
    return;
  }

  if (context.quiet) return;
  const rendered = renderTextSuccess(data);
  if (rendered.length > 0) io.stdout.write(`${rendered}\n`);
}

function writeError(io: CliIo, command: string, context: CliContext, error: unknown): number {
  const normalized = normalizeCliError(error);
  const envelope = errorEnvelope(command, context, normalized);

  if (context.output === "json") {
    io.stderr.write(`${formatJsonError(envelope)}\n`);
  } else if (context.output === "ndjson") {
    io.stderr.write(formatNdjsonError(envelope));
  } else {
    io.stderr.write(`Error (${normalized.code}): ${normalized.message}\n`);
  }

  return normalized.exitCode;
}

function dispatchPlaceholder(parsed: ParsedCliArgs): never {
  const [domain] = parsed.commandPath;
  if (!domain) {
    throw usageError("No command provided");
  }

  if (!RESERVED_DOMAIN_COMMANDS.has(domain)) {
    throw usageError(`Unknown command domain: ${domain}`);
  }

  throw unsupportedError(`Unsupported CLI command: ${parsed.command}`, {
    domain,
    commandPath: parsed.commandPath,
  });
}

export async function runCli(options: RunCliOptions = {}): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr };
  let parsed: ParsedCliArgs | undefined;
  let context = fallbackContext(argv, env, cwd);

  try {
    parsed = parseCliArgs(argv);
    context = buildCliContext(parsed, env, cwd);
    const version = options.packageVersion ?? readPackageVersion(env);

    if (parsed.help || argv.length === 0) {
      writeSuccess(io, parsed, context, helpText().trimEnd());
      return CLI_EXIT_CODES.success;
    }

    if (parsed.version) {
      writeSuccess(io, parsed, context, context.output === "json" || context.output === "ndjson" ? { version } : version);
      return CLI_EXIT_CODES.success;
    }

    const chat = await dispatchChatCommand(parsed.commandPath, context, io);
    if (chat.handled) {
      if (!chat.suppressSuccess) writeSuccess(io, parsed, context, chat.data);
      return CLI_EXIT_CODES.success;
    }

    const data = await dispatchReadOnlyCommand(parsed.commandPath, context);
    if (data.handled) {
      writeSuccess(io, parsed, context, data.data);
      return CLI_EXIT_CODES.success;
    }

    const mutation = await dispatchMutatingCommand(parsed.commandPath, context, io);
    if (mutation.handled) {
      writeSuccess(io, parsed, context, mutation.data);
      return CLI_EXIT_CODES.success;
    }

    dispatchPlaceholder(parsed);
  } catch (error) {
    if (error instanceof CliError || error instanceof Error) {
      return writeError(io, parsed ? commandName(parsed.commandPath) : "help", context, error);
    }
    return writeError(io, parsed ? commandName(parsed.commandPath) : "help", context, error);
  }
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

import { readFileSync } from "fs";
import type { CliContext } from "./context";
import { interruptedError, usageError } from "./errors";
import { formatNdjsonEvent } from "./output";
import type { ChatTitleMessage, GenerateChatTitleRequest } from "../shared/chat-metadata";

export interface ChatCommandIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

export interface ChatDispatchResult {
  handled: boolean;
  data?: unknown;
  suppressSuccess?: boolean;
}

type OptionMap = Map<string, string | true>;

type ChatHistoryMessage = { role: string; content: string };

const VALUE_FLAGS = new Set([
  "--history-file",
  "--message",
  "-m",
  "--messages-file",
  "--profile",
  "-p",
  "--resume",
  "--session",
]);

function parseOptions(tokens: string[]): { options: OptionMap; positionals: string[] } {
  const options: OptionMap = new Map();
  const positionals: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      positionals.push(...tokens.slice(index + 1));
      break;
    }

    if (token.startsWith("--") && token.includes("=")) {
      const [flag, ...rest] = token.split("=");
      options.set(flag, rest.join("="));
      continue;
    }

    if (VALUE_FLAGS.has(token)) {
      const value = tokens[index + 1];
      if (!value || value.startsWith("-")) throw usageError(`Missing value for ${token}`);
      options.set(token, value);
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      options.set(token, true);
      continue;
    }

    positionals.push(token);
  }

  return { options, positionals };
}

function optionValue(options: OptionMap, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = options.get(name);
    if (typeof value === "string") return value;
  }
  return undefined;
}

function hasOption(options: OptionMap, ...names: string[]): boolean {
  return names.some((name) => options.has(name));
}

function profileFor(context: CliContext, options: OptionMap): string | undefined {
  return optionValue(options, "--profile", "-p") ?? context.profile;
}

function readStdinIfAvailable(force: boolean): string | undefined {
  if (!force && process.stdin.isTTY !== false) return undefined;
  try {
    const value = readFileSync(0, "utf-8");
    return value.trim().length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function messageFrom(options: OptionMap, positionals: string[]): string {
  const explicit = optionValue(options, "--message", "-m");
  if (explicit !== undefined) return explicit;

  const positional = positionals.join(" ").trim();
  if (positional) return positional;

  const stdin = readStdinIfAvailable(hasOption(options, "--stdin"));
  if (stdin) return stdin;

  throw usageError("Missing chat message. Pass a positional message, --message, or stdin.");
}

function parseJsonFile(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw usageError(`Invalid ${label}: ${message}`);
  }
}

function coerceHistoryMessages(value: unknown, label: string): ChatHistoryMessage[] {
  const rawMessages = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)
      ? (value as { messages: unknown[] }).messages
      : undefined;

  if (!rawMessages) throw usageError(`${label} must be a JSON array or an object with a messages array`);

  return rawMessages.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw usageError(`${label}[${index}] must be an object`);
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    if (typeof role !== "string" || typeof content !== "string") {
      throw usageError(`${label}[${index}] must include string role and content fields`);
    }
    return { role, content };
  });
}

function coerceTitleMessages(messages: ChatHistoryMessage[], label: string): ChatTitleMessage[] {
  return messages.map((message, index) => {
    if (message.role !== "user" && message.role !== "agent" && message.role !== "assistant") {
      throw usageError(`${label}[${index}].role must be user, agent, or assistant`);
    }
    return { role: message.role, content: message.content };
  });
}

function historyFrom(options: OptionMap): ChatHistoryMessage[] | undefined {
  const historyFile = optionValue(options, "--history-file");
  if (!historyFile) return undefined;
  return coerceHistoryMessages(parseJsonFile(historyFile, "--history-file"), "--history-file");
}

function titleMessagesFrom(options: OptionMap, positionals: string[]): ChatTitleMessage[] {
  const messagesFile = optionValue(options, "--messages-file") ?? optionValue(options, "--history-file");
  if (messagesFile) {
    return coerceTitleMessages(
      coerceHistoryMessages(parseJsonFile(messagesFile, "--messages-file"), "--messages-file"),
      "--messages-file",
    );
  }

  const message = optionValue(options, "--message", "-m") ?? positionals.join(" ").trim() ?? "";
  if (message.trim()) return [{ role: "user", content: message }];

  const stdin = readStdinIfAvailable(hasOption(options, "--stdin"));
  if (stdin) {
    try {
      return coerceTitleMessages(coerceHistoryMessages(JSON.parse(stdin), "stdin"), "stdin");
    } catch (error) {
      if (error instanceof SyntaxError) return [{ role: "user", content: stdin }];
      throw error;
    }
  }

  throw usageError("Missing title messages. Pass --messages-file, --message, a positional message, or stdin.");
}

async function attachConnectionMode(context: CliContext): Promise<void> {
  try {
    const { getConnection } = await import("../main/services/config-service");
    context.connectionMode = getConnection().mode;
  } catch {
    // Mode metadata is useful but should never block command execution.
  }
}

function writeChatText(io: ChatCommandIo, text: string): void {
  io.stdout.write(text);
}

function ensureTrailingNewline(io: ChatCommandIo): void {
  io.stdout.write("\n");
}

async function dispatchChatSend(rest: string[], context: CliContext, io: ChatCommandIo): Promise<ChatDispatchResult> {
  const { options, positionals } = parseOptions(rest);
  const message = messageFrom(options, positionals);
  const profile = profileFor(context, options);
  const resumeSessionId = optionValue(options, "--resume");
  const history = historyFrom(options);
  const chat = await import("../main/services/chat-service");
  const command = "chat send";
  let sawTextChunk = false;
  let interrupted = false;
  let emittedError = false;
  const shouldStreamText = context.output === "text" && !context.quiet;

  const onSigint = (): void => {
    interrupted = true;
    if (context.output === "ndjson") {
      io.stdout.write(formatNdjsonEvent({
        type: "error",
        error: { code: "aborted", message: "Chat interrupted by SIGINT" },
        ts: Date.now(),
      }));
      emittedError = true;
    } else if (!context.quiet) {
      io.stderr.write("Interrupted; aborting active chat...\n");
    }
    chat.abortActiveChatRun("CLI interrupted the active Hermes run.");
  };

  if (context.output === "ndjson") {
    io.stdout.write(formatNdjsonEvent({ type: "start", command, profile, ts: Date.now() }));
  }

  process.once("SIGINT", onSigint);
  try {
    const result = await chat.runChatMessage({
      message,
      profile,
      resumeSessionId,
      history,
      callbacks: {
        onChunk: (chunk) => {
          if (context.output === "ndjson") {
            io.stdout.write(formatNdjsonEvent({ type: "chunk", text: chunk, ts: Date.now() }));
          } else if (shouldStreamText) {
            sawTextChunk = true;
            writeChatText(io, chunk);
          }
        },
        onLiveTraceEvent: (event) => {
          if (context.output === "ndjson") {
            io.stdout.write(formatNdjsonEvent({ type: "trace", event, ts: Date.now() }));
          }
        },
        onToolProgress: (tool) => {
          if (context.output === "ndjson") {
            io.stdout.write(formatNdjsonEvent({ type: "tool", text: tool, ts: Date.now() }));
          } else if (context.verbose && !context.quiet) {
            io.stderr.write(`${tool}\n`);
          }
        },
        onUsage: (usage) => {
          if (context.output === "ndjson") {
            io.stdout.write(formatNdjsonEvent({ type: "usage", usage, ts: Date.now() }));
          }
        },
        onError: (error) => {
          if (context.output === "ndjson") {
            io.stdout.write(formatNdjsonEvent({ type: "error", error: { code: "chat-error", message: error }, ts: Date.now() }));
            emittedError = true;
          }
        },
      },
    });

    if (interrupted) throw interruptedError("Chat interrupted by SIGINT");
    if (sawTextChunk) ensureTrailingNewline(io);
    return { handled: true, data: result, suppressSuccess: sawTextChunk };
  } catch (error) {
    if (interrupted && !emittedError && context.output === "ndjson") {
      io.stdout.write(formatNdjsonEvent({
        type: "error",
        error: { code: "aborted", message: "Chat interrupted by SIGINT" },
        ts: Date.now(),
      }));
    }
    throw interrupted ? interruptedError("Chat interrupted by SIGINT") : error;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

async function dispatchChatTitle(rest: string[], context: CliContext): Promise<ChatDispatchResult> {
  const { options, positionals } = parseOptions(rest);
  const profile = profileFor(context, options);
  const sessionId = optionValue(options, "--session", "--resume");
  const messages = titleMessagesFrom(options, positionals);
  const request: GenerateChatTitleRequest = { profile, sessionId, messages };
  const { generateChatTitleForRequest } = await import("../main/services/chat-service");
  const title = await generateChatTitleForRequest(request);
  return { handled: true, data: { title, sessionId } };
}

export async function dispatchChatCommand(
  commandPath: string[],
  context: CliContext,
  io: ChatCommandIo,
): Promise<ChatDispatchResult> {
  const [domain, action, ...rest] = commandPath;
  if (domain !== "chat") return { handled: false };

  await attachConnectionMode(context);

  if (action === "send") return dispatchChatSend(rest, context, io);
  if (action === "title") return dispatchChatTitle(rest, context);
  return { handled: false };
}

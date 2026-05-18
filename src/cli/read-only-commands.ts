import type { CliContext } from "./context";
import { notFoundError, usageError } from "./errors";

export interface ReadOnlyDispatchResult {
  handled: boolean;
  data?: unknown;
}

type OptionMap = Map<string, string | true>;

const VALUE_FLAGS = new Set([
  "--profile",
  "-p",
  "--limit",
  "--offset",
  "--file",
  "--lines",
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

function numberOption(options: OptionMap, name: string): number | undefined {
  const raw = optionValue(options, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw usageError(`${name} must be a non-negative integer`);
  }
  return value;
}

function profileFor(context: CliContext, options: OptionMap): string | undefined {
  return optionValue(options, "--profile", "-p") ?? context.profile;
}

async function attachConnectionMode(context: CliContext): Promise<void> {
  try {
    const { getConnection } = await import("../main/services/config-service");
    context.connectionMode = getConnection().mode;
  } catch {
    // Mode metadata is useful but must not block the actual command.
  }
}

function requirePositional(positionals: string[], label: string): string {
  const value = positionals[0];
  if (!value) throw usageError(`Missing ${label}`);
  return value;
}

async function dispatchProfiles(domain: string, rest: string[]): Promise<ReadOnlyDispatchResult> {
  if (rest[0] !== "list") return { handled: false };
  const { listProfilesForConnection } = await import("../main/services/sessions-service");
  return { handled: true, data: { [domain]: await listProfilesForConnection() } };
}

async function dispatchSessions(rest: string[], context: CliContext): Promise<ReadOnlyDispatchResult> {
  const action = rest[0];
  const { options, positionals } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const limit = numberOption(options, "--limit");
  const offset = numberOption(options, "--offset");
  const sessions = await import("../main/services/sessions-service");

  if (action === "list") {
    return { handled: true, data: await sessions.listSessionsForProfile(limit, offset, profile) };
  }

  if (action === "messages") {
    const sessionId = requirePositional(positionals, "session id");
    return { handled: true, data: await sessions.getSessionMessagesForProfile(sessionId, profile) };
  }

  if (action === "search") {
    const query = positionals.join(" ").trim();
    if (!query) throw usageError("Missing search query");
    return { handled: true, data: await sessions.searchSessionsForProfile(query, limit, profile) };
  }

  if (action === "cache" && rest[1] === "list") {
    const cacheArgs = parseOptions(rest.slice(2));
    const cacheProfile = profileFor(context, cacheArgs.options);
    return {
      handled: true,
      data: await sessions.listCachedSessionsForProfile(
        numberOption(cacheArgs.options, "--limit"),
        numberOption(cacheArgs.options, "--offset"),
        cacheProfile,
      ),
    };
  }

  return { handled: false };
}

async function dispatchKnowledge(domain: string, rest: string[], context: CliContext): Promise<ReadOnlyDispatchResult> {
  const action = rest[0];
  const { options, positionals } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const knowledge = await import("../main/services/knowledge-service");

  if (domain === "memory" && action === "read") {
    return { handled: true, data: await knowledge.readMemoryForProfile(profile) };
  }

  if (domain === "soul" && action === "read") {
    return { handled: true, data: await knowledge.readSoulForProfile(profile) };
  }

  if (domain === "tools" && action === "list") {
    return { handled: true, data: await knowledge.getToolsetsForProfile(profile) };
  }

  if (domain === "skills") {
    if (action === "installed") {
      return { handled: true, data: await knowledge.listInstalledSkillsForProfile(profile) };
    }
    if (action === "bundled") {
      return { handled: true, data: await knowledge.listBundledSkillsForConnection() };
    }
    if (action === "content") {
      return { handled: true, data: await knowledge.getSkillContentForConnection(requirePositional(positionals, "skill path")) };
    }
    if (action === "metadata") {
      return { handled: true, data: await knowledge.getSkillMetadataForConnection(requirePositional(positionals, "skill path")) };
    }
  }

  return { handled: false };
}

async function dispatchModels(domain: string, rest: string[]): Promise<ReadOnlyDispatchResult> {
  const action = rest[0];
  const models = await import("../main/services/models-service");
  if (domain === "models" && action === "list") {
    return { handled: true, data: await models.listModelsForConnection() };
  }
  if (domain === "credentials" && action === "get") {
    return { handled: true, data: models.getCredentialPoolForConnection() };
  }
  return { handled: false };
}

async function dispatchCron(rest: string[], context: CliContext): Promise<ReadOnlyDispatchResult> {
  if (rest[0] !== "list") return { handled: false };
  const { options } = parseOptions(rest.slice(1));
  const { listCronJobsForProfile } = await import("../main/services/cron-service");
  const includeDisabled = hasOption(options, "--active-only") ? false : true;
  return { handled: true, data: await listCronJobsForProfile(includeDisabled, profileFor(context, options)) };
}

async function dispatchTraces(rest: string[]): Promise<ReadOnlyDispatchResult> {
  const action = rest[0];
  const { positionals } = parseOptions(rest.slice(1));
  const traces = await import("../main/trace-store");
  if (action === "list") return { handled: true, data: traces.listTraceRuns() };
  if (action === "skill-runs") return { handled: true, data: traces.listSkillTrainingRuns() };
  if (action === "get") {
    const runId = requirePositional(positionals, "trace run id");
    const run = traces.getTraceRun(runId);
    if (!run) throw notFoundError(`Trace run not found: ${runId}`);
    return { handled: true, data: run };
  }
  return { handled: false };
}

async function dispatchSystem(domain: string, rest: string[], context: CliContext): Promise<ReadOnlyDispatchResult> {
  const action = rest[0];
  const { options } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const system = await import("../main/services/system-service");

  if (domain === "runtime" && action === "diagnostic") {
    return { handled: true, data: system.getRuntimeDiagnosticForProfile(profile) };
  }

  if (domain === "logs" && action === "read") {
    return {
      handled: true,
      data: await system.readLogsForConnection(optionValue(options, "--file"), numberOption(options, "--lines"), profile),
    };
  }

  if (domain === "mcp" && action === "list") {
    return { handled: true, data: await system.listMcpServersForConnection(profile) };
  }

  if (domain === "memory-providers" && action === "list") {
    return { handled: true, data: await system.discoverMemoryProvidersForConnection(profile) };
  }

  if (domain === "dump" && !action) {
    return { handled: true, data: await system.runHermesDumpForConnection() };
  }

  return { handled: false };
}

async function dispatchConnection(rest: string[]): Promise<ReadOnlyDispatchResult> {
  if (rest[0] !== "get") return { handled: false };
  const { getConnection } = await import("../main/services/config-service");
  return { handled: true, data: getConnection() };
}

async function dispatchGateway(rest: string[], context: CliContext): Promise<ReadOnlyDispatchResult> {
  const action = rest[0];
  const gateway = await import("../main/services/gateway-service");

  if (action === "status") {
    const { options } = parseOptions(rest.slice(1));
    return { handled: true, data: { running: await gateway.gatewayStatus(profileFor(context, options)) } };
  }

  if (action === "platform" && rest[1] === "list") {
    const { options } = parseOptions(rest.slice(2));
    return { handled: true, data: await gateway.getPlatformEnabledForProfile(profileFor(context, options)) };
  }

  return { handled: false };
}

async function dispatchInstall(domain: string, rest: string[]): Promise<ReadOnlyDispatchResult> {
  const action = rest[0];
  const install = await import("../main/services/install-service");

  if (domain === "install") {
    if (action === "status") return { handled: true, data: install.checkInstall() };
    if (action === "verify") return { handled: true, data: { verified: await install.verifyHermesInstall() } };
  }

  if (domain === "hermes") {
    if (action === "version") {
      const { options } = parseOptions(rest.slice(1));
      const version = hasOption(options, "--refresh")
        ? await install.refreshHermesVersionForConnection()
        : await install.getHermesVersionForConnection();
      return { handled: true, data: { version } };
    }
    if (action === "doctor") return { handled: true, data: await install.runHermesDoctorForConnection() };
  }

  return { handled: false };
}

export async function dispatchReadOnlyCommand(
  commandPath: string[],
  context: CliContext,
): Promise<ReadOnlyDispatchResult> {
  const [domain, ...rest] = commandPath;
  if (!domain) return { handled: false };

  await attachConnectionMode(context);

  if (domain === "profiles" || domain === "agents") return dispatchProfiles(domain, rest);
  if (domain === "sessions") return dispatchSessions(rest, context);
  if (["memory", "soul", "tools", "skills"].includes(domain)) return dispatchKnowledge(domain, rest, context);
  if (domain === "models" || domain === "credentials") return dispatchModels(domain, rest);
  if (domain === "cron") return dispatchCron(rest, context);
  if (domain === "traces") return dispatchTraces(rest);
  if (["runtime", "logs", "mcp", "memory-providers", "dump"].includes(domain)) {
    return dispatchSystem(domain, rest, context);
  }
  if (domain === "connection") return dispatchConnection(rest);
  if (domain === "gateway") return dispatchGateway(rest, context);
  if (domain === "install" || domain === "hermes") return dispatchInstall(domain, rest);

  return { handled: false };
}

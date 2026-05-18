import { readFileSync } from "fs";
import type { CliContext } from "./context";
import { notFoundError, unsupportedError, usageError, validationError } from "./errors";
import { formatNdjsonEvent } from "./output";

export interface CliWriteIo {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

export interface MutatingDispatchResult {
  handled: boolean;
  data?: unknown;
}

type OptionMap = Map<string, string | true>;

const VALUE_FLAGS = new Set([
  "--api-key",
  "--base-url",
  "--category",
  "--context-window",
  "--deliver",
  "--description",
  "--entries-file",
  "--file",
  "--host",
  "--key-path",
  "--local-port",
  "--mode",
  "--model",
  "--name",
  "--port",
  "--profile",
  "-p",
  "--prompt",
  "--prompt-file",
  "--provider",
  "--remote-port",
  "--schedule",
  "--url",
  "--username",
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

function requirePositional(positionals: string[], label: string, index = 0): string {
  const value = positionals[index];
  if (!value) throw usageError(`Missing ${label}`);
  return value;
}

function requireOption(options: OptionMap, name: string): string {
  const value = optionValue(options, name);
  if (!value) throw usageError(`Missing ${name}`);
  return value;
}

function integerOption(options: OptionMap, name: string, fallback?: number): number {
  const raw = optionValue(options, name);
  if (raw === undefined) {
    if (fallback === undefined) throw usageError(`Missing ${name}`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) throw usageError(`${name} must be an integer`);
  return value;
}

function booleanFromString(raw: string | undefined, label: string): boolean {
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  throw usageError(`${label} must be true or false`);
}

function contentFrom(options: OptionMap, positionals: string[], label: string): string {
  const file = optionValue(options, "--file");
  if (file) return readFileSync(file, "utf-8");
  if (hasOption(options, "--stdin")) return readFileSync(0, "utf-8");
  const content = positionals.join(" ").trim();
  if (!content) throw usageError(`Missing ${label}`);
  return content;
}

function promptFrom(options: OptionMap, positionals: string[]): string | undefined {
  const promptFile = optionValue(options, "--prompt-file");
  if (promptFile) return readFileSync(promptFile, "utf-8");
  const prompt = optionValue(options, "--prompt");
  if (prompt !== undefined) return prompt;
  const joined = positionals.join(" ").trim();
  return joined || undefined;
}

async function attachConnectionMode(context: CliContext): Promise<void> {
  try {
    const { getConnection } = await import("../main/services/config-service");
    context.connectionMode = getConnection().mode;
  } catch {
    // Mode metadata is useful but should never block command execution.
  }
}

function ensureResultSuccess(result: unknown, label: string): void {
  if (result === false) throw validationError(`${label} failed`, result);
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    (result as { success?: boolean }).success === false
  ) {
    throw validationError((result as { error?: string }).error || `${label} failed`, result);
  }
}

async function dispatchProfiles(domain: string, rest: string[]): Promise<MutatingDispatchResult> {
  const action = rest[0];
  if (!["create", "delete", "use"].includes(action || "")) return { handled: false };
  const { options, positionals } = parseOptions(rest.slice(1));
  const name = requirePositional(positionals, `${domain.slice(0, -1)} name`);
  const service = await import("../main/services/sessions-service");

  if (action === "create") {
    const result = await service.createProfileForConnection(name, hasOption(options, "--clone"));
    ensureResultSuccess(result, `${domain} create`);
    return { handled: true, data: { success: true, name, clone: hasOption(options, "--clone") } };
  }

  if (action === "delete") {
    if (!hasOption(options, "--yes")) throw usageError(`${domain} delete requires --yes`);
    const result = await service.deleteProfileForConnection(name);
    ensureResultSuccess(result, `${domain} delete`);
    return { handled: true, data: { success: true, name } };
  }

  if (action === "use") {
    const success = service.setActiveProfileForConnection(name);
    if (!success) throw validationError(`Failed to activate ${domain.slice(0, -1)}: ${name}`);
    return { handled: true, data: { success: true, name } };
  }

  return { handled: false };
}

async function dispatchSessions(rest: string[], context: CliContext): Promise<MutatingDispatchResult> {
  const action = rest[0];
  const sessions = await import("../main/services/sessions-service");

  if (action === "cache" && rest[1] === "sync") {
    const { options } = parseOptions(rest.slice(2));
    return { handled: true, data: await sessions.syncSessionCacheForProfile(profileFor(context, options)) };
  }

  if (action === "title" && rest[1] === "set") {
    const { options, positionals } = parseOptions(rest.slice(2));
    const sessionId = requirePositional(positionals, "session id");
    const title = positionals.slice(1).join(" ").trim();
    if (!title) throw usageError("Missing session title");
    const success = sessions.updateSessionTitleForProfile(sessionId, title, profileFor(context, options));
    if (!success) throw notFoundError(`Session not found: ${sessionId}`);
    return { handled: true, data: { success, sessionId, title } };
  }

  return { handled: false };
}

async function dispatchConfig(domain: string, rest: string[], context: CliContext): Promise<MutatingDispatchResult> {
  const action = rest[0];
  if (action !== "set") return { handled: false };
  const { options, positionals } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const config = await import("../main/services/config-service");

  if (domain === "env") {
    const key = requirePositional(positionals, "env key");
    const value = requirePositional(positionals, "env value", 1);
    return { handled: true, data: { success: await config.setEnv(key, value, profile), key } };
  }

  if (domain === "config") {
    const key = requirePositional(positionals, "config key");
    const value = requirePositional(positionals, "config value", 1);
    return { handled: true, data: { success: await config.setConfig(key, value, profile), key } };
  }

  if (domain === "model-config") {
    const provider = requireOption(options, "--provider");
    const model = requireOption(options, "--model");
    const baseUrl = optionValue(options, "--base-url") ?? "";
    return {
      handled: true,
      data: { success: await config.setModelConfigForProfile(provider, model, baseUrl, profile), provider, model, baseUrl },
    };
  }

  return { handled: false };
}

async function dispatchConnection(rest: string[]): Promise<MutatingDispatchResult> {
  const action = rest[0];
  const config = await import("../main/services/config-service");

  if (action === "set") {
    const { options } = parseOptions(rest.slice(1));
    const mode = requireOption(options, "--mode");
    if (mode !== "local" && mode !== "remote" && mode !== "ssh") {
      throw usageError("--mode must be local, remote, or ssh");
    }
    const url = optionValue(options, "--url") ?? "";
    if (mode === "remote" && !url) throw usageError("connection set --mode remote requires --url");
    const success = config.setConnection(mode, url, optionValue(options, "--api-key"));
    return { handled: true, data: { success, mode, remoteUrl: url } };
  }

  if (action === "ssh" && rest[1] === "set") {
    const { options } = parseOptions(rest.slice(2));
    const host = requireOption(options, "--host");
    const port = integerOption(options, "--port", 22);
    const username = requireOption(options, "--username");
    const keyPath = requireOption(options, "--key-path");
    const remotePort = integerOption(options, "--remote-port", 8765);
    const localPort = integerOption(options, "--local-port", 19642);
    const success = config.setSshConfig(host, port, username, keyPath, remotePort, localPort);
    return { handled: true, data: { success, host, port, username, keyPath, remotePort, localPort } };
  }

  return { handled: false };
}

async function dispatchGateway(rest: string[], context: CliContext): Promise<MutatingDispatchResult> {
  const action = rest[0];
  if (!["start", "stop", "restart", "platform"].includes(action || "")) return { handled: false };
  const gateway = await import("../main/services/gateway-service");

  if (action === "platform" && rest[1] === "set") {
    const { options, positionals } = parseOptions(rest.slice(2));
    const platform = requirePositional(positionals, "platform");
    const enabled = booleanFromString(requirePositional(positionals, "enabled", 1), "enabled");
    const success = await gateway.setPlatformEnabledForProfile(platform, enabled, profileFor(context, options));
    if (!success) throw unsupportedError("Gateway platform mutation is unsupported in the current connection mode.");
    return { handled: true, data: { success, platform, enabled } };
  }

  const { options } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const success = action === "start"
    ? await gateway.startGateway(profile)
    : action === "stop"
      ? await gateway.stopGateway(profile)
      : await gateway.restartGateway(profile);
  if (!success) throw unsupportedError(`Gateway ${action} is unsupported in the current connection mode.`);
  return { handled: true, data: { success, action, profile } };
}

async function dispatchKnowledge(domain: string, rest: string[], context: CliContext): Promise<MutatingDispatchResult> {
  const action = rest[0];
  const { options, positionals } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const knowledge = await import("../main/services/knowledge-service");

  if (domain === "memory") {
    if (action === "add") {
      const result = await knowledge.addMemoryEntryForProfile(contentFrom(options, positionals, "memory content"), profile);
      ensureResultSuccess(result, "memory add");
      return { handled: true, data: result };
    }
    if (action === "update") {
      const index = Number(requirePositional(positionals, "memory index"));
      if (!Number.isInteger(index)) throw usageError("memory index must be an integer");
      const result = await knowledge.updateMemoryEntryForProfile(index, contentFrom(options, positionals.slice(1), "memory content"), profile);
      ensureResultSuccess(result, "memory update");
      return { handled: true, data: result };
    }
    if (action === "remove") {
      const index = Number(requirePositional(positionals, "memory index"));
      if (!Number.isInteger(index)) throw usageError("memory index must be an integer");
      const success = await knowledge.removeMemoryEntryForProfile(index, profile);
      if (!success) throw notFoundError(`Memory entry not found: ${index}`);
      return { handled: true, data: { success, index } };
    }
  }

  if (domain === "user-profile" && action === "write") {
    const result = await knowledge.writeUserProfileForProfile(contentFrom(options, positionals, "user profile content"), profile);
    ensureResultSuccess(result, "user-profile write");
    return { handled: true, data: result };
  }

  if (domain === "soul") {
    if (action === "write") {
      const success = await knowledge.writeSoulForProfile(contentFrom(options, positionals, "SOUL content"), profile);
      if (!success) throw validationError("Failed to write SOUL");
      return { handled: true, data: { success } };
    }
    if (action === "reset") {
      return { handled: true, data: { success: true, content: await knowledge.resetSoulForProfile(profile) } };
    }
  }

  if (domain === "tools" && action === "set") {
    const key = requirePositional(positionals, "toolset key");
    const enabled = booleanFromString(requirePositional(positionals, "enabled", 1), "enabled");
    const success = await knowledge.setToolsetEnabledForProfile(key, enabled, profile);
    if (!success) throw validationError(`Failed to set toolset: ${key}`);
    return { handled: true, data: { success, key, enabled } };
  }

  if (domain === "skills") {
    if (action === "install") {
      const identifier = requirePositional(positionals, "skill identifier");
      const result = await knowledge.installSkillForProfile(identifier, profile);
      ensureResultSuccess(result, "skills install");
      return { handled: true, data: result };
    }
    if (action === "uninstall") {
      const name = requirePositional(positionals, "skill name");
      const result = await knowledge.uninstallSkillForProfile(name, profile);
      ensureResultSuccess(result, "skills uninstall");
      return { handled: true, data: result };
    }
    if (action === "import") {
      const markdown = readFileSync(requireOption(options, "--file"), "utf-8");
      const result = await knowledge.importSkillMarkdownForProfile(
        {
          markdown,
          name: optionValue(options, "--name"),
          category: optionValue(options, "--category"),
          description: optionValue(options, "--description"),
          overwrite: hasOption(options, "--overwrite"),
        },
        profile,
      );
      ensureResultSuccess(result, "skills import");
      return { handled: true, data: result };
    }
  }

  return { handled: false };
}

async function dispatchModels(domain: string, rest: string[]): Promise<MutatingDispatchResult> {
  const action = rest[0];
  const { options, positionals } = parseOptions(rest.slice(1));

  if (domain === "models") {
    const models = await import("../main/models");
    if (action === "add") {
      return {
        handled: true,
        data: models.addModel(
          requireOption(options, "--name"),
          requireOption(options, "--provider"),
          requireOption(options, "--model"),
          optionValue(options, "--base-url") ?? "",
        ),
      };
    }
    if (action === "remove") {
      const id = requirePositional(positionals, "model id");
      const success = models.removeModel(id);
      if (!success) throw notFoundError(`Model not found: ${id}`);
      return { handled: true, data: { success, id } };
    }
    if (action === "update") {
      const id = requirePositional(positionals, "model id");
      const fields: Parameters<typeof models.updateModel>[1] = {};
      const name = optionValue(options, "--name");
      const provider = optionValue(options, "--provider");
      const model = optionValue(options, "--model");
      const baseUrl = optionValue(options, "--base-url");
      const contextWindow = optionValue(options, "--context-window");
      if (name !== undefined) fields.name = name;
      if (provider !== undefined) fields.provider = provider;
      if (model !== undefined) fields.model = model;
      if (baseUrl !== undefined) fields.baseUrl = baseUrl;
      if (contextWindow !== undefined) {
        const parsed = Number(contextWindow);
        if (!Number.isInteger(parsed) || parsed <= 0) throw usageError("--context-window must be a positive integer");
        fields.contextWindow = parsed;
      }
      const success = models.updateModel(id, fields);
      if (!success) throw notFoundError(`Model not found: ${id}`);
      return { handled: true, data: { success, id, fields } };
    }
  }

  if (domain === "credentials" && action === "set") {
    const provider = requirePositional(positionals, "provider");
    const entriesPath = requireOption(options, "--entries-file");
    const entries = JSON.parse(readFileSync(entriesPath, "utf-8")) as unknown;
    if (!Array.isArray(entries)) throw usageError("--entries-file must contain a JSON array");
    const { setCredentialPool } = await import("../main/config");
    setCredentialPool(provider, entries as Parameters<typeof setCredentialPool>[1]);
    return { handled: true, data: { success: true, provider, count: entries.length } };
  }

  return { handled: false };
}

async function dispatchCron(rest: string[], context: CliContext): Promise<MutatingDispatchResult> {
  const action = rest[0];
  if (!["create", "remove", "pause", "resume", "run"].includes(action || "")) return { handled: false };
  const { options, positionals } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const cron = await import("../main/services/cron-service");

  if (action === "create") {
    const schedule = requireOption(options, "--schedule");
    const result = await cron.createCronJobForProfile(
      schedule,
      promptFrom(options, positionals),
      optionValue(options, "--name"),
      optionValue(options, "--deliver"),
      profile,
    );
    ensureResultSuccess(result, "cron create");
    return { handled: true, data: result };
  }

  const jobId = requirePositional(positionals, "cron job id");
  const result = action === "remove"
    ? await cron.removeCronJobForProfile(jobId, profile)
    : action === "pause"
      ? await cron.pauseCronJobForProfile(jobId, profile)
      : action === "resume"
        ? await cron.resumeCronJobForProfile(jobId, profile)
        : await cron.triggerCronJobForProfile(jobId, profile);
  ensureResultSuccess(result, `cron ${action}`);
  return { handled: true, data: result };
}

async function dispatchSystem(domain: string, rest: string[], context: CliContext): Promise<MutatingDispatchResult> {
  const action = rest[0];
  const { options, positionals } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const system = await import("../main/services/system-service");

  if (domain === "backup" && action === "run") {
    const result = await system.runHermesBackupForProfile(profile);
    ensureResultSuccess(result, "backup run");
    return { handled: true, data: result };
  }

  if (domain === "import" && action === "run") {
    const archivePath = requirePositional(positionals, "archive path");
    const result = await system.runHermesImportForProfile(archivePath, profile);
    ensureResultSuccess(result, "import run");
    return { handled: true, data: result };
  }

  if (domain === "runtime" && action === "revalidate") {
    return { handled: true, data: await system.revalidateRuntimeForProfile(profile) };
  }

  return { handled: false };
}

async function dispatchInstall(domain: string, rest: string[], context: CliContext, io: CliWriteIo): Promise<MutatingDispatchResult> {
  const action = rest[0];
  const install = await import("../main/services/install-service");
  const { options } = parseOptions(rest.slice(1));
  const profile = profileFor(context, options);
  const progress = (progress: unknown) => {
    if (context.output === "ndjson") {
      io.stdout.write(formatNdjsonEvent({ type: "progress", progress, ts: Date.now() }));
    } else if (!context.quiet) {
      const detail = typeof progress === "object" && progress && "detail" in progress ? String((progress as { detail?: unknown }).detail ?? "") : "";
      if (detail) io.stderr.write(`${detail}\n`);
    }
  };

  if (domain === "install" && action === "start") {
    const result = await install.startInstall(progress);
    ensureResultSuccess(result, "install start");
    return { handled: true, data: result };
  }
  if (domain === "hermes" && action === "update") {
    const result = await install.runHermesUpdateForConnection(progress, profile);
    ensureResultSuccess(result, "hermes update");
    return { handled: true, data: result };
  }
  if (domain === "claw" && action === "migrate") {
    const result = await install.runClawMigrateForConnection(progress);
    ensureResultSuccess(result, "claw migrate");
    return { handled: true, data: result };
  }

  return { handled: false };
}

async function dispatchSsh(rest: string[], context: CliContext): Promise<MutatingDispatchResult> {
  if (rest[0] !== "tunnel") return { handled: false };
  const action = rest[1];
  const { options } = parseOptions(rest.slice(2));
  const profile = profileFor(context, options);
  const config = await import("../main/services/config-service");

  if (action === "status") {
    return { handled: true, data: { active: config.isSshTunnelActiveForProfile(profile) } };
  }
  if (action === "start") {
    return { handled: true, data: { success: await config.startSshTunnelForProfile(profile) } };
  }
  if (action === "stop") {
    return { handled: true, data: { success: config.stopSshTunnelForProfile() } };
  }
  return { handled: false };
}

export async function dispatchMutatingCommand(
  commandPath: string[],
  context: CliContext,
  io: CliWriteIo,
): Promise<MutatingDispatchResult> {
  const [domain, ...rest] = commandPath;
  if (!domain) return { handled: false };

  await attachConnectionMode(context);

  if (domain === "profiles" || domain === "agents") return dispatchProfiles(domain, rest);
  if (domain === "sessions") return dispatchSessions(rest, context);
  if (["env", "config", "model-config"].includes(domain)) return dispatchConfig(domain, rest, context);
  if (domain === "connection") return dispatchConnection(rest);
  if (domain === "gateway") return dispatchGateway(rest, context);
  if (["memory", "user-profile", "soul", "tools", "skills"].includes(domain)) {
    return dispatchKnowledge(domain, rest, context);
  }
  if (domain === "models" || domain === "credentials") return dispatchModels(domain, rest);
  if (domain === "cron") return dispatchCron(rest, context);
  if (domain === "backup" || domain === "import" || domain === "runtime") return dispatchSystem(domain, rest, context);
  if (domain === "install" || domain === "hermes" || domain === "claw") return dispatchInstall(domain, rest, context, io);
  if (domain === "ssh") return dispatchSsh(rest, context);

  return { handled: false };
}

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { profileHome, safeWriteFile } from "./utils";
import { t } from "../shared/i18n";
import { getAppLocale } from "./locale";

export interface ToolsetInfo {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

const TOOLSET_DEFS: {
  key: string;
  labelKey: string;
  descriptionKey: string;
}[] = [
  {
    key: "web",
    labelKey: "tools.web.label",
    descriptionKey: "tools.web.description",
  },
  {
    key: "browser",
    labelKey: "tools.browser.label",
    descriptionKey: "tools.browser.description",
  },
  {
    key: "terminal",
    labelKey: "tools.terminal.label",
    descriptionKey: "tools.terminal.description",
  },
  {
    key: "file",
    labelKey: "tools.file.label",
    descriptionKey: "tools.file.description",
  },
  {
    key: "code_execution",
    labelKey: "tools.code_execution.label",
    descriptionKey: "tools.code_execution.description",
  },
  {
    key: "vision",
    labelKey: "tools.vision.label",
    descriptionKey: "tools.vision.description",
  },
  {
    key: "image_gen",
    labelKey: "tools.image_gen.label",
    descriptionKey: "tools.image_gen.description",
  },
  {
    key: "tts",
    labelKey: "tools.tts.label",
    descriptionKey: "tools.tts.description",
  },
  {
    key: "skills",
    labelKey: "tools.skills.label",
    descriptionKey: "tools.skills.description",
  },
  {
    key: "memory",
    labelKey: "tools.memory.label",
    descriptionKey: "tools.memory.description",
  },
  {
    key: "session_search",
    labelKey: "tools.session_search.label",
    descriptionKey: "tools.session_search.description",
  },
  {
    key: "clarify",
    labelKey: "tools.clarify.label",
    descriptionKey: "tools.clarify.description",
  },
  {
    key: "delegation",
    labelKey: "tools.delegation.label",
    descriptionKey: "tools.delegation.description",
  },
  {
    key: "cronjob",
    labelKey: "tools.cronjob.label",
    descriptionKey: "tools.cronjob.description",
  },
  {
    key: "moa",
    labelKey: "tools.moa.label",
    descriptionKey: "tools.moa.description",
  },
  {
    key: "todo",
    labelKey: "tools.todo.label",
    descriptionKey: "tools.todo.description",
  },
];

function localizeToolDefs(
  enabled: boolean | ((key: string) => boolean),
): ToolsetInfo[] {
  const locale = getAppLocale();
  return TOOLSET_DEFS.map((toolDef) => ({
    key: toolDef.key,
    label: t(toolDef.labelKey, locale),
    description: t(toolDef.descriptionKey, locale),
    enabled: typeof enabled === "function" ? enabled(toolDef.key) : enabled,
  }));
}

/**
 * Parse a platform_toolsets.<platform> list from config.yaml.
 * Mercury chat prefers Hermes' local API server when it is ready, so the
 * app-visible "CLI" tool toggles must stay mirrored to api_server as well.
 * We use line-by-line parsing to stay consistent with config.ts (no yaml dep).
 */
function parseEnabledToolsets(configContent: string, platform = "cli"): Set<string> {
  const enabled = new Set<string>();
  const lines = configContent.split("\n");

  let inPlatformToolsets = false;
  let inTarget = false;
  const platformRe = new RegExp(`^\\s+${escapeRegex(platform)}\\s*:`);

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
      inPlatformToolsets = true;
      inTarget = false;
      continue;
    }

    if (inPlatformToolsets && platformRe.test(trimmed)) {
      inTarget = true;
      continue;
    }

    if (inPlatformToolsets && /^\S/.test(trimmed) && !/^\s*$/.test(trimmed)) {
      inPlatformToolsets = false;
      inTarget = false;
      continue;
    }

    if (inTarget && /^\s{4}\S/.test(trimmed) && !/^\s{4,}-/.test(trimmed)) {
      inTarget = false;
      continue;
    }

    if (inTarget) {
      const match = trimmed.match(/^\s+-\s+["']?(\w+)["']?/);
      if (match) enabled.add(match[1]);
    }
  }

  return enabled;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function platformToolsetSection(platform: string, enabled: Set<string>): string {
  const toolsetLines = Array.from(enabled)
    .sort()
    .map((tool) => `      - ${tool}`)
    .join("\n");
  return `  ${platform}:\n${toolsetLines}`;
}

function writeMirroredPlatformToolsets(
  configContent: string,
  enabled: Set<string>,
): string {
  if (!configContent.includes("platform_toolsets")) {
    return `${configContent.trimEnd()}\n\nplatform_toolsets:\n${platformToolsetSection("cli", enabled)}\n${platformToolsetSection("api_server", enabled)}\n`;
  }

  let content = replacePlatformToolset(configContent, "cli", enabled);
  content = replacePlatformToolset(content, "api_server", enabled);
  return content;
}

function replacePlatformToolset(
  configContent: string,
  platform: string,
  enabled: Set<string>,
): string {
  const lines = configContent.split("\n");
  const result: string[] = [];
  const section = platformToolsetSection(platform, enabled);
  const platformRe = new RegExp(`^\\s+${escapeRegex(platform)}\\s*:`);
  let inPlatformToolsets = false;
  let inTarget = false;
  let inserted = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    if (/^\s*platform_toolsets\s*:/.test(trimmed)) {
      inPlatformToolsets = true;
      result.push(line);
      continue;
    }

    if (inPlatformToolsets && platformRe.test(trimmed)) {
      inTarget = true;
      inserted = true;
      result.push(section);
      continue;
    }

    if (inTarget) {
      if (/^\s+-\s/.test(trimmed)) continue;
      if (/^\s{4}\S/.test(trimmed) || /^\S/.test(trimmed) || trimmed === "") {
        inTarget = false;
        result.push(line);
      }
      continue;
    }

    if (inPlatformToolsets && /^\S/.test(trimmed) && trimmed !== "") {
      inPlatformToolsets = false;
      if (!inserted) {
        result.push(section);
        inserted = true;
      }
    }

    result.push(line);
  }

  if (inPlatformToolsets && !inserted) result.push(section);
  return result.join("\n");
}

export function getToolsets(profile?: string): ToolsetInfo[] {
  const configFile = join(profileHome(profile), "config.yaml");

  // If no config, assume all toolsets are enabled (hermes default behavior)
  if (!existsSync(configFile)) {
    return localizeToolDefs(true);
  }

  try {
    const content = readFileSync(configFile, "utf-8");
    const enabledSet = parseEnabledToolsets(content);

    // If no platform_toolsets.cli section exists, all are enabled by default
    if (enabledSet.size === 0 && !content.includes("platform_toolsets")) {
      return localizeToolDefs(true);
    }

    return localizeToolDefs((key) => enabledSet.has(key));
  } catch {
    return localizeToolDefs(true);
  }
}

export function setToolsetEnabled(
  key: string,
  enabled: boolean,
  profile?: string,
): boolean {
  const configFile = join(profileHome(profile), "config.yaml");
  if (!existsSync(configFile)) return false;

  try {
    const content = readFileSync(configFile, "utf-8");
    const currentEnabled = parseEnabledToolsets(content);

    if (enabled) {
      currentEnabled.add(key);
    } else {
      currentEnabled.delete(key);
    }

    // Rebuild both platform_toolsets.cli and platform_toolsets.api_server.
    // Mercury's local chat path usually talks to Hermes through api_server,
    // while the Tools UI historically edited only cli. Keeping these mirrored
    // prevents the model from seeing a different tool registry than the UI.
    const updated = writeMirroredPlatformToolsets(content, currentEnabled);
    safeWriteFile(configFile, updated);

    return true;
  } catch {
    return false;
  }
}

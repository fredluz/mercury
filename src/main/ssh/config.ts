import type { SshConfig } from "../ssh-tunnel";
import type { ToolsetInfo } from "../tools";
import { t } from "../../shared/i18n";
import { getAppLocale } from "../locale";
import { sshReadFile, sshWriteFile } from "./transport";

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLSET_DEFS = [
  { key: "web", labelKey: "tools.web.label", descriptionKey: "tools.web.description" },
  { key: "browser", labelKey: "tools.browser.label", descriptionKey: "tools.browser.description" },
  { key: "terminal", labelKey: "tools.terminal.label", descriptionKey: "tools.terminal.description" },
  { key: "file", labelKey: "tools.file.label", descriptionKey: "tools.file.description" },
  { key: "code_execution", labelKey: "tools.code_execution.label", descriptionKey: "tools.code_execution.description" },
  { key: "vision", labelKey: "tools.vision.label", descriptionKey: "tools.vision.description" },
  { key: "image_gen", labelKey: "tools.image_gen.label", descriptionKey: "tools.image_gen.description" },
  { key: "tts", labelKey: "tools.tts.label", descriptionKey: "tools.tts.description" },
  { key: "skills", labelKey: "tools.skills.label", descriptionKey: "tools.skills.description" },
  { key: "memory", labelKey: "tools.memory.label", descriptionKey: "tools.memory.description" },
  { key: "session_search", labelKey: "tools.session_search.label", descriptionKey: "tools.session_search.description" },
  { key: "clarify", labelKey: "tools.clarify.label", descriptionKey: "tools.clarify.description" },
  { key: "delegation", labelKey: "tools.delegation.label", descriptionKey: "tools.delegation.description" },
];

function parseEnabledToolsets(content: string): Set<string> {
  const enabled = new Set<string>();
  let inPlatformToolsets = false;
  let inCli = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trimEnd();
    if (/^\s*platform_toolsets\s*:/.test(trimmed)) { inPlatformToolsets = true; inCli = false; continue; }
    if (inPlatformToolsets && /^\s+cli\s*:/.test(trimmed)) { inCli = true; continue; }
    if (inPlatformToolsets && /^\S/.test(trimmed) && !/^\s*$/.test(trimmed)) { inPlatformToolsets = false; inCli = false; continue; }
    if (inCli && /^\s{4}\S/.test(trimmed) && !/^\s{4,}-/.test(trimmed)) { inCli = false; continue; }
    if (inCli) { const m = trimmed.match(/^\s+-\s+["']?(\w+)["']?/); if (m) enabled.add(m[1]); }
  }
  return enabled;
}

function localizeToolDefs(enabled: boolean | ((key: string) => boolean)): ToolsetInfo[] {
  const locale = getAppLocale();
  return TOOLSET_DEFS.map((d) => ({
    key: d.key,
    label: t(d.labelKey, locale),
    description: t(d.descriptionKey, locale),
    enabled: typeof enabled === "function" ? enabled(d.key) : enabled,
  }));
}

export function remoteConfigPath(profile?: string): string {
  if (profile && profile !== "default") return `$HOME/.hermes/profiles/${profile}/config.yaml`;
  return `$HOME/.hermes/config.yaml`;
}

export async function sshGetToolsets(config: SshConfig, profile?: string): Promise<ToolsetInfo[]> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return localizeToolDefs(true);
  const enabled = parseEnabledToolsets(content);
  if (enabled.size === 0 && !content.includes("platform_toolsets")) return localizeToolDefs(true);
  return localizeToolDefs((key) => enabled.has(key));
}

export async function sshSetToolsetEnabled(
  config: SshConfig,
  key: string,
  enabled: boolean,
  profile?: string,
): Promise<boolean> {
  try {
    const configPath = remoteConfigPath(profile);
    const content = await sshReadFile(config, configPath);
    if (!content) return false;

    const current = parseEnabledToolsets(content);
    if (enabled) current.add(key); else current.delete(key);

    const toolsetLines = Array.from(current).sort().map((t) => `      - ${t}`).join("\n");
    const newSection = `  cli:\n${toolsetLines}`;

    let newContent: string;
    if (content.includes("platform_toolsets")) {
      const lines = content.split("\n");
      const result: string[] = [];
      let inPT = false, inCli = false, inserted = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimEnd();
        if (/^\s*platform_toolsets\s*:/.test(trimmed)) { inPT = true; result.push(line); continue; }
        if (inPT && /^\s+cli\s*:/.test(trimmed)) { inCli = true; result.push(newSection); inserted = true; continue; }
        if (inCli) { if (/^\s+-\s/.test(trimmed)) continue; inCli = false; result.push(line); continue; }
        if (inPT && /^\S/.test(trimmed) && trimmed !== "") { inPT = false; if (!inserted) { result.push(newSection); } }
        result.push(line);
      }
      newContent = result.join("\n");
    } else {
      newContent = content.trimEnd() + "\n\nplatform_toolsets:\n" + newSection + "\n";
    }

    await sshWriteFile(config, configPath, newContent);
    return true;
  } catch {
    return false;
  }
}

// ── Env / Config (Providers) ─────────────────────────────────────────────────

function remoteEnvPath(profile?: string): string {
  if (profile && profile !== "default") return `~/.hermes/profiles/${profile}/.env`;
  return "~/.hermes/.env";
}

export async function sshReadEnv(config: SshConfig, profile?: string): Promise<Record<string, string>> {
  const content = await sshReadFile(config, remoteEnvPath(profile));
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const k = trimmed.substring(0, eqIdx).trim();
    let v = trimmed.substring(eqIdx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v) result[k] = v;
  }
  // Alias alternate env var names so the app can display them regardless of which name the server uses
  const ENV_ALIASES: Array<[string, string]> = [
    ["HA_URL", "HOMEASSISTANT_URL"],
    ["HA_TOKEN", "HOMEASSISTANT_TOKEN"],
  ];
  for (const [appKey, serverKey] of ENV_ALIASES) {
    if (!result[appKey] && result[serverKey]) result[appKey] = result[serverKey];
    if (!result[serverKey] && result[appKey]) result[serverKey] = result[appKey];
  }
  return result;
}

export async function sshSetEnvValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  const envPath = remoteEnvPath(profile);
  const content = await sshReadFile(config, envPath);

  if (!content.trim()) {
    await sshWriteFile(config, envPath, `${key}=${value}\n`);
    return;
  }

  const lines = content.split("\n");
  let found = false;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().match(new RegExp(`^#?\\s*${escaped}\\s*=`))) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${key}=${value}`);
  await sshWriteFile(config, envPath, lines.join("\n"));
}

export async function sshGetConfigValue(
  config: SshConfig,
  key: string,
  profile?: string,
): Promise<string | null> {
  const content = await sshReadFile(config, remoteConfigPath(profile));
  if (!content) return null;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^\\s*${escapedKey}:\\s*["']?([^"'\\n#]+)["']?`, "m"));
  return match ? match[1].trim() : null;
}

export async function sshSetConfigValue(
  config: SshConfig,
  key: string,
  value: string,
  profile?: string,
): Promise<void> {
  if (/["\\\n\r]/.test(value)) {
    throw new Error('Config value contains illegal characters: ", \\, or newline');
  }
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^(\\s*#?\\s*${escapedKey}:\\s*)["']?[^"'\\n#]*["']?`, "m");
  const updated = regex.test(content) ? content.replace(regex, `$1"${value}"`) : content;
  await sshWriteFile(config, configPath, updated);
}

export function sshGetHermesHome(_config: SshConfig, profile?: string): string {
  if (profile && profile !== "default") return `~/.hermes/profiles/${profile}`;
  return "~/.hermes";
}

export async function sshGetModelConfig(
  config: SshConfig,
  profile?: string,
): Promise<{ provider: string; model: string; baseUrl: string }> {
  return {
    provider: (await sshGetConfigValue(config, "provider", profile)) || "auto",
    model: (await sshGetConfigValue(config, "default", profile)) || "",
    baseUrl: (await sshGetConfigValue(config, "base_url", profile)) || "",
  };
}

export async function sshSetModelConfig(
  config: SshConfig,
  provider: string,
  model: string,
  baseUrl: string,
  profile?: string,
): Promise<void> {
  await sshSetConfigValue(config, "provider", provider, profile);
  await sshSetConfigValue(config, "default", model, profile);
  await sshSetConfigValue(config, "base_url", baseUrl, profile);
  const configPath = remoteConfigPath(profile);
  const content = await sshReadFile(config, configPath);
  if (!content) return;
  let updated = content.replace(
    /^(\s*streaming:\s*)(\S+)/m,
    "$1true",
  );
  const lines = updated.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (
      /^\s*enabled:\s*(true|false)/.test(lines[i]) &&
      i > 0 &&
      /smart_model_routing/.test(lines[i - 1])
    ) {
      lines[i] = lines[i].replace(/(enabled:\s*)(true|false)/, "$1false");
    }
  }
  updated = lines.join("\n");
  if (updated !== content) await sshWriteFile(config, configPath, updated);
}

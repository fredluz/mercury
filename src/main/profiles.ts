import { execFileSync } from "child_process";
import { dirname, join } from "path";
import { homedir } from "os";
import { promises as fs } from "fs";
import { copyFileSync, existsSync } from "fs";
import { isValidProfileName } from "../shared/profile-identity";
import type { ProfileAgentMetadata, ProfileInfo } from "../shared/profiles";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  getEnhancedPath,
} from "./installer";

const PROFILES_DIR = join(HERMES_HOME, "profiles");
const PROFILE_AGENT_METADATA_VERSION = 1;

export type { ProfileAgentMetadata, ProfileInfo } from "../shared/profiles";

async function readProfileConfig(profilePath: string): Promise<{
  model: string;
  provider: string;
}> {
  const configFile = join(profilePath, "config.yaml");
  try {
    const content = await fs.readFile(configFile, "utf-8");
    const nested = parseModelConfigBlock(content);
    const modelMatch = content.match(/^\s*default:\s*["']?([^"'\n#]+)["']?/m);
    const providerMatch = content.match(
      /^\s*provider:\s*["']?([^"'\n#]+)["']?/m,
    );
    return {
      model: nested.model ?? (modelMatch ? modelMatch[1].trim() : ""),
      provider:
        nested.provider ?? (providerMatch ? providerMatch[1].trim() : "auto"),
    };
  } catch {
    return { model: "", provider: "" };
  }
}

function parseModelConfigBlock(content: string): {
  model?: string;
  provider?: string;
} {
  const result: { model?: string; provider?: string } = {};
  const lines = content.split("\n");
  const modelBlockIndex = lines.findIndex((line) =>
    /^model:\s*(?:#.*)?$/.test(line),
  );
  if (modelBlockIndex < 0) return result;

  for (let i = modelBlockIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && line.trim() !== "") break;
    const match = line.match(/^\s+(default|provider):\s*["']?([^"'\n#]*)["']?/);
    if (!match) continue;
    if (match[1] === "default") result.model = match[2].trim();
    if (match[1] === "provider") result.provider = match[2].trim();
  }
  return result;
}

async function countSkills(profilePath: string): Promise<number> {
  const skillsDir = join(profilePath, "skills");
  try {
    const dirs = await fs.readdir(skillsDir);
    let count = 0;
    for (const d of dirs) {
      const sub = join(skillsDir, d);
      const stat = await fs.stat(sub);
      if (stat.isDirectory()) {
        const inner = await fs.readdir(sub);
        for (const f of inner) {
          try {
            await fs.access(join(sub, f, "SKILL.md"));
            count++;
          } catch {
            // not a skill
          }
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function isGatewayRunning(profilePath: string): Promise<boolean> {
  const pidFile = join(profilePath, "gateway.pid");
  try {
    const raw = await fs.readFile(pidFile, "utf-8");
    const pid = parseGatewayPid(raw);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseGatewayPid(raw: string): number {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as { pid?: unknown };
    if (typeof parsed.pid === "number") return parsed.pid;
    if (typeof parsed.pid === "string") return parseInt(parsed.pid, 10);
  } catch {
    // plain pid file
  }
  return parseInt(trimmed, 10);
}

async function getActiveProfileName(): Promise<string> {
  const activeFile = join(HERMES_HOME, "active_profile");
  try {
    const name = await fs.readFile(activeFile, "utf-8");
    return name.trim() || "default";
  } catch {
    return "default";
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export function profileAgentMetadataPath(profilePath: string): string {
  return join(profilePath, "desktop", "profile-agent.json");
}

export async function readProfileAgentMetadata(
  profilePath: string,
): Promise<ProfileAgentMetadata> {
  try {
    const raw = await fs.readFile(profileAgentMetadataPath(profilePath), "utf-8");
    return normalizeProfileAgentMetadata(JSON.parse(raw) as unknown);
  } catch {
    return { version: PROFILE_AGENT_METADATA_VERSION };
  }
}

export async function writeProfileAgentMetadata(
  profilePath: string,
  metadata: ProfileAgentMetadata,
): Promise<void> {
  const normalized = normalizeProfileAgentMetadata(metadata);
  const filePath = profileAgentMetadataPath(profilePath);
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
}

function normalizeProfileAgentMetadata(value: unknown): ProfileAgentMetadata {
  if (!isRecord(value)) return { version: PROFILE_AGENT_METADATA_VERSION };
  return {
    version: PROFILE_AGENT_METADATA_VERSION,
    ...optionalStringField("displayName", value.displayName),
    ...optionalStringField("description", value.description),
    selectedPackIds: stringArray(value.selectedPackIds),
    docsPointers: docsPointers(value.docsPointers),
  };
}

function optionalStringField<K extends "displayName" | "description">(
  key: K,
  value: unknown,
): Partial<Pick<ProfileAgentMetadata, K>> {
  return typeof value === "string" && value.trim()
    ? ({ [key]: value.trim() } as Partial<Pick<ProfileAgentMetadata, K>>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function docsPointers(value: unknown): ProfileAgentMetadata["docsPointers"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): NonNullable<ProfileAgentMetadata["docsPointers"]> => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.title !== "string") {
      return [];
    }
    return [
      {
        id: entry.id,
        title: entry.title,
        ...optionalPointerStringField("path", entry.path),
        ...optionalPointerStringField("url", entry.url),
      },
    ];
  });
}

function optionalPointerStringField<K extends "path" | "url">(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  return typeof value === "string" && value.trim() ? { [key]: value.trim() } as Partial<Record<K, string>> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function profileDisplayFields(
  name: string,
  isDefault: boolean,
  metadata: ProfileAgentMetadata,
): Pick<
  ProfileInfo,
  | "displayName"
  | "kind"
  | "immutable"
  | "deletable"
  | "description"
  | "selectedPackIds"
  | "docsPointers"
> {
  if (isDefault) {
    return {
      displayName: "Mercury",
      kind: "builtin",
      immutable: true,
      deletable: false,
      ...optionalProfileDescription(metadata.description),
      selectedPackIds: [...(metadata.selectedPackIds ?? [])],
      docsPointers: [...(metadata.docsPointers ?? [])],
    };
  }

  return {
    displayName: metadata.displayName || name,
    kind: "custom",
    immutable: false,
    deletable: true,
    ...optionalProfileDescription(metadata.description),
    selectedPackIds: [...(metadata.selectedPackIds ?? [])],
    docsPointers: [...(metadata.docsPointers ?? [])],
  };
}

function optionalProfileDescription(description: string | undefined): Pick<ProfileInfo, "description"> | {} {
  return description ? { description } : {};
}

export async function listProfiles(): Promise<ProfileInfo[]> {
  const activeName = await getActiveProfileName();
  const profiles: ProfileInfo[] = [];

  // Default profile is HERMES_HOME itself
  const [
    defaultConfig,
    defaultHasEnv,
    defaultHasSoul,
    defaultSkills,
    defaultGw,
    defaultMetadata,
  ] = await Promise.all([
    readProfileConfig(HERMES_HOME),
    fileExists(join(HERMES_HOME, ".env")),
    fileExists(join(HERMES_HOME, "SOUL.md")),
    countSkills(HERMES_HOME),
    isGatewayRunning(HERMES_HOME),
    readProfileAgentMetadata(HERMES_HOME),
  ]);

  profiles.push({
    name: "default",
    path: HERMES_HOME,
    isDefault: true,
    isActive: activeName === "default",
    model: defaultConfig.model,
    provider: defaultConfig.provider,
    hasEnv: defaultHasEnv,
    hasSoul: defaultHasSoul,
    skillCount: defaultSkills,
    gatewayRunning: defaultGw,
    ...profileDisplayFields("default", true, defaultMetadata),
  });

  // Named profiles under ~/.hermes/profiles/
  if (existsSync(PROFILES_DIR)) {
    try {
      const dirs = await fs.readdir(PROFILES_DIR);
      const profilePromises = dirs.map(async (name) => {
        // Skip dotfiles like .DS_Store so they don't get mistaken for profiles.
        if (name.startsWith(".")) return null;

        const profilePath = join(PROFILES_DIR, name);
        const stat = await fs.stat(profilePath);
        if (!stat.isDirectory()) return null;

        // Any subdirectory of ~/.hermes/profiles/ is treated as a profile.
        // We deliberately do NOT require config.yaml or .env to exist —
        // a freshly created profile may have neither yet, and filtering on
        // them silently hides it from the UI (issue #19).
        const [config, hasEnvFile, hasSoul, skillCount, gwRunning, metadata] =
          await Promise.all([
            readProfileConfig(profilePath),
            fileExists(join(profilePath, ".env")),
            fileExists(join(profilePath, "SOUL.md")),
            countSkills(profilePath),
            isGatewayRunning(profilePath),
            readProfileAgentMetadata(profilePath),
          ]);

        return {
          name,
          path: profilePath,
          isDefault: false,
          isActive: activeName === name,
          model: config.model,
          provider: config.provider,
          hasEnv: hasEnvFile,
          hasSoul: hasSoul,
          skillCount,
          gatewayRunning: gwRunning,
          ...profileDisplayFields(name, false, metadata),
        } as ProfileInfo;
      });

      const resolved = await Promise.all(profilePromises);
      for (const p of resolved) {
        if (p) profiles.push(p);
      }
    } catch {
      // ignore
    }
  }

  return profiles;
}

export function createProfile(
  name: string,
  copyDefaultConfig: boolean,
): { success: boolean; error?: string } {
  if (!isValidProfileName(name)) {
    return {
      success: false,
      error:
        "Profile names must start with a lowercase letter or number and contain only lowercase letters, numbers, underscores, or hyphens.",
    };
  }

  try {
    execFileSync(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "profile", "create", name, "--no-skills"],
      {
        cwd: join(HERMES_HOME, "hermes-agent"),
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        stdio: "pipe",
        timeout: 15000,
      },
    );

    if (copyDefaultConfig) {
      const profilePath = join(PROFILES_DIR, name);
      for (const file of ["config.yaml", ".env"]) {
        const source = join(HERMES_HOME, file);
        if (existsSync(source)) copyFileSync(source, join(profilePath, file));
      }
    }

    return { success: true };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    let error = msg.trim();
    if (copyDefaultConfig) {
      const rollback = deleteProfile(name);
      if (!rollback.success && rollback.error) {
        error = `${error} Rollback attempted but failed: ${rollback.error}`;
      }
    }
    return { success: false, error };
  }
}

export function deleteProfile(name: string): {
  success: boolean;
  error?: string;
} {
  if (name === "default")
    return { success: false, error: "Cannot delete the default profile" };
  try {
    execFileSync(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "profile", "delete", name, "--yes"],
      {
        cwd: join(HERMES_HOME, "hermes-agent"),
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        stdio: "pipe",
        timeout: 15000,
      },
    );
    return { success: true };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { success: false, error: msg.trim() };
  }
}

export function setActiveProfile(name: string): void {
  try {
    execFileSync(HERMES_PYTHON, [HERMES_SCRIPT, "profile", "use", name], {
      cwd: join(HERMES_HOME, "hermes-agent"),
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 10000,
    });
  } catch {
    // ignore
  }
}

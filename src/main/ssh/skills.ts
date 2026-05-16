import type { SshConfig } from "../ssh-tunnel";
import { type InstalledSkill, type SkillSearchResult } from "../skills";
import { isValidSkillImportProfile, prepareSkillMarkdownImport } from "../skills/importer";
import type { SkillMarkdownImportRequest, SkillMarkdownImportResult, SkillMetadata } from "../../shared/skills";
import { normalizeRemotePath, pythonJsonInput, shellQuote, sshExec, sshFileExists, sshPython, sshReadFile, sshWriteFile } from "./transport";

// ── Skills ───────────────────────────────────────────────────────────────────

const REMOTE_PREFIX = "REMOTE:";

export async function sshListInstalledSkills(config: SshConfig, profile?: string): Promise<InstalledSkill[]> {
  const script = `
import os, json, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
skills_dir = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills" if profile and profile != "default" else "~/.hermes/skills")
skills = []

def read_meta(skill_path):
    description = ""
    skill_file = os.path.join(skill_path, "SKILL.md")
    if os.path.exists(skill_file):
        try:
            content = open(skill_file).read(4000)
            if content.startswith("---"):
                end = content.find("---", 3)
                if end != -1:
                    for line in content[3:end].splitlines():
                        if line.strip().startswith("description:"):
                            description = line.split(":",1)[1].strip().strip("'").strip('"')
            else:
                for line in content.splitlines():
                    if line.strip() and not line.startswith("#"):
                        description = line.strip()[:120]
                        break
        except:
            pass
    return description

if os.path.isdir(skills_dir):
    for entry in sorted(os.listdir(skills_dir)):
        entry_path = os.path.join(skills_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        direct_skill_file = os.path.join(entry_path, "SKILL.md")
        if os.path.exists(direct_skill_file):
            skills.append({"name": entry, "category": "", "description": read_meta(entry_path), "path": entry_path})
            continue
        for name in sorted(os.listdir(entry_path)):
            skill_path = os.path.join(entry_path, name)
            if os.path.isdir(skill_path) and os.path.exists(os.path.join(skill_path, "SKILL.md")):
                skills.append({"name": name, "category": entry, "description": read_meta(skill_path), "path": skill_path})
print(json.dumps(skills))
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile }));
    const parsed = JSON.parse(out.trim() || "[]") as Array<{
      name: string; category: string; description: string; path: string;
    }>;
    return parsed.map((s) => ({ ...s, path: REMOTE_PREFIX + s.path }));
  } catch {
    return [];
  }
}

export async function sshGetSkillContent(config: SshConfig, skillPath: string): Promise<string> {
  const remote = skillPath.startsWith(REMOTE_PREFIX)
    ? skillPath.slice(REMOTE_PREFIX.length)
    : skillPath;
  return await sshReadFile(config, `${remote}/SKILL.md`);
}

export async function sshGetSkillMetadata(
  config: SshConfig,
  skillPath: string,
): Promise<SkillMetadata> {
  const remote = skillPath.startsWith(REMOTE_PREFIX)
    ? skillPath.slice(REMOTE_PREFIX.length)
    : skillPath;
  const unavailable = (reason: string): SkillMetadata => ({
    path: skillPath,
    scripts: [],
    references: [],
    metadataAvailable: false,
    unavailableReason: reason,
  });

  if (remote.includes("\0")) {
    return unavailable("Skill metadata is unavailable for this skill.");
  }

  const script = `
import os, json, sys
payload = json.load(sys.stdin)
base = payload.get("path", "")

def item(kind, name):
    return {"name": name, "relativePath": kind + "/" + name, "kind": "directory" if os.path.isdir(os.path.join(base, kind, name)) else "file"}

def collect(kind):
    directory = os.path.join(base, kind)
    if not os.path.isdir(directory):
        return []
    try:
        return sorted([item(kind, name) for name in os.listdir(directory)], key=lambda entry: entry["name"].lower())
    except Exception:
        return []

skill_file = os.path.join(base, "SKILL.md")
if chr(0) in base or not os.path.isdir(base) or not os.path.isfile(skill_file):
    print(json.dumps({"path": payload.get("originalPath", base), "scripts": [], "references": [], "metadataAvailable": False, "unavailableReason": "Skill metadata is unavailable for this skill."}))
else:
    print(json.dumps({"path": payload.get("originalPath", base), "scripts": collect("scripts"), "references": collect("references"), "metadataAvailable": True}))
`;

  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ path: remote, originalPath: skillPath }),
    );
    return JSON.parse(out.trim()) as SkillMetadata;
  } catch {
    return unavailable("Skill metadata is unavailable for this skill.");
  }
}

function hermesProfileArgs(profile?: string): string {
  return profile && profile !== "default" ? `-p ${shellQuote(profile)}` : "";
}

function hermesProfileCommand(profile: string | undefined, args: string): string {
  const profileArgs = hermesProfileArgs(profile);
  return profileArgs ? `hermes ${profileArgs} ${args}` : `hermes ${args}`;
}

export function buildSshSkillCommand(
  profile: string | undefined,
  args: string,
): string {
  return hermesProfileCommand(profile, args);
}

export async function sshInstallSkill(
  config: SshConfig,
  identifier: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await sshExec(config, `${hermesProfileCommand(profile, `skills install ${shellQuote(identifier)} --yes`)} 2>&1`, undefined, 120000);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function sshUninstallSkill(
  config: SshConfig,
  name: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await sshExec(config, `${hermesProfileCommand(profile, `skills uninstall ${shellQuote(name)}`)} 2>&1`);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

function remoteSkillDir(profile: string | undefined, category: string, name: string): string {
  const skillsRoot =
    profile && profile !== "default"
      ? `~/.hermes/profiles/${profile}/skills`
      : "~/.hermes/skills";
  return `${skillsRoot}/${category}/${name}`;
}

export async function sshImportSkillMarkdown(
  config: SshConfig,
  request: SkillMarkdownImportRequest,
  profile?: string,
): Promise<SkillMarkdownImportResult> {
  if (!isValidSkillImportProfile(profile)) {
    return {
      success: false,
      code: "write-failed",
      error: "Invalid profile name for remote skill import.",
    };
  }

  const preparedResult = prepareSkillMarkdownImport(request);
  if (!preparedResult.success) return preparedResult;

  const { prepared } = preparedResult;
  const skillDir = remoteSkillDir(profile, prepared.category, prepared.name);
  const skillFile = `${skillDir}/SKILL.md`;

  if (!request.overwrite && (await sshFileExists(config, skillFile))) {
    return {
      success: false,
      code: "duplicate",
      error: `Skill ${prepared.category}/${prepared.name} already exists on the remote host.`,
    };
  }

  try {
    await sshWriteFile(config, skillFile, prepared.markdown);
    return {
      success: true,
      skill: {
        name: prepared.name,
        category: prepared.category,
        description: prepared.description,
        path: REMOTE_PREFIX + normalizeRemotePath(skillDir),
      },
    };
  } catch (err) {
    return {
      success: false,
      code: "write-failed",
      error: (err as Error).message,
    };
  }
}

export async function sshSearchSkills(config: SshConfig, query: string): Promise<SkillSearchResult[]> {
  try {
    const out = await sshExec(
      config,
      `hermes skills browse --query ${shellQuote(query)} --json 2>/dev/null || echo "[]"`,
    );
    const parsed = JSON.parse(out.trim() || "[]");
    if (Array.isArray(parsed)) {
      return parsed.map((r: Record<string, string>) => ({
        name: r.name || "",
        description: r.description || "",
        category: r.category || "",
        source: r.source || "",
        installed: false,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

export async function sshListBundledSkills(config: SshConfig): Promise<SkillSearchResult[]> {
  return await sshSearchSkills(config, "");
}

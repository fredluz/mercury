import type { SshConfig } from "../ssh-tunnel";
import { type InstalledSkill, type SkillSearchResult } from "../skills";
import {
  isValidSkillCategory,
  isValidSkillImportProfile,
  isValidSkillName,
  prepareSkillMarkdownImport,
} from "../skills/importer";
import type { SkillDirectoryImportRequest } from "../skills/directory-importer";
import type {
  ParsedSkillSource,
  SkillMarkdownImportRequest,
  SkillMarkdownImportResult,
  SkillMetadata,
  SkillMutationBatchResult,
  SkillMutationTarget,
  SkillSourceCandidate,
  SkillSourceImportResult,
} from "../../shared/skills";
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
    name = ""
    description = ""
    skill_file = os.path.join(skill_path, "SKILL.md")
    if os.path.exists(skill_file):
        try:
            content = open(skill_file).read(4000)
            if content.startswith("---"):
                end = content.find("---", 3)
                if end != -1:
                    for line in content[3:end].splitlines():
                        stripped = line.strip()
                        if stripped.startswith("name:"):
                            name = stripped.split(":",1)[1].strip().strip("'").strip('"')
                        if stripped.startswith("description:"):
                            description = stripped.split(":",1)[1].strip().strip("'").strip('"')
            else:
                for line in content.splitlines():
                    if line.strip() and not line.startswith("#"):
                        description = line.strip()[:120]
                        break
        except:
            pass
    return {"name": name, "description": description}

if os.path.isdir(skills_dir):
    for entry in sorted(os.listdir(skills_dir)):
        entry_path = os.path.join(skills_dir, entry)
        if not os.path.isdir(entry_path):
            continue
        direct_skill_file = os.path.join(entry_path, "SKILL.md")
        if os.path.exists(direct_skill_file):
            meta = read_meta(entry_path)
            skills.append({"name": meta.get("name") or entry, "category": "", "description": meta.get("description") or "", "path": entry_path, "directoryName": entry})
            continue
        for name in sorted(os.listdir(entry_path)):
            skill_path = os.path.join(entry_path, name)
            if os.path.isdir(skill_path) and os.path.exists(os.path.join(skill_path, "SKILL.md")):
                meta = read_meta(skill_path)
                skills.append({"name": meta.get("name") or name, "category": entry, "description": meta.get("description") or "", "path": skill_path, "directoryName": name})
print(json.dumps(skills))
`;
  try {
    const out = await sshPython(config, script, pythonJsonInput({ profile }));
    const parsed = JSON.parse(out.trim() || "[]") as Array<{
      name: string; category: string; description: string; path: string; directoryName: string;
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

function normalizeRelativeFilePath(relativePath: string): string {
  return relativePath.split(/[\\/]+/).join("/");
}

function isSafeRemoteRelativeFilePath(relativePath: string): boolean {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0")) {
    return false;
  }
  if (relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    return false;
  }
  const parts = relativePath.split(/[\\/]+/);
  return !parts.some((part) => part === "" || part === "." || part === "..");
}

function sourceForDirectoryImport(request: SkillDirectoryImportRequest): ParsedSkillSource {
  return request.source || {
    kind: "github",
    owner: "local",
    repo: "directory",
    originalSource: "directory-import",
    pathKind: "repo",
  };
}

function candidateForDirectoryImport(
  request: SkillDirectoryImportRequest,
  source: ParsedSkillSource,
  skill: Extract<SkillSourceImportResult, { success: true }>["skill"],
): SkillSourceCandidate {
  return request.candidate || {
    candidateId: `github:${source.owner}/${source.repo}@directory:${skill.category}/${skill.directoryName}/SKILL.md` as SkillSourceCandidate["candidateId"],
    name: skill.name,
    category: skill.category,
    directoryName: skill.directoryName,
    description: skill.description,
    skillPath: `${skill.category}/${skill.directoryName}/SKILL.md`,
    sourceLabel: source.originalSource,
    commitSha: "directory",
    valid: true,
  };
}

export async function sshImportSkillDirectory(
  config: SshConfig,
  request: SkillDirectoryImportRequest,
  profile?: string,
): Promise<SkillSourceImportResult> {
  const fail = (
    code: Extract<SkillSourceImportResult, { success: false }>["code"],
    error: string,
  ): Extract<SkillSourceImportResult, { success: false }> => ({ success: false, code, error });

  if (!isValidSkillImportProfile(profile)) {
    return fail("write-failed", "Invalid profile name for remote skill directory import.");
  }
  if (!Array.isArray(request.files) || request.files.length === 0) {
    return fail("invalid-markdown", "Skill directory import requires files including SKILL.md.");
  }

  const normalizedFiles = request.files.map((file) => ({
    originalRelativePath: file.relativePath,
    relativePath: normalizeRelativeFilePath(file.relativePath),
    contentBase64: file.contentBase64,
  }));
  const skillMarkdownFile = normalizedFiles.find((file) => file.relativePath === "SKILL.md");
  if (!skillMarkdownFile) {
    return fail("invalid-markdown", "Skill directory import requires a top-level SKILL.md file.");
  }
  const seen = new Set<string>();
  for (const file of normalizedFiles) {
    if (!isSafeRemoteRelativeFilePath(file.originalRelativePath)) {
      return fail("write-failed", `Unsafe file path in skill import: ${file.originalRelativePath}`);
    }
    if (seen.has(file.relativePath)) {
      return fail("write-failed", `Duplicate file path in skill import: ${file.relativePath}`);
    }
    seen.add(file.relativePath);
  }

  const skillMarkdown = Buffer.from(skillMarkdownFile.contentBase64, "base64").toString("utf-8");
  const preparedResult = prepareSkillMarkdownImport({
    markdown: skillMarkdown,
    name: request.name,
    category: request.category,
    description: request.description,
    overwrite: request.overwrite,
  });
  if (!preparedResult.success) return preparedResult;

  const { prepared } = preparedResult;
  const directoryName = (request.directoryName?.trim() || prepared.name).trim();
  if (!isValidSkillCategory(prepared.category)) {
    return fail("invalid-category", "Category must be a slug: 1-64 lowercase letters, numbers, underscores, or hyphens.");
  }
  if (!isValidSkillName(directoryName)) {
    return fail("invalid-name", "Skill directory name must be a slug: 2-64 lowercase letters, numbers, underscores, or hyphens.");
  }

  const payload = {
    profile,
    category: prepared.category,
    directoryName,
    name: prepared.name,
    description: prepared.description,
    overwrite: request.overwrite === true,
    files: normalizedFiles.map((file) => ({
      relativePath: file.relativePath,
      contentBase64:
        file.relativePath === "SKILL.md"
          ? Buffer.from(prepared.markdown, "utf-8").toString("base64")
          : file.contentBase64,
    })),
  };

  const script = String.raw`
import base64, json, os, re, shutil, sys, tempfile, time
payload = json.load(sys.stdin)
profile = payload.get("profile")
category = payload.get("category") or ""
directory_name = payload.get("directoryName") or ""
name = payload.get("name") or ""
description = payload.get("description") or ""
overwrite = bool(payload.get("overwrite"))
files = payload.get("files") or []
remote_prefix = "REMOTE:"
skills_root = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills" if profile and profile != "default" else "~/.hermes/skills")

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")
CATEGORY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
PROFILE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

def result(value):
    print(json.dumps(value))
    sys.exit(0)

def fail(code, error):
    result({"success": False, "code": code, "error": error})

def under(parent, child):
    try:
        parent_real = os.path.realpath(parent)
        child_real = os.path.realpath(child)
        return child_real == parent_real or child_real.startswith(parent_real + os.sep)
    except Exception:
        return False

def has_symlink_in_path(root, target):
    if not os.path.exists(root):
        return False
    root_abs = os.path.abspath(root)
    target_abs = os.path.abspath(target)
    try:
        if os.path.islink(root_abs):
            return True
    except Exception:
        return False
    rel = os.path.relpath(target_abs, root_abs)
    if rel == "." or rel.startswith("..") or os.path.isabs(rel):
        return False
    current = root_abs
    for part in rel.split(os.sep):
        current = os.path.join(current, part)
        if not os.path.exists(current):
            return False
        if os.path.islink(current):
            return True
    return False

def safe_rel(path):
    if not isinstance(path, str) or not path or "\x00" in path:
        return False
    if os.path.isabs(path) or re.match(r"^[A-Za-z]:[\\/]", path):
        return False
    parts = re.split(r"[\\/]+", path)
    return not any(part in ("", ".", "..") for part in parts)

def normalize_rel(path):
    return "/".join(re.split(r"[\\/]+", path))

def safe_existing(path):
    return os.path.exists(skills_root) and os.path.exists(path) and under(skills_root, path) and not has_symlink_in_path(skills_root, path)

def safe_destination_parent(destination):
    parent = os.path.dirname(destination)
    return os.path.exists(skills_root) and os.path.exists(parent) and under(skills_root, destination) and under(skills_root, parent) and not has_symlink_in_path(skills_root, parent)

def remove_any(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path, ignore_errors=True)
        return
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass

if profile and profile != "default" and not PROFILE_RE.match(profile):
    fail("write-failed", "Invalid profile name for remote skill directory import.")
if not CATEGORY_RE.match(category):
    fail("invalid-category", "Category must be a slug: 1-64 lowercase letters, numbers, underscores, or hyphens.")
if not NAME_RE.match(directory_name):
    fail("invalid-name", "Skill directory name must be a slug: 2-64 lowercase letters, numbers, underscores, or hyphens.")
if not isinstance(files, list) or not files:
    fail("invalid-markdown", "Skill directory import requires files including SKILL.md.")

normalized = []
seen = set()
has_skill = False
for entry in files:
    rel_original = entry.get("relativePath") if isinstance(entry, dict) else None
    if not safe_rel(rel_original):
        fail("write-failed", f"Unsafe file path in skill import: {rel_original}")
    rel = normalize_rel(rel_original)
    if rel in seen:
        fail("write-failed", f"Duplicate file path in skill import: {rel}")
    seen.add(rel)
    if rel == "SKILL.md":
        has_skill = True
    normalized.append({"relativePath": rel, "contentBase64": entry.get("contentBase64") or ""})
if not has_skill:
    fail("invalid-markdown", "Skill directory import requires a top-level SKILL.md file.")

category_dir = os.path.abspath(os.path.join(skills_root, category))
dest_dir = os.path.abspath(os.path.join(category_dir, directory_name))
if not under(skills_root, dest_dir):
    fail("write-failed", "Resolved skill path escapes the remote skills directory.")

try:
    os.makedirs(skills_root, mode=0o755, exist_ok=True)
    os.makedirs(category_dir, mode=0o755, exist_ok=True)
    if not safe_destination_parent(dest_dir):
        fail("write-failed", "Skill destination is not safe to write.")

    destination_exists = os.path.lexists(dest_dir)
    if destination_exists and not overwrite:
        fail("duplicate", f"Skill {category}/{directory_name} already exists on the remote host.")
    if destination_exists and not safe_existing(dest_dir):
        fail("write-failed", "Existing skill destination is not safe to replace.")

    temp_dir = tempfile.mkdtemp(prefix=".mercury-import-", dir=category_dir)
    os.chmod(temp_dir, 0o755)
    if not safe_destination_parent(temp_dir):
        fail("write-failed", "Temporary skill destination is not safe to write.")

    try:
        for entry in normalized:
            rel = entry["relativePath"]
            target = os.path.abspath(os.path.join(temp_dir, *rel.split("/")))
            if not under(temp_dir, target):
                raise Exception(f"Resolved file path escapes the skill directory: {rel}")
            parent = os.path.dirname(target)
            os.makedirs(parent, mode=0o755, exist_ok=True)
            current = temp_dir
            for part in rel.split("/")[:-1]:
                current = os.path.join(current, part)
                os.chmod(current, 0o755)
            data = base64.b64decode(entry["contentBase64"])
            with open(target, "xb") as handle:
                handle.write(data)
            os.chmod(target, 0o644)

        backup_dir = None
        try:
            if destination_exists:
                backup_dir = f"{dest_dir}.mercury-backup-{os.getpid()}-{int(time.time() * 1000)}"
                os.rename(dest_dir, backup_dir)
            os.rename(temp_dir, dest_dir)
            temp_dir = None
            if backup_dir:
                remove_any(backup_dir)
        except Exception:
            if backup_dir and os.path.exists(backup_dir) and not os.path.exists(dest_dir):
                try:
                    os.rename(backup_dir, dest_dir)
                except Exception:
                    pass
            raise
    finally:
        if temp_dir and os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)

    result({"success": True, "skill": {"name": name, "category": category, "description": description, "path": remote_prefix + dest_dir, "directoryName": directory_name}})
except SystemExit:
    raise
except Exception as exc:
    fail("write-failed", str(exc))
`;

  try {
    const out = await sshPython(config, script, pythonJsonInput(payload), 120000);
    const parsed = JSON.parse(out.trim() || "{}") as SkillSourceImportResult;
    if (!parsed.success) return parsed;
    const source = sourceForDirectoryImport(request);
    const skill = {
      ...parsed.skill,
      path: parsed.skill.path.startsWith(REMOTE_PREFIX)
        ? REMOTE_PREFIX + normalizeRemotePath(parsed.skill.path.slice(REMOTE_PREFIX.length))
        : REMOTE_PREFIX + normalizeRemotePath(parsed.skill.path),
    };
    return {
      success: true,
      skill,
      source,
      candidate: candidateForDirectoryImport(request, source, skill),
    };
  } catch (err) {
    return fail("write-failed", (err as Error).message);
  }
}

export async function sshMutateSkills(
  config: SshConfig,
  targets: SkillMutationTarget[],
  profile?: string,
): Promise<SkillMutationBatchResult> {
  if (!isValidSkillImportProfile(profile)) {
    const results = targets.map((target) => ({
      success: false as const,
      action: target.action,
      target,
      name: target.name,
      category: target.category,
      code: "invalid-target" as const,
      error: "Invalid profile name for remote skill mutation.",
    }));
    return { success: results.length === 0, updated: 0, failed: results.length, results };
  }

  const script = String.raw`
import json, os, shutil, subprocess, sys
payload = json.load(sys.stdin)
profile = payload.get("profile")
targets = payload.get("targets") or []
skills_root = os.path.expanduser(f"~/.hermes/profiles/{profile}/skills" if profile and profile != "default" else "~/.hermes/skills")
remote_prefix = "REMOTE:"

def norm(value):
    return (value or "").strip().lower()

def safe_segment(value):
    return bool(value) and "/" not in value and "\\" not in value and "\x00" not in value

def read_meta(skill_path, category, directory_name):
    name = directory_name
    description = ""
    skill_file = os.path.join(skill_path, "SKILL.md")
    try:
        content = open(skill_file, encoding="utf-8").read(4000)
        if content.startswith("---"):
            end = content.find("---", 3)
            if end != -1:
                for line in content[3:end].splitlines():
                    stripped = line.strip()
                    if stripped.startswith("name:"):
                        name = stripped.split(":", 1)[1].strip().strip("'").strip('"') or name
                    if stripped.startswith("description:"):
                        description = stripped.split(":", 1)[1].strip().strip("'").strip('"')
    except Exception:
        pass
    return {"name": name, "category": category, "description": description, "path": remote_prefix + skill_path, "directoryName": directory_name}

def list_installed():
    skills = []
    if not os.path.isdir(skills_root):
        return skills
    for category in sorted(os.listdir(skills_root)):
        category_path = os.path.join(skills_root, category)
        if not os.path.isdir(category_path):
            continue
        direct = os.path.join(category_path, "SKILL.md")
        if os.path.isfile(direct):
            skills.append(read_meta(category_path, "", category))
            continue
        for directory_name in sorted(os.listdir(category_path)):
            skill_path = os.path.join(category_path, directory_name)
            if os.path.isdir(skill_path) and os.path.isfile(os.path.join(skill_path, "SKILL.md")):
                skills.append(read_meta(skill_path, category, directory_name))
    return skills

def under_root(path):
    try:
        root = os.path.realpath(skills_root)
        candidate = os.path.realpath(path)
        return candidate == root or candidate.startswith(root + os.sep)
    except Exception:
        return False

def fail(target, code, error):
    return {"success": False, "action": target.get("action"), "target": target, "name": target.get("name") or "", "category": target.get("category"), "code": code, "error": error}

def ok(target, changed, skill=None):
    return {"success": True, "action": target.get("action"), "target": target, "name": (skill or {}).get("name") or target.get("name") or "", "category": (skill or {}).get("category") or target.get("category"), "changed": changed, "skill": skill}

def unique(target, matches):
    dedup = {}
    for skill in matches:
        dedup[skill["path"]] = skill
    values = list(dedup.values())
    if not values:
        return None
    if len(values) == 1:
        return values[0]
    labels = ", ".join(sorted([f"{s.get('category')}/{s.get('directoryName')}" for s in values]))
    return fail(target, "ambiguous-skill", f"Skill target \"{target.get('name')}\" is ambiguous. Matches: {labels}.")

def resolve_installed(target, installed):
    path = target.get("path")
    if path:
        raw = path[len(remote_prefix):] if path.startswith(remote_prefix) else path
        raw = raw.replace("$HOME/", os.path.expanduser("~/"), 1)
        candidate = os.path.abspath(os.path.expanduser(raw))
        if not under_root(candidate):
            return fail(target, "invalid-target", "Skill path is outside the selected profile.")
        if not os.path.isfile(os.path.join(candidate, "SKILL.md")):
            return None
        rel = os.path.relpath(candidate, skills_root).split(os.sep)
        category = rel[0] if len(rel) >= 2 else ""
        directory_name = rel[1] if len(rel) >= 2 else rel[0]
        return read_meta(candidate, category, directory_name)
    matches = []
    category = norm(target.get("category"))
    directory_name = norm(target.get("directoryName"))
    name = norm(target.get("name"))
    for skill in installed:
        if category and directory_name and norm(skill.get("category")) == category and norm(skill.get("directoryName")) == directory_name:
            matches.append(skill)
        if category and name and norm(skill.get("category")) == category and norm(skill.get("name")) == name:
            matches.append(skill)
    if matches:
        return unique(target, matches)
    return unique(target, [skill for skill in installed if norm(skill.get("name")) == name])

def validate(target):
    if not isinstance(target, dict) or target.get("action") not in ("install", "uninstall"):
        return fail(target if isinstance(target, dict) else {"action": "install", "name": ""}, "invalid-target", "Skill mutation target is invalid.")
    if not (target.get("name") or "").strip():
        return fail(target, "invalid-target", "Skill mutation target requires a name.")
    if target.get("category") and not safe_segment(target.get("category")):
        return fail(target, "invalid-target", "Skill category is invalid.")
    if target.get("directoryName") and not safe_segment(target.get("directoryName")):
        return fail(target, "invalid-target", "Skill directory name is invalid.")
    return None

def run_install(target):
    args = ["hermes"]
    if profile and profile != "default":
        args.extend(["-p", profile])
    identifier = target.get("name") or ""
    if target.get("category") and target.get("directoryName"):
        identifier = f"{target.get('category')}/{target.get('directoryName')}"
    elif target.get("directoryName"):
        identifier = target.get("directoryName")
    args.extend(["skills", "install", identifier, "--yes"])
    try:
        proc = subprocess.run(args, text=True, capture_output=True, timeout=120)
        if proc.returncode != 0:
            error = (proc.stderr or proc.stdout or "Hermes skill install failed.").strip()
            return fail(target, "command-failed", error)
        return ok(target, True)
    except subprocess.TimeoutExpired:
        return fail(target, "timeout", "Hermes skill install timed out.")
    except Exception as exc:
        return fail(target, "command-failed", str(exc))

results = []
installed = list_installed()
for target in targets:
    invalid = validate(target)
    if invalid:
        results.append(invalid)
        continue
    if target.get("action") == "install":
        existing = resolve_installed(target, installed)
        if isinstance(existing, dict) and existing.get("success") is False:
            results.append(existing)
            continue
        if existing:
            results.append(ok(target, False, existing))
            continue
        results.append(run_install(target))
        installed = list_installed()
        continue
    match = resolve_installed(target, installed)
    if isinstance(match, dict) and match.get("success") is False:
        results.append(match)
        continue
    if not match:
        results.append(fail(target, "not-found", f"Installed skill \"{target.get('name')}\" was not found."))
        continue
    raw_path = match.get("path", "")
    skill_path = raw_path[len(remote_prefix):] if raw_path.startswith(remote_prefix) else raw_path
    if not under_root(skill_path) or not os.path.isfile(os.path.join(skill_path, "SKILL.md")):
        results.append(fail(target, "invalid-target", "Installed skill target is invalid."))
        continue
    try:
        shutil.rmtree(skill_path)
        category_dir = os.path.dirname(skill_path)
        try:
            if under_root(category_dir) and not os.listdir(category_dir):
                os.rmdir(category_dir)
        except Exception:
            pass
        results.append(ok(target, True, match))
        installed = list_installed()
    except Exception as exc:
        results.append(fail(target, "write-failed", str(exc)))
updated = len([r for r in results if r.get("success") and r.get("changed")])
failed = len([r for r in results if not r.get("success")])
print(json.dumps({"success": failed == 0, "updated": updated, "failed": failed, "results": results}))
`;

  try {
    const out = await sshPython(
      config,
      script,
      pythonJsonInput({ profile, targets }),
      120000,
    );
    return JSON.parse(out.trim() || "{}") as SkillMutationBatchResult;
  } catch (err) {
    const results = targets.map((target) => ({
      success: false as const,
      action: target.action,
      target,
      name: target.name,
      category: target.category,
      code: "command-failed" as const,
      error: (err as Error).message,
    }));
    return { success: false, updated: 0, failed: results.length, results };
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
        directoryName: r.directoryName || r.directory_name || r.name || "",
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

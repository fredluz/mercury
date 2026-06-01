import { execFileSync } from "child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, join, relative, resolve } from "path";
import type {
  InstalledSkillSummary,
  SkillAssociatedFile,
  SkillMetadata,
  SkillMutationBatchResult,
  SkillMutationErrorCode,
  SkillMutationItemResult,
  SkillMutationTarget,
} from "../shared/skills";
import { homedir } from "os";
import { HERMES_HOME, HERMES_PYTHON, HERMES_SCRIPT, HERMES_REPO, getEnhancedPath } from "./install/paths";
import { profileHome } from "./utils";
import {
  isInside,
  isSafeSegment,
  safeDestinationParent,
  safeExistingMutationPath,
} from "./skills/path-safety";
export { prepareSkillMarkdownImport, isValidSkillImportProfile, importSkillMarkdown } from "./skills/importer";
export { importSkillDirectory } from "./skills/directory-importer";

export interface InstalledSkill extends InstalledSkillSummary {}

export interface SkillSearchResult {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
  directoryName: string;
}

type IndexedSkill = InstalledSkill & { resolvedPath: string };

type SkillIndex = {
  skills: IndexedSkill[];
  byPath: Map<string, IndexedSkill>;
  byCategoryDirectory: Map<string, IndexedSkill[]>;
  byCategoryName: Map<string, IndexedSkill[]>;
  byName: Map<string, IndexedSkill[]>;
};

/**
 * Parse SKILL.md frontmatter (YAML between --- markers) for name/description.
 */
function parseSkillFrontmatter(content: string): {
  name: string;
  description: string;
} {
  const result = { name: "", description: "" };

  // Check for YAML frontmatter
  if (!content.startsWith("---")) {
    // Fall back to first heading and first paragraph
    const headingMatch = content.match(/^#\s+(.+)/m);
    if (headingMatch) result.name = headingMatch[1].trim();
    const paraMatch = content.match(/^(?!#)(?!---).+/m);
    if (paraMatch) result.description = paraMatch[0].trim().slice(0, 120);
    return result;
  }

  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return result;

  const frontmatter = content.slice(3, endIdx);

  const nameMatch = frontmatter.match(/^\s*name:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (nameMatch) result.name = nameMatch[1].trim();

  const descMatch = frontmatter.match(
    /^\s*description:\s*["']?([^"'\n]+)["']?\s*$/m,
  );
  if (descMatch) result.description = descMatch[1].trim();

  return result;
}

function readSkillAt(skillPath: string, category: string, directoryName: string): InstalledSkill | null {
  const skillFile = join(skillPath, "SKILL.md");
  if (!existsSync(skillFile)) return null;

  try {
    const content = readFileSync(skillFile, "utf-8").slice(0, 4000);
    const meta = parseSkillFrontmatter(content);
    return {
      name: meta.name || directoryName,
      category,
      description: meta.description || "",
      path: skillPath,
      directoryName,
    };
  } catch {
    return {
      name: directoryName,
      category,
      description: "",
      path: skillPath,
      directoryName,
    };
  }
}

/**
 * Walk the skills directory to find all installed skills.
 * Structure: skills/<category>/<skill-name>/SKILL.md
 */
export function listInstalledSkills(profile?: string): InstalledSkill[] {
  const skillsDir = join(profileHome(profile), "skills");
  if (!existsSync(skillsDir)) return [];

  const skills: InstalledSkill[] = [];

  try {
    const categories = readdirSync(skillsDir);

    for (const category of categories) {
      const categoryPath = join(skillsDir, category);
      if (!statSync(categoryPath).isDirectory()) continue;

      const entries = readdirSync(categoryPath);
      for (const entry of entries) {
        const entryPath = join(categoryPath, entry);
        if (!statSync(entryPath).isDirectory()) continue;

        const skill = readSkillAt(entryPath, category, entry);
        if (skill) skills.push(skill);
      }
    }
  } catch {
    // ignore
  }

  return skills.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

/**
 * Get the full content of a SKILL.md for the detail view.
 */
export function getSkillContent(skillPath: string): string {
  const skillFile = join(skillPath, "SKILL.md");
  if (!existsSync(skillFile)) return "";

  try {
    return readFileSync(skillFile, "utf-8");
  } catch {
    return "";
  }
}

function unavailableSkillMetadata(skillPath: string, reason: string): SkillMetadata {
  return {
    path: skillPath,
    scripts: [],
    references: [],
    metadataAvailable: false,
    unavailableReason: reason,
  };
}

function listAssociatedFiles(
  skillPath: string,
  directoryName: "scripts" | "references",
): SkillAssociatedFile[] {
  const directoryPath = join(skillPath, directoryName);
  if (!existsSync(directoryPath)) return [];

  let directoryStat;
  try {
    directoryStat = statSync(directoryPath);
  } catch {
    return [];
  }
  if (!directoryStat.isDirectory()) return [];

  try {
    return readdirSync(directoryPath)
      .flatMap((entry) => {
        try {
          const entryPath = join(directoryPath, entry);
          const entryStat = statSync(entryPath);
          return [
            {
              name: entry,
              relativePath: `${directoryName}/${entry}`,
              kind: entryStat.isDirectory() ? "directory" : "file",
            } satisfies SkillAssociatedFile,
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Get associated scripts/references for a skill directory.
 */
export function getSkillMetadata(skillPath: string): SkillMetadata {
  if (skillPath.includes("\0")) {
    return unavailableSkillMetadata(
      skillPath,
      "Skill metadata is unavailable for this skill.",
    );
  }

  try {
    const skillFile = join(skillPath, "SKILL.md");
    if (
      !existsSync(skillPath) ||
      !statSync(skillPath).isDirectory() ||
      !existsSync(skillFile) ||
      !statSync(skillFile).isFile()
    ) {
      return unavailableSkillMetadata(
        skillPath,
        "Skill metadata is unavailable for this skill.",
      );
    }

    return {
      path: skillPath,
      scripts: listAssociatedFiles(skillPath, "scripts"),
      references: listAssociatedFiles(skillPath, "references"),
      metadataAvailable: true,
    };
  } catch {
    return unavailableSkillMetadata(
      skillPath,
      "Skill metadata is unavailable for this skill.",
    );
  }
}

/**
 * Search the skill registry via the hermes CLI.
 */
export function searchSkills(query: string): SkillSearchResult[] {
  try {
    const output = execFileSync(
      HERMES_PYTHON,
      [HERMES_SCRIPT, "skills", "browse", "--query", query, "--json"],
      {
        cwd: HERMES_REPO,
        env: {
          ...process.env,
          PATH: getEnhancedPath(),
          HOME: homedir(),
          HERMES_HOME,
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      },
    );

    const text = output.toString().trim();
    if (!text) return [];

    // Try to parse JSON output
    try {
      const results = JSON.parse(text);
      if (Array.isArray(results)) {
        return results.map((r: Record<string, string>) => ({
          name: r.name || "",
          description: r.description || "",
          category: r.category || "",
          source: r.source || "",
          installed: false,
          directoryName: r.directoryName || r.directory_name || r.name || "",
        }));
      }
    } catch {
      // If JSON parsing fails, the CLI may not support --json flag
      // Fall back to listing bundled skills that match
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * List bundled skills from the hermes-agent repo.
 */
export function listBundledSkills(): SkillSearchResult[] {
  const bundledDir = join(HERMES_REPO, "skills");
  if (!existsSync(bundledDir)) return [];

  const skills: SkillSearchResult[] = [];

  try {
    const categories = readdirSync(bundledDir);

    for (const category of categories) {
      const catPath = join(bundledDir, category);
      if (!statSync(catPath).isDirectory()) continue;

      const entries = readdirSync(catPath);
      for (const entry of entries) {
        const entryPath = join(catPath, entry);
        if (!statSync(entryPath).isDirectory()) continue;

        const skill = readSkillAt(entryPath, category, entry);
        if (!skill) continue;

        skills.push({
          name: skill.name,
          description: skill.description,
          category,
          source: "bundled",
          installed: false,
          directoryName: entry,
        });
      }
    }
  } catch {
    // ignore
  }

  return skills.sort(
    (a, b) =>
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

function normalized(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function categoryKey(category: string | undefined, value: string | undefined): string {
  return `${normalized(category)}\u0000${normalized(value)}`;
}

function pushIndex(map: Map<string, IndexedSkill[]>, key: string, skill: IndexedSkill): void {
  if (!key || key === "\u0000") return;
  const existing = map.get(key) || [];
  existing.push(skill);
  map.set(key, existing);
}

function buildIndex(skills: InstalledSkill[]): SkillIndex {
  const index: SkillIndex = {
    skills: [],
    byPath: new Map(),
    byCategoryDirectory: new Map(),
    byCategoryName: new Map(),
    byName: new Map(),
  };

  for (const skill of skills) {
    const indexed = { ...skill, resolvedPath: resolve(skill.path) };
    index.skills.push(indexed);
    index.byPath.set(indexed.resolvedPath, indexed);
    pushIndex(index.byCategoryDirectory, categoryKey(skill.category, skill.directoryName), indexed);
    pushIndex(index.byCategoryName, categoryKey(skill.category, skill.name), indexed);
    pushIndex(index.byName, normalized(skill.name), indexed);
  }

  return index;
}

function bundledSkillsWithPaths(): InstalledSkill[] {
  return listBundledSkills().map((skill) => ({
    name: skill.name,
    category: skill.category,
    description: skill.description,
    path: join(HERMES_REPO, "skills", skill.category, skill.directoryName),
    directoryName: skill.directoryName,
  }));
}

function failure(
  target: SkillMutationTarget,
  code: SkillMutationErrorCode,
  error: string,
): SkillMutationItemResult {
  return {
    success: false,
    action: target.action,
    target,
    name: target.name,
    category: target.category,
    code,
    error,
  };
}

function success(
  target: SkillMutationTarget,
  changed: boolean,
  skill?: InstalledSkill,
): SkillMutationItemResult {
  return {
    success: true,
    action: target.action,
    target,
    name: skill?.name || target.name,
    category: skill?.category || target.category,
    changed,
    skill,
  };
}

function uniqueMatch(
  target: SkillMutationTarget,
  matches: IndexedSkill[],
): IndexedSkill | SkillMutationItemResult | null {
  const unique = [...new Map(matches.map((skill) => [skill.resolvedPath, skill])).values()];
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  const labels = unique
    .map((skill) => `${skill.category}/${skill.directoryName}`)
    .sort()
    .join(", ");
  return failure(
    target,
    "ambiguous-skill",
    `Skill target "${target.name}" is ambiguous. Matches: ${labels}.`,
  );
}

function resolveIndexedTarget(
  target: SkillMutationTarget,
  index: SkillIndex,
  skillsRoot: string,
): IndexedSkill | SkillMutationItemResult | null {
  if (target.path) {
    if (target.path.includes("\0")) {
      return failure(target, "invalid-target", "Skill path is invalid.");
    }
    const resolvedPath = resolve(target.path);
    if (!isInside(skillsRoot, resolvedPath)) {
      return failure(target, "invalid-target", "Skill path is outside the selected profile.");
    }
    const fromIndex = index.byPath.get(resolvedPath);
    if (fromIndex) return fromIndex;
    if (existsSync(join(resolvedPath, "SKILL.md"))) {
      const rel = relative(skillsRoot, resolvedPath).split(/[\\/]/);
      if (rel.length >= 2) {
        const skill = readSkillAt(resolvedPath, rel[0], rel[1]);
        if (skill) return { ...skill, resolvedPath };
      }
    }
    return null;
  }

  const matches: IndexedSkill[] = [];
  if (target.category && target.directoryName) {
    matches.push(...(index.byCategoryDirectory.get(categoryKey(target.category, target.directoryName)) || []));
  }
  if (target.category && target.name) {
    matches.push(...(index.byCategoryName.get(categoryKey(target.category, target.name)) || []));
  }
  if (matches.length > 0) return uniqueMatch(target, matches);
  return uniqueMatch(target, index.byName.get(normalized(target.name)) || []);
}

function resolveBundledTarget(
  target: SkillMutationTarget,
  bundledIndex: SkillIndex,
): IndexedSkill | SkillMutationItemResult | null {
  const matches: IndexedSkill[] = [];
  if (target.category && target.directoryName) {
    matches.push(...(bundledIndex.byCategoryDirectory.get(categoryKey(target.category, target.directoryName)) || []));
  }
  if (target.category && target.name) {
    matches.push(...(bundledIndex.byCategoryName.get(categoryKey(target.category, target.name)) || []));
  }
  if (matches.length > 0) return uniqueMatch(target, matches);
  return uniqueMatch(target, bundledIndex.byName.get(normalized(target.name)) || []);
}

function commandFailureCode(error: string): SkillMutationErrorCode {
  return /timed out/i.test(error) ? "timeout" : "command-failed";
}

function validateTarget(target: SkillMutationTarget): SkillMutationItemResult | null {
  if (!target || (target.action !== "install" && target.action !== "uninstall")) {
    return failure(
      target || { action: "install", name: "" },
      "invalid-target",
      "Skill mutation target is invalid.",
    );
  }
  if (!target.name?.trim()) {
    return failure(target, "invalid-target", "Skill mutation target requires a name.");
  }
  if (target.category && !isSafeSegment(target.category)) {
    return failure(target, "invalid-target", "Skill category is invalid.");
  }
  if (target.directoryName && !isSafeSegment(target.directoryName)) {
    return failure(target, "invalid-target", "Skill directory name is invalid.");
  }
  return null;
}

function summarizeBatch(results: SkillMutationItemResult[]): SkillMutationBatchResult {
  const updated = results.filter((result) => result.success && result.changed).length;
  const failed = results.filter((result) => !result.success).length;
  return { success: failed === 0, updated, failed, results };
}

export async function mutateLocalSkills(
  targets: SkillMutationTarget[],
  profile?: string,
): Promise<SkillMutationBatchResult> {
  const skillsRoot = resolve(profileHome(profile), "skills");
  const bundledRoot = resolve(HERMES_REPO, "skills");
  const results: SkillMutationItemResult[] = [];
  let installedIndex = buildIndex(listInstalledSkills(profile));
  const bundledIndex = buildIndex(bundledSkillsWithPaths());

  for (const target of targets) {
    const invalid = validateTarget(target);
    if (invalid) {
      results.push(invalid);
      continue;
    }

    if (target.action === "install") {
      const source = resolveBundledTarget(target, bundledIndex);
      if (source && "success" in source) {
        results.push(source);
        continue;
      }

      if (source) {
        if (!isInside(bundledRoot, source.resolvedPath) || !existsSync(join(source.resolvedPath, "SKILL.md"))) {
          results.push(failure(target, "invalid-target", "Bundled skill source is invalid."));
          continue;
        }

        mkdirSync(skillsRoot, { recursive: true });
        const destination = resolve(skillsRoot, source.category, source.directoryName);
        if (!isInside(skillsRoot, destination)) {
          results.push(failure(target, "invalid-target", "Skill destination is invalid."));
          continue;
        }
        mkdirSync(dirname(destination), { recursive: true });
        if (!safeDestinationParent(skillsRoot, destination)) {
          results.push(failure(target, "invalid-target", "Skill destination is not safe to write."));
          continue;
        }
        if (existsSync(join(destination, "SKILL.md"))) {
          const installed = readSkillAt(destination, source.category, source.directoryName) || source;
          results.push(success(target, false, installed));
          continue;
        }
        if (existsSync(destination)) {
          results.push(
            failure(
              target,
              "duplicate",
              `Cannot install ${source.category}/${source.directoryName}: destination already exists but is not a skill.`,
            ),
          );
          continue;
        }

        try {
          cpSync(source.resolvedPath, destination, { recursive: true, errorOnExist: true, force: false });
          const installed = readSkillAt(destination, source.category, source.directoryName) || {
            name: source.name,
            category: source.category,
            description: source.description,
            path: destination,
            directoryName: source.directoryName,
          };
          results.push(success(target, true, installed));
          installedIndex = buildIndex(listInstalledSkills(profile));
        } catch (err) {
          results.push(failure(target, "write-failed", (err as Error).message));
        }
        continue;
      }

      const cliResult = installSkill(target.name, profile);
      if (cliResult.success) {
        results.push(success(target, true));
        installedIndex = buildIndex(listInstalledSkills(profile));
      } else {
        const error = cliResult.error || `Failed to install skill ${target.name}.`;
        results.push(failure(target, commandFailureCode(error), error));
      }
      continue;
    }

    const match = resolveIndexedTarget(target, installedIndex, skillsRoot);
    if (match && "success" in match) {
      results.push(match);
      continue;
    }
    if (!match) {
      results.push(failure(target, "not-found", `Installed skill "${target.name}" was not found.`));
      continue;
    }

    try {
      if (
        !safeExistingMutationPath(skillsRoot, match.resolvedPath) ||
        !existsSync(join(match.resolvedPath, "SKILL.md"))
      ) {
        results.push(failure(target, "invalid-target", "Installed skill target is invalid."));
        continue;
      }
      rmSync(match.resolvedPath, { recursive: true, force: false });
      const categoryPath = dirname(match.resolvedPath);
      try {
        if (safeExistingMutationPath(skillsRoot, categoryPath) && readdirSync(categoryPath).length === 0) {
          rmSync(categoryPath, { recursive: false, force: false });
        }
      } catch {
        // Best-effort cleanup of empty category directory.
      }
      results.push(success(target, true, match));
      installedIndex = buildIndex(listInstalledSkills(profile));
    } catch (err) {
      results.push(failure(target, "write-failed", (err as Error).message));
    }
  }

  return summarizeBatch(results);
}

export function installSkill(
  identifier: string,
  profile?: string,
): { success: boolean; error?: string } {
  try {
    const args = [HERMES_SCRIPT, "skills", "install", identifier, "--yes"];
    if (profile && profile !== "default") {
      args.splice(1, 0, "-p", profile);
    }

    execFileSync(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 60000,
    });
    return { success: true };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { success: false, error: msg.trim() };
  }
}

export function uninstallSkill(
  name: string,
  profile?: string,
): { success: boolean; error?: string } {
  try {
    const args = [HERMES_SCRIPT, "skills", "uninstall", name];
    if (profile && profile !== "default") {
      args.splice(1, 0, "-p", profile);
    }

    execFileSync(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
      },
      stdio: "pipe",
      timeout: 30000,
    });
    return { success: true };
  } catch (err) {
    const msg =
      (err as { stderr?: Buffer }).stderr?.toString() || (err as Error).message;
    return { success: false, error: msg.trim() };
  }
}

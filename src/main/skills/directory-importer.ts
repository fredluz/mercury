import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join, resolve } from "path";
import type {
  ParsedSkillSource,
  SkillSourceCandidate,
  SkillSourceImportResult,
} from "../../shared/skills";
import { profileHome } from "../utils";
import {
  isValidSkillCategory,
  isValidSkillImportProfile,
  isValidSkillName,
  prepareSkillMarkdownImport,
} from "./importer";
import {
  isInside,
  isSafeRelativeFilePath,
  safeDestinationParent,
  safeExistingMutationPath,
} from "./path-safety";

export type SkillDirectoryImportFile = {
  relativePath: string;
  contentBase64: string;
  executable?: boolean;
};

export type SkillDirectoryImportRequest = {
  files: SkillDirectoryImportFile[];
  name?: string;
  category?: string;
  description?: string;
  directoryName?: string;
  overwrite?: boolean;
  source?: ParsedSkillSource;
  candidate?: SkillSourceCandidate;
};

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeRelativeFilePath(relativePath: string): string {
  return relativePath.split(/[\\/]+/).join("/");
}

function failure(
  code: Extract<SkillSourceImportResult, { success: false }>["code"],
  error: string,
): Extract<SkillSourceImportResult, { success: false }> {
  return { success: false, code, error };
}

function fallbackSource(): ParsedSkillSource {
  return {
    kind: "github",
    owner: "local",
    repo: "directory",
    originalSource: "directory-import",
    pathKind: "repo",
  };
}

function fallbackCandidate(
  request: SkillDirectoryImportRequest,
  source: ParsedSkillSource,
  skill: Extract<SkillSourceImportResult, { success: true }>["skill"],
): SkillSourceCandidate {
  return {
    candidateId: `github:${source.owner}/${source.repo}@directory:${skill.category}/${skill.directoryName}/SKILL.md`,
    name: skill.name,
    category: skill.category,
    directoryName: skill.directoryName,
    description: skill.description,
    skillPath: `${skill.category}/${skill.directoryName}/SKILL.md`,
    sourceLabel: request.candidate?.sourceLabel || source.originalSource,
    commitSha: "directory",
    valid: true,
  };
}

function ensureDirectoryWithinTemp(tempDir: string, normalizedRelativePath: string): string {
  let current = tempDir;
  chmodSync(current, 0o755);
  const parts = normalizedRelativePath.split("/").slice(0, -1);
  for (const part of parts) {
    current = join(current, part);
    if (!existsSync(current)) {
      mkdirSync(current, { recursive: false, mode: 0o755 });
    }
    chmodSync(current, 0o755);
  }
  return current;
}

function writeFilesToTempDir(
  tempDir: string,
  files: Array<{ relativePath: string; content: Buffer }>,
): void {
  const written = new Set<string>();
  for (const file of files) {
    if (written.has(file.relativePath)) {
      throw new Error(`Duplicate file path in skill import: ${file.relativePath}`);
    }
    written.add(file.relativePath);

    ensureDirectoryWithinTemp(tempDir, file.relativePath);
    const target = resolve(tempDir, ...file.relativePath.split("/"));
    if (!isInside(tempDir, target)) {
      throw new Error(`Resolved file path escapes the skill directory: ${file.relativePath}`);
    }
    writeFileSync(target, file.content, { mode: 0o644 });
    chmodSync(target, 0o644);
  }
}

function rollbackRename(backupDir: string | undefined, skillDir: string): void {
  if (!backupDir) return;
  try {
    if (!pathExists(skillDir) && pathExists(backupDir)) {
      renameSync(backupDir, skillDir);
    }
  } catch {
    // Best effort rollback; original error is more useful to callers.
  }
}

export function importSkillDirectory(
  request: SkillDirectoryImportRequest,
  profile?: string,
): SkillSourceImportResult {
  if (!isValidSkillImportProfile(profile)) {
    return failure("write-failed", "Invalid profile name for skill directory import.");
  }

  if (!Array.isArray(request.files) || request.files.length === 0) {
    return failure("invalid-markdown", "Skill directory import requires files including SKILL.md.");
  }

  const normalizedFiles = request.files.map((file) => ({
    originalRelativePath: file.relativePath,
    relativePath: normalizeRelativeFilePath(file.relativePath),
    contentBase64: file.contentBase64,
  }));
  const skillMarkdownFile = normalizedFiles.find((file) => file.relativePath === "SKILL.md");
  if (!skillMarkdownFile) {
    return failure("invalid-markdown", "Skill directory import requires a top-level SKILL.md file.");
  }

  for (const file of normalizedFiles) {
    if (!isSafeRelativeFilePath(file.originalRelativePath)) {
      return failure("write-failed", `Unsafe file path in skill import: ${file.originalRelativePath}`);
    }
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
    return failure("invalid-category", "Category must be a slug: 1-64 lowercase letters, numbers, underscores, or hyphens.");
  }
  if (!isValidSkillName(directoryName)) {
    return failure("invalid-name", "Skill directory name must be a slug: 2-64 lowercase letters, numbers, underscores, or hyphens.");
  }

  const skillsRoot = resolve(profileHome(profile), "skills");
  const categoryDir = resolve(skillsRoot, prepared.category);
  const skillDir = resolve(categoryDir, directoryName);
  if (!isInside(skillsRoot, skillDir)) {
    return failure("write-failed", "Resolved skill path escapes the profile skills directory.");
  }

  const decodedFiles: Array<{ relativePath: string; content: Buffer }> = [];
  const seen = new Set<string>();
  for (const file of normalizedFiles) {
    if (!isSafeRelativeFilePath(file.originalRelativePath, skillDir)) {
      return failure("write-failed", `Unsafe file path in skill import: ${file.originalRelativePath}`);
    }
    if (seen.has(file.relativePath)) {
      return failure("write-failed", `Duplicate file path in skill import: ${file.relativePath}`);
    }
    seen.add(file.relativePath);
    decodedFiles.push({
      relativePath: file.relativePath,
      content:
        file.relativePath === "SKILL.md"
          ? Buffer.from(prepared.markdown, "utf-8")
          : Buffer.from(file.contentBase64, "base64"),
    });
  }

  const destinationExists = pathExists(skillDir);
  if (destinationExists && !request.overwrite) {
    return failure("duplicate", `Skill ${prepared.category}/${directoryName} already exists.`);
  }
  if (destinationExists && !safeExistingMutationPath(skillsRoot, skillDir)) {
    return failure("write-failed", "Existing skill destination is not safe to replace.");
  }

  let tempDir = "";
  let backupDir: string | undefined;
  let tempMoved = false;
  try {
    mkdirSync(skillsRoot, { recursive: true, mode: 0o755 });
    mkdirSync(categoryDir, { recursive: true, mode: 0o755 });

    if (!safeDestinationParent(skillsRoot, skillDir)) {
      return failure("write-failed", "Skill destination is not safe to write.");
    }

    tempDir = mkdtempSync(join(categoryDir, ".mercury-import-"));
    chmodSync(tempDir, 0o755);
    if (!safeDestinationParent(skillsRoot, tempDir)) {
      return failure("write-failed", "Temporary skill destination is not safe to write.");
    }

    writeFilesToTempDir(tempDir, decodedFiles);

    if (destinationExists) {
      backupDir = `${skillDir}.mercury-backup-${process.pid}-${Date.now()}`;
      renameSync(skillDir, backupDir);
    }
    renameSync(tempDir, skillDir);
    tempMoved = true;

    if (backupDir) {
      rmSync(backupDir, { recursive: true, force: true });
    }

    const source = request.source || fallbackSource();
    const skill = {
      name: prepared.name,
      category: prepared.category,
      description: prepared.description,
      path: skillDir,
      directoryName,
    };
    return {
      success: true,
      skill,
      source,
      candidate: request.candidate || fallbackCandidate(request, source, skill),
    };
  } catch (err) {
    rollbackRename(backupDir, skillDir);
    return failure("write-failed", (err as Error).message);
  } finally {
    if (tempDir && !tempMoved) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of the temp directory created by this import.
      }
    }
  }
}

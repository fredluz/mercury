import { execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import type {
  PreparedSkillMarkdownImport,
  SkillMarkdownImportRequest,
  SkillMarkdownImportResult,
} from "../shared/skills";
import {
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  HERMES_REPO,
  getEnhancedPath,
} from "./installer";
import { profileHome } from "./utils";

export interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

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

const SKILL_MARKDOWN_MAX_LENGTH = 200_000;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SKILL_CATEGORY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
type SkillMarkdownImportFailure = Extract<
  SkillMarkdownImportResult,
  { success: false }
>;

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

function parseFrontmatterBlock(content: string): {
  frontmatter: string;
  body: string;
} | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return null;
  }
  const delimiter = content.match(/\r?\n---\s*(?:\r?\n|$)/);
  if (!delimiter?.index) return null;
  const endIdx = delimiter.index;
  const delimiterEnd = endIdx + delimiter[0].length;
  let body = content.slice(delimiterEnd);
  if (body.startsWith("\r\n")) body = body.slice(2);
  else if (body.startsWith("\n")) body = body.slice(1);
  return { frontmatter: content.slice(3, endIdx), body };
}

function readFrontmatterField(frontmatter: string, field: string): string {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = frontmatter.match(
    new RegExp(`^\\s*${escaped}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"),
  );
  return match?.[1]?.trim() || "";
}

function replaceOrAppendFrontmatterField(
  frontmatter: string,
  field: string,
  value: string,
): string {
  const line = `${field}: ${yamlQuote(value)}`;
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}:.*$`, "m");
  if (re.test(frontmatter)) return frontmatter.replace(re, line);
  const trimmed = frontmatter.trim();
  return trimmed ? `${trimmed}\n${line}` : line;
}

function inferSkillName(markdown: string, frontmatterName: string): string {
  if (frontmatterName) return frontmatterName;
  const headingMatch = markdown.match(/^#\s+(.+)/m);
  return headingMatch?.[1]?.trim() || "";
}

function inferSkillDescription(
  requestDescription: string | undefined,
  frontmatterDescription: string,
  markdown: string,
): string {
  if (requestDescription?.trim()) return requestDescription.trim();
  if (frontmatterDescription) return frontmatterDescription;
  const paraMatch = markdown.match(/^(?!#)(?!---)\S.+/m);
  return paraMatch?.[0]?.trim().slice(0, 160) || "";
}

export function prepareSkillMarkdownImport(
  request: SkillMarkdownImportRequest,
):
  | SkillMarkdownImportFailure
  | { success: true; prepared: PreparedSkillMarkdownImport } {
  const markdown = request.markdown;
  if (
    typeof markdown !== "string" ||
    !markdown.trim() ||
    markdown.length > SKILL_MARKDOWN_MAX_LENGTH ||
    markdown.includes("\0")
  ) {
    return {
      success: false,
      code: "invalid-markdown",
      error: "Markdown is required, must be under 200,000 characters, and cannot contain NUL bytes.",
    };
  }

  const existingFrontmatter = parseFrontmatterBlock(markdown);
  const frontmatterName = existingFrontmatter
    ? readFrontmatterField(existingFrontmatter.frontmatter, "name")
    : "";
  const frontmatterDescription = existingFrontmatter
    ? readFrontmatterField(existingFrontmatter.frontmatter, "description")
    : "";
  const name = (request.name?.trim() || inferSkillName(markdown, frontmatterName)).trim();
  const category = (request.category?.trim() || "custom").trim();
  const description = inferSkillDescription(
    request.description,
    frontmatterDescription,
    existingFrontmatter?.body || markdown,
  );

  if (!SKILL_NAME_RE.test(name)) {
    return {
      success: false,
      code: "invalid-name",
      error: "Skill name must be a slug: 2-64 lowercase letters, numbers, underscores, or hyphens.",
    };
  }

  if (!SKILL_CATEGORY_RE.test(category)) {
    return {
      success: false,
      code: "invalid-category",
      error: "Category must be a slug: 1-64 lowercase letters, numbers, underscores, or hyphens.",
    };
  }

  let normalized: string;
  if (existingFrontmatter) {
    let frontmatter = replaceOrAppendFrontmatterField(
      existingFrontmatter.frontmatter,
      "name",
      name,
    );
    frontmatter = replaceOrAppendFrontmatterField(
      frontmatter,
      "description",
      description,
    );
    normalized = `---\n${frontmatter.trim()}\n---\n${existingFrontmatter.body}`;
  } else {
    normalized = `---\nname: ${yamlQuote(name)}\ndescription: ${yamlQuote(
      description,
    )}\n---\n${markdown}`;
  }

  return {
    success: true,
    prepared: { name, category, description, markdown: normalized },
  };
}

export function isValidSkillImportProfile(profile?: string): boolean {
  return !profile || profile === "default" || PROFILE_NAME_RE.test(profile);
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

        const skillFile = join(entryPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
          const content = readFileSync(skillFile, "utf-8").slice(0, 4000);
          const meta = parseSkillFrontmatter(content);

          skills.push({
            name: meta.name || entry,
            category,
            description: meta.description || "",
            path: entryPath,
          });
        } catch {
          skills.push({
            name: entry,
            category,
            description: "",
            path: entryPath,
          });
        }
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

        const skillFile = join(entryPath, "SKILL.md");
        if (!existsSync(skillFile)) continue;

        try {
          const content = readFileSync(skillFile, "utf-8").slice(0, 4000);
          const meta = parseSkillFrontmatter(content);

          skills.push({
            name: meta.name || entry,
            description: meta.description || "",
            category,
            source: "bundled",
            installed: false,
          });
        } catch {
          skills.push({
            name: entry,
            description: "",
            category,
            source: "bundled",
            installed: false,
          });
        }
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

export function importSkillMarkdown(
  request: SkillMarkdownImportRequest,
  profile?: string,
): SkillMarkdownImportResult {
  if (!isValidSkillImportProfile(profile)) {
    return {
      success: false,
      code: "write-failed",
      error: "Invalid profile name for skill import.",
    };
  }

  const preparedResult = prepareSkillMarkdownImport(request);
  if (!preparedResult.success) return preparedResult;

  const { prepared } = preparedResult;
  const skillsRoot = resolve(profileHome(profile), "skills");
  const skillDir = resolve(skillsRoot, prepared.category, prepared.name);
  const skillFile = resolve(skillDir, "SKILL.md");
  const rootWithSep = `${skillsRoot}${process.platform === "win32" ? "\\" : "/"}`;

  if (
    !(skillDir === skillsRoot || skillDir.startsWith(rootWithSep)) ||
    dirname(skillFile) !== skillDir
  ) {
    return {
      success: false,
      code: "write-failed",
      error: "Resolved skill path escapes the profile skills directory.",
    };
  }

  if (existsSync(skillFile) && !request.overwrite) {
    return {
      success: false,
      code: "duplicate",
      error: `Skill ${prepared.category}/${prepared.name} already exists.`,
    };
  }

  try {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(skillFile, prepared.markdown, "utf-8");
    return {
      success: true,
      skill: {
        name: prepared.name,
        category: prepared.category,
        description: prepared.description,
        path: skillDir,
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

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import type { PreparedSkillMarkdownImport, SkillMarkdownImportRequest, SkillMarkdownImportResult } from "../../shared/skills";
import { profileHome } from "../utils";

const SKILL_MARKDOWN_MAX_LENGTH = 200_000;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const SKILL_CATEGORY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
type SkillMarkdownImportFailure = Extract<
  SkillMarkdownImportResult,
  { success: false }
>;

export function isValidSkillImportProfile(profile?: string): boolean {
  return !profile || profile === "default" || PROFILE_NAME_RE.test(profile);
}

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

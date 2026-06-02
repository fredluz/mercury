// Client-side mirror of the SKILL.md metadata inference used by the main-process
// importer (src/main/skills/importer.ts). Kept in sync so the Add Skill modal can
// pre-fill the Name and Description fields the moment Markdown is pasted, without a
// round-trip to the main process.

export interface SkillMarkdownMeta {
  name: string;
  description: string;
}

function parseFrontmatterBlock(content: string): { frontmatter: string; body: string } | null {
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
  const match = frontmatter.match(new RegExp(`^\\s*${escaped}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  return match?.[1]?.trim() || "";
}

function inferSkillName(markdown: string, frontmatterName: string): string {
  if (frontmatterName) return frontmatterName;
  const headingMatch = markdown.match(/^#\s+(.+)/m);
  return headingMatch?.[1]?.trim() || "";
}

function inferSkillDescription(frontmatterDescription: string, body: string): string {
  if (frontmatterDescription) return frontmatterDescription;
  const paraMatch = body.match(/^(?!#)(?!---)\S.+/m);
  return paraMatch?.[0]?.trim().slice(0, 160) || "";
}

/**
 * Derives the skill name and description from pasted SKILL.md Markdown.
 * Prefers YAML frontmatter, then falls back to the first heading / paragraph.
 */
export function parseSkillMarkdownMeta(markdown: string): SkillMarkdownMeta {
  const frontmatterBlock = parseFrontmatterBlock(markdown);
  const frontmatterName = frontmatterBlock
    ? readFrontmatterField(frontmatterBlock.frontmatter, "name")
    : "";
  const frontmatterDescription = frontmatterBlock
    ? readFrontmatterField(frontmatterBlock.frontmatter, "description")
    : "";
  return {
    name: inferSkillName(markdown, frontmatterName),
    description: inferSkillDescription(frontmatterDescription, frontmatterBlock?.body || markdown),
  };
}

import { describe, expect, it } from "vitest";
import { parseSkillMarkdownMeta } from "./skillMarkdownMeta";

describe("parseSkillMarkdownMeta", () => {
  it("reads name and description from frontmatter", () => {
    const md = [
      "---",
      "name: article-thumbnail",
      "description: Generate a brand-consistent still thumbnail.",
      "---",
      "# Article Thumbnail Skill",
      "",
      "Body text.",
    ].join("\n");
    expect(parseSkillMarkdownMeta(md)).toEqual({
      name: "article-thumbnail",
      description: "Generate a brand-consistent still thumbnail.",
    });
  });

  it("strips surrounding quotes from frontmatter values", () => {
    const md = ['---', 'name: "my-skill"', "description: 'Does a thing'", "---", "# Heading"].join("\n");
    expect(parseSkillMarkdownMeta(md)).toEqual({
      name: "my-skill",
      description: "Does a thing",
    });
  });

  it("falls back to first heading and first paragraph when no frontmatter", () => {
    const md = "# Cool Skill\n\nThis is what it does.";
    expect(parseSkillMarkdownMeta(md)).toEqual({
      name: "Cool Skill",
      description: "This is what it does.",
    });
  });

  it("truncates inferred description to 160 chars", () => {
    const long = "x".repeat(200);
    const md = `# Heading\n\n${long}`;
    expect(parseSkillMarkdownMeta(md).description).toHaveLength(160);
  });

  it("returns empty strings when nothing can be inferred", () => {
    expect(parseSkillMarkdownMeta("")).toEqual({ name: "", description: "" });
  });
});

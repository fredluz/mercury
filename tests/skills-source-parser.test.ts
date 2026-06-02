import { existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import { parseSkillSource } from "../src/main/skills/source-parser";

describe("skill source parser", () => {
  it("parses GitHub owner/repo shorthand", () => {
    const result = parseSkillSource("owner/repo");

    expect(result).toEqual({
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
    });
  });

  it("parses owner/repo/skill shorthand and maps the trailing segment to the skill selector", () => {
    const result = parseSkillSource("mattpocock/skills/tdd");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "mattpocock",
      repo: "skills",
      pathKind: "repo",
      originalSource: "mattpocock/skills/tdd",
      skillSelector: "tdd",
    });
  });

  it("uses the final segment of a multi-level owner/repo subpath as the selector", () => {
    const result = parseSkillSource("owner/repo/skills/pdf");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "owner",
      repo: "repo",
      skillSelector: "pdf",
    });
  });

  it("parses npx skills add owner/repo/skill shorthand", () => {
    const result = parseSkillSource("npx skills add mattpocock/skills/tdd");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "mattpocock",
      repo: "skills",
      pathKind: "repo",
      skillSelector: "tdd",
    });
  });

  it("parses full GitHub repository URLs", () => {
    const result = parseSkillSource("https://github.com/owner/repo.git");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "owner",
      repo: "repo",
      pathKind: "repo",
      originalSource: "https://github.com/owner/repo.git",
    });
  });

  it("parses raw SKILL.md URLs", () => {
    const result = parseSkillSource(
      "https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md",
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "anthropics",
      repo: "skills",
      pathKind: "raw",
      rawRefAndPath: ["main", "skills", "pdf", "SKILL.md"],
    });
  });

  it("keeps GitHub tree ref/path segments unresolved", () => {
    const result = parseSkillSource(
      "https://github.com/owner/repo/tree/feature/branch/skills/pdf",
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "owner",
      repo: "repo",
      pathKind: "tree",
      rawRefAndPath: ["feature", "branch", "skills", "pdf"],
    });
    expect(result.source.ref).toBeUndefined();
    expect(result.source.path).toBeUndefined();
  });

  it("keeps GitHub blob ref/path segments unresolved", () => {
    const result = parseSkillSource(
      "https://github.com/owner/repo/blob/release/v1/skills/pdf/SKILL.md",
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "owner",
      repo: "repo",
      pathKind: "blob",
      rawRefAndPath: ["release", "v1", "skills", "pdf", "SKILL.md"],
    });
    expect(result.source.ref).toBeUndefined();
    expect(result.source.path).toBeUndefined();
  });

  it("parses npx skills add commands and ignores install flags", () => {
    const result = parseSkillSource(
      "npx skills add owner/repo --skill pdf -g -y -a claude-code",
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "owner",
      repo: "repo",
      pathKind: "repo",
      originalSource:
        "npx skills add owner/repo --skill pdf -g -y -a claude-code",
      skillSelector: "pdf",
    });
  });

  it("parses npx -y skills add commands with quoted URLs and --skill=value", () => {
    const result = parseSkillSource(
      'npx -y skills add "https://github.com/owner/repo" --skill=pdf',
    );

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "owner",
      repo: "repo",
      pathKind: "repo",
      skillSelector: "pdf",
    });
  });

  it("parses gh skill install commands", () => {
    const result = parseSkillSource("gh skill install OWNER/REPO SKILL");

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.source).toMatchObject({
      owner: "OWNER",
      repo: "REPO",
      pathKind: "repo",
      skillSelector: "SKILL",
    });
  });

  it("rejects unsupported sources", () => {
    expect(parseSkillSource("https://gitlab.com/owner/repo")).toMatchObject({
      success: false,
      code: "unsupported-source",
    });
    expect(parseSkillSource("./local/path")).toMatchObject({
      success: false,
      code: "unsupported-source",
    });
  });

  it("treats pasted commands as data and never executes them", () => {
    const marker = join(tmpdir(), `mercury-parser-never-exec-${Date.now()}`);
    rmSync(marker, { force: true });

    const result = parseSkillSource(
      `npx skills add owner/repo; touch ${marker}`,
    );

    expect(result).toMatchObject({
      success: false,
      code: "unsupported-source",
    });
    expect(existsSync(marker)).toBe(false);
  });
});

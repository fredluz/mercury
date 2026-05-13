import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let hermesHome: string;

beforeEach(() => {
  hermesHome = mkdtempSync(join(tmpdir(), "mercury-skills-import-"));
  process.env.HERMES_HOME = hermesHome;
  vi.resetModules();
});

afterEach(() => {
  rmSync(hermesHome, { recursive: true, force: true });
  delete process.env.HERMES_HOME;
  vi.resetModules();
});

describe("manual Markdown skill import", () => {
  it("writes normalized SKILL.md into the default profile", async () => {
    const { importSkillMarkdown, listInstalledSkills } = await import(
      "../src/main/skills"
    );

    const result = importSkillMarkdown({
      markdown: "# manual-skill\n\nDo one focused thing.",
      category: "custom",
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.skill).toMatchObject({
      name: "manual-skill",
      category: "custom",
      description: "Do one focused thing.",
    });

    const skillFile = join(
      hermesHome,
      "skills",
      "custom",
      "manual-skill",
      "SKILL.md",
    );
    const written = readFileSync(skillFile, "utf-8");
    expect(written).toContain('name: "manual-skill"');
    expect(written).toContain('description: "Do one focused thing."');
    expect(written).toContain("# manual-skill");
    expect(listInstalledSkills()).toEqual([
      expect.objectContaining({ name: "manual-skill", category: "custom" }),
    ]);
  });

  it("writes to named profile skills directory", async () => {
    const { importSkillMarkdown } = await import("../src/main/skills");

    const result = importSkillMarkdown(
      {
        markdown: "Body only",
        name: "profile-skill",
        description: "Profile scoped",
      },
      "research",
    );

    expect(result.success).toBe(true);
    const written = readFileSync(
      join(
        hermesHome,
        "profiles",
        "research",
        "skills",
        "custom",
        "profile-skill",
        "SKILL.md",
      ),
      "utf-8",
    );
    expect(written).toContain('name: "profile-skill"');
    expect(written).toContain('description: "Profile scoped"');
  });

  it("rejects traversal profile names", async () => {
    const { importSkillMarkdown } = await import("../src/main/skills");

    const result = importSkillMarkdown(
      { markdown: "# safe-skill" },
      "../escape",
    );

    expect(result).toMatchObject({ success: false, code: "write-failed" });
  });

  it("rejects invalid names and categories", async () => {
    const { importSkillMarkdown } = await import("../src/main/skills");

    expect(
      importSkillMarkdown({ markdown: "# Bad Name", category: "custom" }),
    ).toMatchObject({ success: false, code: "invalid-name" });
    expect(
      importSkillMarkdown({
        markdown: "# valid-name",
        category: "../escape",
      }),
    ).toMatchObject({ success: false, code: "invalid-category" });
  });

  it("rejects duplicates unless overwrite is enabled", async () => {
    const { importSkillMarkdown } = await import("../src/main/skills");

    const first = importSkillMarkdown({ markdown: "# duplicate-skill" });
    expect(first.success).toBe(true);

    const duplicate = importSkillMarkdown({ markdown: "# duplicate-skill" });
    expect(duplicate).toMatchObject({ success: false, code: "duplicate" });

    const overwrite = importSkillMarkdown({
      markdown: "# duplicate-skill\n\nReplacement text.",
      overwrite: true,
    });
    expect(overwrite.success).toBe(true);
    expect(
      readFileSync(
        join(hermesHome, "skills", "custom", "duplicate-skill", "SKILL.md"),
        "utf-8",
      ),
    ).toContain("Replacement text.");
  });

  it("preserves Markdown body while normalizing existing frontmatter", async () => {
    const { importSkillMarkdown } = await import("../src/main/skills");

    const result = importSkillMarkdown({
      markdown: "---\nname: old-name\ndescription: Old description\nversion: 1.0.0\n---\n# Body\n\nKeep **this**.",
      name: "new-name",
      description: "New description",
    });

    expect(result.success).toBe(true);
    const written = readFileSync(
      join(hermesHome, "skills", "custom", "new-name", "SKILL.md"),
      "utf-8",
    );
    expect(written).toContain('name: "new-name"');
    expect(written).toContain('description: "New description"');
    expect(written).toContain("version: 1.0.0");
    expect(written.endsWith("# Body\n\nKeep **this**.")).toBe(true);
  });

  it("does not treat inline dashes as the frontmatter closing delimiter", async () => {
    const { importSkillMarkdown } = await import("../src/main/skills");

    const result = importSkillMarkdown({
      markdown:
        '---\nname: dash-skill\ndescription: "foo --- bar"\n---\n# Body',
    });

    expect(result.success).toBe(true);
    const written = readFileSync(
      join(hermesHome, "skills", "custom", "dash-skill", "SKILL.md"),
      "utf-8",
    );
    expect(written).toContain('description: "foo --- bar"');
    expect(written).toContain("# Body");
  });
});

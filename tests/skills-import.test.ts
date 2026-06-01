import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let hermesHome: string;

function b64(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

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

  it("returns associated scripts and references metadata", async () => {
    const { importSkillMarkdown, getSkillMetadata } = await import(
      "../src/main/skills"
    );

    const result = importSkillMarkdown({ markdown: "# meta-skill" });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);

    mkdirSync(join(result.skill.path, "scripts"));
    mkdirSync(join(result.skill.path, "references", "examples"), {
      recursive: true,
    });
    writeFileSync(join(result.skill.path, "scripts", "check.py"), "print('ok')");
    writeFileSync(join(result.skill.path, "references", "guide.md"), "# Guide");

    expect(getSkillMetadata(result.skill.path)).toMatchObject({
      path: result.skill.path,
      metadataAvailable: true,
      scripts: [
        { name: "check.py", relativePath: "scripts/check.py", kind: "file" },
      ],
      references: [
        { name: "examples", relativePath: "references/examples", kind: "directory" },
        { name: "guide.md", relativePath: "references/guide.md", kind: "file" },
      ],
    });
  });
});

describe("directory skill import", () => {
  it("writes a multi-file skill directory with normalized SKILL.md and metadata", async () => {
    const { getSkillMetadata, importSkillDirectory } = await import(
      "../src/main/skills"
    );

    const result = importSkillDirectory({
      category: "tools",
      directoryName: "dir-skill",
      files: [
        { relativePath: "SKILL.md", contentBase64: b64("# dir-skill\n\nDirectory import.") },
        { relativePath: "scripts/check.py", contentBase64: b64("print('ok')\n") },
        { relativePath: "references/guide.md", contentBase64: b64("# Guide\n") },
        { relativePath: "references/examples/demo.md", contentBase64: b64("demo\n") },
        { relativePath: "assets/icon.png", contentBase64: Buffer.from([1, 2, 3]).toString("base64") },
      ],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error);
    expect(result.skill).toMatchObject({
      name: "dir-skill",
      category: "tools",
      description: "Directory import.",
      directoryName: "dir-skill",
    });

    const skillDir = join(hermesHome, "skills", "tools", "dir-skill");
    const skillFile = join(skillDir, "SKILL.md");
    const scriptFile = join(skillDir, "scripts", "check.py");
    expect(readFileSync(skillFile, "utf-8")).toContain('name: "dir-skill"');
    expect(readFileSync(scriptFile, "utf-8")).toBe("print('ok')\n");
    expect(readFileSync(join(skillDir, "assets", "icon.png"))).toEqual(Buffer.from([1, 2, 3]));
    expect(statSync(skillFile).mode & 0o777).toBe(0o644);
    expect(statSync(scriptFile).mode & 0o777).toBe(0o644);
    expect(statSync(join(skillDir, "scripts")).mode & 0o777).toBe(0o755);

    expect(getSkillMetadata(skillDir)).toMatchObject({
      metadataAvailable: true,
      scripts: [
        { name: "check.py", relativePath: "scripts/check.py", kind: "file" },
      ],
      references: [
        { name: "examples", relativePath: "references/examples", kind: "directory" },
        { name: "guide.md", relativePath: "references/guide.md", kind: "file" },
      ],
    });
  });

  it("writes to a named profile", async () => {
    const { importSkillDirectory } = await import("../src/main/skills");

    const result = importSkillDirectory(
      {
        directoryName: "profile-dir",
        files: [
          { relativePath: "SKILL.md", contentBase64: b64("# profile-dir\n\nProfile scoped.") },
        ],
      },
      "research",
    );

    expect(result.success).toBe(true);
    expect(
      readFileSync(
        join(
          hermesHome,
          "profiles",
          "research",
          "skills",
          "custom",
          "profile-dir",
          "SKILL.md",
        ),
        "utf-8",
      ),
    ).toContain('name: "profile-dir"');
  });

  it.each(["../x", "/abs", "a/../../x", "bad\0path"])(
    "rejects unsafe relative path %s",
    async (relativePath) => {
      const { importSkillDirectory } = await import("../src/main/skills");

      const result = importSkillDirectory({
        files: [
          { relativePath: "SKILL.md", contentBase64: b64("# safe-dir") },
          { relativePath, contentBase64: b64("nope") },
        ],
      });

      expect(result).toMatchObject({ success: false, code: "write-failed" });
      expect(existsSync(join(hermesHome, "skills", "custom", "safe-dir"))).toBe(false);
    },
  );

  it("rejects invalid category and directory names", async () => {
    const { importSkillDirectory } = await import("../src/main/skills");

    expect(
      importSkillDirectory({
        category: "../escape",
        files: [{ relativePath: "SKILL.md", contentBase64: b64("# valid-dir") }],
      }),
    ).toMatchObject({ success: false, code: "invalid-category" });

    expect(
      importSkillDirectory({
        directoryName: "Bad Name",
        files: [{ relativePath: "SKILL.md", contentBase64: b64("# valid-dir") }],
      }),
    ).toMatchObject({ success: false, code: "invalid-name" });
  });

  it("rejects writes through symlinked category directories", async () => {
    const { importSkillDirectory } = await import("../src/main/skills");
    const external = join(hermesHome, "external-tools");
    mkdirSync(join(hermesHome, "skills"), { recursive: true });
    mkdirSync(external, { recursive: true });
    symlinkSync(external, join(hermesHome, "skills", "tools"));

    const result = importSkillDirectory({
      category: "tools",
      files: [{ relativePath: "SKILL.md", contentBase64: b64("# symlink-skill") }],
    });

    expect(result).toMatchObject({ success: false, code: "write-failed" });
    expect(existsSync(join(external, "symlink-skill", "SKILL.md"))).toBe(false);
  });

  it("rejects duplicates unless overwrite replaces the whole skill directory", async () => {
    const { importSkillDirectory } = await import("../src/main/skills");

    const first = importSkillDirectory({
      files: [
        { relativePath: "SKILL.md", contentBase64: b64("# stale-skill\n\nFirst.") },
        { relativePath: "references/old.md", contentBase64: b64("old") },
      ],
    });
    expect(first.success).toBe(true);

    const duplicate = importSkillDirectory({
      files: [{ relativePath: "SKILL.md", contentBase64: b64("# stale-skill\n\nDuplicate.") }],
    });
    expect(duplicate).toMatchObject({ success: false, code: "duplicate" });

    const overwrite = importSkillDirectory({
      overwrite: true,
      files: [
        { relativePath: "SKILL.md", contentBase64: b64("# stale-skill\n\nReplacement.") },
        { relativePath: "references/new.md", contentBase64: b64("new") },
      ],
    });
    expect(overwrite.success).toBe(true);

    const skillDir = join(hermesHome, "skills", "custom", "stale-skill");
    expect(readFileSync(join(skillDir, "SKILL.md"), "utf-8")).toContain("Replacement.");
    expect(existsSync(join(skillDir, "references", "old.md"))).toBe(false);
    expect(existsSync(join(skillDir, "references", "new.md"))).toBe(true);
  });
});

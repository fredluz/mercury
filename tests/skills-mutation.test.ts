import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const createdRoots: string[] = [];

function tempRoot(): string {
  const root = join(tmpdir(), `mercury-skills-mutation-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  createdRoots.push(root);
  return root;
}

async function importSkillsWithRoots(home: string, repo: string) {
  vi.resetModules();
  vi.doMock("../src/main/utils", async () => {
    const actual = await vi.importActual<typeof import("../src/main/utils")>(
      "../src/main/utils",
    );
    return {
      ...actual,
      profileHome: (profile?: string) =>
        profile && profile !== "default" ? join(home, "profiles", profile) : home,
    };
  });
  vi.doMock("../src/main/install/paths", () => ({
    HERMES_HOME: home,
    HERMES_PYTHON: "python3",
    HERMES_SCRIPT: "hermes",
    HERMES_REPO: repo,
    getEnhancedPath: () => process.env.PATH || "",
  }));
  return import("../src/main/skills");
}

function writeSkill(root: string, category: string, directoryName: string, name = directoryName): string {
  const dir = join(root, category, directoryName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n\n# ${name}\n`,
  );
  return dir;
}

afterEach(() => {
  vi.doUnmock("../src/main/utils");
  vi.doUnmock("../src/main/install/paths");
  vi.resetModules();
  for (const root of createdRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("local skill mutation path safety", () => {
  it("refuses installs through symlinked profile skill categories", async () => {
    const root = tempRoot();
    const home = join(root, "home");
    const repo = join(root, "repo");
    const external = join(root, "external-category");
    writeSkill(join(repo, "skills"), "tools", "demo");
    mkdirSync(join(home, "skills"), { recursive: true });
    mkdirSync(external, { recursive: true });
    symlinkSync(external, join(home, "skills", "tools"));

    const { mutateLocalSkills } = await importSkillsWithRoots(home, repo);

    await expect(
      mutateLocalSkills([
        { action: "install", name: "demo", category: "tools", directoryName: "demo" },
      ]),
    ).resolves.toMatchObject({
      success: false,
      results: [expect.objectContaining({ success: false, code: "invalid-target" })],
    });
    expect(existsSync(join(external, "demo", "SKILL.md"))).toBe(false);
  });

  it("refuses uninstalls through symlinked profile skill categories", async () => {
    const root = tempRoot();
    const home = join(root, "home");
    const repo = join(root, "repo");
    const external = join(root, "external-category");
    mkdirSync(join(external, "demo"), { recursive: true });
    writeFileSync(join(external, "demo", "SKILL.md"), "---\nname: demo\n---\n");
    mkdirSync(join(home, "skills"), { recursive: true });
    symlinkSync(external, join(home, "skills", "tools"));

    const { mutateLocalSkills } = await importSkillsWithRoots(home, repo);

    await expect(
      mutateLocalSkills([{ action: "uninstall", name: "demo" }]),
    ).resolves.toMatchObject({
      success: false,
      results: [expect.objectContaining({ success: false, code: "invalid-target" })],
    });
    expect(existsSync(join(external, "demo", "SKILL.md"))).toBe(true);
  });
});

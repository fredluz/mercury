import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSourceCandidate, SkillSourceImportRequest } from "../../../../shared/skills";
import Skills from "./Skills";

vi.mock("../../components/useI18n", () => {
  const templates: Record<string, string> = {
    "skills.bulkActionFailedDetailed": "Some skill actions failed: {{details}}",
    "skills.bulkActionSucceeded": "Updated {{count}} skills.",
    "skills.pendingChanges": "Pending skill changes",
    "skills.pendingSummary": "{{enable}} to enable · {{disable}} to disable",
    "skills.pendingHelp": "Changes are staged locally and apply only when you save.",
    "skills.saveChanges": "Save changes",
    "skills.savingChanges": "Saving...",
    "skills.discardChanges": "Discard",
    "skills.pendingDiscarded": "Pending skill changes discarded.",
    "skills.pendingSaved": "Saved {{count}} skill changes.",
    "skills.pendingNoChanges": "No skill changes were needed.",
    "skills.pendingSaveFailedDetailed": "Some skill changes failed: {{details}}",
    "skills.pendingSaveMissingResult": "No result returned for this change",
    "skills.pendingSaveNotReflected": "Saved result was not reflected after reload",
    "skills.importPendingSaveFailed": "Save pending skill changes before importing. Fix or discard failed changes, then try again.",
    "skills.sourceImportRestartWarning": "Skill imported from source. Restart the gateway or start a new Hermes session for runtime indexing.",
  };
  const t = (key: string, options?: Record<string, unknown>) => {
    const template = templates[key] ?? key;
    if (!options) return template;
    return Object.entries(options).reduce(
      (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
      template,
    );
  };
  return { useI18n: () => ({ t }) };
});

// Fixtures use real catalog skills so the screen groups them under packs:
// `arxiv`/`blogwatcher` (research category) belong to the Research pack, and
// `github-auth` (github category) belongs to the Coding pack.
const installed = [
  {
    name: "arxiv",
    category: "research",
    description: "Arxiv research helper",
    path: "/skills/research/arxiv",
    directoryName: "arxiv",
  },
  {
    name: "github-auth",
    category: "github",
    description: "GitHub auth helper",
    path: "/skills/github/github-auth",
    directoryName: "github-auth",
  },
];

const bundled = [
  {
    name: "arxiv",
    category: "research",
    description: "Arxiv research helper",
    source: "bundled",
    installed: false,
    directoryName: "arxiv",
  },
  {
    name: "blogwatcher",
    category: "research",
    description: "Blog watcher helper",
    source: "bundled",
    installed: false,
    directoryName: "blogwatcher",
  },
];

type MutationTarget = {
  action: "install" | "uninstall";
  name: string;
  category?: string;
  directoryName?: string;
  path?: string;
};

function targetIdentity(target: { category?: string; name: string; directoryName?: string }): string {
  return `${(target.category || "").toLowerCase()}\u0000${(target.directoryName || target.name).toLowerCase()}`;
}

function sourceCandidate(overrides: Partial<SkillSourceCandidate> = {}): SkillSourceCandidate {
  return {
    candidateId: "github:owner/repo@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:skills/demo/SKILL.md" as const,
    name: "demo-skill",
    category: "custom",
    directoryName: "demo-skill",
    description: "Demo source skill",
    skillPath: "skills/demo/SKILL.md",
    sourceLabel: "owner/repo",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    valid: true,
    ...overrides,
  };
}

function installHermesApiMock(): void {
  const installedByProfile: Record<string, typeof installed> = {
    default: [...installed],
    scout: [installed[0]],
  };

  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    listInstalledSkills: vi.fn(async (profile?: string) => {
      const key = profile || "default";
      return installedByProfile[key] ?? installedByProfile.default;
    }),
    listBundledSkills: vi.fn().mockResolvedValue(bundled),
    getSkillContent: vi.fn().mockResolvedValue("# arxiv\n\nSkill body."),
    getSkillMetadata: vi.fn().mockResolvedValue({
      path: "/skills/research/arxiv",
      metadataAvailable: true,
      scripts: [{ name: "check.py", relativePath: "scripts/check.py", kind: "file" }],
      references: [{ name: "guide.md", relativePath: "references/guide.md", kind: "file" }],
    }),
    installSkill: vi.fn().mockResolvedValue({ success: true }),
    uninstallSkill: vi.fn().mockResolvedValue({ success: true }),
    mutateSkills: vi.fn().mockImplementation(async (targets: MutationTarget[], profile?: string) => {
      const key = profile || "default";
      const current = [...(installedByProfile[key] ?? installedByProfile.default)];
      const results = targets.map((target) => {
        if (target.action === "install") {
          const existing = current.some((skill) => targetIdentity(skill) === targetIdentity(target));
          if (!existing) {
            const bundledSkill = bundled.find((skill) => targetIdentity(skill) === targetIdentity(target));
            current.push({
              name: target.name,
              category: target.category || "",
              description: bundledSkill?.description || "",
              path: `/skills/${target.category || ""}/${target.directoryName || target.name}`,
              directoryName: target.directoryName || target.name,
            });
          }
          return {
            success: true,
            action: target.action,
            target,
            name: target.name,
            category: target.category,
            changed: !existing,
          };
        }

        const before = current.length;
        const next = current.filter((skill) => {
          if (target.path) return skill.path !== target.path;
          return targetIdentity(skill) !== targetIdentity(target);
        });
        current.splice(0, current.length, ...next);
        return {
          success: true,
          action: target.action,
          target,
          name: target.name,
          category: target.category,
          changed: before !== current.length,
        };
      });
      installedByProfile[key] = current;
      return {
        success: true,
        updated: results.filter((result) => result.changed).length,
        failed: 0,
        results,
      };
    }),
    importSkillMarkdown: vi.fn().mockResolvedValue({
      success: true,
      skill: {
        name: "manual-skill",
        category: "custom",
        description: "Manual",
        path: "/skills/custom/manual-skill",
      },
    }),
    previewSkillSource: vi.fn().mockResolvedValue({
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidates: [sourceCandidate()],
    }),
    importSkillSource: vi.fn().mockImplementation(async (request: SkillSourceImportRequest, profile?: string) => {
      const key = profile || "default";
      const category = request.category || "custom";
      const directoryName = request.name || "demo-skill";
      const imported = {
        name: request.name || "demo-skill",
        category,
        description: request.description || "Demo source skill",
        path: `/skills/${category}/${directoryName}`,
        directoryName,
      };
      installedByProfile[key] = [...(installedByProfile[key] ?? installedByProfile.default), imported];
      return {
        success: true,
        skill: imported,
        source: {
          kind: "github",
          owner: "owner",
          repo: "repo",
          originalSource: request.source,
          pathKind: "repo",
        },
        candidate: sourceCandidate({ category, directoryName, name: imported.name }),
      };
    }),
    listProfiles: vi.fn().mockResolvedValue([
      {
        name: "default",
        path: "/profiles/default",
        isDefault: true,
        isActive: true,
        model: "gpt",
        provider: "openai",
        hasEnv: true,
        hasSoul: false,
        skillCount: 2,
        gatewayRunning: false,
      },
      {
        name: "scout",
        path: "/profiles/scout",
        isDefault: false,
        isActive: false,
        model: "gpt",
        provider: "openai",
        hasEnv: true,
        hasSoul: false,
        skillCount: 1,
        gatewayRunning: false,
      },
    ]),
    isRemoteOnlyMode: vi.fn().mockResolvedValue(false),
    openExternal: vi.fn(),
  };
}

function categorySection(category: string): HTMLElement {
  const section = screen
    .getAllByText(category)
    .map((node) => node.closest("section"))
    .find((node): node is HTMLElement => node instanceof HTMLElement);
  if (!section) throw new Error(`Missing category section: ${category}`);
  return section;
}

async function savePendingChanges(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));
}

describe("Skills redesign", () => {
  beforeEach(() => {
    installHermesApiMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("groups installed skills by pack and collapses sections", async () => {
    render(<Skills profile="default" />);

    await screen.findByText("Research");
    expect(screen.getByText("github-auth")).toBeInTheDocument();
    expect(screen.getByText("arxiv")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Research").closest("button")!);

    expect(screen.queryByText("arxiv")).not.toBeInTheDocument();
    expect(screen.getByText("github-auth")).toBeInTheDocument();
  });

  it("stages bulk enables and saves one flat batch", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const listCallsBeforeAction = vi.mocked(window.hermesAPI.listInstalledSkills).mock.calls.length;
    fireEvent.click(within(section).getByRole("button", { name: "skills.enableAll" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    expect(await screen.findByText("Pending skill changes")).toBeInTheDocument();
    expect(screen.getByText("1 to enable · 0 to disable")).toBeInTheDocument();

    await savePendingChanges();

    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [{ action: "install", name: "blogwatcher", category: "research", directoryName: "blogwatcher" }],
        "default",
      ),
    );
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.listInstalledSkills).toHaveBeenCalledTimes(listCallsBeforeAction + 1);
  });

  it("stages bulk disables and saves one flat batch within a category", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    const section = categorySection("Research");
    fireEvent.click(within(section).getByRole("button", { name: "skills.disableAll" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    expect(await screen.findByText("0 to enable · 1 to disable")).toBeInTheDocument();

    await savePendingChanges();

    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [
          {
            action: "uninstall",
            name: "arxiv",
            category: "research",
            directoryName: "arxiv",
            path: "/skills/research/arxiv",
          },
        ],
        "default",
      ),
    );
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1);
  });

  it("stages individual enable and disable actions until Save", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const browseSection = categorySection("Research");
    const tsTestRow = within(browseSection).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    await savePendingChanges();
    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [{ action: "install", name: "blogwatcher", category: "research", directoryName: "blogwatcher" }],
        "default",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /skills.installedTab/i }));
    const installedSection = categorySection("Coding");
    fireEvent.click(within(installedSection).getByRole("button", { name: "skills.disable" }));
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1);

    await savePendingChanges();
    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenLastCalledWith(
        [
          {
            action: "uninstall",
            name: "github-auth",
            category: "github",
            directoryName: "github-auth",
            path: "/skills/github/github-auth",
          },
        ],
        "default",
      ),
    );
  });

  it("discard clears pending changes without mutating", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const tsTestRow = within(section).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    expect(await screen.findByText("Pending skill changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.queryByText("Pending skill changes")).not.toBeInTheDocument());
    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    expect(screen.getByText("Pending skill changes discarded.")).toBeInTheDocument();
  });

  it("partial save failures clear successful pending changes and keep failed ones", async () => {
    const listInstalled = vi.mocked(window.hermesAPI.listInstalledSkills);
    let listCall = 0;
    listInstalled.mockImplementation(async () => {
      listCall += 1;
      return listCall === 1 ? [] : [installed[0]];
    });
    vi.mocked(window.hermesAPI.mutateSkills).mockResolvedValueOnce({
      success: false,
      updated: 1,
      failed: 1,
      results: [
        {
          success: true,
          action: "install",
          target: { action: "install", name: "arxiv", category: "research", directoryName: "arxiv" },
          name: "arxiv",
          category: "research",
          changed: true,
        },
        {
          success: false,
          action: "install",
          target: { action: "install", name: "blogwatcher", category: "research", directoryName: "blogwatcher" },
          name: "blogwatcher",
          category: "research",
          code: "timeout",
          error: "Timed out while installing",
        },
      ],
    });

    render(<Skills profile="default" />);

    fireEvent.click(await screen.findByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    fireEvent.click(within(section).getByRole("button", { name: "skills.enableAll" }));
    expect(await screen.findByText("2 to enable · 0 to disable")).toBeInTheDocument();

    await savePendingChanges();

    expect(await screen.findByText("Saved 1 skill changes.")).toBeInTheDocument();
    expect(await screen.findByText(/blogwatcher \(research\/blogwatcher\): Timed out while installing/)).toBeInTheDocument();
    expect(screen.getByText("1 to enable · 0 to disable")).toBeInTheDocument();
  });

  it("renders thrown IPC errors from Save and retains pending changes", async () => {
    vi.mocked(window.hermesAPI.mutateSkills).mockRejectedValueOnce(new Error("IPC unavailable"));

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const tsTestRow = within(section).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    await savePendingChanges();

    await waitFor(() => expect(window.hermesAPI.mutateSkills).toHaveBeenCalled());
    expect(await screen.findByText("IPC unavailable")).toBeInTheDocument();
    expect(screen.getByText("1 to enable · 0 to disable")).toBeInTheDocument();
  });

  it("targets duplicate display names by directory and path when saved", async () => {
    vi.mocked(window.hermesAPI.listInstalledSkills).mockResolvedValue([
      {
        name: "shared-name",
        category: "tools",
        description: "Alpha helper",
        path: "/skills/tools/alpha-dir",
        directoryName: "alpha-dir",
      },
      {
        name: "shared-name",
        category: "tools",
        description: "Beta helper",
        path: "/skills/tools/beta-dir",
        directoryName: "beta-dir",
      },
    ]);
    vi.mocked(window.hermesAPI.listBundledSkills).mockResolvedValue([]);

    render(<Skills profile="default" />);
    await screen.findByText("skills.otherSkills");

    const section = categorySection("skills.otherSkills");
    const rows = within(section).getAllByText("shared-name").map((node) => node.closest(".skills-row"));
    const secondRow = rows[1];
    if (!secondRow) throw new Error("Missing duplicate skill row");
    fireEvent.click(within(secondRow as HTMLElement).getByRole("button", { name: "skills.disable" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    await savePendingChanges();

    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [
          {
            action: "uninstall",
            name: "shared-name",
            category: "tools",
            directoryName: "beta-dir",
            path: "/skills/tools/beta-dir",
          },
        ],
        "default",
      ),
    );
  });

  it("opens installed skill details with metadata and Agents using it", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    const section = categorySection("Research");
    fireEvent.click(within(section).getByRole("button", { name: "skills.details" }));

    expect(await screen.findByText("Skill body.")).toBeInTheDocument();
    expect(screen.getByText("scripts/check.py")).toBeInTheDocument();
    expect(screen.getByText("references/guide.md")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("scout")).toBeInTheDocument();
    expect(window.hermesAPI.listProfiles).toHaveBeenCalled();
    expect(window.hermesAPI.getSkillMetadata).toHaveBeenCalledWith("/skills/research/arxiv");
  });

  it("restores the skill list scroll position after returning from details", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    const container = document.querySelector(".skills-container") as HTMLDivElement | null;
    if (!container) throw new Error("Missing skills scroll container");
    container.scrollTop = 420;

    const section = categorySection("Research");
    fireEvent.click(within(section).getByRole("button", { name: "skills.details" }));
    expect(await screen.findByText("Skill body.")).toBeInTheDocument();

    container.scrollTop = 0;
    fireEvent.click(screen.getByRole("button", { name: "skills.backToSkills" }));

    await waitFor(() => expect(screen.queryByText("Skill body.")).not.toBeInTheDocument());
    expect(container.scrollTop).toBe(420);
  });

  it("detail disable stages pending uninstall and closes details", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    const section = categorySection("Research");
    fireEvent.click(within(section).getByRole("button", { name: "skills.details" }));
    expect(await screen.findByText("Skill body.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "skills.disable" }));

    await waitFor(() => expect(screen.queryByText("Skill body.")).not.toBeInTheDocument());
    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    expect(screen.getByText("0 to enable · 1 to disable")).toBeInTheDocument();
  });

  it("undo removes a pending row change without mutating", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const tsTestRow = within(section).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    expect(await screen.findByText("Pending skill changes")).toBeInTheDocument();
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.undoPendingChange" }));

    await waitFor(() => expect(screen.queryByText("Pending skill changes")).not.toBeInTheDocument());
    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
  });

  it("refresh rebases pending changes already satisfied by installed truth", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const tsTestRow = within(section).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));
    expect(await screen.findByText("Pending skill changes")).toBeInTheDocument();

    vi.mocked(window.hermesAPI.listInstalledSkills).mockResolvedValue([
      ...installed,
      {
        name: "blogwatcher",
        category: "research",
        description: "TypeScript test helper",
        path: "/skills/research/blogwatcher",
        directoryName: "blogwatcher",
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: /skills.refresh/i }));

    await waitFor(() => expect(screen.queryByText("Pending skill changes")).not.toBeInTheDocument());
    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
  });

  it("stops Markdown import when saving pending changes fails", async () => {
    vi.mocked(window.hermesAPI.mutateSkills).mockResolvedValueOnce({
      success: false,
      updated: 0,
      failed: 1,
      results: [
        {
          success: false,
          action: "install",
          target: { action: "install", name: "blogwatcher", category: "research", directoryName: "blogwatcher" },
          name: "blogwatcher",
          category: "research",
          code: "timeout",
          error: "Timed out while installing",
        },
      ],
    });

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const tsTestRow = within(section).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.change(screen.getByPlaceholderText("skills.importMarkdownPlaceholder"), {
      target: { value: "# manual-skill\n\nManual body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.importSkillMarkdown).not.toHaveBeenCalled();
    expect(await screen.findByText(/Save pending skill changes before importing/)).toBeInTheDocument();
    expect(await screen.findByText(/blogwatcher \(research\/blogwatcher\): Timed out while installing/)).toBeInTheDocument();
    expect(screen.getByText("1 to enable · 0 to disable")).toBeInTheDocument();
  });

  it("keeps manual Markdown import working", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.change(screen.getByPlaceholderText("skills.importMarkdownPlaceholder"), {
      target: { value: "# manual-skill\n\nManual body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() =>
      expect(window.hermesAPI.importSkillMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({ markdown: "# manual-skill\n\nManual body." }),
        "default",
      ),
    );
  });

  it("saves pending changes before submitting Markdown import", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const tsTestRow = within(section).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.change(screen.getByPlaceholderText("skills.importMarkdownPlaceholder"), {
      target: { value: "# manual-skill\n\nManual body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.hermesAPI.importSkillMarkdown).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
      [{ action: "install", name: "blogwatcher", category: "research", directoryName: "blogwatcher" }],
      "default",
    );
  });

  it("previews a GitHub URL with one candidate and imports it directly", async () => {
    const candidate = sourceCandidate({
      candidateId: "github:owner/repo@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:skills/pdf/SKILL.md",
      category: "docs",
      directoryName: "pdf",
      name: "pdf",
      skillPath: "skills/pdf/SKILL.md",
    });
    vi.mocked(window.hermesAPI.previewSkillSource).mockResolvedValueOnce({
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "https://github.com/owner/repo",
        pathKind: "repo",
      },
      candidates: [candidate],
    });

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.click(await screen.findByRole("tab", { name: "skills.githubLinkTab" }));
    fireEvent.change(screen.getByPlaceholderText("skills.sourceUrlPlaceholder"), {
      target: { value: "https://github.com/owner/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.getSkills" }));

    await waitFor(() => expect(window.hermesAPI.previewSkillSource).toHaveBeenCalledWith({ source: "https://github.com/owner/repo" }));
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(window.hermesAPI.importSkillSource).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.importSkillSource).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "https://github.com/owner/repo",
        candidateId: candidate.candidateId,
        category: "docs",
      }),
      "default",
    );
  });

  it("previews before saving pending source imports and aborts import on pending-save failure", async () => {
    vi.mocked(window.hermesAPI.mutateSkills).mockResolvedValueOnce({
      success: false,
      updated: 0,
      failed: 1,
      results: [
        {
          success: false,
          action: "install",
          target: { action: "install", name: "blogwatcher", category: "research", directoryName: "blogwatcher" },
          name: "blogwatcher",
          category: "research",
          code: "timeout",
          error: "Timed out while installing",
        },
      ],
    });

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("Research");
    const tsTestRow = within(section).getByText("blogwatcher").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing blogwatcher row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.click(await screen.findByRole("tab", { name: "skills.githubLinkTab" }));
    fireEvent.change(screen.getByPlaceholderText("skills.sourceUrlPlaceholder"), {
      target: { value: "owner/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.getSkills" }));
    await waitFor(() => expect(window.hermesAPI.previewSkillSource).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.importSkillSource).not.toHaveBeenCalled();
    expect(await screen.findByText(/Save pending skill changes before importing/)).toBeInTheDocument();
    expect(
      vi.mocked(window.hermesAPI.previewSkillSource).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(window.hermesAPI.mutateSkills).mock.invocationCallOrder[0]);
  });

  it("renders a monorepo candidate picker and imports the selected candidate", async () => {
    const pdf = sourceCandidate({
      candidateId: "github:owner/repo@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:skills/pdf/SKILL.md",
      category: "docs",
      directoryName: "pdf",
      name: "pdf",
      skillPath: "skills/pdf/SKILL.md",
      description: "PDF helper",
    });
    const lint = sourceCandidate({
      candidateId: "github:owner/repo@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:skills/lint/SKILL.md",
      category: "devtools",
      directoryName: "lint",
      name: "lint",
      skillPath: "skills/lint/SKILL.md",
      description: "Lint helper",
    });
    vi.mocked(window.hermesAPI.previewSkillSource).mockResolvedValueOnce({
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidates: [pdf, lint],
    });

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.click(await screen.findByRole("tab", { name: "skills.githubLinkTab" }));
    fireEvent.change(screen.getByPlaceholderText("skills.sourceUrlPlaceholder"), {
      target: { value: "owner/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.getSkills" }));

    // First candidate auto-selected; its SKILL.md path shows in the preview header.
    expect(await screen.findByText(/skills\/pdf\/SKILL\.md/)).toBeInTheDocument();
    // Page to the second candidate with the next arrow.
    fireEvent.click(screen.getByRole("button", { name: "skills.sourceCandidateNext" }));
    expect(await screen.findByText(/skills\/lint\/SKILL\.md/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(window.hermesAPI.importSkillSource).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.importSkillSource).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "owner/repo",
        candidateId: lint.candidateId,
        category: "devtools",
      }),
      "default",
    );
  });

  it("auto-selects the first candidate so source import is enabled after preview", async () => {
    vi.mocked(window.hermesAPI.previewSkillSource).mockResolvedValueOnce({
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidates: [
        sourceCandidate({
          candidateId: "github:owner/repo@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:skills/pdf/SKILL.md",
          directoryName: "pdf",
          skillPath: "skills/pdf/SKILL.md",
        }),
        sourceCandidate({
          candidateId: "github:owner/repo@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:skills/lint/SKILL.md",
          directoryName: "lint",
          skillPath: "skills/lint/SKILL.md",
        }),
      ],
    });

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.click(await screen.findByRole("tab", { name: "skills.githubLinkTab" }));
    fireEvent.change(screen.getByPlaceholderText("skills.sourceUrlPlaceholder"), {
      target: { value: "owner/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.getSkills" }));

    await screen.findByText(/skills\/pdf\/SKILL\.md/);
    expect(screen.getByRole("button", { name: "skills.import" })).not.toBeDisabled();
  });

  it("shows the error for a single invalid source candidate", async () => {
    vi.mocked(window.hermesAPI.previewSkillSource).mockResolvedValueOnce({
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidates: [sourceCandidate({ valid: false, error: "Invalid SKILL.md frontmatter" })],
    });

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.click(await screen.findByRole("tab", { name: "skills.githubLinkTab" }));
    fireEvent.change(screen.getByPlaceholderText("skills.sourceUrlPlaceholder"), {
      target: { value: "owner/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.getSkills" }));

    expect(await screen.findByText("Invalid SKILL.md frontmatter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "skills.import" })).toBeDisabled();
  });

  it("hides GitHub and command source tabs in pure remote mode", async () => {
    vi.mocked(window.hermesAPI.isRemoteOnlyMode).mockResolvedValueOnce(true);

    render(<Skills profile="default" />);
    await screen.findByText("Research");

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));

    expect(screen.getByRole("tab", { name: "skills.pasteMarkdownTab" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "skills.githubLinkTab" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "skills.commandTab" })).not.toBeInTheDocument();
    expect(await screen.findByText("skills.sourceRemoteUnavailable")).toBeInTheDocument();
  });

  it("source import success closes the modal, reloads installed skills, and shows restart warning", async () => {
    vi.mocked(window.hermesAPI.importSkillSource).mockResolvedValueOnce({
      success: true,
      skill: {
        name: "demo-skill",
        category: "custom",
        description: "Demo source skill",
        path: "/skills/custom/demo-skill",
        directoryName: "demo-skill",
      },
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidate: sourceCandidate(),
      warning: "gateway-restart-required",
    });

    render(<Skills profile="default" />);
    await screen.findByText("Research");
    const listCallsBeforeImport = vi.mocked(window.hermesAPI.listInstalledSkills).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /skills.addSkillAction/i }));
    fireEvent.click(await screen.findByRole("tab", { name: "skills.githubLinkTab" }));
    fireEvent.change(screen.getByPlaceholderText("skills.sourceUrlPlaceholder"), {
      target: { value: "owner/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.getSkills" }));
    await waitFor(() => expect(window.hermesAPI.previewSkillSource).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(screen.queryByText("skills.addSkillTitle")).not.toBeInTheDocument());
    expect(window.hermesAPI.listInstalledSkills).toHaveBeenCalledTimes(listCallsBeforeImport + 1);
    expect(screen.getByText("Skill imported from source. Restart the gateway or start a new Hermes session for runtime indexing.")).toBeInTheDocument();
  });
});

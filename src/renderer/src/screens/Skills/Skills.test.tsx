import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const installed = [
  {
    name: "ts-pro",
    category: "typescript",
    description: "TypeScript helper",
    path: "/skills/typescript/ts-pro",
    directoryName: "ts-pro",
  },
  {
    name: "electron-pro",
    category: "electron",
    description: "Electron helper",
    path: "/skills/electron/electron-pro",
    directoryName: "electron-pro",
  },
];

const bundled = [
  {
    name: "ts-pro",
    category: "typescript",
    description: "TypeScript helper",
    source: "bundled",
    installed: false,
    directoryName: "ts-pro",
  },
  {
    name: "ts-test",
    category: "typescript",
    description: "TypeScript test helper",
    source: "bundled",
    installed: false,
    directoryName: "ts-test",
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

function installHermesApiMock(): void {
  const installedByProfile: Record<string, typeof installed> = {
    default: [...installed],
    research: [installed[0]],
  };

  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    listInstalledSkills: vi.fn(async (profile?: string) => {
      const key = profile || "default";
      return installedByProfile[key] ?? installedByProfile.default;
    }),
    listBundledSkills: vi.fn().mockResolvedValue(bundled),
    getSkillContent: vi.fn().mockResolvedValue("# ts-pro\n\nSkill body."),
    getSkillMetadata: vi.fn().mockResolvedValue({
      path: "/skills/typescript/ts-pro",
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
        name: "research",
        path: "/profiles/research",
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

  it("groups installed skills by category and collapses sections", async () => {
    render(<Skills profile="default" />);

    await screen.findByText("typescript");
    expect(screen.getByText("electron-pro")).toBeInTheDocument();
    expect(screen.getByText("ts-pro")).toBeInTheDocument();

    fireEvent.click(screen.getByText("typescript").closest("button")!);

    expect(screen.queryByText("ts-pro")).not.toBeInTheDocument();
    expect(screen.getByText("electron-pro")).toBeInTheDocument();
  });

  it("stages bulk enables and saves one flat batch", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const listCallsBeforeAction = vi.mocked(window.hermesAPI.listInstalledSkills).mock.calls.length;
    fireEvent.click(within(section).getByRole("button", { name: "skills.enableAll" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    expect(await screen.findByText("Pending skill changes")).toBeInTheDocument();
    expect(screen.getByText("1 to enable · 0 to disable")).toBeInTheDocument();

    await savePendingChanges();

    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [{ action: "install", name: "ts-test", category: "typescript", directoryName: "ts-test" }],
        "default",
      ),
    );
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.listInstalledSkills).toHaveBeenCalledTimes(listCallsBeforeAction + 1);
  });

  it("stages bulk disables and saves one flat batch within a category", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    const section = categorySection("typescript");
    fireEvent.click(within(section).getByRole("button", { name: "skills.disableAll" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    expect(await screen.findByText("0 to enable · 1 to disable")).toBeInTheDocument();

    await savePendingChanges();

    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [
          {
            action: "uninstall",
            name: "ts-pro",
            category: "typescript",
            directoryName: "ts-pro",
            path: "/skills/typescript/ts-pro",
          },
        ],
        "default",
      ),
    );
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1);
  });

  it("stages individual enable and disable actions until Save", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const browseSection = categorySection("typescript");
    const tsTestRow = within(browseSection).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    await savePendingChanges();
    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [{ action: "install", name: "ts-test", category: "typescript", directoryName: "ts-test" }],
        "default",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /skills.installedTab/i }));
    const installedSection = categorySection("electron");
    fireEvent.click(within(installedSection).getByRole("button", { name: "skills.disable" }));
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1);

    await savePendingChanges();
    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenLastCalledWith(
        [
          {
            action: "uninstall",
            name: "electron-pro",
            category: "electron",
            directoryName: "electron-pro",
            path: "/skills/electron/electron-pro",
          },
        ],
        "default",
      ),
    );
  });

  it("discard clears pending changes without mutating", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const tsTestRow = within(section).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
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
          target: { action: "install", name: "ts-pro", category: "typescript", directoryName: "ts-pro" },
          name: "ts-pro",
          category: "typescript",
          changed: true,
        },
        {
          success: false,
          action: "install",
          target: { action: "install", name: "ts-test", category: "typescript", directoryName: "ts-test" },
          name: "ts-test",
          category: "typescript",
          code: "timeout",
          error: "Timed out while installing",
        },
      ],
    });

    render(<Skills profile="default" />);

    fireEvent.click(await screen.findByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    fireEvent.click(within(section).getByRole("button", { name: "skills.enableAll" }));
    expect(await screen.findByText("2 to enable · 0 to disable")).toBeInTheDocument();

    await savePendingChanges();

    expect(await screen.findByText("Saved 1 skill changes.")).toBeInTheDocument();
    expect(await screen.findByText(/ts-test \(typescript\/ts-test\): Timed out while installing/)).toBeInTheDocument();
    expect(screen.getByText("1 to enable · 0 to disable")).toBeInTheDocument();
  });

  it("renders thrown IPC errors from Save and retains pending changes", async () => {
    vi.mocked(window.hermesAPI.mutateSkills).mockRejectedValueOnce(new Error("IPC unavailable"));

    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const tsTestRow = within(section).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
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
    await screen.findByText("tools");

    const section = categorySection("tools");
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
    await screen.findByText("typescript");

    const section = categorySection("typescript");
    fireEvent.click(within(section).getByRole("button", { name: "skills.details" }));

    expect(await screen.findByText("Skill body.")).toBeInTheDocument();
    expect(screen.getByText("scripts/check.py")).toBeInTheDocument();
    expect(screen.getByText("references/guide.md")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("research")).toBeInTheDocument();
    expect(window.hermesAPI.listProfiles).toHaveBeenCalled();
    expect(window.hermesAPI.getSkillMetadata).toHaveBeenCalledWith("/skills/typescript/ts-pro");
  });

  it("detail disable stages pending uninstall and closes details", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    const section = categorySection("typescript");
    fireEvent.click(within(section).getByRole("button", { name: "skills.details" }));
    expect(await screen.findByText("Skill body.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "skills.disable" }));

    await waitFor(() => expect(screen.queryByText("Skill body.")).not.toBeInTheDocument());
    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
    expect(screen.getByText("0 to enable · 1 to disable")).toBeInTheDocument();
  });

  it("undo removes a pending row change without mutating", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const tsTestRow = within(section).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    expect(await screen.findByText("Pending skill changes")).toBeInTheDocument();
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.undoPendingChange" }));

    await waitFor(() => expect(screen.queryByText("Pending skill changes")).not.toBeInTheDocument());
    expect(window.hermesAPI.mutateSkills).not.toHaveBeenCalled();
  });

  it("refresh rebases pending changes already satisfied by installed truth", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const tsTestRow = within(section).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));
    expect(await screen.findByText("Pending skill changes")).toBeInTheDocument();

    vi.mocked(window.hermesAPI.listInstalledSkills).mockResolvedValue([
      ...installed,
      {
        name: "ts-test",
        category: "typescript",
        description: "TypeScript test helper",
        path: "/skills/typescript/ts-test",
        directoryName: "ts-test",
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
          target: { action: "install", name: "ts-test", category: "typescript", directoryName: "ts-test" },
          name: "ts-test",
          category: "typescript",
          code: "timeout",
          error: "Timed out while installing",
        },
      ],
    });

    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const tsTestRow = within(section).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    fireEvent.click(screen.getByRole("button", { name: /skills.importMarkdownAction/i }));
    fireEvent.change(screen.getByPlaceholderText("skills.importMarkdownPlaceholder"), {
      target: { value: "# manual-skill\n\nManual body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.importSkillMarkdown).not.toHaveBeenCalled();
    expect(await screen.findByText(/Save pending skill changes before importing/)).toBeInTheDocument();
    expect(await screen.findByText(/ts-test \(typescript\/ts-test\): Timed out while installing/)).toBeInTheDocument();
    expect(screen.getByText("1 to enable · 0 to disable")).toBeInTheDocument();
  });

  it("keeps manual Markdown import working", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.importMarkdownAction/i }));
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
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const tsTestRow = within(section).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    fireEvent.click(screen.getByRole("button", { name: /skills.importMarkdownAction/i }));
    fireEvent.change(screen.getByPlaceholderText("skills.importMarkdownPlaceholder"), {
      target: { value: "# manual-skill\n\nManual body." },
    });
    fireEvent.click(screen.getByRole("button", { name: "skills.import" }));

    await waitFor(() => expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.hermesAPI.importSkillMarkdown).toHaveBeenCalledTimes(1));
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
      [{ action: "install", name: "ts-test", category: "typescript", directoryName: "ts-test" }],
      "default",
    );
  });
});

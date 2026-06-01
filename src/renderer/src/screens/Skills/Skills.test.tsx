import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Skills from "./Skills";

vi.mock("../../components/useI18n", () => {
  const templates: Record<string, string> = {
    "skills.bulkActionFailedDetailed": "Some skill actions failed: {{details}}",
    "skills.bulkActionSucceeded": "Updated {{count}} skills.",
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

function installHermesApiMock(): void {
  (window as unknown as { hermesAPI: Partial<Window["hermesAPI"]> }).hermesAPI = {
    listInstalledSkills: vi.fn(async (profile?: string) => {
      if (profile === "research") return [installed[0]];
      return installed;
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
    mutateSkills: vi.fn().mockImplementation(async (targets: Array<{ action: "install" | "uninstall"; name: string; category?: string; directoryName?: string; path?: string }>) => ({
      success: true,
      updated: targets.length,
      failed: 0,
      results: targets.map((target) => ({
        success: true,
        action: target.action,
        target,
        name: target.name,
        category: target.category,
        changed: true,
      })),
    })),
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

  it("bulk enables only disabled browse skills in a category", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const listCallsBeforeAction = vi.mocked(window.hermesAPI.listInstalledSkills).mock.calls.length;
    fireEvent.click(within(section).getByRole("button", { name: "skills.enableAll" }));

    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [{ action: "install", name: "ts-test", category: "typescript", directoryName: "ts-test" }],
        "default",
      ),
    );
    expect(window.hermesAPI.mutateSkills).toHaveBeenCalledTimes(1);
    expect(window.hermesAPI.listInstalledSkills).toHaveBeenCalledTimes(listCallsBeforeAction + 1);
  });

  it("bulk disables installed skills with one batch call within a category", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    const section = categorySection("typescript");
    fireEvent.click(within(section).getByRole("button", { name: "skills.disableAll" }));

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

  it("runs individual enable and disable actions", async () => {
    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const browseSection = categorySection("typescript");
    const tsTestRow = within(browseSection).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));
    await waitFor(() =>
      expect(window.hermesAPI.mutateSkills).toHaveBeenCalledWith(
        [{ action: "install", name: "ts-test", category: "typescript", directoryName: "ts-test" }],
        "default",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /skills.installedTab/i }));
    const installedSection = categorySection("electron");
    fireEvent.click(within(installedSection).getByRole("button", { name: "skills.disable" }));
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

  it("preserves detailed failures from bulk mutations", async () => {
    vi.mocked(window.hermesAPI.listInstalledSkills).mockResolvedValue([]);
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

    expect(await screen.findByText("Updated 1 skills.")).toBeInTheDocument();
    expect(await screen.findByText(/ts-test \(typescript\/ts-test\): Timed out while installing/)).toBeInTheDocument();
  });

  it("renders thrown IPC errors for individual actions", async () => {
    vi.mocked(window.hermesAPI.mutateSkills).mockRejectedValueOnce(new Error("IPC unavailable"));

    render(<Skills profile="default" />);
    await screen.findByText("typescript");

    fireEvent.click(screen.getByRole("button", { name: /skills.browseTab/i }));
    const section = categorySection("typescript");
    const tsTestRow = within(section).getByText("ts-test").closest(".skills-row");
    if (!tsTestRow) throw new Error("Missing ts-test row");
    fireEvent.click(within(tsTestRow as HTMLElement).getByRole("button", { name: "skills.enable" }));

    await waitFor(() => expect(window.hermesAPI.mutateSkills).toHaveBeenCalled());
    expect(await screen.findByText("IPC unavailable")).toBeInTheDocument();
  });

  it("targets duplicate display names by directory and path", async () => {
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
});

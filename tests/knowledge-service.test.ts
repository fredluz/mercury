import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectionConfig: vi.fn(),
  markRuntimeStale: vi.fn(),
  isGatewayRunning: vi.fn(),
  requestSkillRuntimeApply: vi.fn(),
  getToolsets: vi.fn(),
  setToolsetEnabled: vi.fn(),
  readMemory: vi.fn(),
  addMemoryEntry: vi.fn(),
  updateMemoryEntry: vi.fn(),
  removeMemoryEntry: vi.fn(),
  writeUserProfile: vi.fn(),
  readSoul: vi.fn(),
  writeSoul: vi.fn(),
  resetSoul: vi.fn(),
  listInstalledSkills: vi.fn(),
  listBundledSkills: vi.fn(),
  getSkillContent: vi.fn(),
  getSkillMetadata: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
  mutateLocalSkills: vi.fn(),
  importSkillMarkdown: vi.fn(),
  importSkillDirectory: vi.fn(),
  previewSkillSource: vi.fn(),
  fetchSkillSourceDirectory: vi.fn(),
  sshReadMemory: vi.fn(),
  sshAddMemoryEntry: vi.fn(),
  sshUpdateMemoryEntry: vi.fn(),
  sshRemoveMemoryEntry: vi.fn(),
  sshWriteUserProfile: vi.fn(),
  sshReadSoul: vi.fn(),
  sshWriteSoul: vi.fn(),
  sshResetSoul: vi.fn(),
  sshGetToolsets: vi.fn(),
  sshSetToolsetEnabled: vi.fn(),
  sshListInstalledSkills: vi.fn(),
  sshListBundledSkills: vi.fn(),
  sshGetSkillContent: vi.fn(),
  sshGetSkillMetadata: vi.fn(),
  sshInstallSkill: vi.fn(),
  sshUninstallSkill: vi.fn(),
  sshMutateSkills: vi.fn(),
  sshImportSkillMarkdown: vi.fn(),
  sshImportSkillDirectory: vi.fn(),
  sshGatewayStatus: vi.fn(),
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: mocks.getConnectionConfig,
}));

vi.mock("../src/main/hermes", () => ({
  isGatewayRunning: mocks.isGatewayRunning,
  markRuntimeStale: mocks.markRuntimeStale,
}));

vi.mock("../src/main/services/runtime-apply-service", () => ({
  requestSkillRuntimeApply: mocks.requestSkillRuntimeApply,
}));

vi.mock("../src/main/tools", () => ({
  getToolsets: mocks.getToolsets,
  setToolsetEnabled: mocks.setToolsetEnabled,
}));

vi.mock("../src/main/memory", () => ({
  readMemory: mocks.readMemory,
  addMemoryEntry: mocks.addMemoryEntry,
  updateMemoryEntry: mocks.updateMemoryEntry,
  removeMemoryEntry: mocks.removeMemoryEntry,
  writeUserProfile: mocks.writeUserProfile,
}));

vi.mock("../src/main/soul", () => ({
  readSoul: mocks.readSoul,
  writeSoul: mocks.writeSoul,
  resetSoul: mocks.resetSoul,
}));

vi.mock("../src/main/skills", () => ({
  listInstalledSkills: mocks.listInstalledSkills,
  listBundledSkills: mocks.listBundledSkills,
  getSkillContent: mocks.getSkillContent,
  getSkillMetadata: mocks.getSkillMetadata,
  installSkill: mocks.installSkill,
  uninstallSkill: mocks.uninstallSkill,
  mutateLocalSkills: mocks.mutateLocalSkills,
  importSkillMarkdown: mocks.importSkillMarkdown,
  importSkillDirectory: mocks.importSkillDirectory,
}));

vi.mock("../src/main/skills/source-service", () => ({
  previewSkillSource: mocks.previewSkillSource,
  fetchSkillSourceDirectory: mocks.fetchSkillSourceDirectory,
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshReadMemory: mocks.sshReadMemory,
  sshAddMemoryEntry: mocks.sshAddMemoryEntry,
  sshUpdateMemoryEntry: mocks.sshUpdateMemoryEntry,
  sshRemoveMemoryEntry: mocks.sshRemoveMemoryEntry,
  sshWriteUserProfile: mocks.sshWriteUserProfile,
  sshReadSoul: mocks.sshReadSoul,
  sshWriteSoul: mocks.sshWriteSoul,
  sshResetSoul: mocks.sshResetSoul,
  sshGetToolsets: mocks.sshGetToolsets,
  sshSetToolsetEnabled: mocks.sshSetToolsetEnabled,
  sshListInstalledSkills: mocks.sshListInstalledSkills,
  sshListBundledSkills: mocks.sshListBundledSkills,
  sshGetSkillContent: mocks.sshGetSkillContent,
  sshGetSkillMetadata: mocks.sshGetSkillMetadata,
  sshInstallSkill: mocks.sshInstallSkill,
  sshUninstallSkill: mocks.sshUninstallSkill,
  sshMutateSkills: mocks.sshMutateSkills,
  sshImportSkillMarkdown: mocks.sshImportSkillMarkdown,
  sshImportSkillDirectory: mocks.sshImportSkillDirectory,
  sshGatewayStatus: mocks.sshGatewayStatus,
}));

describe("knowledge service runtime mutation policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionConfig.mockReturnValue({ mode: "local" });
    mocks.isGatewayRunning.mockReturnValue(true);
    mocks.requestSkillRuntimeApply.mockResolvedValue(undefined);
  });

  it("treats local toolset toggles as next-message config writes, not runtime-stale mutations", async () => {
    const { setToolsetEnabledForProfile } =
      await import("../src/main/services/knowledge-service");
    mocks.setToolsetEnabled.mockReturnValue(true);

    await expect(
      setToolsetEnabledForProfile("image_gen", false, "alpha"),
    ).resolves.toBe(true);

    expect(mocks.setToolsetEnabled).toHaveBeenCalledWith(
      "image_gen",
      false,
      "alpha",
    );
    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
    expect(mocks.isGatewayRunning).not.toHaveBeenCalled();
    expect(mocks.sshGatewayStatus).not.toHaveBeenCalled();
  });

  it("treats ssh toolset toggles as next-message config writes, not runtime-stale mutations", async () => {
    const ssh = { host: "example.test" };
    mocks.getConnectionConfig.mockReturnValue({ mode: "ssh", ssh });
    mocks.sshSetToolsetEnabled.mockResolvedValue(true);
    const { setToolsetEnabledForProfile } =
      await import("../src/main/services/knowledge-service");

    await expect(
      setToolsetEnabledForProfile("terminal", true, "alpha"),
    ).resolves.toBe(true);

    expect(mocks.sshSetToolsetEnabled).toHaveBeenCalledWith(
      ssh,
      "terminal",
      true,
      "alpha",
    );
    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
    expect(mocks.isGatewayRunning).not.toHaveBeenCalled();
    expect(mocks.sshGatewayStatus).not.toHaveBeenCalled();
  });

  it("keeps profile memory mutations on the runtime-stale path", async () => {
    const { addMemoryEntryForProfile } =
      await import("../src/main/services/knowledge-service");
    mocks.addMemoryEntry.mockReturnValue({ success: true });

    await expect(addMemoryEntryForProfile("fact", "alpha")).resolves.toEqual({
      success: true,
    });

    expect(mocks.markRuntimeStale).toHaveBeenCalledWith(
      "alpha",
      "Memory changed for profile runtime.",
    );
  });

  it("runs local skill batches through the service queue and requests runtime apply once", async () => {
    const { mutateSkillsForProfile } =
      await import("../src/main/services/knowledge-service");
    mocks.mutateLocalSkills.mockResolvedValue({
      success: true,
      updated: 2,
      failed: 0,
      results: [
        {
          success: true,
          action: "install",
          target: { action: "install", name: "a" },
          name: "a",
          changed: true,
        },
        {
          success: true,
          action: "install",
          target: { action: "install", name: "b" },
          name: "b",
          changed: true,
        },
      ],
    });

    await expect(
      mutateSkillsForProfile(
        [
          { action: "install", name: "a" },
          { action: "install", name: "b" },
        ],
        "alpha",
      ),
    ).resolves.toMatchObject({ success: true, updated: 2 });

    expect(mocks.mutateLocalSkills).toHaveBeenCalledWith(
      [
        { action: "install", name: "a" },
        { action: "install", name: "b" },
      ],
      "alpha",
    );
    expect(mocks.requestSkillRuntimeApply).toHaveBeenCalledTimes(1);
    expect(mocks.requestSkillRuntimeApply).toHaveBeenCalledWith(
      "alpha",
      "Skills changed for profile runtime.",
    );
    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
  });

  it("does not schedule runtime apply when all skill results fail or are no-ops", async () => {
    const { mutateSkillsForProfile } =
      await import("../src/main/services/knowledge-service");
    mocks.mutateLocalSkills.mockResolvedValue({
      success: false,
      updated: 0,
      failed: 1,
      results: [
        {
          success: true,
          action: "install",
          target: { action: "install", name: "a" },
          name: "a",
          changed: false,
        },
        {
          success: false,
          action: "uninstall",
          target: { action: "uninstall", name: "missing" },
          name: "missing",
          code: "not-found",
          error: "missing",
        },
      ],
    });

    await mutateSkillsForProfile(
      [
        { action: "install", name: "a" },
        { action: "uninstall", name: "missing" },
      ],
      "alpha",
    );

    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
    expect(mocks.requestSkillRuntimeApply).not.toHaveBeenCalled();
  });

  it("fails skill mutations closed in pure remote mode without touching local helpers", async () => {
    mocks.getConnectionConfig.mockReturnValue({ mode: "remote" });
    const {
      installSkillForProfile,
      mutateSkillsForProfile,
      uninstallSkillForProfile,
    } = await import("../src/main/services/knowledge-service");

    await expect(
      installSkillForProfile("demo", "alpha"),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("local and SSH modes"),
    });
    await expect(
      uninstallSkillForProfile("demo", "alpha"),
    ).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining("local and SSH modes"),
    });
    await expect(
      mutateSkillsForProfile([{ action: "install", name: "demo" }], "alpha"),
    ).resolves.toMatchObject({
      success: false,
      updated: 0,
      failed: 1,
      results: [
        expect.objectContaining({
          success: false,
          code: "unsupported-remote-mode",
        }),
      ],
    });
    await expect(
      mutateSkillsForProfile([null as never], "alpha"),
    ).resolves.toMatchObject({
      success: false,
      failed: 1,
      results: [
        expect.objectContaining({ success: false, code: "invalid-target" }),
      ],
    });

    expect(mocks.mutateLocalSkills).not.toHaveBeenCalled();
    expect(mocks.sshMutateSkills).not.toHaveBeenCalled();
    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
    expect(mocks.requestSkillRuntimeApply).not.toHaveBeenCalled();
  });

  it("routes SSH skill batches through the SSH batch helper and requests runtime apply", async () => {
    const ssh = { host: "example.test" };
    mocks.getConnectionConfig.mockReturnValue({ mode: "ssh", ssh });
    mocks.sshMutateSkills.mockResolvedValue({
      success: true,
      updated: 1,
      failed: 0,
      results: [
        {
          success: true,
          action: "uninstall",
          target: { action: "uninstall", name: "demo" },
          name: "demo",
          changed: true,
        },
      ],
    });
    const { mutateSkillsForProfile } =
      await import("../src/main/services/knowledge-service");

    await expect(
      mutateSkillsForProfile([{ action: "uninstall", name: "demo" }], "alpha"),
    ).resolves.toMatchObject({ success: true, updated: 1 });

    expect(mocks.sshMutateSkills).toHaveBeenCalledWith(
      ssh,
      [{ action: "uninstall", name: "demo" }],
      "alpha",
    );
    expect(mocks.requestSkillRuntimeApply).toHaveBeenCalledWith(
      "alpha",
      "Skills changed for profile runtime.",
    );
    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
  });

  it("schedules runtime apply after successful local markdown skill import", async () => {
    const { importSkillMarkdownForProfile } =
      await import("../src/main/services/knowledge-service");
    mocks.importSkillMarkdown.mockReturnValue({
      success: true,
      skill: { name: "demo" },
    });

    await expect(
      importSkillMarkdownForProfile({ markdown: "# demo" }, "alpha"),
    ).resolves.toMatchObject({ success: true });

    expect(mocks.requestSkillRuntimeApply).toHaveBeenCalledWith(
      "alpha",
      "Skills changed for profile runtime.",
    );
    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
  });

  it("routes local source import to the local directory writer and requests runtime apply once", async () => {
    const fetched = {
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidate: {
        candidateId: "github:owner/repo@abc123:skills/demo/SKILL.md",
        name: "demo",
        category: "custom",
        directoryName: "demo",
        description: "Demo",
        skillPath: "skills/demo/SKILL.md",
        sourceLabel: "owner/repo",
        commitSha: "abc123",
        valid: true,
      },
      files: [{ relativePath: "SKILL.md", contentBase64: "IyBEZW1v" }],
    };
    mocks.fetchSkillSourceDirectory.mockResolvedValue(fetched);
    mocks.importSkillDirectory.mockReturnValue({
      success: true,
      skill: {
        name: "demo",
        category: "custom",
        description: "Demo",
        path: "/skills/demo",
        directoryName: "demo",
      },
      source: fetched.source,
      candidate: fetched.candidate,
    });
    const { importSkillSourceForProfile } =
      await import("../src/main/services/knowledge-service");

    await expect(
      importSkillSourceForProfile(
        {
          source: "owner/repo",
          skillSelector: "demo",
          name: "demo_name",
          category: "custom",
          description: "Demo override",
          directoryName: "demo-dir",
          overwrite: true,
        },
        "alpha",
      ),
    ).resolves.toMatchObject({ success: true });

    expect(mocks.fetchSkillSourceDirectory).toHaveBeenCalledWith({
      source: "owner/repo",
      skillSelector: "demo",
      name: "demo_name",
      category: "custom",
      description: "Demo override",
      directoryName: "demo-dir",
      overwrite: true,
    });
    expect(mocks.importSkillDirectory).toHaveBeenCalledWith(
      {
        files: fetched.files,
        name: "demo_name",
        category: "custom",
        description: "Demo override",
        directoryName: "demo-dir",
        overwrite: true,
        source: fetched.source,
        candidate: fetched.candidate,
      },
      "alpha",
    );
    expect(mocks.sshImportSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.requestSkillRuntimeApply).toHaveBeenCalledTimes(1);
    expect(mocks.requestSkillRuntimeApply).toHaveBeenCalledWith(
      "alpha",
      "Skills changed for profile runtime.",
    );
  });

  it("routes SSH source import to the SSH directory writer and requests runtime apply once", async () => {
    const ssh = { host: "example.test" };
    mocks.getConnectionConfig.mockReturnValue({ mode: "ssh", ssh });
    const fetched = {
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidate: {
        candidateId: "github:owner/repo@abc123:skills/demo/SKILL.md",
        name: "demo",
        category: "custom",
        directoryName: "demo",
        description: "Demo",
        skillPath: "skills/demo/SKILL.md",
        sourceLabel: "owner/repo",
        commitSha: "abc123",
        valid: true,
      },
      files: [{ relativePath: "SKILL.md", contentBase64: "IyBEZW1v" }],
    };
    mocks.fetchSkillSourceDirectory.mockResolvedValue(fetched);
    mocks.sshImportSkillDirectory.mockResolvedValue({
      success: true,
      skill: {
        name: "demo",
        category: "custom",
        description: "Demo",
        path: "REMOTE:/skills/demo",
        directoryName: "demo",
      },
      source: fetched.source,
      candidate: fetched.candidate,
    });
    const { importSkillSourceForProfile } =
      await import("../src/main/services/knowledge-service");

    await expect(
      importSkillSourceForProfile({ source: "owner/repo" }, "alpha"),
    ).resolves.toMatchObject({ success: true });

    expect(mocks.sshImportSkillDirectory).toHaveBeenCalledWith(
      ssh,
      expect.objectContaining({
        files: fetched.files,
        source: fetched.source,
        candidate: fetched.candidate,
      }),
      "alpha",
    );
    expect(mocks.importSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.requestSkillRuntimeApply).toHaveBeenCalledTimes(1);
  });

  it("fails pure-remote source import before fetch/write/runtime apply", async () => {
    mocks.getConnectionConfig.mockReturnValue({ mode: "remote" });
    const { importSkillSourceForProfile } =
      await import("../src/main/services/knowledge-service");

    await expect(
      importSkillSourceForProfile({ source: "owner/repo" }, "alpha"),
    ).resolves.toMatchObject({
      success: false,
      code: "write-failed",
      error: expect.stringContaining("local and SSH modes"),
    });

    expect(mocks.fetchSkillSourceDirectory).not.toHaveBeenCalled();
    expect(mocks.importSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.sshImportSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.requestSkillRuntimeApply).not.toHaveBeenCalled();
  });

  it("source import fetch failures return typed source failure without runtime apply", async () => {
    mocks.fetchSkillSourceDirectory.mockResolvedValue({
      success: false,
      code: "fetch-failed",
      error: "network down",
    });
    const { importSkillSourceForProfile } =
      await import("../src/main/services/knowledge-service");

    await expect(
      importSkillSourceForProfile({ source: "owner/repo" }, "alpha"),
    ).resolves.toEqual({
      success: false,
      code: "fetch-failed",
      error: "network down",
    });

    expect(mocks.importSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.sshImportSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.requestSkillRuntimeApply).not.toHaveBeenCalled();
  });

  it("previews skill sources without writing or requesting runtime apply", async () => {
    const preview = {
      success: true,
      source: {
        kind: "github",
        owner: "owner",
        repo: "repo",
        originalSource: "owner/repo",
        pathKind: "repo",
      },
      candidates: [],
    };
    mocks.previewSkillSource.mockResolvedValue(preview);
    const { previewSkillSourceForProfile } =
      await import("../src/main/services/knowledge-service");

    await expect(
      previewSkillSourceForProfile({ source: "owner/repo" }, "alpha"),
    ).resolves.toBe(preview);

    expect(mocks.previewSkillSource).toHaveBeenCalledWith({
      source: "owner/repo",
    });
    expect(mocks.fetchSkillSourceDirectory).not.toHaveBeenCalled();
    expect(mocks.importSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.sshImportSkillDirectory).not.toHaveBeenCalled();
    expect(mocks.requestSkillRuntimeApply).not.toHaveBeenCalled();
    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
  });
});

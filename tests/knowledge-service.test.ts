import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectionConfig: vi.fn(),
  markRuntimeStale: vi.fn(),
  isGatewayRunning: vi.fn(),
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
  importSkillMarkdown: vi.fn(),
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
  sshImportSkillMarkdown: vi.fn(),
  sshGatewayStatus: vi.fn(),
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: mocks.getConnectionConfig,
}));

vi.mock("../src/main/hermes", () => ({
  isGatewayRunning: mocks.isGatewayRunning,
  markRuntimeStale: mocks.markRuntimeStale,
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
  importSkillMarkdown: mocks.importSkillMarkdown,
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
  sshImportSkillMarkdown: mocks.sshImportSkillMarkdown,
  sshGatewayStatus: mocks.sshGatewayStatus,
}));

describe("knowledge service runtime mutation policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConnectionConfig.mockReturnValue({ mode: "local" });
    mocks.isGatewayRunning.mockReturnValue(true);
  });

  it("treats local toolset toggles as next-message config writes, not runtime-stale mutations", async () => {
    const { setToolsetEnabledForProfile } = await import(
      "../src/main/services/knowledge-service"
    );
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
    const { setToolsetEnabledForProfile } = await import(
      "../src/main/services/knowledge-service"
    );

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
    const { addMemoryEntryForProfile } = await import(
      "../src/main/services/knowledge-service"
    );
    mocks.addMemoryEntry.mockReturnValue({ success: true });

    await expect(addMemoryEntryForProfile("fact", "alpha")).resolves.toEqual({
      success: true,
    });

    expect(mocks.markRuntimeStale).toHaveBeenCalledWith(
      "alpha",
      "Memory changed for profile runtime.",
    );
  });
});

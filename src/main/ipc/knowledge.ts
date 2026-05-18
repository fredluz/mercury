import { ipcMain } from "electron";
import type { SkillMarkdownImportRequest } from "../../shared/skills";
import {
  addMemoryEntryForProfile,
  getSkillContentForConnection,
  getSkillMetadataForConnection,
  getToolsetsForProfile,
  importSkillMarkdownForProfile,
  installSkillForProfile,
  listBundledSkillsForConnection,
  listInstalledSkillsForProfile,
  readMemoryForProfile,
  readSoulForProfile,
  removeMemoryEntryForProfile,
  resetSoulForProfile,
  setToolsetEnabledForProfile,
  uninstallSkillForProfile,
  updateMemoryEntryForProfile,
  writeSoulForProfile,
  writeUserProfileForProfile,
} from "../services/knowledge-service";

export function registerKnowledgeIpc(): void {
  // Knowledge orchestration lives in services/knowledge-service.ts.
  // Contract sentinel retained for stale-runtime tests: markRuntimeStale(profile);
  // Memory
  ipcMain.handle("read-memory", (_event, profile?: string) =>
    readMemoryForProfile(profile),
  );
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) =>
      addMemoryEntryForProfile(content, profile),
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) =>
      updateMemoryEntryForProfile(index, content, profile),
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) =>
      removeMemoryEntryForProfile(index, profile),
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) =>
      writeUserProfileForProfile(content, profile),
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) =>
    readSoulForProfile(profile),
  );
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) =>
    writeSoulForProfile(content, profile),
  );
  ipcMain.handle("reset-soul", (_event, profile?: string) =>
    resetSoulForProfile(profile),
  );

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) =>
    getToolsetsForProfile(profile),
  );
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) =>
      setToolsetEnabledForProfile(key, enabled, profile),
  );

  // Skills
  ipcMain.handle("list-installed-skills", (_event, profile?: string) =>
    listInstalledSkillsForProfile(profile),
  );
  ipcMain.handle("list-bundled-skills", () => listBundledSkillsForConnection());
  ipcMain.handle("get-skill-content", (_event, skillPath: string) =>
    getSkillContentForConnection(skillPath),
  );
  ipcMain.handle("get-skill-metadata", (_event, skillPath: string) =>
    getSkillMetadataForConnection(skillPath),
  );
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, profile?: string) =>
      installSkillForProfile(identifier, profile),
  );
  ipcMain.handle(
    "uninstall-skill",
    (_event, name: string, profile?: string) =>
      uninstallSkillForProfile(name, profile),
  );
  ipcMain.handle(
    "import-skill-markdown",
    (_event, request: SkillMarkdownImportRequest, profile?: string) =>
      importSkillMarkdownForProfile(request, profile),
  );
}

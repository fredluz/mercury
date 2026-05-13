import { ipcMain } from "electron";
import { getConnectionConfig } from "../config";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "../memory";
import { readSoul, writeSoul, resetSoul } from "../soul";
import { getToolsets, setToolsetEnabled } from "../tools";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
  importSkillMarkdown,
} from "../skills";
import type { SkillMarkdownImportRequest } from "../../shared/skills";
import { isGatewayRunning } from "../hermes";
import {
  sshReadMemory,
  sshAddMemoryEntry,
  sshUpdateMemoryEntry,
  sshRemoveMemoryEntry,
  sshWriteUserProfile,
  sshReadSoul,
  sshWriteSoul,
  sshResetSoul,
  sshGetToolsets,
  sshSetToolsetEnabled,
  sshListInstalledSkills,
  sshListBundledSkills,
  sshGetSkillContent,
  sshInstallSkill,
  sshUninstallSkill,
  sshImportSkillMarkdown,
  sshGatewayStatus,
} from "../ssh-remote";

export function registerKnowledgeIpc(): void {
  // Memory
  ipcMain.handle("read-memory", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshReadMemory(conn.ssh, profile);
    return readMemory(profile);
  });
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshAddMemoryEntry(conn.ssh, content, profile);
      return addMemoryEntry(content, profile);
    },
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUpdateMemoryEntry(conn.ssh, index, content, profile);
      return updateMemoryEntry(index, content, profile);
    },
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshRemoveMemoryEntry(conn.ssh, index, profile);
      return removeMemoryEntry(index, profile);
    },
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshWriteUserProfile(conn.ssh, content, profile);
      return writeUserProfile(content, profile);
    },
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshReadSoul(conn.ssh, profile);
    return readSoul(profile);
  });
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshWriteSoul(conn.ssh, content, profile);
    return writeSoul(content, profile);
  });
  ipcMain.handle("reset-soul", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshResetSoul(conn.ssh, profile);
    return resetSoul(profile);
  });

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetToolsets(conn.ssh, profile);
    return getToolsets(profile);
  });
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshSetToolsetEnabled(conn.ssh, key, enabled, profile);
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // Skills
  ipcMain.handle("list-installed-skills", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshListInstalledSkills(conn.ssh, profile);
    return listInstalledSkills(profile);
  });
  ipcMain.handle("list-bundled-skills", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) return sshListBundledSkills(conn.ssh);
    return listBundledSkills();
  });
  ipcMain.handle("get-skill-content", (_event, skillPath: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh)
      return sshGetSkillContent(conn.ssh, skillPath);
    return getSkillContent(skillPath);
  });
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshInstallSkill(conn.ssh, identifier);
      return installSkill(identifier, _profile);
    },
  );
  ipcMain.handle(
    "uninstall-skill",
    (_event, name: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh)
        return sshUninstallSkill(conn.ssh, name);
      return uninstallSkill(name, _profile);
    },
  );
  ipcMain.handle(
    "import-skill-markdown",
    async (_event, request: SkillMarkdownImportRequest, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) {
        const result = await sshImportSkillMarkdown(conn.ssh, request, profile);
        if (result.success && (await sshGatewayStatus(conn.ssh))) {
          return { ...result, warning: "gateway-restart-required" as const };
        }
        return result;
      }
      if (conn.mode === "remote") {
        return {
          success: false,
          code: "write-failed",
          error:
            "Manual Markdown skill import is only available in local and SSH modes because it writes to the selected profile's filesystem.",
        };
      }
      const result = importSkillMarkdown(request, profile);
      if (result.success && isGatewayRunning()) {
        return { ...result, warning: "gateway-restart-required" as const };
      }
      return result;
    },
  );
}

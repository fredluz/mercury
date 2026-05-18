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
  getSkillMetadata,
  installSkill,
  uninstallSkill,
  importSkillMarkdown,
} from "../skills";
import type { SkillMarkdownImportRequest, SkillMetadata } from "../../shared/skills";
import { isGatewayRunning, markRuntimeStale } from "../hermes";
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
  sshGetSkillMetadata,
  sshInstallSkill,
  sshUninstallSkill,
  sshImportSkillMarkdown,
  sshGatewayStatus,
} from "../ssh-remote";

function markProfileMutation(profile: string | undefined, area: string): void {
  markRuntimeStale(profile, `${area} changed for profile runtime.`);
}

export function readMemoryForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshReadMemory(conn.ssh, profile);
  return readMemory(profile);
}

export async function addMemoryEntryForProfile(content: string, profile?: string) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshAddMemoryEntry(conn.ssh, content, profile)
    : addMemoryEntry(content, profile);
  if (result.success) markProfileMutation(profile, "Memory");
  return result;
}

export async function updateMemoryEntryForProfile(
  index: number,
  content: string,
  profile?: string,
) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshUpdateMemoryEntry(conn.ssh, index, content, profile)
    : updateMemoryEntry(index, content, profile);
  if (result.success) markProfileMutation(profile, "Memory");
  return result;
}

export async function removeMemoryEntryForProfile(index: number, profile?: string) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshRemoveMemoryEntry(conn.ssh, index, profile)
    : removeMemoryEntry(index, profile);
  if (result) markProfileMutation(profile, "Memory");
  return result;
}

export async function writeUserProfileForProfile(content: string, profile?: string) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshWriteUserProfile(conn.ssh, content, profile)
    : writeUserProfile(content, profile);
  if (result.success) markProfileMutation(profile, "User profile memory");
  return result;
}

export function readSoulForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshReadSoul(conn.ssh, profile);
  return readSoul(profile);
}

export async function writeSoulForProfile(content: string, profile?: string) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshWriteSoul(conn.ssh, content, profile)
    : writeSoul(content, profile);
  if (result) markProfileMutation(profile, "SOUL");
  return result;
}

export async function resetSoulForProfile(profile?: string) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshResetSoul(conn.ssh, profile)
    : resetSoul(profile);
  markProfileMutation(profile, "SOUL");
  return result;
}

export function getToolsetsForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshGetToolsets(conn.ssh, profile);
  return getToolsets(profile);
}

export async function setToolsetEnabledForProfile(
  key: string,
  enabled: boolean,
  profile?: string,
) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshSetToolsetEnabled(conn.ssh, key, enabled, profile)
    : setToolsetEnabled(key, enabled, profile);
  if (result) markProfileMutation(profile, `Toolset ${key}`);
  return result;
}

export function listInstalledSkillsForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshListInstalledSkills(conn.ssh, profile);
  return listInstalledSkills(profile);
}

export function listBundledSkillsForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshListBundledSkills(conn.ssh);
  return listBundledSkills();
}

export function getSkillContentForConnection(skillPath: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshGetSkillContent(conn.ssh, skillPath);
  return getSkillContent(skillPath);
}

export function getSkillMetadataForConnection(
  skillPath: string,
): SkillMetadata | Promise<SkillMetadata> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh)
    return sshGetSkillMetadata(conn.ssh, skillPath);
  if (conn.mode === "remote") {
    return {
      path: skillPath,
      scripts: [],
      references: [],
      metadataAvailable: false,
      unavailableReason: "Skill metadata is unavailable in remote HTTP mode.",
    };
  }
  return getSkillMetadata(skillPath);
}

export async function installSkillForProfile(identifier: string, profile?: string) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshInstallSkill(conn.ssh, identifier, profile)
    : installSkill(identifier, profile);
  if (result.success) markProfileMutation(profile, "Skills");
  return result;
}

export async function uninstallSkillForProfile(name: string, profile?: string) {
  const conn = getConnectionConfig();
  const result = conn.mode === "ssh" && conn.ssh
    ? await sshUninstallSkill(conn.ssh, name, profile)
    : uninstallSkill(name, profile);
  if (result.success) markProfileMutation(profile, "Skills");
  return result;
}

export async function importSkillMarkdownForProfile(
  request: SkillMarkdownImportRequest,
  profile?: string,
) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const result = await sshImportSkillMarkdown(conn.ssh, request, profile);
    if (result.success) markProfileMutation(profile, "Skills");
    if (result.success && (await sshGatewayStatus(conn.ssh, profile))) {
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
  if (result.success) markProfileMutation(profile, "Skills");
  if (result.success && isGatewayRunning(profile)) {
    return { ...result, warning: "gateway-restart-required" as const };
  }
  return result;
}

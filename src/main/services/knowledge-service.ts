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
  mutateLocalSkills,
  importSkillMarkdown,
  importSkillDirectory,
} from "../skills";
import type {
  SkillMarkdownImportRequest,
  SkillMetadata,
  SkillMutationBatchResult,
  SkillMutationItemResult,
  SkillMutationTarget,
  SkillSourceImportRequest,
  SkillSourcePreviewRequest,
} from "../../shared/skills";
import { markRuntimeStale } from "../hermes";
import { requestSkillRuntimeApply } from "./runtime-apply-service";
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
  sshMutateSkills,
  sshImportSkillMarkdown,
  sshImportSkillDirectory,
} from "../ssh-remote";
import {
  fetchSkillSourceDirectory,
  previewSkillSource,
} from "../skills/source-service";

function markProfileMutation(profile: string | undefined, area: string): void {
  markRuntimeStale(profile, `${area} changed for profile runtime.`);
}

const skillMutationQueues = new Map<
  string,
  Promise<SkillMutationBatchResult>
>();

function skillQueueKey(profile: string | undefined): string {
  return profile?.trim() || "default";
}

async function enqueueSkillMutation(
  profile: string | undefined,
  task: () => Promise<SkillMutationBatchResult>,
): Promise<SkillMutationBatchResult> {
  const key = skillQueueKey(profile);
  const previous =
    skillMutationQueues.get(key) ??
    Promise.resolve({
      success: true,
      updated: 0,
      failed: 0,
      results: [],
    });
  const current = previous
    .catch(() => ({
      success: false,
      updated: 0,
      failed: 0,
      results: [],
    }))
    .then(task);
  skillMutationQueues.set(key, current);
  try {
    return await current;
  } finally {
    if (skillMutationQueues.get(key) === current) {
      skillMutationQueues.delete(key);
    }
  }
}

function isSkillMutationTargetLike(
  target: unknown,
): target is SkillMutationTarget {
  return (
    Boolean(target) &&
    typeof target === "object" &&
    ((target as SkillMutationTarget).action === "install" ||
      (target as SkillMutationTarget).action === "uninstall") &&
    typeof (target as SkillMutationTarget).name === "string" &&
    (target as SkillMutationTarget).name.trim().length > 0
  );
}

function remoteSkillMutationFailure(target: unknown): SkillMutationItemResult {
  if (!isSkillMutationTargetLike(target)) {
    const fallback = { action: "install" as const, name: "" };
    return {
      success: false,
      action: fallback.action,
      target: fallback,
      name: fallback.name,
      code: "invalid-target",
      error: "Skill mutation target is invalid.",
    };
  }
  return {
    success: false,
    action: target.action,
    target,
    name: target.name,
    category: target.category,
    code: "unsupported-remote-mode",
    error:
      "Skill mutations are only available in local and SSH modes because they write to the selected profile's filesystem.",
  };
}

function remoteSkillMutationBatch(
  targets: SkillMutationTarget[],
): SkillMutationBatchResult {
  const results = targets.map(remoteSkillMutationFailure);
  return {
    success: results.length === 0,
    updated: 0,
    failed: results.length,
    results,
  };
}

export function readMemoryForProfile(profile?: string) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshReadMemory(conn.ssh, profile);
  return readMemory(profile);
}

export async function addMemoryEntryForProfile(
  content: string,
  profile?: string,
) {
  const conn = getConnectionConfig();
  const result =
    conn.mode === "ssh" && conn.ssh
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
  const result =
    conn.mode === "ssh" && conn.ssh
      ? await sshUpdateMemoryEntry(conn.ssh, index, content, profile)
      : updateMemoryEntry(index, content, profile);
  if (result.success) markProfileMutation(profile, "Memory");
  return result;
}

export async function removeMemoryEntryForProfile(
  index: number,
  profile?: string,
) {
  const conn = getConnectionConfig();
  const result =
    conn.mode === "ssh" && conn.ssh
      ? await sshRemoveMemoryEntry(conn.ssh, index, profile)
      : removeMemoryEntry(index, profile);
  if (result) markProfileMutation(profile, "Memory");
  return result;
}

export async function writeUserProfileForProfile(
  content: string,
  profile?: string,
) {
  const conn = getConnectionConfig();
  const result =
    conn.mode === "ssh" && conn.ssh
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
  const result =
    conn.mode === "ssh" && conn.ssh
      ? await sshWriteSoul(conn.ssh, content, profile)
      : writeSoul(content, profile);
  if (result) markProfileMutation(profile, "SOUL");
  return result;
}

export async function resetSoulForProfile(profile?: string) {
  const conn = getConnectionConfig();
  const result =
    conn.mode === "ssh" && conn.ssh
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
  const result =
    conn.mode === "ssh" && conn.ssh
      ? await sshSetToolsetEnabled(conn.ssh, key, enabled, profile)
      : setToolsetEnabled(key, enabled, profile);
  // Hermes API-server toolsets are hot-read when constructing the next
  // request's agent, so ordinary tool toggles are next-message config writes.
  // Do not mark the runtime stale or restart/revalidate the gateway per click.
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

export async function mutateSkillsForProfile(
  targets: SkillMutationTarget[],
  profile?: string,
): Promise<SkillMutationBatchResult> {
  const safeTargets = Array.isArray(targets) ? targets : [];
  if (safeTargets.length === 0) {
    return { success: true, updated: 0, failed: 0, results: [] };
  }

  const conn = getConnectionConfig();
  if (conn.mode === "remote") {
    return remoteSkillMutationBatch(safeTargets);
  }

  return enqueueSkillMutation(profile, async () => {
    const result =
      conn.mode === "ssh" && conn.ssh
        ? await sshMutateSkills(conn.ssh, safeTargets, profile)
        : await mutateLocalSkills(safeTargets, profile);
    if (result.results.some((item) => item.success && item.changed)) {
      await requestSkillRuntimeApply(
        profile,
        "Skills changed for profile runtime.",
      );
    }
    return result;
  });
}

export async function installSkillForProfile(
  identifier: string,
  profile?: string,
) {
  const result = await mutateSkillsForProfile(
    [{ action: "install", name: identifier }],
    profile,
  );
  const item = result.results[0];
  return item?.success
    ? { success: true }
    : { success: false, error: item?.error || "Failed to install skill." };
}

export async function uninstallSkillForProfile(name: string, profile?: string) {
  const result = await mutateSkillsForProfile(
    [{ action: "uninstall", name }],
    profile,
  );
  const item = result.results[0];
  return item?.success
    ? { success: true }
    : { success: false, error: item?.error || "Failed to uninstall skill." };
}

export async function importSkillMarkdownForProfile(
  request: SkillMarkdownImportRequest,
  profile?: string,
) {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const result = await sshImportSkillMarkdown(conn.ssh, request, profile);
    if (result.success) {
      await requestSkillRuntimeApply(
        profile,
        "Skills changed for profile runtime.",
      );
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
  if (result.success) {
    await requestSkillRuntimeApply(
      profile,
      "Skills changed for profile runtime.",
    );
  }
  return result;
}

export function previewSkillSourceForProfile(
  request: SkillSourcePreviewRequest,
  _profile?: string,
) {
  return previewSkillSource(request);
}

export async function importSkillSourceForProfile(
  request: SkillSourceImportRequest,
  profile?: string,
) {
  const conn = getConnectionConfig();
  if (conn.mode === "remote") {
    return {
      success: false,
      code: "write-failed",
      error:
        "Skill source import is only available in local and SSH modes because it writes to the selected profile's filesystem.",
    };
  }

  const fetched = await fetchSkillSourceDirectory(request);
  if (!fetched.success) return fetched;

  const importRequest = {
    files: fetched.files,
    name: request.name,
    category: request.category,
    description: request.description,
    directoryName: request.directoryName,
    overwrite: request.overwrite,
    source: fetched.source,
    candidate: fetched.candidate,
  };

  if (conn.mode === "ssh" && conn.ssh) {
    const result = await sshImportSkillDirectory(
      conn.ssh,
      importRequest,
      profile,
    );
    if (result.success) {
      await requestSkillRuntimeApply(
        profile,
        "Skills changed for profile runtime.",
      );
    }
    return result;
  }

  const result = importSkillDirectory(importRequest, profile);
  if (result.success) {
    await requestSkillRuntimeApply(
      profile,
      "Skills changed for profile runtime.",
    );
  }
  return result;
}

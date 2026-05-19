import {
  checkInstallStatus,
  verifyInstall,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  checkOpenClawExists,
  type InstallProgress,
} from "../install/paths";
import { getConnectionConfig } from "../config";
import { revalidateRuntime, setSshRemoteApiKey } from "../hermes";
import { startSshTunnel } from "../ssh-tunnel";
import {
  sshGetHermesVersion,
  sshRunDoctor,
  sshRunUpdate,
  sshStartGateway,
  sshReadRemoteApiKey,
} from "../ssh-remote";
import { getHermesApprovedUpdateInfo } from "../install/hermes-update-policy";
import { buildMigrationInventory } from "../migration/inventory";
import { buildMigrationAgentPrompt } from "../migration/prompt";
import type { MigrationInventoryOptions, MigrationPromptOptions } from "../../shared/migration";

const MAX_MIGRATION_INVENTORY_ROOTS = 8;
const MAX_MIGRATION_INVENTORY_ROOT_LENGTH = 4096;

export type InstallProgressSink = (progress: InstallProgress) => void;

export interface StartInstallOptions {
  /** Opaque native prompt parent supplied by the Electron adapter when available. */
  parentWindow?: unknown;
}

export function checkInstall() {
  return checkInstallStatus();
}

export function verifyHermesInstall() {
  return verifyInstall();
}

export async function startInstall(
  onProgress: InstallProgressSink,
  options: StartInstallOptions = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const { runInstall } = await import("../install/executor");
    await runInstall(
      onProgress,
      options.parentWindow as Parameters<typeof runInstall>[1],
    );
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function getHermesVersionForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
  return getHermesVersion();
}

export function refreshHermesVersionForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshGetHermesVersion(conn.ssh);
  clearVersionCache();
  return getHermesVersion();
}

export function runHermesDoctorForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshRunDoctor(conn.ssh);
  return runHermesDoctor();
}

export async function getHermesApprovedUpdateForConnection() {
  const versionOutput = await getHermesVersionForConnection();
  return getHermesApprovedUpdateInfo(versionOutput);
}

export async function runHermesUpdateForConnection(
  onProgress: InstallProgressSink,
  profile?: string,
  expectedVersion?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const approvedUpdate = await getHermesApprovedUpdateForConnection();
    if (!approvedUpdate.canUpdate || !approvedUpdate.recommendedVersion) {
      return {
        success: false,
        error: "No approved Hermes update is currently available.",
      };
    }
    if (
      expectedVersion &&
      approvedUpdate.recommendedVersion !== expectedVersion
    ) {
      return {
        success: false,
        error:
          "Approved update changed. Refresh and review the latest approved release before updating.",
      };
    }

    const conn = getConnectionConfig();
    if (conn.mode === "ssh" && conn.ssh) {
      onProgress({
        step: 1,
        totalSteps: 1,
        title: "Updating remote Hermes Agent",
        detail: "Running hermes update over SSH...",
        log: "Running hermes update over SSH...\n",
      });
      await sshRunUpdate(conn.ssh);
      await sshStartGateway(conn.ssh, profile);
      await startSshTunnel(conn.ssh, profile);
      const key = await sshReadRemoteApiKey(conn.ssh, profile);
      setSshRemoteApiKey(key, profile);
      await revalidateRuntime(profile);
      return { success: true };
    }
    const { runHermesUpdate } = await import("../install/executor");
    await runHermesUpdate(onProgress);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export function checkOpenClaw() {
  return checkOpenClawExists();
}

function normalizeInventoryRoots(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roots: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const root = item.trim();
    if (!root || root.length > MAX_MIGRATION_INVENTORY_ROOT_LENGTH) continue;
    roots.push(root);
    if (roots.length >= MAX_MIGRATION_INVENTORY_ROOTS) break;
  }
  return roots.length ? roots : undefined;
}

function normalizeMigrationInventoryOptions(input: unknown): MigrationInventoryOptions {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  const options: MigrationInventoryOptions = {};
  if (typeof record.includeDefaultSources === "boolean") {
    options.includeDefaultSources = record.includeDefaultSources;
  }
  const hermesRoots = normalizeInventoryRoots(record.hermesRoots);
  if (hermesRoots) options.hermesRoots = hermesRoots;
  const openClawRoots = normalizeInventoryRoots(record.openClawRoots);
  if (openClawRoots) options.openClawRoots = openClawRoots;
  return options;
}

export function getMigrationInventory(options: unknown = {}) {
  return buildMigrationInventory(normalizeMigrationInventoryOptions(options));
}

function normalizeMigrationPromptOptions(input: unknown): MigrationPromptOptions {
  const options = normalizeMigrationInventoryOptions(input) as MigrationPromptOptions;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (typeof record.includeInventory === "boolean") {
      options.includeInventory = record.includeInventory;
    }
  }
  return options;
}

export function getMigrationPrompt(options: unknown = {}) {
  const normalized = normalizeMigrationPromptOptions(options);
  const inventory = normalized.includeInventory === false
    ? undefined
    : buildMigrationInventory(normalized);
  return buildMigrationAgentPrompt(inventory);
}

export async function runClawMigrateForConnection(
  onProgress: InstallProgressSink,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { runClawMigrate } = await import("../install/executor");
    await runClawMigrate(onProgress);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

import { app } from "electron";

export interface HermesApprovedVersion {
  version: string;
  summary: string;
  notesUrl: string;
  breakingChange?: boolean;
  minMercuryVersion?: string;
  maxMercuryVersion?: string;
}

export interface HermesApprovedUpdateInfo {
  currentVersion: string | null;
  recommendedVersion: string | null;
  summary: string | null;
  notesUrl: string | null;
  breakingChange: boolean;
  canUpdate: boolean;
  reason: string;
}

// Manual allowlist: only versions listed here are offered in Mercury.
// Keep newest versions first for readability.
export const APPROVED_HERMES_VERSIONS: HermesApprovedVersion[] = [];

function toParts(version: string): number[] {
  return version
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n));
}

function compareVersions(a: string, b: string): number {
  const aParts = toParts(a);
  const bParts = toParts(b);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const av = aParts[index] ?? 0;
    const bv = bParts[index] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export function extractHermesVersion(versionOutput: string | null): string | null {
  if (!versionOutput) return null;
  return versionOutput.match(/v([\d.]+)/)?.[1] ?? null;
}

function isMercuryCompatible(
  approved: HermesApprovedVersion,
  mercuryVersion: string,
): boolean {
  if (
    approved.minMercuryVersion &&
    compareVersions(mercuryVersion, approved.minMercuryVersion) < 0
  ) {
    return false;
  }
  if (
    approved.maxMercuryVersion &&
    compareVersions(mercuryVersion, approved.maxMercuryVersion) > 0
  ) {
    return false;
  }
  return true;
}

export function getHermesApprovedUpdateInfo(
  versionOutput: string | null,
  mercuryVersion = app.getVersion(),
): HermesApprovedUpdateInfo {
  const currentVersion = extractHermesVersion(versionOutput);
  const compatibleApproved = APPROVED_HERMES_VERSIONS
    .filter((approved) => isMercuryCompatible(approved, mercuryVersion))
    .sort((a, b) => compareVersions(b.version, a.version));

  if (compatibleApproved.length === 0) {
    return {
      currentVersion,
      recommendedVersion: null,
      summary: null,
      notesUrl: null,
      breakingChange: false,
      canUpdate: false,
      reason: "no-approved-versions",
    };
  }

  const recommended = currentVersion
    ? compatibleApproved.find(
        (approved) => compareVersions(approved.version, currentVersion) > 0,
      )
    : compatibleApproved[0];

  if (!recommended) {
    return {
      currentVersion,
      recommendedVersion: null,
      summary: null,
      notesUrl: null,
      breakingChange: false,
      canUpdate: false,
      reason: "already-latest-approved",
    };
  }

  return {
    currentVersion,
    recommendedVersion: recommended.version,
    summary: recommended.summary,
    notesUrl: recommended.notesUrl,
    breakingChange: Boolean(recommended.breakingChange),
    canUpdate: true,
    reason: "approved-update-available",
  };
}

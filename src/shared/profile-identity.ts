export const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const RESERVED_PROFILE_TARGETS = {
  default: "default",
  mercury: "mercury",
} as const;

export const RESERVED_PROFILE_TARGET_NAMES = new Set<string>([
  RESERVED_PROFILE_TARGETS.default,
  RESERVED_PROFILE_TARGETS.mercury,
]);

export function isValidProfileName(profileName: string): boolean {
  return PROFILE_NAME_PATTERN.test(profileName);
}

export function deriveProfileIdFromDisplayName(
  displayName: string,
  occupiedProfileIds: Iterable<string> = [],
): string {
  const occupied = new Set<string>(RESERVED_PROFILE_TARGET_NAMES);
  for (const profileId of occupiedProfileIds) {
    occupied.add(profileId);
  }

  const base = slugBase(displayName);
  let candidate = truncateProfileSlug(base);
  let suffix = 2;
  while (occupied.has(candidate)) {
    const suffixText = `-${suffix}`;
    candidate = `${truncateProfileSlug(base, suffixText.length)}${suffixText}`;
    suffix += 1;
  }
  return candidate;
}

function slugBase(displayName: string): string {
  const lowered = displayName.trim().toLowerCase();
  const slug = lowered
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-_]+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug || "agent";
}

function truncateProfileSlug(slug: string, reservedLength = 0): string {
  const maxLength = 64 - reservedLength;
  const truncated = slug.slice(0, maxLength).replace(/[-_]+$/g, "");
  return isValidProfileName(truncated) ? truncated : "agent";
}

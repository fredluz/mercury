import { createHash } from "crypto";

export function normalizeProfile(profile?: string): string {
  const trimmed = profile?.trim();
  return trimmed && trimmed !== "default" ? trimmed : "default";
}

export function isNamedProfile(profile: string): boolean {
  return profile !== "default";
}

export function fingerprintSecret(secret?: string): string | undefined {
  if (!secret) return undefined;
  const digest = createHash("sha256").update(secret).digest("hex").slice(0, 12);
  return `sha256:${digest}`;
}

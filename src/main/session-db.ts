import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { HERMES_HOME } from "./installer";
import { profileHome } from "./utils";

export interface SessionProfileScope {
  profile: string;
  home: string;
  dbPath: string;
  isDefault: boolean;
}

export function normalizeSessionProfile(profile?: string | null): string {
  const value = profile?.trim();
  return !value || value === "default" ? "default" : value;
}

export function getSessionDbPath(profile?: string | null): string {
  return join(profileHome(normalizeSessionProfile(profile)), "state.db");
}

export function getSessionProfileScope(profile?: string | null): SessionProfileScope {
  const normalized = normalizeSessionProfile(profile);
  const home = profileHome(normalized);
  return {
    profile: normalized,
    home,
    dbPath: join(home, "state.db"),
    isDefault: normalized === "default",
  };
}

export function discoverSessionProfileScopes(profile?: string | null): SessionProfileScope[] {
  if (profile !== undefined && profile !== null && profile.trim()) {
    return [getSessionProfileScope(profile)];
  }

  const scopes: SessionProfileScope[] = [getSessionProfileScope("default")];
  const profilesDir = join(HERMES_HOME, "profiles");
  if (!existsSync(profilesDir)) return scopes;

  try {
    for (const name of readdirSync(profilesDir).sort()) {
      if (!name || name.startsWith(".")) continue;
      const home = join(profilesDir, name);
      try {
        if (!statSync(home).isDirectory()) continue;
      } catch {
        continue;
      }
      scopes.push({
        profile: name,
        home,
        dbPath: join(home, "state.db"),
        isDefault: false,
      });
    }
  } catch {
    // Best-effort profile discovery; default scope is still usable.
  }

  return scopes;
}

export function sessionCacheKey(
  sessionId: string,
  profile?: string | null,
): string {
  return `${normalizeSessionProfile(profile)}\u0000${sessionId}`;
}

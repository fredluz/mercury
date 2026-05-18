import { isNamedProfile, normalizeProfile } from "./profile";

export function buildHermesProfileCommandArgs(
  hermesScript: string,
  profile: string | undefined,
  commandArgs: string[],
): string[] {
  const normalizedProfile = normalizeProfile(profile);
  const args = [hermesScript];
  if (isNamedProfile(normalizedProfile)) {
    args.push("-p", normalizedProfile);
  }
  args.push(...commandArgs);
  return args;
}

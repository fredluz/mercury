import { isNamedProfile, normalizeProfile } from "./profile";

export function buildHermesProfileCommandArgs(
  hermesScript: string,
  profile: string | undefined,
  commandArgs: string[],
): string[] {
  const normalizedProfile = normalizeProfile(profile);
  const args = [hermesScript];
  args.push(
    "-p",
    isNamedProfile(normalizedProfile) ? normalizedProfile : "default",
  );
  args.push(...commandArgs);
  return args;
}

import { existsSync, lstatSync, realpathSync } from "fs";
import { dirname, isAbsolute, join, relative, resolve } from "path";

export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel));
}

export function isInsideReal(parent: string, child: string): boolean {
  return isInside(realpathSync.native(parent), realpathSync.native(child));
}

export function hasSymlinkInPath(root: string, target: string): boolean {
  if (!existsSync(root)) return false;
  let current = resolve(root);
  try {
    if (lstatSync(current).isSymbolicLink()) return true;
  } catch {
    return false;
  }

  const rel = relative(current, resolve(target));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
  for (const part of rel.split(/[\\/]/)) {
    current = join(current, part);
    if (!existsSync(current)) return false;
    if (lstatSync(current).isSymbolicLink()) return true;
  }
  return false;
}

export function safeExistingMutationPath(root: string, target: string): boolean {
  return (
    existsSync(root) &&
    existsSync(target) &&
    isInside(root, target) &&
    isInsideReal(root, target) &&
    !hasSymlinkInPath(root, target)
  );
}

export function safeDestinationParent(root: string, destination: string): boolean {
  const parent = dirname(destination);
  return (
    existsSync(root) &&
    existsSync(parent) &&
    isInside(root, destination) &&
    isInsideReal(root, parent) &&
    !hasSymlinkInPath(root, parent)
  );
}

export function isSafeSegment(value: string | undefined): boolean {
  return Boolean(value && !value.includes("/") && !value.includes("\\") && !value.includes("\0"));
}

export function isSafeRelativeFilePath(relativePath: string, root?: string): boolean {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    return false;
  }

  const parts = relativePath.split(/[\\/]+/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return false;
  }

  const base = root ? resolve(root) : resolve(process.cwd(), ".mercury-relative-path-root");
  return isInside(base, resolve(base, relativePath));
}

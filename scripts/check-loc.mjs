#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const warnLimit = 400;
const maxLimit = 500;

const sourceExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

const excludedBasenames = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "skills-lock.json",
]);

const excludedPathPrefixes = [
  ".git/",
  "dist/",
  "out/",
  "release/",
  "node_modules/",
  "docs/assets/",
  "docs/labs-e2e/",
  "docs/usage-sweep/",
  "src/renderer/src/assets/fonts/",
];

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const isCheckedFile = (file) => {
  const normalized = file.split(path.sep).join("/");
  if (excludedBasenames.has(path.basename(normalized))) return false;
  if (excludedPathPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  return sourceExtensions.has(path.extname(normalized));
};

const countLines = (file) => {
  const content = readFileSync(path.join(repoRoot, file), "utf8");
  if (content.length === 0) return 0;
  return content.split(/\r\n|\r|\n/).length - (content.endsWith("\n") ? 1 : 0);
};

const checkedFiles = trackedFiles.filter(isCheckedFile);
const results = checkedFiles
  .map((file) => ({ file, lines: countLines(file) }))
  .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

const failures = results.filter(({ lines }) => lines > maxLimit);
const warnings = results.filter(
  ({ lines }) => lines >= warnLimit && lines <= maxLimit,
);

console.log(
  `LOC guard checked ${checkedFiles.length} tracked source/test/source-like files (warn >= ${warnLimit}, fail > ${maxLimit}).`,
);

if (warnings.length > 0) {
  console.warn("\nWarnings:");
  for (const { file, lines } of warnings) {
    console.warn(`  ${lines.toString().padStart(4, " ")} ${file}`);
  }
}

if (failures.length > 0) {
  console.error("\nFailures:");
  for (const { file, lines } of failures) {
    console.error(`  ${lines.toString().padStart(4, " ")} ${file}`);
  }
  process.exitCode = 1;
}

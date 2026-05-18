/* eslint-disable @typescript-eslint/explicit-function-return-type */

import fs from "node:fs";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..", "..");
export const appEntry = path.join(repoRoot, "out", "main", "index.js");
export const labsDir = path.join(repoRoot, "docs", "labs-e2e");
export const reportPath = path.join(labsDir, "trace-lab-hardening-report.md");
export const summaryPath = path.join(labsDir, "trace-lab-hardening-summary.json");
export const screenshotPath = path.join(labsDir, "trace-lab-hardening.png");

export const requiredToolsets = [
  "web",
  "terminal",
  "file",
  "code_execution",
  "image_gen",
  "delegation",
  "skills",
  "memory",
  "session_search",
  "todo",
];

export const blocker = (message) => {
  const error = new Error(message);
  error.blocker = true;
  return error;
};

export const compact = (value, max = 240) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const readJsonIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

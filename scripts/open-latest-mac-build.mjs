#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, statSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arch = process.arch === "arm64" ? "mac-arm64" : "mac";
const builtApp = join(repoRoot, "dist", arch, "Mercury.app");
const fallbackBuiltApp = join(repoRoot, "dist", "mac-arm64", "Mercury.app");
const appPath = existsSync(builtApp) ? builtApp : fallbackBuiltApp;
const appAsar = join(appPath, "Contents", "Resources", "app.asar");
const logDir = join(homedir(), "Library", "Logs", "Mercury");
const logPath = join(logDir, "latest-build-launcher.log");

const sourceRoots = [
  "src",
  "resources",
  "build",
  "electron-builder.yml",
  "electron.vite.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "tsconfig.node.json",
  "tsconfig.web.json",
];

const ignoredDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "prompt-exports",
  "docs",
]);

process.env.PATH = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
  process.env.PATH || "",
].join(":");

function log(message) {
  mkdirSync(logDir, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stderr.write(line);
}

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (stat.isFile()) return stat.mtimeMs;
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    newest = Math.max(newest, newestMtime(join(path, entry.name)));
  }
  return newest;
}

function latestSourceMtime() {
  return Math.max(
    ...sourceRoots.map((entry) => newestMtime(join(repoRoot, entry))),
  );
}

function bundleMtime() {
  if (existsSync(appAsar)) return statSync(appAsar).mtimeMs;
  if (existsSync(appPath)) return statSync(appPath).mtimeMs;
  return 0;
}

function notify(title, message) {
  spawnSync("osascript", [
    "-e",
    `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`,
  ], { stdio: "ignore" });
}

function alert(title, message) {
  spawnSync("osascript", [
    "-e",
    `display dialog ${JSON.stringify(message)} with title ${JSON.stringify(title)} buttons {"OK"} default button "OK"`,
  ], { stdio: "ignore" });
}

function quitRunningMercury() {
  spawnSync("osascript", [
    "-e",
    'if application id "com.fredluz.mercury" is running then tell application id "com.fredluz.mercury" to quit',
  ], { stdio: "ignore" });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const result = spawnSync("pgrep", ["-x", "Mercury"], { stdio: "ignore" });
    if (result.status !== 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}

function runBuild() {
  mkdirSync(logDir, { recursive: true });
  const fd = openSync(logPath, "a");
  try {
    log(`Rebuilding Mercury mac bundle from ${repoRoot}`);
    notify("Mercury", "Rebuilding latest app bundle...");
    quitRunningMercury();
    const result = spawnSync("npm", ["run", "build:mac"], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", fd, fd],
    });
    if (result.status !== 0) {
      throw new Error(`npm run build:mac failed with exit code ${result.status}. See ${logPath}`);
    }
    log("Build complete");
  } finally {
    closeSync(fd);
  }
}

function openApp() {
  if (!existsSync(appPath)) {
    throw new Error(`Built app not found at ${appPath}`);
  }
  log(`Opening ${appPath}`);
  const result = spawnSync("open", [appPath], { stdio: "ignore" });
  if (result.status !== 0) {
    throw new Error(`open failed for ${appPath}`);
  }
}

try {
  const src = latestSourceMtime();
  const bundle = bundleMtime();
  log(`latestSource=${new Date(src).toISOString()} bundle=${bundle ? new Date(bundle).toISOString() : "missing"}`);
  if (!bundle || src > bundle + 1000) {
    runBuild();
  } else {
    log("Built bundle is current");
  }
  openApp();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`ERROR ${message}`);
  alert("Mercury launch failed", `${message}\n\nLog: ${logPath}`);
  process.exit(1);
}

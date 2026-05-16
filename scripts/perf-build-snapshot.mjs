#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outDir = path.join(repoRoot, "out");
const outputDir = path.join(repoRoot, "prompt-exports", "perf-runs");

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const options = {
  runId: args.get("run-id") || `build-bundle-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  top: Math.max(1, Number(args.get("top") || 25)),
};

if (!fs.existsSync(outDir)) {
  console.error("Missing out/ build directory. Run `npm run build` first.");
  process.exit(2);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (!entry.isFile()) return [];
    return [fullPath];
  });
}

function sizeRecord(file) {
  const buffer = fs.readFileSync(file);
  return {
    path: path.relative(repoRoot, file),
    sizeBytes: buffer.length,
    gzipBytes: zlib.gzipSync(buffer).length,
  };
}

function sumByExtension(files) {
  const totals = new Map();
  for (const file of files) {
    const ext = path.extname(file.path) || "(none)";
    const current = totals.get(ext) || { extension: ext, sizeBytes: 0, gzipBytes: 0, files: 0 };
    current.sizeBytes += file.sizeBytes;
    current.gzipBytes += file.gzipBytes;
    current.files += 1;
    totals.set(ext, current);
  }
  return [...totals.values()].sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function sumUnder(relativeDir, files) {
  const prefix = `${relativeDir.replace(/\/$/, "")}/`;
  const matching = files.filter((file) => file.path.startsWith(prefix));
  return {
    path: relativeDir,
    fileCount: matching.length,
    sizeBytes: matching.reduce((sum, file) => sum + file.sizeBytes, 0),
    gzipBytes: matching.reduce((sum, file) => sum + file.gzipBytes, 0),
  };
}

function readRendererHtml() {
  const htmlPath = path.join(outDir, "renderer", "index.html");
  if (!fs.existsSync(htmlPath)) return null;
  const html = fs.readFileSync(htmlPath, "utf8");
  const assets = [];
  const assetRe = /(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = assetRe.exec(html)) !== null) {
    const value = match[1];
    if (!value.includes("/assets/") && !value.startsWith("./assets/")) continue;
    const normalized = value.replace(/^\.\//, "").replace(/^\//, "");
    const absolutePath = path.join(outDir, "renderer", normalized.replace(/^renderer\//, ""));
    assets.push({
      ref: value,
      path: path.relative(repoRoot, absolutePath),
      exists: fs.existsSync(absolutePath),
      kind: value.endsWith(".css") ? "css" : value.endsWith(".js") ? "js" : "asset",
    });
  }
  return {
    path: path.relative(repoRoot, htmlPath),
    assets,
  };
}

function dynamicImportsFor(file) {
  const source = fs.readFileSync(path.join(repoRoot, file.path), "utf8");
  const imports = new Set();
  const dynamicRe = /import\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = dynamicRe.exec(source)) !== null) {
    imports.add(match[1]);
  }
  return [...imports].sort();
}

const files = walk(outDir).map(sizeRecord).sort((a, b) => b.sizeBytes - a.sizeBytes);
const rendererJsFiles = files.filter(
  (file) => file.path.startsWith("out/renderer/") && file.path.endsWith(".js"),
);
const dynamicImports = rendererJsFiles
  .map((file) => ({ path: file.path, imports: dynamicImportsFor(file) }))
  .filter((entry) => entry.imports.length > 0);
const rendererHtml = readRendererHtml();
const filesByPath = new Map(files.map((file) => [file.path, file]));
const initialRendererAssets = (rendererHtml?.assets || []).map((asset) => ({
  ...asset,
  size: filesByPath.get(asset.path) || null,
}));

const artifact = {
  runId: options.runId,
  kind: "build-bundle-snapshot",
  date: new Date().toISOString(),
  repoRoot,
  outDir: path.relative(repoRoot, outDir),
  totals: {
    all: {
      fileCount: files.length,
      sizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
    },
    main: sumUnder("out/main", files),
    preload: sumUnder("out/preload", files),
    renderer: sumUnder("out/renderer", files),
  },
  totalsByExtension: sumByExtension(files),
  topFiles: files.slice(0, options.top),
  rendererHtml,
  initialRendererAssets,
  dynamicImports,
};

fs.mkdirSync(outputDir, { recursive: true });
const artifactPath = path.join(outputDir, `${options.runId}-build-bundle.json`);
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

console.log(`[build] wrote ${path.relative(repoRoot, artifactPath)}`);
console.log(
  `[build] total ${(artifact.totals.all.sizeBytes / 1024).toFixed(1)} KiB raw, ` +
    `${(artifact.totals.all.gzipBytes / 1024).toFixed(1)} KiB gzip across ${artifact.totals.all.fileCount} files`,
);
for (const file of artifact.topFiles.slice(0, Math.min(5, artifact.topFiles.length))) {
  console.log(
    `[build] ${(file.sizeBytes / 1024).toFixed(1)} KiB raw ` +
      `${(file.gzipBytes / 1024).toFixed(1)} KiB gzip ${file.path}`,
  );
}

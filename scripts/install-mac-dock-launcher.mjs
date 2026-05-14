#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync, chmodSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir, tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launcherApp = join(homedir(), "Applications", "Mercury.app");
const launcherId = "com.fredluz.mercury.latest-launcher";
const executableName = "mercury-latest";
const installDock = process.argv.includes("--dock");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stderr || result.stdout || ""}`);
  }
  return result.stdout;
}

function plistEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createLauncherApp() {
  const contents = join(launcherApp, "Contents");
  const macos = join(contents, "MacOS");
  const resources = join(contents, "Resources");
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });

  const iconSource = join(repoRoot, "build", "icon.icns");
  if (existsSync(iconSource)) {
    copyFileSync(iconSource, join(resources, "icon.icns"));
  }

  writeFileSync(
    join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Mercury</string>
  <key>CFBundleExecutable</key>
  <string>${plistEscape(executableName)}</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundleIdentifier</key>
  <string>${plistEscape(launcherId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Mercury</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
`,
  );

  const launcherScript = `#!/bin/bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
REPO=${JSON.stringify(repoRoot)}
LOG="$HOME/Library/Logs/Mercury/latest-build-launcher.log"
mkdir -p "$(dirname "$LOG")"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [ -x "$candidate" ]; then NODE="$candidate"; break; fi
  done
fi
if [ -z "$NODE" ]; then
  /usr/bin/osascript -e 'display dialog "Node.js was not found. Install Node or add it to /opt/homebrew/bin or /usr/local/bin." with title "Mercury launch failed" buttons {"OK"} default button "OK"'
  exit 1
fi
exec "$NODE" "$REPO/scripts/open-latest-mac-build.mjs" >> "$LOG" 2>&1
`;
  const executablePath = join(macos, executableName);
  writeFileSync(executablePath, launcherScript);
  chmodSync(executablePath, 0o755);
}

function installLauncherInDock() {
  const exportResult = spawnSync("defaults", ["export", "com.apple.dock", "-"], {
    encoding: "utf8",
  });
  if (exportResult.status !== 0) {
    throw new Error(exportResult.stderr || "Failed to read Dock preferences");
  }

  const tmp = mkdtempSync(join(tmpdir(), "mercury-dock-"));
  const inputPlist = join(tmp, "dock.plist");
  const scriptPath = join(tmp, "patch-dock.py");
  writeFileSync(inputPlist, exportResult.stdout);
  writeFileSync(
    scriptPath,
    `import plistlib, sys, pathlib
input_path, app_path, launcher_id = sys.argv[1:4]
with open(input_path, 'rb') as f:
    dock = plistlib.load(f)
apps = dock.get('persistent-apps', [])
filtered = []
for item in apps:
    tile = item.get('tile-data', {})
    label = tile.get('file-label', '')
    bundle = tile.get('bundle-identifier', '')
    url = tile.get('file-data', {}).get('_CFURLString', '')
    haystack = ' '.join([label, bundle, url]).lower()
    if bundle in {launcher_id, 'com.fredluz.mercury'} or 'mercury.app' in haystack:
        continue
    filtered.append(item)
app_url = pathlib.Path(app_path).resolve().as_uri() + '/'
filtered.append({
    'tile-data': {
        'file-data': {
            '_CFURLString': app_url,
            '_CFURLStringType': 15,
        },
        'file-label': 'Mercury',
        'bundle-identifier': launcher_id,
    },
    'tile-type': 'file-tile',
})
dock['persistent-apps'] = filtered
with open(input_path, 'wb') as f:
    plistlib.dump(dock, f, sort_keys=False)
`,
  );
  try {
    run("python3", [scriptPath, inputPlist, launcherApp, launcherId]);
    run("defaults", ["import", "com.apple.dock", inputPlist]);
    spawnSync("killall", ["Dock"], { stdio: "ignore" });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  createLauncherApp();
  console.log(`Installed launcher app: ${launcherApp}`);
  if (installDock) {
    installLauncherInDock();
    console.log("Dock now points to the Mercury latest-build launcher.");
  } else {
    console.log("Run with --dock to pin/update it in the Dock.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

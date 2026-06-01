#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

// Visual screenshot harness for the new-agent creation flow.
// Adapted from scripts/e2e-flow-sweep.mjs: boots the built app against an
// isolated HERMES_HOME, opens Profiles -> New Agent, and captures the styled
// two-pane creation route (plus an expanded-pack variant).

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const repoRoot = path.resolve(import.meta.dirname, "..");
const artifactsDir = path.join(repoRoot, "docs", "assets");
const shotOverview = path.join(artifactsDir, "agent-creator-flow.png");
const shotExpanded = path.join(artifactsDir, "agent-creator-flow-expanded.png");

const readOpenCodeGoKey = () => {
  const authPath = path.join(
    os.homedir(),
    ".local",
    "share",
    "opencode",
    "auth.json",
  );
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  const key = auth["opencode-go"]?.key;
  if (!key) throw new Error(`Missing opencode-go key in ${authPath}`);
  return key;
};

const writeHermesHome = () => {
  const key = readOpenCodeGoKey();
  const hermesHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "mercury-creator-shot-"),
  );
  fs.chmodSync(hermesHome, 0o700);

  const installedAgent = path.join(os.homedir(), ".hermes", "hermes-agent");
  if (!fs.existsSync(installedAgent)) {
    throw new Error(`Hermes agent not found at ${installedAgent}`);
  }
  fs.symlinkSync(installedAgent, path.join(hermesHome, "hermes-agent"), "dir");

  fs.writeFileSync(path.join(hermesHome, ".env"), `OPENCODE_GO_API_KEY=${key}\n`, {
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    [
      "model:",
      "  provider: opencode-go",
      "  default: deepseek-v4-flash",
      '  base_url: ""',
      "streaming: true",
      "max_turns: 20",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(hermesHome, "auth.json"),
    JSON.stringify({ active_provider: "opencode-go" }, null, 2),
  );
  return hermesHome;
};

const launchApp = async (hermesHome) => {
  const { _electron: electron } = require("playwright");
  const electronPath = require("electron");
  return electron.launch({
    executablePath: electronPath,
    args: [path.join(repoRoot, "out", "main", "index.js")],
    cwd: repoRoot,
    env: { ...process.env, HERMES_HOME: hermesHome, NODE_ENV: "production" },
  });
};

const run = async () => {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const hermesHome = writeHermesHome();
  let app;
  try {
    app = await launchApp(hermesHome);

    // The app may open a transient splash window before the main one; poll all
    // windows until one exposes the chat surface, and survive splash closing.
    const deadline = Date.now() + 60_000;
    let page;
    while (Date.now() < deadline) {
      const windows = app.windows();
      for (const candidate of windows) {
        if (candidate.isClosed()) continue;
        const hit = await candidate
          .locator("textarea.chat-input")
          .count()
          .catch(() => 0);
        if (hit) {
          page = candidate;
          break;
        }
      }
      if (page) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!page) throw new Error("Never found a window with the chat surface");
    page.setDefaultTimeout(30_000);
    await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });

    await page
      .locator(".sidebar-nav-item")
      .filter({ hasText: "Profiles" })
      .click();
    await page.locator(".agents-container").waitFor();

    await page.getByRole("button", { name: /New Agent/i }).click();
    await page.locator(".agents-creator-screen").waitFor({ timeout: 30_000 });
    await page.locator(".agents-draft-review").waitFor();
    await page.waitForTimeout(600);
    await page.screenshot({ path: shotOverview });
    console.log(`Screenshot written to ${shotOverview}`);

    // Expand the first pack to show its members.
    const membersBtn = page
      .locator(".agents-pack-card")
      .first()
      .getByRole("button", { name: /Members/i });
    if (await membersBtn.count()) {
      await membersBtn.first().click();
      await page.locator(".agents-pack-members").first().waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: shotExpanded });
      console.log(`Screenshot written to ${shotExpanded}`);
    }
  } finally {
    if (app) await app.close();
    try {
      // Drop the symlinked hermes-agent before recursive remove.
      fs.rmSync(path.join(hermesHome, "hermes-agent"), { force: true });
      fs.rmSync(hermesHome, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`cleanup skipped: ${cleanupError?.message || cleanupError}`);
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

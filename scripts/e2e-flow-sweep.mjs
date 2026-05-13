#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const repoRoot = path.resolve(import.meta.dirname, "..");
const artifactsDir = path.join(repoRoot, "docs", "assets");
const screenshotPath = path.join(artifactsDir, "mercury-flow-sweep.png");
const reportPath = path.join(repoRoot, "docs", "e2e-flow-sweep-report.md");

const waitForCompletedTrace = async (tracePath, timeout = 180_000) => {
  const deadline = Date.now() + timeout;
  let lastStatus = "missing";
  while (Date.now() < deadline) {
    if (fs.existsSync(tracePath)) {
      const store = JSON.parse(fs.readFileSync(tracePath, "utf8"));
      const completed = store.runs?.find((run) => run.status === "completed");
      if (completed) return completed;
      lastStatus = store.runs?.[0]?.status || "empty";
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Expected a completed trace in ${tracePath}; last status: ${lastStatus}`,
  );
};

const clickNav = async (page, label) => {
  await page.locator(".sidebar-nav-item").filter({ hasText: label }).click();
};

const appendResult = (results, name, status, detail = "") => {
  results.push({ name, status, detail });
  console.log(
    `${status === "pass" ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`,
  );
};

const readOpenCodeGoKey = () => {
  const authPath = path.join(
    os.homedir(),
    ".local",
    "share",
    "opencode",
    "auth.json",
  );
  const raw = fs.readFileSync(authPath, "utf8");
  const auth = JSON.parse(raw);
  const key = auth["opencode-go"]?.key;
  if (!key) {
    throw new Error(`Missing opencode-go key in ${authPath}`);
  }
  return key;
};

const writeHermesHome = () => {
  const key = readOpenCodeGoKey();
  const hermesHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "mercury-flow-e2e-"),
  );
  fs.chmodSync(hermesHome, 0o700);

  const installedAgent = path.join(os.homedir(), ".hermes", "hermes-agent");
  const linkedAgent = path.join(hermesHome, "hermes-agent");
  if (!fs.existsSync(installedAgent)) {
    throw new Error(`Hermes agent not found at ${installedAgent}`);
  }
  fs.symlinkSync(installedAgent, linkedAgent, "dir");

  fs.writeFileSync(
    path.join(hermesHome, ".env"),
    `OPENCODE_GO_API_KEY=${key}\n`,
    { mode: 0o600 },
  );
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
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      NODE_ENV: "production",
    },
  });
};

const run = async () => {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const hermesHome = writeHermesHome();
  const results = [];
  let app;

  try {
    app = await launchApp(hermesHome);
    const page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    await page.waitForLoadState("domcontentloaded");

    await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
    appendResult(
      results,
      "Boots into Chat with isolated configured Hermes home",
      "pass",
      hermesHome,
    );

    const navLabels = [
      "Chat",
      "Sessions",
      "Trace Lab",
      "Profiles",
      "Models",
      "Providers",
      "Skills",
      "Persona",
      "Memory",
      "Tools",
      "Schedules",
      "Gateway",
      "Settings",
    ];
    for (const label of navLabels) {
      await page
        .locator(".sidebar-nav-item")
        .filter({ hasText: label })
        .waitFor();
    }
    appendResult(
      results,
      "Sidebar exposes all first-class desktop surfaces",
      "pass",
    );

    const modelText = await page.locator(".chat-model-name").innerText();
    if (!/deepseek-v4-flash/i.test(modelText)) {
      throw new Error(
        `Expected deepseek-v4-flash model label, got ${modelText}`,
      );
    }
    appendResult(
      results,
      "OpenCode Go DeepSeek model is active in Chat",
      "pass",
      modelText,
    );

    await page
      .locator("textarea.chat-input")
      .fill("Reply with exactly: FLOW_SWEEP_CHAT_OK");
    await page.keyboard.press("Enter");
    await page
      .locator(".chat-message-agent .chat-bubble-agent")
      .filter({ hasText: "FLOW_SWEEP_CHAT_OK" })
      .waitFor({ timeout: 180_000 });
    appendResult(
      results,
      "Chat sends a real model request and receives the expected reply",
      "pass",
    );

    const tracePath = path.join(hermesHome, "desktop-traces.json");
    const completedTrace = await waitForCompletedTrace(tracePath);
    appendResult(
      results,
      "Trace store contains a completed run on disk",
      "pass",
      completedTrace.id,
    );

    await clickNav(page, "Trace Lab");
    await page.locator(".trace-run-row").first().waitFor({ timeout: 30_000 });
    await page.locator(".trace-detail").waitFor({ timeout: 10_000 });
    await page.locator(".trace-event-row").first().waitFor({ timeout: 10_000 });
    await page.locator(".trace-inspector").waitFor();
    appendResult(
      results,
      "Trace Lab lists the completed chat run with timeline and inspector",
      "pass",
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    await clickNav(page, "Sessions");
    await page.locator(".sessions-container").waitFor();
    await page.locator(".sessions-searchbar-input").fill("FLOW_SWEEP_CHAT_OK");
    appendResult(results, "Sessions renders and accepts search input", "pass");

    await clickNav(page, "Profiles");
    await page.locator(".agents-container").waitFor();
    await page.getByRole("button", { name: /New Agent/i }).click();
    await page
      .locator(".agents-create input.input")
      .fill(`flow-sweep-${Date.now()}`);
    await page
      .locator(".agents-create")
      .getByRole("button", { name: /^Create$/i })
      .click();
    await page
      .locator(".agents-card")
      .filter({ hasText: "flow-sweep-" })
      .waitFor({ timeout: 15_000 });
    appendResult(results, "Profiles can create a local agent profile", "pass");

    await clickNav(page, "Models");
    await page.locator(".models-search-input").fill("deepseek");
    await page
      .locator(".models-grid, .models-empty")
      .filter({ hasText: /deepseek/i })
      .waitFor({ timeout: 10_000 });
    appendResult(
      results,
      "Models renders searchable OpenCode Go DeepSeek entries",
      "pass",
    );

    await clickNav(page, "Providers");
    await page
      .locator(".settings-container")
      .filter({ hasText: "Providers" })
      .filter({ hasText: "OpenCode Go" })
      .waitFor();
    appendResult(
      results,
      "Providers exposes OpenCode Go configuration",
      "pass",
    );

    await clickNav(page, "Skills");
    await page.locator(".skills-container").waitFor();
    await page.locator(".skills-tab").first().waitFor();
    appendResult(results, "Skills renders installed/browse surfaces", "pass");

    await clickNav(page, "Persona");
    await page.locator("textarea.soul-editor").waitFor();
    appendResult(results, "Persona editor renders", "pass");

    await clickNav(page, "Memory");
    await page.locator(".memory-stats").waitFor();
    await page.getByRole("button", { name: /Add Memory/i }).click();
    await page
      .locator(".memory-entry-textarea")
      .fill("Flow sweep memory entry");
    await page.getByRole("button", { name: /^Save$/i }).click();
    await page
      .locator(".memory-entry-card")
      .filter({ hasText: "Flow sweep memory entry" })
      .waitFor({ timeout: 10_000 });
    appendResult(
      results,
      "Memory supports adding a local memory entry",
      "pass",
    );

    await clickNav(page, "Tools");
    await page.locator(".tools-card").first().waitFor();
    appendResult(results, "Tools renders toolset cards", "pass");

    await clickNav(page, "Schedules");
    await page.locator(".schedules-container").waitFor();
    await page
      .getByRole("button", { name: /New Task|Create your first task/i })
      .first()
      .click();
    await page.locator(".schedules-modal").waitFor();
    await page.getByRole("button", { name: /^Cancel$/i }).click();
    appendResult(
      results,
      "Schedules opens and closes the create-task modal",
      "pass",
    );

    await clickNav(page, "Gateway");
    await page.locator(".settings-gateway-status").waitFor();
    await page.locator(".settings-platform-card").first().waitFor();
    appendResult(results, "Gateway renders status and platform cards", "pass");

    await clickNav(page, "Settings");
    await page
      .locator(".settings-container")
      .filter({ hasText: "Settings" })
      .waitFor();
    await page.getByRole("button", { name: /^Remote$/i }).click();
    await page.getByRole("button", { name: /^Local$/i }).click();
    appendResult(
      results,
      "Settings renders and switches connection modes",
      "pass",
    );

    const report = [
      "# Mercury Flow Sweep E2E",
      "",
      `Date: ${new Date().toISOString()}`,
      "",
      "## Configuration",
      "",
      "- Provider: OpenCode Go",
      "- Model: deepseek-v4-flash",
      "- Harness: Electron launched through Playwright against a temporary isolated `HERMES_HOME`.",
      "- Credential source: local OpenCode auth copied into the temporary home at runtime only; no key is written to the repository.",
      "",
      "## Results",
      "",
      ...results.map(
        (r) =>
          `- ${r.status === "pass" ? "PASS" : "FAIL"}: ${r.name}${r.detail ? ` (${r.detail})` : ""}`,
      ),
      "",
      "## Artifacts",
      "",
      `- Screenshot: [docs/assets/mercury-flow-sweep.png](assets/mercury-flow-sweep.png)`,
      `- Temporary Hermes home used for this run: \`${hermesHome}\``,
      "",
      "## Notes",
      "",
      "- This sweep exercises the real chat path, Trace Lab persistence, and the main desktop surfaces.",
      "- Schedules, Gateway, provider credential mutations, and external service actions are rendered or opened but not triggered when doing so would start long-running processes or call unrelated services.",
      "",
    ].join("\n");
    fs.writeFileSync(reportPath, report);

    console.log(`Report written to ${reportPath}`);
    console.log(`Screenshot written to ${screenshotPath}`);
  } catch (error) {
    appendResult(
      results,
      "Flow sweep aborted",
      "fail",
      error?.message || String(error),
    );
    throw error;
  } finally {
    if (app) {
      await app.close();
    }
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

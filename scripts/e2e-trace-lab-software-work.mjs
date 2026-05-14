#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

const repoRoot = path.resolve(import.meta.dirname, "..");
const appEntry = path.join(repoRoot, "out", "main", "index.js");
const labsDir = path.join(repoRoot, "docs", "labs-e2e");
const reportPath = path.join(labsDir, "trace-lab-software-work-report.md");
const summaryPath = path.join(labsDir, "trace-lab-software-work-summary.json");
const screenshotPath = path.join(labsDir, "trace-lab-software-work.png");

const marker = "TRACE_SW_WORK_OK";
const blockedMarker = "TRACE_SW_WORK_IMAGE_BLOCKED";

const requiredToolsets = [
  "terminal",
  "file",
  "code_execution",
  "image_gen",
  "delegation",
  "todo",
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const blocker = (message) => {
  const error = new Error(message);
  error.blocker = true;
  return error;
};

const compact = (value, max = 260) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const readJsonIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const readHermesAuth = () => {
  const authPath = path.join(os.homedir(), ".hermes", "auth.json");
  if (!fs.existsSync(authPath)) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    const hasCredential = Boolean(
      auth.active_provider ||
        (auth.providers && Object.keys(auth.providers).length) ||
        (auth.credential_pool && Object.keys(auth.credential_pool).length),
    );
    return hasCredential ? { path: authPath, auth } : null;
  } catch {
    return null;
  }
};

const hasHermesProvider = (auth, provider) =>
  Boolean(
    auth?.active_provider === provider ||
      auth?.providers?.[provider] ||
      auth?.credential_pool?.[provider]?.length,
  );

const readCodexCliAuth = () => {
  const authPath = path.join(
    process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "auth.json",
  );
  if (!fs.existsSync(authPath)) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (!auth?.tokens?.access_token || !auth?.tokens?.refresh_token) return null;
    return {
      active_provider: "openai-codex",
      providers: {
        "openai-codex": {
          tokens: auth.tokens,
          last_refresh: auth.last_refresh,
          auth_mode: auth.auth_mode || "chatgpt",
        },
      },
    };
  } catch {
    return null;
  }
};

const discoverCredentials = () => {
  const explicitProvider = process.env.TRACE_SW_WORK_PROVIDER;
  const explicitModel = process.env.TRACE_SW_WORK_MODEL;
  const explicitBaseUrl = process.env.TRACE_SW_WORK_BASE_URL || "";
  const explicitKeyEnv = process.env.TRACE_SW_WORK_API_KEY_ENV;
  const explicitKey =
    process.env.TRACE_SW_WORK_API_KEY ||
    (explicitKeyEnv ? process.env[explicitKeyEnv] : "");

  if (explicitProvider && !explicitModel) {
    throw blocker(
      "TRACE_SW_WORK_PROVIDER was set, but TRACE_SW_WORK_MODEL is missing.",
    );
  }

  if (explicitProvider && explicitModel) {
    if (explicitKey) {
      const providerKey = `${explicitProvider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
      return {
        source: explicitKeyEnv
          ? `TRACE_SW_WORK_API_KEY_ENV=${explicitKeyEnv}`
          : "TRACE_SW_WORK_API_KEY",
        provider: explicitProvider,
        model: explicitModel,
        baseUrl: explicitBaseUrl,
        env: {
          [providerKey]: explicitKey,
          ...(explicitKeyEnv ? { [explicitKeyEnv]: explicitKey } : {}),
        },
        auth: { active_provider: explicitProvider },
      };
    }
    const hermesAuth = readHermesAuth();
    if (hermesAuth) {
      return {
        source: "local ~/.hermes/auth.json",
        provider: explicitProvider,
        model: explicitModel,
        baseUrl: explicitBaseUrl,
        env: {},
        authPath: hermesAuth.path,
        auth: hermesAuth.auth,
      };
    }
    throw blocker(
      "Explicit provider/model were set, but no API key or Hermes auth was found.",
    );
  }

  const hermesAuth = readHermesAuth();
  if (hermesAuth && hasHermesProvider(hermesAuth.auth, "openai-codex")) {
    return {
      source: "local ~/.hermes/auth.json openai-codex",
      provider: "openai-codex",
      model: explicitModel || "gpt-5.5",
      baseUrl: explicitBaseUrl || "https://chatgpt.com/backend-api/codex",
      env: {},
      authPath: hermesAuth.path,
      auth: hermesAuth.auth,
      imageGenProvider: "openai-codex",
    };
  }

  const codexCliAuth = readCodexCliAuth();
  if (codexCliAuth) {
    return {
      source: "local ~/.codex/auth.json ChatGPT/Codex OAuth",
      provider: "openai-codex",
      model: explicitModel || "gpt-5.5",
      baseUrl: explicitBaseUrl || "https://chatgpt.com/backend-api/codex",
      env: {},
      auth: codexCliAuth,
      imageGenProvider: "openai-codex",
    };
  }

  if (process.env.OPENAI_API_KEY) {
    return {
      source: "OPENAI_API_KEY",
      provider: explicitProvider || "openai",
      model: explicitModel || "gpt-4.1-mini",
      baseUrl: explicitBaseUrl,
      env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY },
      auth: { active_provider: explicitProvider || "openai" },
    };
  }

  throw blocker(
    [
      "Trace Lab software-work scenario requires real model credentials.",
      "Configure local openai-codex Hermes/Codex OAuth, OPENAI_API_KEY, or TRACE_SW_WORK_PROVIDER + TRACE_SW_WORK_MODEL + TRACE_SW_WORK_API_KEY(_ENV).",
    ].join("\n"),
  );
};

const writeHermesHome = (credentials) => {
  const installedAgent = path.join(os.homedir(), ".hermes", "hermes-agent");
  if (!fs.existsSync(installedAgent)) {
    throw blocker(`Hermes Agent is not installed at ${installedAgent}.`);
  }

  const hermesHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "mercury-trace-software-work-"),
  );
  fs.chmodSync(hermesHome, 0o700);
  fs.symlinkSync(installedAgent, path.join(hermesHome, "hermes-agent"), "dir");

  const envLines = Object.entries({
    ...credentials.env,
    FAL_KEY: process.env.FAL_KEY || undefined,
  })
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${String(value).replace(/\n/g, "")}`);
  fs.writeFileSync(path.join(hermesHome, ".env"), `${envLines.join("\n")}\n`, {
    mode: 0o600,
  });

  const imageGenLines = credentials.imageGenProvider
    ? [
        "image_gen:",
        `  provider: ${credentials.imageGenProvider}`,
        `  model: ${process.env.TRACE_SW_WORK_IMAGE_MODEL || "gpt-image-2-medium"}`,
      ]
    : [];
  fs.writeFileSync(
    path.join(hermesHome, "config.yaml"),
    [
      "model:",
      `  provider: ${credentials.provider}`,
      `  default: ${credentials.model}`,
      `  base_url: ${JSON.stringify(credentials.baseUrl || "")}`,
      "streaming: true",
      "max_turns: 50",
      ...imageGenLines,
      "platform_toolsets:",
      "  cli:",
      ...requiredToolsets.map((tool) => `    - ${tool}`),
      "  api_server:",
      ...requiredToolsets.map((tool) => `    - ${tool}`),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );

  if (credentials.authPath) {
    fs.copyFileSync(credentials.authPath, path.join(hermesHome, "auth.json"));
    fs.chmodSync(path.join(hermesHome, "auth.json"), 0o600);
  } else {
    fs.writeFileSync(
      path.join(hermesHome, "auth.json"),
      JSON.stringify(credentials.auth, null, 2),
      { mode: 0o600 },
    );
  }

  return hermesHome;
};

const assertBuiltApp = () => {
  if (!fs.existsSync(appEntry)) {
    throw blocker("Run npm run build before this e2e scenario.");
  }
};

const buildElectronEnv = (hermesHome, credentials) => {
  const keep = [
    "PATH",
    "HOME",
    "SHELL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "SSH_AUTH_SOCK",
    "XDG_RUNTIME_DIR",
  ];
  const env = Object.fromEntries(
    keep
      .map((key) => [key, process.env[key]])
      .filter(([, value]) => value != null),
  );
  return {
    ...env,
    ...credentials.env,
    ...(process.env.FAL_KEY ? { FAL_KEY: process.env.FAL_KEY } : {}),
    HERMES_HOME: hermesHome,
    NODE_ENV: "production",
  };
};

const launchApp = async (hermesHome, credentials) => {
  assertBuiltApp();
  const { _electron: electron } = require("playwright");
  const electronPath = require("electron");
  return electron.launch({
    executablePath: electronPath,
    args: [appEntry],
    cwd: repoRoot,
    env: buildElectronEnv(hermesHome, credentials),
  });
};

const clickNav = async (page, label) => {
  await page.locator(".sidebar-nav-item").filter({ hasText: label }).click();
};

const sendScenarioPrompt = async (page, workspaceDir) => {
  const prompt = [
    "You are running inside Mercury's real desktop e2e scenario. Perform actual bounded software-engineering work; do not only describe a plan.",
    `Workspace: ${workspaceDir}`,
    "Task:",
    "1. Create a tiny browser game named Moon Moth Catcher with these files: index.html, styles.css, game.js, and README.md. Keep it dependency-free and playable by opening index.html.",
    "2. Use file-writing tools for the source files and use the terminal tool to run a real verification command that checks all four files exist and prints their byte sizes.",
    "3. Use the image_generate/image generation tool to generate an actual 128x128 harmless pixel-art moon moth sprite asset for the game. If the tool returns a file path or URL, include that exact reference and, if possible, save/copy it under the workspace assets directory. Do not fake image success. Do not create the requested raster asset with terminal code, Python/Pillow, canvas, SVG, or text placeholders; only the configured image-generation tool counts for this step.",
    `4. If the image tool is unavailable, fails, or you cannot verify a real image-generation tool result, include exactly ${blockedMarker}: <short reason>.`,
    `5. Final answer must include exactly ${marker}, the created file paths, the terminal verification command/output summary, and either the generated image artifact path/URL or ${blockedMarker}.`,
  ].join("\n");

  await clickNav(page, "Chat").catch(() => undefined);
  await page.locator("textarea.chat-input").waitFor({ timeout: 60_000 });
  await page.locator("textarea.chat-input").fill(prompt);
  await page.keyboard.press("Enter");
  await page
    .locator(".chat-message-agent .chat-bubble-agent")
    .filter({ hasText: new RegExp(`${marker}|${blockedMarker}`) })
    .waitFor({ timeout: 900_000 });
};

const waitForRun = async (tracePath, predicate, timeout = 120_000) => {
  const deadline = Date.now() + timeout;
  let last = "missing trace store";
  while (Date.now() < deadline) {
    const store = readJsonIfExists(tracePath);
    const runs = store?.runs || [];
    const match = runs.find(predicate);
    if (match) return match;
    last = `${runs.length} run(s): ${runs.map((run) => `${run.status}:${compact(run.messagePreview, 80)}`).join(" | ")}`;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for software-work trace run; last state: ${last}`);
};

const eventTypes = (run) =>
  new Set((run.events || []).map((event) => event.type));

const hasAnyEvent = (run, types) => {
  const typeSet = eventTypes(run);
  return types.some((type) => typeSet.has(type));
};

const eventText = (event) =>
  `${event.type || ""} ${event.title || ""} ${event.detail || ""} ${JSON.stringify(event.metadata || {})}`;

const hasEventMatching = (run, pattern) =>
  (run.events || []).some((event) => pattern.test(eventText(event)));

const runContains = (run, text) =>
  [
    run.messagePreview,
    run.title,
    ...(run.events || []).flatMap((event) => [
      event.title,
      event.detail,
      JSON.stringify(event.metadata || {}),
    ]),
  ]
    .filter(Boolean)
    .some((value) => String(value).includes(text));

const listFilesRecursive = (dir) => {
  if (!fs.existsSync(dir)) return [];
  const output = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else output.push(fullPath);
    }
  };
  walk(dir);
  return output.sort();
};

const verifyTraceLabSearch = async (page, run) => {
  await clickNav(page, "Trace Lab");
  await page
    .locator(".trace-run-row, .trace-run-results")
    .first()
    .waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: /refresh/i }).click().catch(() => undefined);
  await page
    .locator(".trace-run-row, .trace-run-results")
    .first()
    .waitFor({ timeout: 45_000 });

  const queries = [
    marker,
    "Moon Moth Catcher",
    path.basename(run.messagePreview?.match(/Workspace: ([^\n]+)/)?.[1] || ""),
  ].filter(Boolean);
  let lastError = null;
  for (const query of queries) {
    try {
      await page.locator(".trace-run-search input").fill(query);
      const row = page.locator(".trace-run-row").first();
      await row.waitFor({ timeout: 20_000 });
      await row.click();
      await page.locator(".trace-detail").waitFor({ timeout: 15_000 });
      await page.locator(".trace-event-row").first().click();
      await page.locator(".trace-inspector").waitFor({ timeout: 15_000 });
      return { status: "pass", query };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Trace Lab search did not locate the run");
};

const classify = ({ run, workspaceDir }) => {
  const files = listFilesRecursive(workspaceDir);
  const relativeFiles = files.map((file) => path.relative(workspaceDir, file));
  const expectedFiles = ["index.html", "styles.css", "game.js", "README.md"];
  const imageFiles = relativeFiles.filter((file) =>
    /(^|\/)(assets\/)?[^/]+\.(png|jpe?g|webp|gif)$/i.test(file),
  );

  const missing = [];
  const blocked = [];

  if (run.status !== "completed") missing.push(`run status is ${run.status}`);
  for (const expected of expectedFiles) {
    if (!relativeFiles.some((file) => file === expected || file.endsWith(`/${expected}`))) {
      missing.push(`workspace missing ${expected}`);
    }
  }
  if (
    !hasAnyEvent(run, ["tool.started", "tool.progress", "tool.completed"]) &&
    !hasEventMatching(run, /terminal|shell|execute|file|write|edit/i)
  ) {
    missing.push("trace missing terminal/file tool evidence");
  }
  if (!hasEventMatching(run, /node|byte|index\.html|game\.js|README\.md/i)) {
    missing.push("trace missing verification command/file detail evidence");
  }

  const artifactEvidence = hasAnyEvent(run, ["artifact.created"]);
  const imageToolEvidence = (run.events || []).some((event) => {
    const text = eventText(event);
    return (
      event.type.startsWith("tool.") &&
      /image_generate|generate_image|image_generation|gpt[-_ ]?image|openai-codex/i.test(
        text,
      )
    );
  });
  const blockedInRun = runContains(run, blockedMarker);

  if (!artifactEvidence) {
    blocked.push("trace missing artifact.created event for generated image asset");
  }
  if (!imageToolEvidence) {
    blocked.push("trace missing actual image_generate/image_generation tool evidence");
  }
  if (blockedInRun) {
    blocked.push(`${blockedMarker} was reported by the agent`);
  }

  return {
    status: missing.length ? "fail" : blocked.length ? "blocked" : "pass",
    missing,
    blocked,
    runId: run.id || null,
    runStatus: run.status || null,
    eventTypes: Array.from(eventTypes(run)).sort(),
    usage: run.usage || null,
    files: relativeFiles,
    imageFiles,
    artifactEvidence,
    imageToolEvidence,
    blockedInRun,
  };
};

const writeArtifacts = (summary) => {
  fs.mkdirSync(labsDir, { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const result = summary.result || {};
  const report = [
    "# Trace Lab Software-Work E2E",
    "",
    `Date: ${summary.date}`,
    "",
    "## Configuration",
    "",
    `- Provider: ${summary.provider}`,
    `- Model: ${summary.model}`,
    `- Credential source: ${summary.credentialSource}`,
    `- Temporary Hermes home: \`${summary.hermesHome}\``,
    `- Scenario workspace: \`${summary.workspaceDir}\``,
    "- Harness path: Playwright launches the built Electron app and drives the real Mercury chat UI/IPC/Hermes path.",
    "",
    "## Result",
    "",
    `- Status: **${summary.status.toUpperCase()}**`,
    `- Run id: ${result.runId || "n/a"}`,
    `- Run status: ${result.runStatus || "n/a"}`,
    `- Trace Lab UI search: ${summary.traceLab?.status || "n/a"}`,
    `- Artifact event evidence: ${result.artifactEvidence ? "yes" : "no"}`,
    `- Image tool/provider evidence: ${result.imageToolEvidence ? "yes" : "no"}`,
    "",
    "## Missing / blocked evidence",
    "",
    result.missing?.length
      ? result.missing.map((item) => `- Missing: ${item}`).join("\n")
      : "- No hard missing evidence.",
    result.blocked?.length
      ? result.blocked.map((item) => `- Blocked: ${item}`).join("\n")
      : "- No image/artifact blocker detected.",
    "",
    "## Workspace files",
    "",
    result.files?.length
      ? result.files.map((file) => `- ${file}`).join("\n")
      : "- None detected.",
    "",
    "## Trace event types",
    "",
    result.eventTypes?.length
      ? result.eventTypes.map((type) => `- ${type}`).join("\n")
      : "- None detected.",
    "",
    "## Artifacts",
    "",
    `- Summary JSON: [trace-lab-software-work-summary.json](trace-lab-software-work-summary.json)`,
    `- Screenshot: [trace-lab-software-work.png](trace-lab-software-work.png)`,
    "",
    "This report intentionally excludes API keys and auth payloads.",
    "",
  ].join("\n");
  fs.writeFileSync(reportPath, report);
};

const run = async () => {
  fs.mkdirSync(labsDir, { recursive: true });
  const credentials = discoverCredentials();
  assertBuiltApp();
  const hermesHome = writeHermesHome(credentials);
  const tracePath = path.join(hermesHome, "desktop-traces.json");
  const workspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "mercury-sw-workspace-"),
  );
  fs.mkdirSync(path.join(workspaceDir, "assets"), { recursive: true });

  let app;
  let summary;
  try {
    app = await launchApp(hermesHome, credentials);
    const page = await app.firstWindow();
    page.setDefaultTimeout(20_000);
    await page.waitForLoadState("domcontentloaded");
    await page.locator("textarea.chat-input").waitFor({ timeout: 60_000 });

    await page.evaluate(async (tools) => {
      await Promise.all(
        tools.map((tool) => window.hermesAPI.setToolsetEnabled(tool, true)),
      );
    }, requiredToolsets);

    const modelConfig = await page.evaluate(() =>
      window.hermesAPI.getModelConfig(),
    );
    console.log(
      `Running Trace Lab software-work scenario with ${modelConfig.provider}/${modelConfig.model}`,
    );
    console.log(`Workspace: ${workspaceDir}`);

    await sendScenarioPrompt(page, workspaceDir);
    const runRecord = await waitForRun(
      tracePath,
      (runItem) =>
        ["completed", "failed"].includes(runItem.status) &&
        (runContains(runItem, marker) ||
          runContains(runItem, blockedMarker) ||
          runContains(runItem, workspaceDir)),
      180_000,
    );

    const result = classify({ run: runRecord, workspaceDir });
    let traceLab = { status: "skipped", detail: "Run did not pass hard checks" };
    if (result.status !== "fail") {
      try {
        traceLab = await verifyTraceLabSearch(page, runRecord);
      } catch (error) {
        traceLab = { status: "fail", detail: error?.message || String(error) };
        result.missing.push(`Trace Lab UI search failed: ${traceLab.detail}`);
        result.status = "fail";
      }
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });

    summary = {
      date: new Date().toISOString(),
      provider: credentials.provider,
      model: credentials.model,
      credentialSource: credentials.source,
      hermesHome,
      workspaceDir,
      tracePath,
      status: result.status,
      result,
      traceLab,
      artifactPaths: { reportPath, summaryPath, screenshotPath },
    };
    writeArtifacts(summary);

    console.log(`Report written to ${reportPath}`);
    console.log(`Summary written to ${summaryPath}`);
    console.log(`Screenshot written to ${screenshotPath}`);
    console.log(`Scenario status: ${result.status}`);

    if (result.status === "fail") {
      throw new Error(
        `Trace Lab software-work scenario failed. See ${reportPath}`,
      );
    }
    if (result.status === "blocked" && process.env.TRACE_SW_WORK_ALLOW_BLOCKED !== "1") {
      const error = new Error(
        `Trace Lab software-work scenario is blocked by missing image/artifact evidence. See ${reportPath}`,
      );
      error.blockedScenario = true;
      throw error;
    }
  } catch (error) {
    if (!summary) {
      summary = {
        date: new Date().toISOString(),
        provider: credentials.provider,
        model: credentials.model,
        credentialSource: credentials.source,
        hermesHome,
        workspaceDir,
        tracePath,
        status: "fail",
        result: {
          status: "fail",
          missing: [error?.message || String(error)],
          blocked: [],
          files: listFilesRecursive(workspaceDir).map((file) =>
            path.relative(workspaceDir, file),
          ),
          eventTypes: [],
        },
        traceLab: { status: "skipped", detail: "Harness aborted" },
        artifactPaths: { reportPath, summaryPath, screenshotPath },
      };
      writeArtifacts(summary);
      console.error(`Partial report written to ${reportPath}`);
    }
    throw error;
  } finally {
    if (app) await app.close();
  }
};

run().catch((error) => {
  if (error?.blocker) {
    console.error(error.message);
    process.exit(1);
  }
  if (error?.blockedScenario) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});

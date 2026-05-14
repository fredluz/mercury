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
const reportPath = path.join(labsDir, "trace-lab-hardening-report.md");
const summaryPath = path.join(labsDir, "trace-lab-hardening-summary.json");
const screenshotPath = path.join(labsDir, "trace-lab-hardening.png");

const requiredToolsets = [
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

const blocker = (message) => {
  const error = new Error(message);
  error.blocker = true;
  return error;
};

const compact = (value, max = 240) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJsonIfExists = (filePath) => {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const readOpenCodeGoKey = () => {
  const authPath = path.join(
    os.homedir(),
    ".local",
    "share",
    "opencode",
    "auth.json",
  );
  if (!fs.existsSync(authPath)) return null;
  try {
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
    return auth["opencode-go"]?.key || null;
  } catch {
    return null;
  }
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
  const explicitProvider = process.env.TRACE_LAB_E2E_PROVIDER;
  const explicitModel = process.env.TRACE_LAB_E2E_MODEL;
  const explicitBaseUrl = process.env.TRACE_LAB_E2E_BASE_URL || "";
  const explicitKeyEnv = process.env.TRACE_LAB_E2E_API_KEY_ENV;
  const explicitKey =
    process.env.TRACE_LAB_E2E_API_KEY ||
    (explicitKeyEnv ? process.env[explicitKeyEnv] : "");

  if (explicitProvider && !explicitModel) {
    throw blocker(
      "TRACE_LAB_E2E_PROVIDER was set, but TRACE_LAB_E2E_MODEL is missing. Set both to constrain the hardening run to a specific provider.",
    );
  }

  if (explicitProvider && explicitModel) {
    const hermesAuth = readHermesAuth();
    if (explicitKey) {
      const providerKey = `${explicitProvider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
      return {
        source: explicitKeyEnv
          ? `TRACE_LAB_E2E_API_KEY_ENV=${explicitKeyEnv}`
          : "TRACE_LAB_E2E_API_KEY",
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
      `TRACE_LAB_E2E_PROVIDER=${explicitProvider} and TRACE_LAB_E2E_MODEL=${explicitModel} were set, but no matching explicit key or local Hermes auth was found. Set TRACE_LAB_E2E_API_KEY(_ENV) or configure ~/.hermes/auth.json.`,
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

  if (process.env.OPENCODE_GO_API_KEY || readOpenCodeGoKey()) {
    return {
      source: process.env.OPENCODE_GO_API_KEY
        ? "OPENCODE_GO_API_KEY"
        : "local OpenCode auth",
      provider: "opencode-go",
      model: explicitModel || "deepseek-v4-flash",
      baseUrl: explicitBaseUrl,
      env: {
        OPENCODE_GO_API_KEY:
          process.env.OPENCODE_GO_API_KEY || readOpenCodeGoKey(),
      },
      auth: { active_provider: "opencode-go" },
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

  if (process.env.OPENROUTER_API_KEY) {
    return {
      source: "OPENROUTER_API_KEY",
      provider: explicitProvider || "openrouter",
      model: explicitModel || "openai/gpt-4.1-mini",
      baseUrl: explicitBaseUrl,
      env: { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY },
      auth: { active_provider: explicitProvider || "openrouter" },
    };
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return {
      source: "ANTHROPIC_API_KEY",
      provider: explicitProvider || "anthropic",
      model: explicitModel || "claude-3-5-sonnet-latest",
      baseUrl: explicitBaseUrl,
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
      auth: { active_provider: explicitProvider || "anthropic" },
    };
  }

  throw blocker(
    [
      "Trace Lab hardening requires real model credentials.",
      "Configure one of:",
      "- opencode auth login",
      "- OPENCODE_GO_API_KEY",
      "- OPENAI_API_KEY",
      "- OPENROUTER_API_KEY",
      "- ANTHROPIC_API_KEY",
      "- TRACE_LAB_E2E_PROVIDER + TRACE_LAB_E2E_MODEL + TRACE_LAB_E2E_API_KEY(_ENV)",
    ].join("\n"),
  );
};

const shouldRunImageScenario = () => process.env.TRACE_LAB_E2E_SKIP_IMAGE !== "1";

const writeHermesHome = (credentials) => {
  const installedAgent = path.join(os.homedir(), ".hermes", "hermes-agent");
  if (!fs.existsSync(installedAgent)) {
    throw blocker(
      `Hermes Agent is not installed at ${installedAgent}. Install/configure Hermes first.`,
    );
  }

  const hermesHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "mercury-trace-hardening-"),
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

  const toolLines = requiredToolsets.map((tool) => `    - ${tool}`);
  const imageGenLines = credentials.imageGenProvider
    ? [
        "image_gen:",
        `  provider: ${credentials.imageGenProvider}`,
        `  model: ${process.env.TRACE_LAB_E2E_IMAGE_MODEL || "gpt-image-2-medium"}`,
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
      "max_turns: 40",
      ...imageGenLines,
      "platform_toolsets:",
      "  cli:",
      ...toolLines,
      "  api_server:",
      ...toolLines,
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
    throw blocker("Run npm run build before npm run e2e:trace-lab-hardening.");
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

const sendPrompt = async (page, prompt, marker, timeout = 240_000) => {
  await clickNav(page, "Chat").catch(() => undefined);
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
  await page.locator("textarea.chat-input").fill(prompt);
  await page.keyboard.press("Enter");
  await page
    .locator(".chat-message-agent .chat-bubble-agent")
    .filter({ hasText: marker })
    .waitFor({ timeout });
};

const sendPromptExpectingFailure = async (page, prompt, timeout = 90_000) => {
  await clickNav(page, "Chat").catch(() => undefined);
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
  await page.locator("textarea.chat-input").fill(prompt);
  await page.keyboard.press("Enter");
  try {
    await page
      .locator(".chat-message-agent .chat-bubble-agent")
      .filter({ hasText: /Error:/i })
      .waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
};

const sendPromptAndAbort = async (page, prompt) => {
  await clickNav(page, "Chat").catch(() => undefined);
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
  await page.locator("textarea.chat-input").fill(prompt);
  await page.keyboard.press("Enter");
  await page.locator(".chat-stop-btn").waitFor({ timeout: 45_000 });
  await page.locator(".chat-stop-btn").click();
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
};

const waitForRun = async (tracePath, predicate, timeout = 120_000) => {
  const deadline = Date.now() + timeout;
  let last = "missing trace store";
  while (Date.now() < deadline) {
    const store = readJsonIfExists(tracePath);
    const runs = store?.runs || [];
    const match = runs.find(predicate);
    if (match) return match;
    last = `${runs.length} run(s): ${runs.map((run) => `${run.status}:${compact(run.messagePreview, 40)}`).join(" | ")}`;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for trace run; last state: ${last}`);
};

const runContains = (run, marker) =>
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
    .some((text) => String(text).includes(marker));

const eventTypes = (run) =>
  new Set((run.events || []).map((event) => event.type));

const hasAnyEvent = (run, types) => {
  const typeSet = eventTypes(run);
  return types.some((type) => typeSet.has(type));
};

const eventText = (event) =>
  `${event.type} ${event.title} ${event.detail || ""} ${JSON.stringify(event.metadata || {})}`;

const hasEventMatching = (run, pattern) =>
  (run.events || []).some((event) => pattern.test(eventText(event)));

const harnessClosedRe = /Target page, context or browser has been closed|Page closed|Browser has been closed/i;
const isHarnessClosureError = (error) => harnessClosedRe.test(error?.message || String(error));

const imageProviderFailureRe = /image|artifact|openai|codex|gpt[-_ ]?image|provider|unavailable|unknown|not available|not supported|denied|forbidden|unauthorized|access/i;
const imageArtifactRe = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)|^https?:\/\//i;

const hasImageArtifactEvidence = (run) =>
  (run.events || []).some((event) => {
    if (event.type !== "artifact.created") return false;
    const metadata = event.metadata || {};
    const artifactType = String(metadata.artifactType || "").toLowerCase();
    const reference = String(metadata.url || metadata.path || event.detail || "");
    return artifactType === "image" || imageArtifactRe.test(reference);
  });

const classifyExpectedImageFailure = (run) => {
  if (!run || run.status !== "failed") return null;
  const failureEvent = (run.events || []).find(
    (event) =>
      ["transport.error", "tool.failed"].includes(event.type) &&
      imageProviderFailureRe.test(eventText(event)),
  );
  if (!failureEvent) return null;
  return compact(failureEvent.detail || failureEvent.title || failureEvent.type);
};

const verifyImageScenario = (scenario, run) => {
  const failureDetail = classifyExpectedImageFailure(run);
  if (run.status === "completed" && hasImageArtifactEvidence(run)) {
    return {
      ...scenario,
      runId: run.id,
      status: "pass",
      missing: [],
      dependencies: [],
      runStatus: run.status,
      eventTypes: Array.from(eventTypes(run)).sort(),
      usage: run.usage || null,
      classification: "success",
    };
  }
  if (failureDetail) {
    return {
      ...scenario,
      runId: run.id,
      status: "dependency",
      missing: [],
      dependencies: [`expected image provider/tool failure traced: ${failureDetail}`],
      runStatus: run.status,
      eventTypes: Array.from(eventTypes(run)).sort(),
      usage: run.usage || null,
      classification: "expected-provider-tool-failure",
    };
  }
  const missing = [];
  if (!["completed", "failed"].includes(run.status)) {
    missing.push("completed or explicit failed status");
  }
  if (run.status === "completed" && !hasImageArtifactEvidence(run)) {
    missing.push("artifact.created image evidence on success");
  }
  if (run.status === "failed") {
    missing.push("traceable image provider/tool failure evidence");
  }
  return {
    ...scenario,
    runId: run.id,
    status: "fail",
    missing: missing.length ? missing : ["image success or traceable provider/tool failure classification"],
    dependencies: [],
    runStatus: run.status,
    eventTypes: Array.from(eventTypes(run)).sort(),
    usage: run.usage || null,
    classification: "unclassified-failure",
  };
};

const verifyScenario = (scenario, run, checks) => {
  const hardFailures = [];
  const dependencies = [];
  for (const check of checks) {
    const ok = check.test(run);
    if (ok) continue;
    if (check.dependency) dependencies.push(check.label);
    else hardFailures.push(check.label);
  }
  return {
    ...scenario,
    runId: run?.id || null,
    status: hardFailures.length
      ? "fail"
      : dependencies.length
        ? "dependency"
        : "pass",
    missing: hardFailures,
    dependencies,
    runStatus: run?.status || null,
    eventTypes: run ? Array.from(eventTypes(run)).sort() : [],
    usage: run?.usage || null,
  };
};

const verifyTraceLabSearch = async (page, scenario) => {
  if (!scenario.marker)
    return { marker: scenario.name, status: "skipped", detail: "No marker" };
  await clickNav(page, "Trace Lab");
  await page
    .locator(".trace-run-row, .trace-run-results")
    .first()
    .waitFor({ timeout: 30_000 });
  await page.locator(".trace-run-search input").fill(scenario.marker);
  const row = page
    .locator(".trace-run-row")
    .filter({ hasText: scenario.marker })
    .first();
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page
    .locator(".trace-detail")
    .filter({ hasText: scenario.marker })
    .waitFor({ timeout: 10_000 });
  await page.locator(".trace-event-row").first().click();
  await page.locator(".trace-inspector").waitFor({ timeout: 10_000 });
  return { marker: scenario.marker, status: "pass" };
};

const sendPromptAndWaitForTraceTerminal = async (
  page,
  tracePath,
  prompt,
  marker,
  timeout = 420_000,
) => {
  await clickNav(page, "Chat").catch(() => undefined);
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
  await page.locator("textarea.chat-input").fill(prompt);
  await page.keyboard.press("Enter");

  const deadline = Date.now() + timeout;
  let last = "missing trace store";
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error(
        `Harness failure: Electron page/context closed while waiting for ${marker}. Last trace state: ${last}`,
      );
    }
    const store = readJsonIfExists(tracePath);
    const runs = store?.runs || [];
    const match = runs.find(
      (run) => ["completed", "failed", "aborted"].includes(run.status) && runContains(run, marker),
    );
    if (match) return match;
    last = `${runs.length} run(s): ${runs.map((run) => `${run.status}:${compact(run.messagePreview, 40)}`).join(" | ")}`;
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${marker} terminal trace run; last state: ${last}`);
};

const writeArtifacts = (summary) => {
  fs.mkdirSync(labsDir, { recursive: true });
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  const scenarioRows = summary.scenarios
    .map(
      (scenario) =>
        `| ${scenario.status.toUpperCase()} | ${scenario.name} | ${scenario.runStatus || "n/a"} | ${scenario.runId || "n/a"} | ${scenario.missing.concat(scenario.dependencies.map((d) => `dependency: ${d}`)).join("<br>") || "—"} |`,
    )
    .join("\n");

  const traceLabRows = summary.traceLab
    .map(
      (item) =>
        `| ${item.status.toUpperCase()} | ${item.marker} | ${item.detail || "—"} |`,
    )
    .join("\n");

  const harnessFailures = summary.scenarios.filter(
    (scenario) => scenario.classification === "harness-failure" || scenario.name === "Harness aborted before completion",
  );
  const hardFailures = summary.scenarios.filter((scenario) => scenario.status === "fail");
  const dependencyText = summary.dependencies.length
    ? summary.dependencies.map((dep) => `- ${dep}`).join("\n")
    : hardFailures.length
      ? "- Not evaluated because harness/scenario hard failures were present."
      : "- None detected; all expected dependency-sensitive evidence was present.";
  const harnessFailureText = harnessFailures.length
    ? harnessFailures.map((failure) => `- ${failure.missing.join("; ") || failure.name}`).join("\n")
    : "- None detected.";

  const report = [
    "# Trace Lab Hardening E2E",
    "",
    `Date: ${summary.date}`,
    "",
    "## Configuration",
    "",
    `- Provider: ${summary.provider}`,
    `- Model: ${summary.model}`,
    `- Credential source: ${summary.credentialSource} (secrets copied only into the temporary Hermes home at runtime).`,
    `- Temporary Hermes home: \`${summary.hermesHome}\``,
    `- Image scenario: ${summary.imageScenarioEnabled ? "enabled" : "skipped via TRACE_LAB_E2E_SKIP_IMAGE=1"}`,
    "- Harness path: Playwright launches the built Electron app and drives renderer UI/preload APIs against the real IPC/main Hermes path.",
    "",
    "## Scenario verification",
    "",
    "| Result | Scenario | Run status | Run id | Missing evidence |",
    "| --- | --- | --- | --- | --- |",
    scenarioRows,
    "",
    "## Trace Lab UI verification",
    "",
    "| Result | Marker | Detail |",
    "| --- | --- | --- |",
    traceLabRows,
    "",
    "## Classification semantics",
    "",
    "- PASS means the scenario produced all required evidence. Image generation only passes when a completed run contains `artifact.created` image evidence.",
    "- DEPENDENCY means the app path traced an expected external provider/tool-unavailable failure; it is not counted as generated image success.",
    "- FAIL means a harness crash, page closure, unclassified app failure, or missing hard evidence.",
    "",
    "## Item 1 dependencies",
    "",
    dependencyText,
    "",
    "## Harness failures",
    "",
    harnessFailureText,
    "",
    "## Artifacts",
    "",
    `- Summary JSON: [trace-lab-hardening-summary.json](trace-lab-hardening-summary.json)`,
    `- Screenshot: [trace-lab-hardening.png](trace-lab-hardening.png)`,
    "",
    "## Secret handling",
    "",
    "The report and summary intentionally include only provider/model names, credential source labels, run ids, statuses, event type names, and dependency notes. API keys and auth payloads are not written to repository artifacts.",
    "",
  ].join("\n");
  fs.writeFileSync(reportPath, report);
};

const run = async () => {
  fs.mkdirSync(labsDir, { recursive: true });
  const credentials = discoverCredentials();
  assertBuiltApp();
  const imageScenarioEnabled = shouldRunImageScenario();
  const hermesHome = writeHermesHome(credentials);
  const tracePath = path.join(hermesHome, "desktop-traces.json");

  const scenarios = [];
  const traceLab = [];
  let app;
  let artifactsWritten = false;

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
      `Running Trace Lab hardening with ${modelConfig.provider}/${modelConfig.model}`,
    );

    const normal = {
      name: "Normal conversation",
      marker: "TRACE_HARDEN_NORMAL_OK",
      prompt: "Reply with exactly: TRACE_HARDEN_NORMAL_OK",
    };
    await sendPrompt(page, normal.prompt, normal.marker);
    const normalRun = await waitForRun(
      tracePath,
      (run) => run.status === "completed" && runContains(run, normal.marker),
    );
    scenarios.push(
      verifyScenario(normal, normalRun, [
        {
          label: "completed status",
          test: (run) => run.status === "completed",
        },
        {
          label: "message.user",
          test: (run) => hasAnyEvent(run, ["message.user"]),
        },
        {
          label: "message.agent.delta",
          test: (run) => hasAnyEvent(run, ["message.agent.delta"]),
        },
        {
          label: "run.completed",
          test: (run) => hasAnyEvent(run, ["run.completed"]),
        },
        {
          label: "usage.recorded or usage totals",
          test: (run) =>
            hasAnyEvent(run, ["usage.recorded"]) ||
            Boolean(run.usage?.totalTokens),
          dependency: true,
        },
      ]),
    );

    const resume = {
      name: "Resumed/history conversation",
      marker: "TRACE_HARDEN_RESUME_OK",
      prompt:
        "Reference TRACE_HARDEN_NORMAL_OK and reply with exactly: TRACE_HARDEN_RESUME_OK",
    };
    await sendPrompt(page, resume.prompt, resume.marker);
    const resumeRun = await waitForRun(
      tracePath,
      (run) => run.status === "completed" && runContains(run, resume.marker),
    );
    scenarios.push(
      verifyScenario(resume, resumeRun, [
        {
          label: "completed status",
          test: (run) => run.status === "completed",
        },
        {
          label: "session id present",
          test: (run) => Boolean(run.sessionId),
          dependency: true,
        },
        {
          label: "session.resumed",
          test: (run) => hasAnyEvent(run, ["session.resumed"]),
          dependency: true,
        },
        {
          label: "message.history.loaded",
          test: (run) => hasAnyEvent(run, ["message.history.loaded"]),
          dependency: true,
        },
      ]),
    );

    const tool = {
      name: "Tool call",
      marker: "TRACE_HARDEN_TOOL_OK",
      prompt:
        "Use the terminal tool to run pwd only. Then reply with exactly: TRACE_HARDEN_TOOL_OK",
    };
    await sendPrompt(page, tool.prompt, tool.marker, 300_000);
    const toolRun = await waitForRun(
      tracePath,
      (run) => run.status === "completed" && runContains(run, tool.marker),
    );
    scenarios.push(
      verifyScenario(tool, toolRun, [
        {
          label: "completed status",
          test: (run) => run.status === "completed",
        },
        {
          label: "tool evidence",
          test: (run) =>
            hasAnyEvent(run, [
              "tool.started",
              "tool.progress",
              "tool.completed",
            ]) || hasEventMatching(run, /terminal|pwd|shell|tool/i),
          dependency: true,
        },
      ]),
    );

    const delegation = {
      name: "Delegation/sub-agent",
      marker: "TRACE_HARDEN_DELEGATION_OK",
      prompt:
        "Delegate a short subtask to summarize the word Mercury in one sentence. Then reply with exactly: TRACE_HARDEN_DELEGATION_OK",
    };
    await sendPrompt(page, delegation.prompt, delegation.marker, 360_000);
    const delegationRun = await waitForRun(
      tracePath,
      (run) =>
        run.status === "completed" && runContains(run, delegation.marker),
    );
    scenarios.push(
      verifyScenario(delegation, delegationRun, [
        {
          label: "completed status",
          test: (run) => run.status === "completed",
        },
        {
          label: "delegation evidence",
          test: (run) =>
            hasAnyEvent(run, [
              "delegation.started",
              "delegation.completed",
              "delegation.failed",
            ]) || hasEventMatching(run, /delegate|subagent|sub-agent/i),
          dependency: true,
        },
      ]),
    );

    if (imageScenarioEnabled) {
      const image = {
        name: "Image generation",
        marker: "TRACE_HARDEN_IMAGE_OK",
        prompt:
          "Use the image_generate tool to generate an actual tiny harmless abstract blue circle image. Do not merely describe the image. After the tool returns an image URL or file path, include that image reference in your answer and then reply with exactly: TRACE_HARDEN_IMAGE_OK",
      };
      const imageRun = await sendPromptAndWaitForTraceTerminal(
        page,
        tracePath,
        image.prompt,
        image.marker,
        420_000,
      );
      scenarios.push(verifyImageScenario(image, imageRun));
    }

    const originalConfig = await page.evaluate(() =>
      window.hermesAPI.getModelConfig(),
    );
    const errorScenario = {
      name: "Intentional model error",
      marker: "TRACE_HARDEN_ERROR_EXPECTED",
      prompt: "Reply with exactly: TRACE_HARDEN_ERROR_EXPECTED",
    };
    try {
      await page.evaluate(
        ({ provider, baseUrl }) =>
          window.hermesAPI.setModelConfig(
            provider,
            "trace-lab-invalid-model-do-not-create",
            baseUrl,
          ),
        originalConfig,
      );
      await sendPromptExpectingFailure(page, errorScenario.prompt);
    } finally {
      await page.evaluate(
        ({ provider, model, baseUrl }) =>
          window.hermesAPI.setModelConfig(provider, model, baseUrl),
        originalConfig,
      );
    }
    const errorRun = await waitForRun(
      tracePath,
      (run) =>
        ["failed", "completed"].includes(run.status) &&
        runContains(run, errorScenario.marker),
    );
    scenarios.push(
      verifyScenario(errorScenario, errorRun, [
        { label: "failed status", test: (run) => run.status === "failed" },
        {
          label: "run.failed",
          test: (run) => hasAnyEvent(run, ["run.failed"]),
        },
        {
          label: "transport.error",
          test: (run) =>
            hasAnyEvent(run, ["transport.error"]) ||
            hasEventMatching(run, /error|invalid model|not found/i),
          dependency: true,
        },
      ]),
    );

    const abort = {
      name: "Cancellation/abort",
      marker: "TRACE_HARDEN_ABORT_EXPECTED",
      prompt:
        "Write a very long numbered essay of at least 1000 words. Include TRACE_HARDEN_ABORT_EXPECTED in the first sentence, then continue until stopped.",
    };
    await sendPromptAndAbort(page, abort.prompt);
    const abortRun = await waitForRun(
      tracePath,
      (run) => run.status === "aborted" && runContains(run, abort.marker),
      90_000,
    );
    scenarios.push(
      verifyScenario(abort, abortRun, [
        { label: "aborted status", test: (run) => run.status === "aborted" },
        {
          label: "run.aborted",
          test: (run) => hasAnyEvent(run, ["run.aborted"]),
        },
      ]),
    );

    const slash = {
      name: "Local slash command",
      marker: "/model",
      prompt: "/model",
    };
    await sendPrompt(page, slash.prompt, "Current model", 30_000).catch(
      async () => {
        await page.locator("textarea.chat-input").waitFor({ timeout: 10_000 });
      },
    );
    const slashStore = readJsonIfExists(tracePath);
    const slashRun = slashStore?.runs?.find(
      (run) => runContains(run, "/model") || hasAnyEvent(run, ["slash.local"]),
    );
    scenarios.push(
      verifyScenario(slash, slashRun || { status: null, events: [] }, [
        {
          label: "slash.local",
          test: (run) => hasAnyEvent(run, ["slash.local"]),
          dependency: true,
        },
      ]),
    );

    const traceLabScenarios = scenarios.filter(
      (scenario) =>
        scenario.marker &&
        scenario.runId &&
        scenario.marker.startsWith("TRACE_HARDEN"),
    );
    for (const scenario of traceLabScenarios) {
      try {
        traceLab.push(await verifyTraceLabSearch(page, scenario));
      } catch (error) {
        traceLab.push({
          marker: scenario.marker,
          status: "fail",
          detail: error?.message || String(error),
        });
      }
    }
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const dependencies = scenarios.flatMap((scenario) =>
      scenario.dependencies.map(
        (dependency) => `${scenario.name}: ${dependency}`,
      ),
    );
    const summary = {
      date: new Date().toISOString(),
      provider: credentials.provider,
      model: credentials.model,
      credentialSource: credentials.source,
      hermesHome,
      imageScenarioEnabled,
      scenarios,
      traceLab,
      dependencies,
      artifactPaths: { reportPath, summaryPath, screenshotPath },
    };
    writeArtifacts(summary);
    artifactsWritten = true;

    const hardFailures = scenarios.filter(
      (scenario) => scenario.status === "fail",
    );
    const traceLabFailures = traceLab.filter((item) => item.status === "fail");
    console.log(`Report written to ${reportPath}`);
    console.log(`Summary written to ${summaryPath}`);
    console.log(`Screenshot written to ${screenshotPath}`);
    if (dependencies.length) {
      console.warn(
        `Item 1 dependency evidence missing:\n- ${dependencies.join("\n- ")}`,
      );
    }
    if (hardFailures.length || traceLabFailures.length) {
      throw new Error(
        `Trace Lab hardening failed: ${hardFailures.length} scenario hard failure(s), ${traceLabFailures.length} Trace Lab UI failure(s). See ${reportPath}`,
      );
    }
  } catch (error) {
    if (!artifactsWritten) {
      const dependencies = scenarios.flatMap((scenario) =>
        scenario.dependencies.map(
          (dependency) => `${scenario.name}: ${dependency}`,
        ),
      );
      const summary = {
        date: new Date().toISOString(),
        provider: credentials.provider,
        model: credentials.model,
        credentialSource: credentials.source,
        hermesHome,
        imageScenarioEnabled,
        scenarios: [
          ...scenarios,
          {
            name: "Harness aborted before completion",
            marker: null,
            runId: null,
            status: "fail",
            missing: [
              isHarnessClosureError(error)
                ? `Harness failure: Electron page/context closed before completion (${compact(error?.message || String(error))})`
                : error?.message || String(error),
            ],
            dependencies: [],
            runStatus: null,
            eventTypes: [],
            usage: null,
            classification: "harness-failure",
          },
        ],
        traceLab,
        dependencies,
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
  } else {
    console.error(error);
  }
  process.exit(1);
});

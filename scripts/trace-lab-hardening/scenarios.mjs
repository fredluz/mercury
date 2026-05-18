/* eslint-disable @typescript-eslint/explicit-function-return-type */

import fs from "node:fs";
import path from "node:path";

import { writeArtifacts } from "./artifacts.mjs";
import { discoverCredentials } from "./credentials.mjs";
import { assertBuiltApp, launchApp } from "./electron-app.mjs";
import { shouldRunImageScenario, writeHermesHome } from "./hermes-home.mjs";
import {
  sendPrompt,
  sendPromptAndAbort,
  sendPromptAndWaitForTraceTerminal,
  sendPromptExpectingFailure,
} from "./playwright-actions.mjs";
import {
  compact,
  labsDir,
  readJsonIfExists,
  reportPath,
  requiredToolsets,
  screenshotPath,
  summaryPath,
} from "./constants.mjs";
import {
  hasAnyEvent,
  hasEventMatching,
  isHarnessClosureError,
  runContains,
  waitForRun,
} from "./trace-assertions.mjs";
import {
  verifyImageScenario,
  verifyScenario,
  verifyTraceLabSearch,
} from "./scenario-verifiers.mjs";

export const runTraceLabHardening = async () => {
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

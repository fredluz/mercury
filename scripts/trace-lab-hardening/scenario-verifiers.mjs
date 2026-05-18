/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { clickNav } from "./playwright-actions.mjs";
import {
  classifyExpectedImageFailure,
  eventTypes,
  hasImageArtifactEvidence,
} from "./trace-assertions.mjs";

export const verifyImageScenario = (scenario, run) => {
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

export const verifyScenario = (scenario, run, checks) => {
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

export const verifyTraceLabSearch = async (page, scenario) => {
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

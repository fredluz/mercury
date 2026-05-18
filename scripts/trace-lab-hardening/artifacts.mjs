/* eslint-disable @typescript-eslint/explicit-function-return-type */

import fs from "node:fs";

import { labsDir, reportPath, summaryPath } from "./constants.mjs";

export const writeArtifacts = (summary) => {
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

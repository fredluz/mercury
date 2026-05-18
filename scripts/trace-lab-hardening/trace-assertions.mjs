/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { compact, readJsonIfExists, sleep } from "./constants.mjs";

export const waitForRun = async (tracePath, predicate, timeout = 120_000) => {
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

export const runContains = (run, marker) =>
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

export const eventTypes = (run) =>
  new Set((run.events || []).map((event) => event.type));

export const hasAnyEvent = (run, types) => {
  const typeSet = eventTypes(run);
  return types.some((type) => typeSet.has(type));
};

export const eventText = (event) =>
  `${event.type} ${event.title} ${event.detail || ""} ${JSON.stringify(event.metadata || {})}`;

export const hasEventMatching = (run, pattern) =>
  (run.events || []).some((event) => pattern.test(eventText(event)));

const harnessClosedRe = /Target page, context or browser has been closed|Page closed|Browser has been closed/i;
export const isHarnessClosureError = (error) => harnessClosedRe.test(error?.message || String(error));

const imageProviderFailureRe = /image|artifact|openai|codex|gpt[-_ ]?image|provider|unavailable|unknown|not available|not supported|denied|forbidden|unauthorized|access/i;
const imageArtifactRe = /\.(?:png|jpe?g|gif|webp|svg)(?:[?#]|$)|^https?:\/\//i;

export const hasImageArtifactEvidence = (run) =>
  (run.events || []).some((event) => {
    if (event.type !== "artifact.created") return false;
    const metadata = event.metadata || {};
    const artifactType = String(metadata.artifactType || "").toLowerCase();
    const reference = String(metadata.url || metadata.path || event.detail || "");
    return artifactType === "image" || imageArtifactRe.test(reference);
  });

export const classifyExpectedImageFailure = (run) => {
  if (!run || run.status !== "failed") return null;
  const failureEvent = (run.events || []).find(
    (event) =>
      ["transport.error", "tool.failed"].includes(event.type) &&
      imageProviderFailureRe.test(eventText(event)),
  );
  if (!failureEvent) return null;
  return compact(failureEvent.detail || failureEvent.title || failureEvent.type);
};

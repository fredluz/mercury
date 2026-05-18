/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { compact, readJsonIfExists, sleep } from "./constants.mjs";
import { runContains } from "./trace-assertions.mjs";

export const clickNav = async (page, label) => {
  await page.locator(".sidebar-nav-item").filter({ hasText: label }).click();
};

export const sendPrompt = async (page, prompt, marker, timeout = 240_000) => {
  await clickNav(page, "Chat").catch(() => undefined);
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
  await page.locator("textarea.chat-input").fill(prompt);
  await page.keyboard.press("Enter");
  await page
    .locator(".chat-message-agent .chat-bubble-agent")
    .filter({ hasText: marker })
    .waitFor({ timeout });
};

export const sendPromptExpectingFailure = async (page, prompt, timeout = 90_000) => {
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

export const sendPromptAndAbort = async (page, prompt) => {
  await clickNav(page, "Chat").catch(() => undefined);
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
  await page.locator("textarea.chat-input").fill(prompt);
  await page.keyboard.press("Enter");
  await page.locator(".chat-stop-btn").waitFor({ timeout: 45_000 });
  await page.locator(".chat-stop-btn").click();
  await page.locator("textarea.chat-input").waitFor({ timeout: 45_000 });
};
export const sendPromptAndWaitForTraceTerminal = async (
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

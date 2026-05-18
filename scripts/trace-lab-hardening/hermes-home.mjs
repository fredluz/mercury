/* eslint-disable @typescript-eslint/explicit-function-return-type */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { blocker, requiredToolsets } from "./constants.mjs";

export const shouldRunImageScenario = () => process.env.TRACE_LAB_E2E_SKIP_IMAGE !== "1";

export const writeHermesHome = (credentials) => {
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

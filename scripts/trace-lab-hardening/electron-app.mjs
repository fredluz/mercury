/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createRequire } from "node:module";
import fs from "node:fs";

import { appEntry, blocker, repoRoot } from "./constants.mjs";

const require = createRequire(import.meta.url);

export const assertBuiltApp = () => {
  if (!fs.existsSync(appEntry)) {
    throw blocker("Run npm run build before npm run e2e:trace-lab-hardening.");
  }
};

export const buildElectronEnv = (hermesHome, credentials) => {
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

export const launchApp = async (hermesHome, credentials) => {
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

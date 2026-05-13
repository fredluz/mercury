import { spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getEnhancedPath } from "../install/paths";
import { stripAnsi } from "../utils";
import { HERMES_OFFICE_DIR, HERMES_OFFICE_REPO, findNpm } from "./shared";
import { writeClaw3dSettings } from "./config";
import type { Claw3dSetupProgress } from "./config";

export async function setupClaw3d(
  onProgress: (progress: Claw3dSetupProgress) => void,
): Promise<void> {
  const totalSteps = 2;
  let log = "";

  function emit(step: number, title: string, text: string): void {
    log += text;
    onProgress({
      step,
      totalSteps,
      title,
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    HOME: homedir(),
    TERM: "dumb",
  };

  // Step 1: Clone (or pull if already cloned)
  const cloned = existsSync(join(HERMES_OFFICE_DIR, "package.json"));

  if (!cloned) {
    emit(1, "Cloning Claw3D repository...", "Cloning from GitHub...\n");
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "git",
        ["clone", HERMES_OFFICE_REPO, HERMES_OFFICE_DIR],
        {
          cwd: homedir(),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      proc.stdout?.on("data", (data: Buffer) => {
        emit(1, "Cloning Claw3D repository...", stripAnsi(data.toString()));
      });
      proc.stderr?.on("data", (data: Buffer) => {
        emit(1, "Cloning Claw3D repository...", stripAnsi(data.toString()));
      });

      proc.on("close", (code) => {
        if (code === 0) {
          emit(1, "Cloning Claw3D repository...", "Clone complete.\n");
          resolve();
        } else {
          reject(new Error(`git clone failed (exit code ${code})`));
        }
      });
      proc.on("error", (err) =>
        reject(new Error(`Failed to run git: ${err.message}`)),
      );
    });
  } else {
    emit(
      1,
      "Claw3D already cloned",
      "Repository already exists, pulling latest...\n",
    );
    await new Promise<void>((resolve) => {
      const proc = spawn("git", ["pull", "--ff-only"], {
        cwd: HERMES_OFFICE_DIR,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.stdout?.on("data", (data: Buffer) => {
        emit(1, "Updating Claw3D...", stripAnsi(data.toString()));
      });
      proc.stderr?.on("data", (data: Buffer) => {
        emit(1, "Updating Claw3D...", stripAnsi(data.toString()));
      });

      proc.on("close", (code) => {
        if (code === 0) resolve();
        else resolve(); // non-fatal: pull failures shouldn't block setup
      });
      proc.on("error", () => resolve());
    });
  }

  // Step 2: npm install
  emit(2, "Installing dependencies...", "Running npm install...\n");
  const npm = findNpm();

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(npm, ["install"], {
      cwd: HERMES_OFFICE_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      emit(2, "Installing dependencies...", stripAnsi(data.toString()));
    });
    proc.stderr?.on("data", (data: Buffer) => {
      emit(2, "Installing dependencies...", stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit(
          2,
          "Installing dependencies...",
          "Dependencies installed successfully.\n",
        );
        resolve();
      } else {
        reject(new Error(`npm install failed (exit code ${code})`));
      }
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to run npm: ${err.message}`)),
    );
  });

  // Write config files so Claw3D skips onboarding
  writeClaw3dSettings();
}

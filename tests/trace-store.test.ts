import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `hermes-trace-store-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
}));

import {
  createLocalChatTrace,
  createTraceRun,
  listSkillTrainingRuns,
  listTraceRuns,
  recordTraceEvent,
} from "../src/main/trace-store";

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("trace-store core trace events", () => {
  it("persists structured trace events and strips secret metadata", () => {
    const run = createTraceRun("Generate a trace artifact");

    recordTraceEvent(run.id, "tool.started", "Tool started: image_gen", "image_gen", {
      toolName: "image_gen",
      apiKey: "must-not-persist",
      nested: { token: "hidden", safe: "visible" },
    });
    recordTraceEvent(run.id, "artifact.created", "Artifact created", "file.png token=secret", {
      artifactType: "image",
      path: "/tmp/file.png",
      authorization: "Bearer secret",
    });

    const [stored] = listTraceRuns();
    const toolEvent = stored.events.find((event) => event.type === "tool.started");
    const artifactEvent = stored.events.find(
      (event) => event.type === "artifact.created",
    );

    expect(toolEvent?.metadata).toMatchObject({ toolName: "image_gen" });
    expect(toolEvent?.metadata).not.toHaveProperty("apiKey");
    expect(String(toolEvent?.metadata?.nested)).not.toContain("hidden");
    expect(artifactEvent?.detail).toBe("file.png token=[redacted]");
    expect(artifactEvent?.metadata).toMatchObject({
      artifactType: "image",
      path: "/tmp/file.png",
    });
    expect(artifactEvent?.metadata).not.toHaveProperty("authorization");
  });

  it("creates a completed local slash command trace", () => {
    const run = createLocalChatTrace({
      command: "/model",
      profile: "default",
      responsePreview: "Current model: hermes-agent",
      metadata: { api_token: "hidden", command: "/model" },
    });

    expect(run.status).toBe("completed");
    expect(run.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "run.started",
        "message.user",
        "slash.local",
        "message.agent.delta",
        "run.completed",
      ]),
    );
    const slashEvent = run.events.find((event) => event.type === "slash.local");
    expect(slashEvent?.metadata).toMatchObject({ command: "/model" });
    expect(slashEvent?.metadata).not.toHaveProperty("api_token");
  });
});

describe("trace-store skill training extraction", () => {
  it("preserves linked run, score, and needs-review status from skill metadata", () => {
    const run = createTraceRun("Improve the visual explainer skill");

    recordTraceEvent(
      run.id,
      "skill.eval",
      "visual-explainer",
      "Visual explainer needs one more review before promotion.",
      {
        skillName: "visual-explainer",
        score: "0.82",
        status: "needs-review",
      },
    );

    const [skillRun] = listSkillTrainingRuns();
    expect(skillRun).toMatchObject({
      skillName: "visual-explainer",
      status: "needs-review",
      score: 0.82,
      linkedRunId: run.id,
      summary: "Visual explainer needs one more review before promotion.",
    });
  });

  it("clamps invalid score metadata to the trust range", () => {
    const run = createTraceRun("Promote a high-scoring skill");
    recordTraceEvent(run.id, "skill.promoted", "trace-compressor", undefined, {
      skillName: "trace-compressor",
      score: 1.4,
    });

    const [skillRun] = listSkillTrainingRuns();
    expect(skillRun.score).toBe(1);
  });
});

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
  createTraceRun,
  listSkillTrainingRuns,
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

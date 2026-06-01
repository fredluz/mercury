import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("os");
  return {
    TEST_HOME: path.join(os.tmpdir(), `mercury-agents-state-test-${Date.now()}`),
  };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  getEnhancedPath: () => process.env.PATH || "",
}));

import {
  agentDraftsStateFilePath,
  agentsStateFilePath,
  createAgentDraft,
  deriveBackendProfileId,
  mutateAgentDraft,
  readAgentsState,
} from "../src/main/agent-store";
import { listProfiles, writeProfileAgentMetadata } from "../src/main/profiles";

const PROFILES_DIR = join(TEST_HOME, "profiles");

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(PROFILES_DIR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("profile-scoped agent metadata", () => {
  it("keeps committed identity out of the draft store", async () => {
    expect(agentDraftsStateFilePath()).toBe(join(TEST_HOME, "desktop", "agent-drafts.json"));
    expect(agentsStateFilePath()).toBe(agentDraftsStateFilePath());

    const state = await readAgentsState();

    expect(state).toEqual({ version: 1, drafts: {} });
    expect("agents" in state).toBe(false);
    expect(existsSync(join(TEST_HOME, "desktop", "agents.json"))).toBe(false);
  });

  it("reads named display metadata from profile-scoped profile-agent.json", async () => {
    const profilePath = join(PROFILES_DIR, "research-bot");
    mkdirSync(profilePath, { recursive: true });
    await writeProfileAgentMetadata(profilePath, {
      version: 1,
      displayName: "Research Bot",
      description: "Finds sources",
      selectedPackIds: ["research"],
      docsPointers: [{ id: "guide", title: "Guide", url: "https://example.test" }],
    });

    const profiles = await listProfiles();

    expect(profiles.find((profile) => profile.name === "research-bot")).toMatchObject({
      displayName: "Research Bot",
      kind: "custom",
      immutable: false,
      deletable: true,
      description: "Finds sources",
      selectedPackIds: ["research"],
      docsPointers: [{ id: "guide", title: "Guide", url: "https://example.test" }],
    });
  });

  it("ignores legacy desktop/agents.json committed identity data", async () => {
    mkdirSync(join(PROFILES_DIR, "legacy"), { recursive: true });
    mkdirSync(join(TEST_HOME, "desktop"), { recursive: true });
    writeFileSync(
      join(TEST_HOME, "desktop", "agents.json"),
      JSON.stringify({
        version: 1,
        agents: { legacy: { displayName: "Legacy Display" } },
        drafts: {},
      }),
    );

    const profiles = await listProfiles();
    const state = await readAgentsState();

    expect(profiles.find((profile) => profile.name === "legacy")?.displayName).toBe("legacy");
    expect(state.drafts).toEqual({});
    expect("agents" in state).toBe(false);
  });
});

describe("backend profile id derivation", () => {
  it("creates lowercase safe slugs compatible with profile naming", () => {
    expect(deriveBackendProfileId("Research Bot!!")).toBe("research-bot");
    expect(deriveBackendProfileId("___")).toBe("agent");
    expect(deriveBackendProfileId("9 Lives")).toBe("9-lives");
  });

  it("reserves default and mercury and resolves collisions deterministically", () => {
    expect(deriveBackendProfileId("default")).toBe("default-2");
    expect(deriveBackendProfileId("Mercury")).toBe("mercury-2");
    expect(deriveBackendProfileId("Research", ["research", "research-2"])).toBe(
      "research-3",
    );
  });

  it("locks the derived backend profile id when a draft is created", async () => {
    const draft = await createAgentDraft({ draftId: "draft-lock", displayName: "Writer" });

    const result = await mutateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "rename-1",
      patch: { displayName: "Editor" },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.draft.profile).toBe("writer");
    expect(result.draft.displayName).toBe("Editor");
  });
});

describe("draft-only store determinism", () => {
  it("increments revisions monotonically, dedupes mutationId retries, and reports stale conflicts", async () => {
    const draft = await createAgentDraft({ draftId: "draft-1", displayName: "Research" });

    const first = await mutateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "m-1",
      patch: { description: "Find sources" },
    });
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.changed).toBe(true);
    expect(first.draft.revision).toBe(1);
    expect(first.event?.changes).toEqual([
      { path: "description", previous: undefined, next: "Find sources" },
    ]);

    const duplicate = await mutateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "m-1",
      patch: { description: "Different text should not apply" },
    });
    expect(duplicate.success).toBe(true);
    if (!duplicate.success) return;
    expect(duplicate.changed).toBe(false);
    expect(duplicate.draft.revision).toBe(1);
    expect(duplicate.draft.description).toBe("Find sources");

    const stale = await mutateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "m-2",
      patch: { persona: "Careful researcher" },
    });
    expect(stale.success).toBe(false);
    if (stale.success) return;
    expect(stale.code).toBe("conflict");
    expect(stale.draft?.revision).toBe(1);

    const second = await mutateAgentDraft({
      draftId: draft.id,
      expectedRevision: 1,
      mutationId: "m-2",
      patch: { persona: "Careful researcher" },
    });
    expect(second.success).toBe(true);
    if (!second.success) return;
    expect(second.draft.revision).toBe(2);
  });

  it("persists drafts under desktop/agent-drafts.json without a committed identity map", async () => {
    await createAgentDraft({ draftId: "persisted", displayName: "Coder" });

    const raw = JSON.parse(readFileSync(agentDraftsStateFilePath(), "utf-8")) as {
      agents?: unknown;
      drafts?: Record<string, { profile?: string }>;
    };

    expect(raw.agents).toBeUndefined();
    expect(raw.drafts?.persisted?.profile).toBe("coder");
  });
});

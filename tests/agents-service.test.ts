import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";

const { TEST_HOME, execFileSyncMock, serviceMocks, sshMocks, KNOWN_TOOLSETS } =
  vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require("os");
    const knownToolsets = [
      "web",
      "browser",
      "terminal",
      "file",
      "code_execution",
      "vision",
      "image_gen",
      "tts",
      "skills",
      "memory",
      "session_search",
      "clarify",
      "delegation",
      "cronjob",
      "moa",
      "todo",
    ];
    return {
      TEST_HOME: path.join(
        os.tmpdir(),
        `mercury-agents-service-test-${Date.now()}`,
      ),
      execFileSyncMock: vi.fn(),
      KNOWN_TOOLSETS: knownToolsets,
      serviceMocks: {
        getConnection: vi.fn(),
        setModelConfigForProfile: vi.fn(),
        getToolsetsForProfile: vi.fn(),
        setToolsetEnabledForProfile: vi.fn(),
        mutateSkillsForProfile: vi.fn(),
        writeSoulForProfile: vi.fn(),
        writeUserProfileForProfile: vi.fn(),
        addMemoryEntryForProfile: vi.fn(),
      },
      sshMocks: {
        sshListSessions: vi.fn(),
        sshGetSessionMessages: vi.fn(),
        sshSearchSessions: vi.fn(),
        sshListProfiles: vi.fn(),
        sshCreateProfile: vi.fn(),
        sshDeleteProfile: vi.fn(),
        sshWriteProfileAgentMetadata: vi.fn(),
        sshSetAgentAvatar: vi.fn(),
        sshClearAgentAvatar: vi.fn(),
        sshGetAgentAvatarDataUrl: vi.fn(),
        sshListCachedSessions: vi.fn(),
      },
    };
  });

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: TEST_HOME,
  HERMES_PYTHON: "/usr/bin/python3",
  HERMES_SCRIPT: "/dev/null",
  getEnhancedPath: () => process.env.PATH || "",
}));

vi.mock("child_process", () => ({
  default: { execFileSync: execFileSyncMock },
  execFileSync: execFileSyncMock,
}));

vi.mock("../src/main/services/config-service", () => ({
  getConnection: serviceMocks.getConnection,
  setModelConfigForProfile: serviceMocks.setModelConfigForProfile,
}));

vi.mock("../src/main/services/knowledge-service", () => ({
  addMemoryEntryForProfile: serviceMocks.addMemoryEntryForProfile,
  getToolsetsForProfile: serviceMocks.getToolsetsForProfile,
  mutateSkillsForProfile: serviceMocks.mutateSkillsForProfile,
  setToolsetEnabledForProfile: serviceMocks.setToolsetEnabledForProfile,
  writeSoulForProfile: serviceMocks.writeSoulForProfile,
  writeUserProfileForProfile: serviceMocks.writeUserProfileForProfile,
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshListSessions: sshMocks.sshListSessions,
  sshGetSessionMessages: sshMocks.sshGetSessionMessages,
  sshSearchSessions: sshMocks.sshSearchSessions,
  sshListProfiles: sshMocks.sshListProfiles,
  sshCreateProfile: sshMocks.sshCreateProfile,
  sshDeleteProfile: sshMocks.sshDeleteProfile,
  sshWriteProfileAgentMetadata: sshMocks.sshWriteProfileAgentMetadata,
  sshSetAgentAvatar: sshMocks.sshSetAgentAvatar,
  sshClearAgentAvatar: sshMocks.sshClearAgentAvatar,
  sshGetAgentAvatarDataUrl: sshMocks.sshGetAgentAvatarDataUrl,
  sshListCachedSessions: sshMocks.sshListCachedSessions,
}));

import type { AgentDraftChangeEvent } from "../src/shared/agents";
import type { SkillMutationTarget } from "../src/shared/skills";
import {
  agentDraftsStateFilePath,
  readAgentsState,
} from "../src/main/agent-store";
import {
  abandonAgentDraft,
  cancelAgentDraftNotifications,
  commitAgentDraft,
  createAgentDraft,
  clearAgentAvatar,
  getAgentAvatarDataUrl,
  getAgentDraft,
  onAgentDraftChanged,
  setAgentAvatar,
  updateAgentDraft,
} from "../src/main/services/agents-service";
import {
  AGENT_AVATAR_CONTENT_TYPE,
  AGENT_AVATAR_FILE_NAME,
  AGENT_AVATAR_MAX_BYTES,
} from "../src/shared/profiles";

const PROFILES_DIR = join(TEST_HOME, "profiles");

function profileInfo(name: string, isDefault = false) {
  return {
    name,
    path: isDefault ? TEST_HOME : join(PROFILES_DIR, name),
    isDefault,
    isActive: isDefault,
    model: "",
    provider: "auto",
    hasEnv: false,
    hasSoul: false,
    skillCount: 0,
    gatewayRunning: false,
    displayName: isDefault ? "Mercury" : name,
    kind: isDefault ? "builtin" : "custom",
    immutable: isDefault,
    deletable: !isDefault,
    selectedPackIds: [],
    docsPointers: [],
  };
}

function pngBytes(extraBytes = 0): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extraBytes, 0),
  ]);
}

function pngDataUrl(buffer = pngBytes()): string {
  return `data:${AGENT_AVATAR_CONTENT_TYPE};base64,${buffer.toString("base64")}`;
}

function createCustomProfile(name: string): string {
  const dir = join(PROFILES_DIR, name);
  mkdirSync(join(dir, "desktop"), { recursive: true });
  return dir;
}

function readAgentMetadata(profile: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      join(PROFILES_DIR, profile, "desktop", "profile-agent.json"),
      "utf-8",
    ),
  ) as Record<string, unknown>;
}

function toolToggleMap(): Record<string, boolean> {
  return Object.fromEntries(
    serviceMocks.setToolsetEnabledForProfile.mock.calls.map(
      ([key, enabled]) => [key, enabled],
    ),
  );
}

async function modelReadyDraft(
  draftId: string,
  displayName: string,
  selectedPackIds = ["default"],
) {
  const draft = await createAgentDraft({ draftId, displayName });
  const result = await updateAgentDraft({
    draftId: draft.id,
    expectedRevision: draft.revision,
    mutationId: `${draftId}:model`,
    patch: {
      model: { provider: "openai", model: "gpt-4.1", baseUrl: "" },
      selectedPackIds,
    },
  });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("draft update failed");
  return result.draft;
}

beforeEach(() => {
  execFileSyncMock.mockReset();
  execFileSyncMock.mockReturnValue(Buffer.from(""));
  serviceMocks.getConnection.mockReset();
  serviceMocks.getConnection.mockReturnValue({ mode: "local" });
  serviceMocks.setModelConfigForProfile.mockReset();
  serviceMocks.setModelConfigForProfile.mockResolvedValue(true);
  serviceMocks.getToolsetsForProfile.mockReset();
  serviceMocks.getToolsetsForProfile.mockResolvedValue(
    KNOWN_TOOLSETS.map((key) => ({
      key,
      label: key,
      description: key,
      enabled: false,
    })),
  );
  serviceMocks.setToolsetEnabledForProfile.mockReset();
  serviceMocks.setToolsetEnabledForProfile.mockResolvedValue(true);
  serviceMocks.mutateSkillsForProfile.mockReset();
  serviceMocks.mutateSkillsForProfile.mockImplementation(async (targets) => ({
    success: true,
    updated: targets.length,
    failed: 0,
    results: targets.map((target: SkillMutationTarget) => ({
      success: true,
      action: target.action,
      target,
      name: target.name,
      category: target.category,
      changed: true,
    })),
  }));
  serviceMocks.writeSoulForProfile.mockReset();
  serviceMocks.writeSoulForProfile.mockResolvedValue(true);
  serviceMocks.writeUserProfileForProfile.mockReset();
  serviceMocks.writeUserProfileForProfile.mockResolvedValue({ success: true });
  serviceMocks.addMemoryEntryForProfile.mockReset();
  serviceMocks.addMemoryEntryForProfile.mockResolvedValue({ success: true });
  for (const mock of Object.values(sshMocks)) mock.mockReset();
  sshMocks.sshListProfiles.mockResolvedValue([profileInfo("default", true)]);
  sshMocks.sshCreateProfile.mockResolvedValue({ success: true });
  sshMocks.sshDeleteProfile.mockResolvedValue(true);
  sshMocks.sshWriteProfileAgentMetadata.mockResolvedValue(undefined);
  sshMocks.sshSetAgentAvatar.mockResolvedValue({
    success: true,
    agent: profileInfo("avatar_bot"),
    avatar: {
      path: AGENT_AVATAR_FILE_NAME,
      contentType: AGENT_AVATAR_CONTENT_TYPE,
      updatedAt: "2026-06-02T00:00:00.000Z",
      byteLength: pngBytes().length,
    },
  });
  sshMocks.sshClearAgentAvatar.mockResolvedValue({
    success: true,
    agent: profileInfo("avatar_bot"),
    avatar: null,
  });
  sshMocks.sshGetAgentAvatarDataUrl.mockResolvedValue({
    success: true,
    dataUrl: pngDataUrl(),
    avatar: {
      path: AGENT_AVATAR_FILE_NAME,
      contentType: AGENT_AVATAR_CONTENT_TYPE,
      updatedAt: "2026-06-02T00:00:00.000Z",
      byteLength: pngBytes().length,
    },
  });
  mkdirSync(TEST_HOME, { recursive: true });
  mkdirSync(PROFILES_DIR, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  cancelAgentDraftNotifications();
  vi.restoreAllMocks();
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true });
  }
});

describe("agent avatar local persistence", () => {
  it("setAgentAvatar writes desktop/avatar.png and avatar metadata", async () => {
    createCustomProfile("avatar_bot");
    const bytes = pngBytes(4);

    const result = await setAgentAvatar({
      profile: "avatar_bot",
      imageDataUrl: pngDataUrl(bytes),
    });

    expect(result).toMatchObject({
      success: true,
      agent: { name: "avatar_bot", avatar: expect.any(Object) },
      avatar: {
        path: AGENT_AVATAR_FILE_NAME,
        contentType: AGENT_AVATAR_CONTENT_TYPE,
        byteLength: bytes.length,
      },
    });
    expect(readFileSync(join(PROFILES_DIR, "avatar_bot", "desktop", "avatar.png"))).toEqual(
      bytes,
    );
    expect(readAgentMetadata("avatar_bot")).toMatchObject({
      avatar: {
        path: AGENT_AVATAR_FILE_NAME,
        contentType: AGENT_AVATAR_CONTENT_TYPE,
        updatedAt: expect.any(String),
        byteLength: bytes.length,
      },
    });
  });

  it("getAgentAvatarDataUrl returns transient data URLs without storing base64 in JSON", async () => {
    createCustomProfile("reader_bot");
    const bytes = pngBytes(2);
    await expect(
      setAgentAvatar({ profile: "reader_bot", imageDataUrl: pngDataUrl(bytes) }),
    ).resolves.toMatchObject({ success: true });

    const result = await getAgentAvatarDataUrl("reader_bot");

    expect(result).toMatchObject({
      success: true,
      dataUrl: pngDataUrl(bytes),
      avatar: { path: AGENT_AVATAR_FILE_NAME },
    });
    expect(JSON.stringify(readAgentMetadata("reader_bot"))).not.toContain("data:image/png");
  });

  it("clearAgentAvatar removes avatar metadata and best-effort deletes the file", async () => {
    createCustomProfile("clear_bot");
    await expect(
      setAgentAvatar({ profile: "clear_bot", imageDataUrl: pngDataUrl() }),
    ).resolves.toMatchObject({ success: true });

    const result = await clearAgentAvatar({ profile: "clear_bot" });

    expect(result).toMatchObject({
      success: true,
      agent: { name: "clear_bot" },
      avatar: null,
    });
    expect(existsSync(join(PROFILES_DIR, "clear_bot", "desktop", "avatar.png"))).toBe(
      false,
    );
    expect(readAgentMetadata("clear_bot")).not.toHaveProperty("avatar");
  });

  it("rejects default profile avatar mutation", async () => {
    const result = await setAgentAvatar({
      profile: "default",
      imageDataUrl: pngDataUrl(),
    });

    expect(result).toMatchObject({
      success: false,
      code: "immutable-agent",
    });
    expect(existsSync(join(TEST_HOME, "desktop", "avatar.png"))).toBe(false);
  });

  it("rejects non-PNG and oversized avatar uploads before writing files", async () => {
    createCustomProfile("invalid_avatar_bot");

    await expect(
      setAgentAvatar({
        profile: "invalid_avatar_bot",
        imageDataUrl: `data:text/plain;base64,${Buffer.from("hello").toString("base64")}`,
      }),
    ).resolves.toMatchObject({ success: false, code: "validation-error" });

    await expect(
      setAgentAvatar({
        profile: "invalid_avatar_bot",
        imageDataUrl: pngDataUrl(Buffer.from("not a png")),
      }),
    ).resolves.toMatchObject({ success: false, code: "validation-error" });

    await expect(
      setAgentAvatar({
        profile: "invalid_avatar_bot",
        imageDataUrl: pngDataUrl(pngBytes(AGENT_AVATAR_MAX_BYTES)),
      }),
    ).resolves.toMatchObject({ success: false, code: "validation-error" });

    expect(existsSync(join(PROFILES_DIR, "invalid_avatar_bot", "desktop", "avatar.png"))).toBe(
      false,
    );
    expect(existsSync(join(PROFILES_DIR, "invalid_avatar_bot", "desktop", "profile-agent.json"))).toBe(
      false,
    );
  });
});

describe("agent avatar SSH and remote routing", () => {
  const ssh = {
    host: "example.test",
    port: 22,
    username: "fred",
    keyPath: "/tmp/key",
    remotePort: 8642,
    localPort: 18642,
  };

  it("routes SSH avatar set, clear, and read through ssh-remote helpers", async () => {
    serviceMocks.getConnection.mockReturnValue({ mode: "ssh", ssh });
    sshMocks.sshListProfiles.mockResolvedValue([
      profileInfo("default", true),
      profileInfo("avatar_bot"),
    ]);
    const imageDataUrl = pngDataUrl(pngBytes(3));

    await expect(
      setAgentAvatar({ profile: "avatar_bot", imageDataUrl }),
    ).resolves.toMatchObject({ success: true, agent: { name: "avatar_bot" } });
    await expect(clearAgentAvatar({ profile: "avatar_bot" })).resolves.toMatchObject({
      success: true,
      avatar: null,
    });
    await expect(getAgentAvatarDataUrl("avatar_bot")).resolves.toMatchObject({
      success: true,
      dataUrl: pngDataUrl(),
    });

    expect(sshMocks.sshSetAgentAvatar).toHaveBeenCalledWith(
      ssh,
      "avatar_bot",
      imageDataUrl,
    );
    expect(sshMocks.sshClearAgentAvatar).toHaveBeenCalledWith(ssh, "avatar_bot");
    expect(sshMocks.sshGetAgentAvatarDataUrl).toHaveBeenCalledWith(
      ssh,
      "avatar_bot",
    );
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("fails pure remote avatar operations before local or SSH writes", async () => {
    serviceMocks.getConnection.mockReturnValue({ mode: "remote" });

    await expect(
      setAgentAvatar({ profile: "remote_bot", imageDataUrl: pngDataUrl() }),
    ).resolves.toMatchObject({
      success: false,
      code: "unsupported-remote-mode",
    });
    await expect(clearAgentAvatar({ profile: "remote_bot" })).resolves.toMatchObject({
      success: false,
      code: "unsupported-remote-mode",
    });
    await expect(getAgentAvatarDataUrl("remote_bot")).resolves.toMatchObject({
      success: false,
      code: "unsupported-remote-mode",
    });

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(sshMocks.sshSetAgentAvatar).not.toHaveBeenCalled();
    expect(sshMocks.sshClearAgentAvatar).not.toHaveBeenCalled();
    expect(sshMocks.sshGetAgentAvatarDataUrl).not.toHaveBeenCalled();
    expect(existsSync(join(PROFILES_DIR, "remote_bot", "desktop", "avatar.png"))).toBe(false);
  });
});

describe("agents service draft lifecycle", () => {
  it("updates revisions, reports stale conflicts, and dedupes mutation retries", async () => {
    const draft = await createAgentDraft({
      draftId: "draft-service-1",
      displayName: "Research",
    });

    const first = await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "m-1",
      patch: { selectedPackIds: ["research"] },
    });

    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.changed).toBe(true);
    expect(first.draft.revision).toBe(1);

    const duplicate = await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "m-1",
      patch: { selectedPackIds: ["coding"] },
    });

    expect(duplicate.success).toBe(true);
    if (!duplicate.success) return;
    expect(duplicate.changed).toBe(false);
    expect(duplicate.draft.revision).toBe(1);
    expect(duplicate.draft.selectedPackIds).toEqual(["research"]);

    const stale = await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "m-2",
      patch: { selectedPackIds: ["coding"] },
    });

    expect(stale.success).toBe(false);
    if (stale.success) return;
    expect(stale.code).toBe("conflict");
    expect(stale.draft?.revision).toBe(1);
  });

  it("debounces text notifications while preserving first previous and final next", async () => {
    vi.useFakeTimers();
    const events: AgentDraftChangeEvent[] = [];
    const dispose = onAgentDraftChanged((event) => events.push(event));
    const draft = await createAgentDraft({
      draftId: "draft-text",
      displayName: "Alpha",
    });

    await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "rename-1",
      patch: { displayName: "Beta" },
    });
    await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 1,
      mutationId: "rename-2",
      patch: { displayName: "Gamma" },
    });

    await expect(getAgentDraft(draft.id)).resolves.toMatchObject({
      displayName: "Gamma",
      revision: 2,
    });
    expect(events).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(499);
    expect(events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      draftId: draft.id,
      revision: 2,
      changes: [{ path: "displayName", previous: "Alpha", next: "Gamma" }],
      notification: {
        previousText: "Alpha",
        nextText: "Gamma",
        debounced: true,
      },
    });
    dispose();
  });

  it("emits non-text notifications immediately", async () => {
    const events: AgentDraftChangeEvent[] = [];
    const dispose = onAgentDraftChanged((event) => events.push(event));
    const draft = await createAgentDraft({
      draftId: "draft-state",
      displayName: "Stateful",
    });

    await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "packs-1",
      patch: { selectedPackIds: ["coding"] },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      draftId: draft.id,
      revision: 1,
      changes: [
        { path: "selectedPackIds", previous: ["default"], next: ["coding"] },
      ],
      notification: { debounced: false },
    });
    dispose();
  });

  it("flushes pending text notifications when commit is requested", async () => {
    vi.useFakeTimers();
    const events: AgentDraftChangeEvent[] = [];
    const dispose = onAgentDraftChanged((event) => events.push(event));
    const draft = await createAgentDraft({
      draftId: "draft-commit",
      displayName: "Before",
    });

    await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "rename-commit",
      patch: { displayName: "After" },
    });
    expect(events).toHaveLength(0);

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: 1,
    });

    expect(result).toMatchObject({ success: false, code: "validation-error" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      changes: [{ path: "displayName", previous: "Before", next: "After" }],
      notification: { debounced: true },
    });
    dispose();
  });

  it("flushes pending text notifications before abandoning the draft", async () => {
    vi.useFakeTimers();
    const events: AgentDraftChangeEvent[] = [];
    const dispose = onAgentDraftChanged((event) => events.push(event));
    const draft = await createAgentDraft({
      draftId: "draft-abandon",
      displayName: "Before",
    });

    await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: 0,
      mutationId: "rename-abandon",
      patch: { displayName: "After" },
    });
    const result = await abandonAgentDraft(draft.id);

    expect(result).toEqual({ success: true });
    expect(events.map((event) => event.changes[0]?.path)).toEqual([
      "displayName",
      "status",
    ]);
    expect(events[0]?.notification?.debounced).toBe(true);
    expect(events[1]).toMatchObject({
      changes: [{ path: "status", previous: "draft", next: "abandoned" }],
      notification: { debounced: false },
    });
    dispose();
  });

  it("commits packs by creating a profile, applying exact tools, one skill batch, and metadata", async () => {
    const draft = await createAgentDraft({
      draftId: "draft-pack-commit",
      displayName: "Research Artist",
      profileId: "research_artist",
    });
    const updated = await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision,
      mutationId: "configure-pack-commit",
      patch: {
        description: "Finds sources and makes images",
        persona: "Be precise.",
        model: {
          provider: "openai",
          model: "gpt-4.1",
          baseUrl: "https://api.example.test",
        },
        memory: {
          userProfile: "Prefers citations",
          entries: ["Uses APA style"],
        },
        selectedPackIds: [
          "default",
          "research",
          "image-generation",
          "video-making",
        ],
        docsPointers: [
          {
            id: "custom-doc",
            title: "Custom doc",
            url: "https://example.test/doc",
          },
        ],
        toolsetOverrides: { image_gen: false, tts: true },
      },
    });
    expect(updated.success).toBe(true);
    if (!updated.success) return;

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: updated.draft.revision,
      activate: true,
    });

    expect(result).toMatchObject({
      success: true,
      agent: {
        name: "research_artist",
        displayName: "Research Artist",
        selectedPackIds: [
          "default",
          "research",
          "image-generation",
          "video-making",
        ],
        docsPointers: expect.arrayContaining([
          expect.objectContaining({ id: "default-baseline-docs" }),
          expect.objectContaining({ id: "custom-doc" }),
        ]),
      },
    });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "create", "research_artist", "--no-skills"],
      expect.objectContaining({ timeout: 15000 }),
    );
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "use", "research_artist"],
      expect.objectContaining({ timeout: 10000 }),
    );
    expect(serviceMocks.setModelConfigForProfile).toHaveBeenCalledWith(
      "openai",
      "gpt-4.1",
      "https://api.example.test",
      "research_artist",
    );
    expect(serviceMocks.writeSoulForProfile).toHaveBeenCalledWith(
      "Be precise.",
      "research_artist",
    );
    expect(serviceMocks.writeUserProfileForProfile).toHaveBeenCalledWith(
      "Prefers citations",
      "research_artist",
    );
    expect(serviceMocks.addMemoryEntryForProfile).toHaveBeenCalledWith(
      "Uses APA style",
      "research_artist",
    );

    expect(serviceMocks.setToolsetEnabledForProfile).toHaveBeenCalledTimes(
      KNOWN_TOOLSETS.length,
    );
    expect(toolToggleMap()).toMatchObject({
      web: true,
      browser: true,
      terminal: true,
      file: true,
      code_execution: true,
      vision: true,
      skills: true,
      memory: true,
      session_search: true,
      clarify: true,
      delegation: true,
      image_gen: false,
      tts: true,
      cronjob: false,
      moa: false,
      todo: false,
    });

    expect(serviceMocks.mutateSkillsForProfile).toHaveBeenCalledTimes(1);
    const [skillTargets, profile] =
      serviceMocks.mutateSkillsForProfile.mock.calls[0];
    expect(profile).toBe("research_artist");
    expect(skillTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "install",
          category: "research",
          directoryName: "arxiv",
        }),
        expect.objectContaining({
          action: "install",
          category: "creative",
          directoryName: "comfyui",
        }),
      ]),
    );
    expect(
      skillTargets.filter((target: SkillMutationTarget) => target.directoryName === "comfyui"),
    ).toHaveLength(1);
    expect(skillTargets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "default-baseline-docs" }),
      ]),
    );

    const metadata = JSON.parse(
      readFileSync(
        join(PROFILES_DIR, "research_artist", "desktop", "profile-agent.json"),
        "utf-8",
      ),
    ) as { selectedPackIds?: string[]; docsPointers?: Array<{ id: string }> };
    expect(metadata).toMatchObject({
      displayName: "Research Artist",
      selectedPackIds: [
        "default",
        "research",
        "image-generation",
        "video-making",
      ],
      docsPointers: expect.arrayContaining([
        expect.objectContaining({ id: "default-baseline-docs" }),
        expect.objectContaining({ id: "custom-doc" }),
      ]),
    });
    const state = await readAgentsState([]);
    expect("agents" in state).toBe(false);
    expect(state.drafts[draft.id]?.status).toBe("committed");
  });

  it("trims pack skills excluded by per-member skillOverrides at commit", async () => {
    const draft = await createAgentDraft({
      draftId: "draft-skill-override",
      displayName: "Selective Researcher",
      profileId: "selective_researcher",
    });
    const updated = await updateAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision,
      mutationId: "configure-skill-override",
      patch: {
        model: { provider: "openai", model: "gpt-4.1", baseUrl: "" },
        selectedPackIds: ["research"],
        // research pack has tool:web + 4 skills; drop arxiv and the web tool.
        skillOverrides: { "skill:research/arxiv": false, "tool:web": false },
      },
    });
    expect(updated.success).toBe(true);
    if (!updated.success) return;

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: updated.draft.revision,
    });
    expect(result.success).toBe(true);

    const [skillTargets] = serviceMocks.mutateSkillsForProfile.mock.calls[0];
    expect(skillTargets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ directoryName: "arxiv" }),
      ]),
    );
    expect(skillTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ directoryName: "blogwatcher" }),
      ]),
    );
    // The excluded web tool is not enabled.
    expect(toolToggleMap().web).toBe(false);
  });

  it("rolls back profile creation and does not persist metadata when skill application fails", async () => {
    const draft = await modelReadyDraft("draft-rollback", "Rollback Agent", [
      "research",
    ]);
    serviceMocks.mutateSkillsForProfile.mockResolvedValueOnce({
      success: false,
      updated: 0,
      failed: 1,
      results: [
        {
          success: false,
          action: "install",
          target: {
            action: "install",
            name: "arxiv",
            category: "research",
            directoryName: "arxiv",
          },
          name: "arxiv",
          category: "research",
          code: "not-found",
          error: "missing skill",
        },
      ],
    });

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision,
    });

    expect(result).toMatchObject({
      success: false,
      code: "commit-failed",
      error: expect.stringContaining("Rolled back"),
    });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "delete", draft.profile, "--yes"],
      expect.objectContaining({ timeout: 15000 }),
    );
    expect(
      existsSync(
        join(PROFILES_DIR, draft.profile, "desktop", "profile-agent.json"),
      ),
    ).toBe(false);
    const state = await readAgentsState([]);
    expect("agents" in state).toBe(false);
    expect(state.drafts[draft.id]?.status).toBe("draft");
  });

  it("metadata write failure rolls back the created profile and leaves the draft uncommitted", async () => {
    const draft = await modelReadyDraft(
      "draft-metadata-fail",
      "Metadata Fail",
      ["default"],
    );
    writeFileSync(
      join(PROFILES_DIR, draft.profile),
      "not a profile directory",
      "utf-8",
    );

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision,
    });

    expect(result).toMatchObject({
      success: false,
      code: "commit-failed",
      error: expect.stringContaining("Rolled back"),
    });
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "delete", draft.profile, "--yes"],
      expect.objectContaining({ timeout: 15000 }),
    );
    expect(
      existsSync(
        join(PROFILES_DIR, draft.profile, "desktop", "profile-agent.json"),
      ),
    ).toBe(false);
    const state = await readAgentsState([]);
    expect(state.drafts[draft.id]?.status).toBe("draft");
  });

  it("draft-status write failure after metadata write does not blindly delete the created profile", async () => {
    const draft = await modelReadyDraft("draft-status-fail", "Status Fail", [
      "default",
    ]);
    chmodSync(agentDraftsStateFilePath(), 0o444);

    try {
      const result = await commitAgentDraft({
        draftId: draft.id,
        expectedRevision: draft.revision,
      });

      expect(result).toMatchObject({ success: false, code: "commit-failed" });
      expect(execFileSyncMock).not.toHaveBeenCalledWith(
        "/usr/bin/python3",
        ["/dev/null", "profile", "delete", draft.profile, "--yes"],
        expect.anything(),
      );
      expect(
        existsSync(
          join(PROFILES_DIR, draft.profile, "desktop", "profile-agent.json"),
        ),
      ).toBe(true);
    } finally {
      chmodSync(agentDraftsStateFilePath(), 0o644);
    }
  });

  it("idempotent retry reconciles a draft whose profile metadata already matches", async () => {
    const draft = await modelReadyDraft("draft-retry", "Retry Agent", [
      "default",
    ]);
    chmodSync(agentDraftsStateFilePath(), 0o444);

    try {
      await commitAgentDraft({
        draftId: draft.id,
        expectedRevision: draft.revision,
      });
    } finally {
      chmodSync(agentDraftsStateFilePath(), 0o644);
    }

    const createCallsAfterFirstAttempt = execFileSyncMock.mock.calls.filter(
      ([, args]) =>
        Array.isArray(args) && args[1] === "profile" && args[2] === "create",
    ).length;
    const modelWritesAfterFirstAttempt =
      serviceMocks.setModelConfigForProfile.mock.calls.length;

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision,
    });

    expect(result).toMatchObject({
      success: true,
      agent: { name: draft.profile, displayName: "Retry Agent" },
    });
    const createCallsAfterRetry = execFileSyncMock.mock.calls.filter(
      ([, args]) =>
        Array.isArray(args) && args[1] === "profile" && args[2] === "create",
    ).length;
    expect(createCallsAfterRetry).toBe(createCallsAfterFirstAttempt);
    expect(serviceMocks.setModelConfigForProfile.mock.calls.length).toBe(
      modelWritesAfterFirstAttempt,
    );
    const state = await readAgentsState([]);
    expect(state.drafts[draft.id]?.status).toBe("committed");
  });

  it("fails pure remote commits before any profile, tool, skill, model, or metadata write", async () => {
    serviceMocks.getConnection.mockReturnValue({ mode: "remote" });
    const draft = await modelReadyDraft("draft-remote", "Remote Agent", [
      "research",
    ]);

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision,
    });

    expect(result).toMatchObject({
      success: false,
      code: "unsupported-remote-mode",
    });
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(serviceMocks.setModelConfigForProfile).not.toHaveBeenCalled();
    expect(serviceMocks.setToolsetEnabledForProfile).not.toHaveBeenCalled();
    expect(serviceMocks.mutateSkillsForProfile).not.toHaveBeenCalled();
    const state = await readAgentsState([]);
    expect("agents" in state).toBe(false);
  });

  it("routes SSH profile creation through existing session-service SSH branches", async () => {
    const ssh = {
      host: "example.test",
      port: 22,
      username: "fred",
      keyPath: "/tmp/key",
      remotePort: 8642,
      localPort: 18642,
    };
    writeFileSync(
      join(TEST_HOME, "desktop.json"),
      JSON.stringify({ connectionMode: "ssh", sshConfig: ssh }),
      "utf-8",
    );
    serviceMocks.getConnection.mockReturnValue({ mode: "ssh", ssh });
    const draft = await modelReadyDraft("draft-ssh", "SSH Agent", ["default"]);

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision,
    });

    expect(result).toMatchObject({
      success: true,
      agent: { name: draft.profile },
    });
    expect(sshMocks.sshListProfiles).toHaveBeenCalledWith(ssh);
    expect(sshMocks.sshCreateProfile).toHaveBeenCalledWith(
      ssh,
      draft.profile,
      true,
    );
    expect(sshMocks.sshWriteProfileAgentMetadata).toHaveBeenCalledWith(
      ssh,
      draft.profile,
      expect.objectContaining({ displayName: "SSH Agent" }),
    );
    expect(execFileSyncMock).not.toHaveBeenCalledWith(
      "/usr/bin/python3",
      ["/dev/null", "profile", "create", draft.profile, "--no-skills"],
      expect.anything(),
    );
  });

  it("commit honors expectedRevision conflicts before writes", async () => {
    const draft = await modelReadyDraft(
      "draft-commit-conflict",
      "Conflict Agent",
      ["default"],
    );

    const result = await commitAgentDraft({
      draftId: draft.id,
      expectedRevision: draft.revision - 1,
    });

    expect(result).toMatchObject({
      success: false,
      code: "conflict",
      draft: { revision: draft.revision },
    });
    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(serviceMocks.setModelConfigForProfile).not.toHaveBeenCalled();
    expect(serviceMocks.mutateSkillsForProfile).not.toHaveBeenCalled();
  });
});

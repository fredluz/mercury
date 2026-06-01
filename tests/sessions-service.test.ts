import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ProfileRuntimeHandle } from "../src/main/hermes/types";

const mocks = vi.hoisted(() => ({
  connection: { mode: "local" } as { mode: string; ssh?: unknown },
  resolveRuntime: vi.fn(),
  listSessions: vi.fn(),
  getSessionMessages: vi.fn(),
  searchSessions: vi.fn(),
  syncSessionCache: vi.fn(),
  listCachedSessions: vi.fn(),
  updateSessionTitle: vi.fn(),
  projectCachedSession: vi.fn(),
  removeCachedSession: vi.fn(),
  listHermesSessions: vi.fn(),
  readHermesSession: vi.fn(),
  getHermesSessionMessages: vi.fn(),
  updateHermesSessionTitle: vi.fn(),
  deleteHermesSession: vi.fn(),
  forkHermesSession: vi.fn(),
  sshListSessions: vi.fn(),
  sshGetSessionMessages: vi.fn(),
  sshSearchSessions: vi.fn(),
  sshListProfiles: vi.fn(),
  sshCreateProfile: vi.fn(),
  sshDeleteProfile: vi.fn(),
  sshListCachedSessions: vi.fn(),
  listProfiles: vi.fn(),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  setActiveProfile: vi.fn(),
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => mocks.connection,
}));

vi.mock("../src/main/hermes/runtime", () => ({
  profileRuntimeManager: {
    normalizeProfile: (profile?: string) => profile?.trim() || "default",
    resolveRuntime: mocks.resolveRuntime,
  },
}));

vi.mock("../src/main/sessions", () => ({
  listSessions: mocks.listSessions,
  getSessionMessages: mocks.getSessionMessages,
  searchSessions: mocks.searchSessions,
}));

vi.mock("../src/main/session-cache", () => ({
  syncSessionCache: mocks.syncSessionCache,
  listCachedSessions: mocks.listCachedSessions,
  updateSessionTitle: mocks.updateSessionTitle,
  projectCachedSession: mocks.projectCachedSession,
  removeCachedSession: mocks.removeCachedSession,
}));

vi.mock("../src/main/profiles", () => ({
  listProfiles: mocks.listProfiles,
  createProfile: mocks.createProfile,
  deleteProfile: mocks.deleteProfile,
  setActiveProfile: mocks.setActiveProfile,
}));

vi.mock("../src/main/ssh-remote", () => ({
  sshListSessions: mocks.sshListSessions,
  sshGetSessionMessages: mocks.sshGetSessionMessages,
  sshSearchSessions: mocks.sshSearchSessions,
  sshListProfiles: mocks.sshListProfiles,
  sshCreateProfile: mocks.sshCreateProfile,
  sshDeleteProfile: mocks.sshDeleteProfile,
  sshListCachedSessions: mocks.sshListCachedSessions,
}));

vi.mock("../src/main/services/hermes-sessions-api", () => ({
  listHermesSessions: mocks.listHermesSessions,
  readHermesSession: mocks.readHermesSession,
  getHermesSessionMessages: mocks.getHermesSessionMessages,
  updateHermesSessionTitle: mocks.updateHermesSessionTitle,
  deleteHermesSession: mocks.deleteHermesSession,
  forkHermesSession: mocks.forkHermesSession,
  cachedSessionFromServerSession: (session: {
    id: string;
    title?: string | null;
    startedAt?: number;
    profile?: string;
  }) => ({
    id: session.id,
    title: session.title || "New Conversation",
    startedAt: session.startedAt || 1,
    source: "api",
    messageCount: 0,
    model: "",
    profile: session.profile || "work",
  }),
  summaryFromServerSession: (session: {
    id: string;
    title?: string | null;
    startedAt?: number;
    profile?: string;
  }) => ({
    id: session.id,
    source: "api",
    startedAt: session.startedAt || 1,
    endedAt: null,
    messageCount: 0,
    model: "",
    title: session.title || null,
    preview: "",
    profile: session.profile || "work",
  }),
}));

import {
  createProfileForConnection,
  deleteProfileForConnection,
  deleteServerSessionForProfile,
  getSessionMessagesForProfile,
  listServerSessionsForProfile,
  setActiveProfileForConnection,
  updateServerSessionTitleForProfile,
} from "../src/main/services/sessions-service";

function runtime(profile = "work"): ProfileRuntimeHandle {
  return {
    request: { profile, mode: "local", purpose: "sessions" },
    identity: {
      requestedProfile: profile,
      actualProfile: profile,
      verified: true,
      verificationSource: "managed-process",
      mode: "local",
      transport: "api",
      startedByMercury: true,
      verifiedAt: 1,
    },
    transport: "api",
    apiBaseUrl: "http://127.0.0.1:39001",
    authHeaders: { Authorization: "Bearer test" },
  };
}

describe("sessions-service source-of-truth policy", () => {
  let tempDir: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection = { mode: "local" };
    delete process.env.MERCURY_SESSIONS_DIAG;
    delete process.env.MERCURY_SESSIONS_DIAG_FILE;
  });

  afterEach(() => {
    delete process.env.MERCURY_SESSIONS_DIAG;
    delete process.env.MERCURY_SESSIONS_DIAG_FILE;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("fails closed for pure remote profile creation, deletion, and activation", async () => {
    mocks.connection = { mode: "remote" };
    mocks.createProfile.mockReturnValue({ success: true });
    mocks.deleteProfile.mockReturnValue({ success: true });

    expect(createProfileForConnection("remote-agent", true)).toEqual({
      success: false,
      error: "Agent creation is only available in local and SSH modes.",
    });
    await expect(deleteProfileForConnection("remote-agent")).resolves.toEqual({
      success: false,
      error: "Agent deletion is only available in local and SSH modes.",
    });
    expect(setActiveProfileForConnection("remote-agent")).toBe(false);

    expect(mocks.createProfile).not.toHaveBeenCalled();
    expect(mocks.deleteProfile).not.toHaveBeenCalled();
    expect(mocks.setActiveProfile).not.toHaveBeenCalled();
  });

  it("forwards structured SSH profile creation results", async () => {
    const ssh = { host: "example.test" };
    mocks.connection = { mode: "ssh", ssh };
    mocks.sshCreateProfile.mockResolvedValue({ success: true });

    await expect(
      createProfileForConnection("ssh-agent", true),
    ).resolves.toEqual({
      success: true,
    });

    expect(mocks.sshCreateProfile).toHaveBeenCalledWith(ssh, "ssh-agent", true);
    expect(mocks.createProfile).not.toHaveBeenCalled();
  });

  it("wraps SSH profile deletion as a structured result", async () => {
    const ssh = { host: "example.test" };
    mocks.connection = { mode: "ssh", ssh };
    mocks.sshDeleteProfile.mockResolvedValue(true);

    await expect(deleteProfileForConnection("ssh-agent")).resolves.toEqual({
      success: true,
      error: undefined,
    });

    expect(mocks.sshDeleteProfile).toHaveBeenCalledWith(ssh, "ssh-agent");
    expect(mocks.deleteProfile).not.toHaveBeenCalled();
  });

  it("falls back to local sessions only when runtime resolution fails and records a diagnostic", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mercury-sessions-service-"));
    const diagFile = join(tempDir, "sessions.ndjson");
    process.env.MERCURY_SESSIONS_DIAG = "1";
    process.env.MERCURY_SESSIONS_DIAG_FILE = diagFile;
    const localRows = [{ id: "local-session", startedAt: 1, title: "Local" }];
    mocks.resolveRuntime.mockRejectedValue(new Error("gateway unavailable"));
    mocks.listSessions.mockReturnValue(localRows);

    await expect(listServerSessionsForProfile(10, 0, "work")).resolves.toBe(
      localRows,
    );

    expect(mocks.listHermesSessions).not.toHaveBeenCalled();
    expect(mocks.listSessions).toHaveBeenCalledWith(10, 0, "work");
    const records = readFileSync(diagFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "list-server-sessions",
          fallback: true,
          fallbackReason: "runtime-resolution-failed",
          errorMessage: "gateway unavailable",
        }),
      ]),
    );
  });

  it("does not fall back to local list results after a verified Gateway sessions API failure", async () => {
    mocks.resolveRuntime.mockResolvedValue(runtime());
    mocks.listHermesSessions.mockRejectedValue(
      new Error("Gateway sessions failed"),
    );
    mocks.listSessions.mockReturnValue([{ id: "local-session" }]);

    await expect(listServerSessionsForProfile(10, 0, "work")).rejects.toThrow(
      "Gateway sessions failed",
    );

    expect(mocks.listSessions).not.toHaveBeenCalled();
    expect(mocks.projectCachedSession).not.toHaveBeenCalled();
  });

  it("keeps pure remote runtime resolution failures fail-closed instead of showing local sessions", async () => {
    mocks.connection = { mode: "remote" };
    mocks.resolveRuntime.mockRejectedValue(
      new Error("remote profiles are unsupported"),
    );
    mocks.listSessions.mockReturnValue([{ id: "local-session" }]);

    await expect(listServerSessionsForProfile(10, 0, "work")).rejects.toThrow(
      "remote profiles are unsupported",
    );

    expect(mocks.listSessions).not.toHaveBeenCalled();
    expect(mocks.listHermesSessions).not.toHaveBeenCalled();
  });

  it("falls back to local messages only when runtime resolution fails", async () => {
    const localMessages = [
      { id: 1, role: "user", content: "local", timestamp: 1 },
    ];
    mocks.resolveRuntime.mockRejectedValue(new Error("offline"));
    mocks.getSessionMessages.mockReturnValue(localMessages);

    await expect(getSessionMessagesForProfile("s1", "work")).resolves.toBe(
      localMessages,
    );

    expect(mocks.readHermesSession).not.toHaveBeenCalled();
    expect(mocks.getSessionMessages).toHaveBeenCalledWith("s1", "work");
  });

  it("does not fall back to local messages after a verified Gateway messages API failure", async () => {
    mocks.resolveRuntime.mockResolvedValue(runtime());
    mocks.readHermesSession.mockResolvedValue({
      id: "s1",
      title: "Remote",
      startedAt: 2,
      profile: "work",
    });
    mocks.getHermesSessionMessages.mockRejectedValue(
      new Error("messages endpoint failed"),
    );
    mocks.getSessionMessages.mockReturnValue([
      { id: 1, role: "user", content: "local", timestamp: 1 },
    ]);

    await expect(getSessionMessagesForProfile("s1", "work")).rejects.toThrow(
      "messages endpoint failed",
    );

    expect(mocks.getSessionMessages).not.toHaveBeenCalled();
  });

  it("does not update the local title after a verified Gateway title update failure", async () => {
    mocks.resolveRuntime.mockResolvedValue(runtime());
    mocks.updateHermesSessionTitle.mockRejectedValue(
      new Error("title update failed"),
    );
    mocks.updateSessionTitle.mockReturnValue(true);

    await expect(
      updateServerSessionTitleForProfile("s1", "Renamed", "work"),
    ).resolves.toBe(false);

    expect(mocks.updateSessionTitle).not.toHaveBeenCalled();
    expect(mocks.projectCachedSession).not.toHaveBeenCalled();
  });

  it("uses local title update fallback when runtime resolution fails before verification", async () => {
    mocks.resolveRuntime.mockRejectedValue(new Error("not verified yet"));
    mocks.updateSessionTitle.mockReturnValue(true);

    await expect(
      updateServerSessionTitleForProfile("s1", "Renamed", "work"),
    ).resolves.toBe(true);

    expect(mocks.updateSessionTitle).toHaveBeenCalledWith(
      "s1",
      "Renamed",
      "work",
    );
    expect(mocks.updateHermesSessionTitle).not.toHaveBeenCalled();
  });

  it("does not mutate local titles for pure remote runtime resolution failures", async () => {
    mocks.connection = { mode: "remote" };
    mocks.resolveRuntime.mockRejectedValue(
      new Error("remote profiles are unsupported"),
    );
    mocks.updateSessionTitle.mockReturnValue(true);

    await expect(
      updateServerSessionTitleForProfile("s1", "Renamed", "work"),
    ).rejects.toThrow("remote profiles are unsupported");

    expect(mocks.updateSessionTitle).not.toHaveBeenCalled();
    expect(mocks.updateHermesSessionTitle).not.toHaveBeenCalled();
  });

  it("does not remove the local cache after a verified Gateway delete failure", async () => {
    mocks.resolveRuntime.mockResolvedValue(runtime());
    mocks.deleteHermesSession.mockRejectedValue(new Error("delete failed"));
    mocks.removeCachedSession.mockReturnValue(true);

    await expect(deleteServerSessionForProfile("s1", "work")).resolves.toBe(
      false,
    );

    expect(mocks.removeCachedSession).not.toHaveBeenCalled();
  });

  it("uses local delete fallback when runtime resolution fails before verification", async () => {
    mocks.resolveRuntime.mockRejectedValue(new Error("not verified yet"));
    mocks.removeCachedSession.mockReturnValue(true);

    await expect(deleteServerSessionForProfile("s1", "work")).resolves.toBe(
      true,
    );

    expect(mocks.removeCachedSession).toHaveBeenCalledWith("s1", "work");
    expect(mocks.deleteHermesSession).not.toHaveBeenCalled();
  });
});

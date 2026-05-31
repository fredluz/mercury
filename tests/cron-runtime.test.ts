import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  isRemoteMode: vi.fn(),
  resolveRuntime: vi.fn(),
  bffClientForRuntime: vi.fn(),
  HermesBffError: class HermesBffError extends Error {
    responsePreview?: string;
    constructor(message: string, responsePreview?: string) {
      super(message);
      this.responsePreview = responsePreview;
    }
  },
  bffJobs: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    action: vi.fn(),
  },
  hermesHome: "/tmp/hermes",
}));

vi.mock("child_process", () => ({
  default: { execFile: mocks.execFile },
  execFile: mocks.execFile,
}));

vi.mock("../src/main/installer", () => ({
  get HERMES_HOME() {
    return mocks.hermesHome;
  },
  HERMES_PYTHON: "python",
  HERMES_SCRIPT: "hermes",
}));

vi.mock("../src/main/hermes", () => ({
  isRemoteMode: mocks.isRemoteMode,
}));

vi.mock("../src/main/hermes/runtime", () => ({
  buildHermesProfileCommandArgs: (
    hermesScript: string,
    profile: string | undefined,
    commandArgs: string[],
  ) => {
    const args = [hermesScript];
    if (profile && profile !== "default") args.push("-p", profile);
    args.push(...commandArgs);
    return args;
  },
  profileRuntimeManager: {
    normalizeProfile: (profile?: string) => profile?.trim() || "default",
    resolveRuntime: mocks.resolveRuntime,
  },
}));

vi.mock("../src/main/hermes/bff", () => ({
  HermesBffError: mocks.HermesBffError,
  profileHermesBffClientForRuntime: mocks.bffClientForRuntime,
}));

async function loadCronJobs(): Promise<typeof import("../src/main/cronjobs")> {
  vi.resetModules();
  return import("../src/main/cronjobs");
}

beforeEach(() => {
  rmSync(mocks.hermesHome, { recursive: true, force: true });
  mocks.hermesHome = mkdtempSync(join(tmpdir(), "mercury-cron-"));
  mocks.execFile.mockReset().mockImplementation((_bin, _args, _opts, cb) => {
    cb(null, "ok", "");
  });
  mocks.isRemoteMode.mockReset().mockReturnValue(false);
  mocks.resolveRuntime.mockReset();
  mocks.bffClientForRuntime.mockReset().mockReturnValue({ jobs: mocks.bffJobs });
  mocks.bffJobs.list.mockReset().mockResolvedValue([]);
  mocks.bffJobs.create.mockReset().mockResolvedValue({});
  mocks.bffJobs.update.mockReset().mockResolvedValue(undefined);
  mocks.bffJobs.remove.mockReset().mockResolvedValue(undefined);
  mocks.bffJobs.action.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn());
});

describe("cron runtime routing", () => {
  it("uses a profile-verified CLI command for local cron creation", async () => {
    const { createCronJob } = await loadCronJobs();

    await expect(
      createCronJob("0 9 * * *", "Daily prompt", "Daily", "local", "alpha"),
    ).resolves.toEqual({ success: true, error: undefined });

    expect(mocks.execFile).toHaveBeenCalledWith(
      "python",
      [
        "hermes",
        "-p",
        "alpha",
        "cron",
        "create",
        "0 9 * * *",
        "--name",
        "Daily",
        "--deliver",
        "local",
        "--",
        "Daily prompt",
      ],
      expect.objectContaining({ cwd: join(mocks.hermesHome, "hermes-agent") }),
      expect.any(Function),
    );
  });

  it("fails closed for remote cron mutations when runtime identity is unverified", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockRejectedValue(
      new Error("runtime profile unverified"),
    );
    const { createCronJob } = await loadCronJobs();

    await expect(
      createCronJob("0 9 * * *", "Daily prompt", "Daily", "local", "alpha"),
    ).resolves.toEqual({ success: false, error: "runtime profile unverified" });

    expect(mocks.resolveRuntime).toHaveBeenCalledWith({
      profile: "alpha",
      purpose: "cron",
      preferTransport: "api",
    });
    expect(mocks.bffClientForRuntime).not.toHaveBeenCalled();
  });

  it("fails closed when the resolved cron runtime does not match the requested profile", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockResolvedValue({
      request: { profile: "beta", mode: "local", purpose: "cron" },
      identity: {
        requestedProfile: "beta",
        actualProfile: "beta",
        verified: true,
      },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19002",
    });
    const { createCronJob } = await loadCronJobs();

    mocks.bffClientForRuntime.mockImplementation(() => {
      throw new Error("Runtime profile beta does not match requested profile alpha.");
    });

    await expect(
      createCronJob("0 9 * * *", "Daily prompt", "Daily", "local", "alpha"),
    ).resolves.toEqual({
      success: false,
      error: "Runtime profile beta does not match requested profile alpha.",
    });
    expect(mocks.bffClientForRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ apiBaseUrl: "http://127.0.0.1:19002" }),
      "alpha",
      "cron",
    );
  });

  it("routes remote cron API calls through the verified runtime BFF jobs client", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockResolvedValue({
      request: { profile: "alpha", mode: "local", purpose: "cron" },
      identity: {
        requestedProfile: "alpha",
        actualProfile: "alpha",
        verified: true,
      },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19001",
      authHeaders: { Authorization: "Bearer alpha" },
    });
    mocks.bffJobs.list.mockResolvedValue([
      { id: "remote-1", name: "Remote", schedule: "0 9 * * *" },
    ]);
    const { listCronJobs } = await loadCronJobs();

    await expect(listCronJobs(true, "alpha")).resolves.toMatchObject([
      { id: "remote-1", name: "Remote" },
    ]);

    expect(mocks.bffClientForRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: "http://127.0.0.1:19001",
        authHeaders: { Authorization: "Bearer alpha" },
      }),
      "alpha",
      "cron",
    );
    expect(mocks.bffJobs.list).toHaveBeenCalledWith(true);
  });

  it("preserves completed state for disabled retained one-shot jobs", async () => {
    const jobsPath = join(mocks.hermesHome, "cron", "jobs.json");
    mkdirSync(join(mocks.hermesHome, "cron"), { recursive: true });
    writeFileSync(
      jobsPath,
      JSON.stringify({
        jobs: [
          {
            id: "once-complete",
            name: "Completed one-shot",
            enabled: false,
            state: "completed",
            schedule: {
              kind: "once",
              run_at: "2026-05-21T10:30:00.000Z",
            },
            timing: {
              kind: "once",
              at: "2026-05-21T10:30:00.000Z",
            },
            repeat: { times: null, completed: 1 },
          },
        ],
      }),
    );
    const { listCronJobs } = await loadCronJobs();

    await expect(listCronJobs(true)).resolves.toMatchObject([
      {
        id: "once-complete",
        state: "completed",
        enabled: false,
      },
    ]);
  });

  it("surfaces remote cron backend error details from BFF responses", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockResolvedValue({
      request: { profile: "alpha", mode: "local", purpose: "cron" },
      identity: {
        requestedProfile: "alpha",
        actualProfile: "alpha",
        verified: true,
      },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19001",
    });
    mocks.bffJobs.create.mockRejectedValue(
      new mocks.HermesBffError(
        "Hermes BFF POST /api/jobs failed with HTTP 422.",
        JSON.stringify({ error: "invalid schedule" }),
      ),
    );
    const { createCronJob } = await loadCronJobs();

    await expect(
      createCronJob("bad", "Daily prompt", "Daily", "local", "alpha"),
    ).resolves.toEqual({ success: false, error: "invalid schedule" });
  });

  it("sends parseable schedule strings for rich remote one-shot jobs", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockResolvedValue({
      request: { profile: "alpha", mode: "local", purpose: "cron" },
      identity: {
        requestedProfile: "alpha",
        actualProfile: "alpha",
        verified: true,
      },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19001",
      authHeaders: { Authorization: "Bearer alpha" },
    });
    mocks.bffJobs.create.mockResolvedValue({ id: "remote-once" });
    const { createCronJob } = await loadCronJobs();

    await expect(
      createCronJob(
        {
          id: "remote-once",
          name: "Remote one-shot",
          prompt: "Send the recap",
          timing: { kind: "once", at: "2026-05-21T10:30:00.000Z" },
          skills: ["summarizer"],
          context: { sessionId: "session-1" },
        },
        "alpha",
      ),
    ).resolves.toEqual({ success: true, id: "remote-once" });

    expect(mocks.bffJobs.create).toHaveBeenCalledWith(expect.objectContaining({
      id: "remote-once",
      schedule: "2026-05-21T10:30:00.000Z",
      schedule_display: "2026-05-21T10:30:00.000Z",
      schedule_type: "once",
      skills: ["summarizer"],
      context: { sessionId: "session-1" },
    }));
  });

  it("normalizes cron jobs without dropping schedule metadata", async () => {
    const jobsPath = join(
      mocks.hermesHome,
      "profiles",
      "alpha",
      "cron",
      "jobs.json",
    );
    mkdirSync(join(mocks.hermesHome, "profiles", "alpha", "cron"), {
      recursive: true,
    });
    writeFileSync(
      jobsPath,
      JSON.stringify({
        version: 2,
        jobs: [
          {
            id: "job-1",
            name: "Morning",
            schedule: { value: "0 9 * * *", label: "Daily at 09:00" },
            schedule_type: "daily",
            timing: { kind: "daily", time: "09:00", timezone: "Europe/Lisbon" },
            prompt: "Brief me",
            deliver: ["local", "slack:ops"],
            skills: ["calendar", "mail"],
            context: { conversationId: "conv-1", note: "keep" },
            source_session_id: "session-1",
            source_trace_id: "trace-1",
            run_history: [{ traceId: "trace-run-1", status: "success" }],
            unknown_nested: { preserved: true },
          },
        ],
      }),
    );
    const { listCronJobs } = await loadCronJobs();

    await expect(listCronJobs(true, "alpha")).resolves.toMatchObject([
      {
        id: "job-1",
        schedule: "0 9 * * *",
        schedule_type: "daily",
        timing: { kind: "daily", time: "09:00", timezone: "Europe/Lisbon" },
        deliver: ["local", "slack:ops"],
        skills: ["calendar", "mail"],
        context: { conversationId: "conv-1", note: "keep" },
        source_session_id: "session-1",
        source_trace_id: "trace-1",
        run_history: [{ traceId: "trace-run-1", status: "success" }],
        unknown_nested: { preserved: true },
      },
    ]);
  });

  it("creates rich one-shot schedules locally with metadata and retained completion state", async () => {
    const { createCronJob, listCronJobs } = await loadCronJobs();

    await expect(
      createCronJob(
        {
          id: "once-1",
          name: "Send recap",
          prompt: "Summarize this conversation",
          schedule: "0 10 21 5 *",
          timing: { kind: "once", at: "2026-05-21T10:30:00.000Z" },
          deliver: ["local", "email:fred@example.test"],
          skills: ["summarizer", "calendar"],
          context: { conversationId: "conv-1", selectedText: "notes" },
          sourceSessionId: "session-1",
          sourceTraceId: "trace-1",
          metadata: { color: "blue" },
        },
        "alpha",
      ),
    ).resolves.toEqual({ success: true, id: "once-1" });

    expect(mocks.execFile).not.toHaveBeenCalled();
    const persistedPath = join(
      mocks.hermesHome,
      "profiles",
      "alpha",
      "cron",
      "jobs.json",
    );
    const persisted = JSON.parse(readFileSync(persistedPath, "utf-8"));
    expect(persisted.jobs[0]).toMatchObject({
      schedule: {
        kind: "once",
        run_at: "2026-05-21T10:30:00.000Z",
        display: "once at 2026-05-21T10:30:00.000Z",
      },
      schedule_display: "2026-05-21T10:30:00.000Z",
      next_run_at: "2026-05-21T10:30:00.000Z",
    });
    await expect(listCronJobs(true, "alpha")).resolves.toMatchObject([
      {
        id: "once-1",
        repeat: { times: null, completed: 0 },
        deliver: ["local", "email:fred@example.test"],
        skills: ["summarizer", "calendar"],
        context: { conversationId: "conv-1", selectedText: "notes" },
        source_session_id: "session-1",
        source_trace_id: "trace-1",
        metadata: { color: "blue" },
      },
    ]);
  });

  it("updates local schedules while preserving unknown fields and object jobs shape", async () => {
    const jobsPath = join(
      mocks.hermesHome,
      "profiles",
      "alpha",
      "cron",
      "jobs.json",
    );
    mkdirSync(join(mocks.hermesHome, "profiles", "alpha", "cron"), {
      recursive: true,
    });
    writeFileSync(
      jobsPath,
      JSON.stringify({
        version: 3,
        jobs: [
          {
            id: "job-1",
            name: "Old",
            schedule: "0 8 * * *",
            prompt: "Old prompt",
            deliver: ["local"],
            unknown: { keep: true },
          },
        ],
      }),
    );
    const { updateCronJob, listCronJobs } = await loadCronJobs();

    await expect(
      updateCronJob(
        "job-1",
        {
          name: "Updated",
          timing: { kind: "weekly", time: "11:15", daysOfWeek: [1, 3, 5] },
          deliver: ["local", "slack:team"],
          skills: ["writer"],
          context: { conversationId: "conv-2" },
        },
        "alpha",
      ),
    ).resolves.toEqual({ success: true, id: "job-1" });

    const persisted = JSON.parse(readFileSync(jobsPath, "utf-8"));
    expect(Array.isArray(persisted)).toBe(false);
    expect(persisted.version).toBe(3);
    expect(persisted.jobs[0]).toMatchObject({
      id: "job-1",
      name: "Updated",
      schedule: {
        kind: "cron",
        expr: "15 11 * * 1,3,5",
        display: "15 11 * * 1,3,5",
      },
      schedule_display: "15 11 * * 1,3,5",
      schedule_type: "weekly",
      deliver: ["local", "slack:team"],
      skills: ["writer"],
      context: { conversationId: "conv-2" },
      unknown: { keep: true },
    });
    await expect(listCronJobs(true, "alpha")).resolves.toMatchObject([
      {
        id: "job-1",
        name: "Updated",
        unknown: { keep: true },
      },
    ]);
  });

  it("updates local schedules while preserving array jobs shape", async () => {
    const jobsPath = join(
      mocks.hermesHome,
      "profiles",
      "alpha",
      "cron",
      "jobs.json",
    );
    mkdirSync(join(mocks.hermesHome, "profiles", "alpha", "cron"), {
      recursive: true,
    });
    writeFileSync(
      jobsPath,
      JSON.stringify([{ id: "job-1", name: "Old", schedule: "0 8 * * *" }]),
    );
    const { updateCronJob } = await loadCronJobs();

    await expect(
      updateCronJob("job-1", { name: "Array Updated" }, "alpha"),
    ).resolves.toEqual({ success: true, id: "job-1" });

    const persisted = JSON.parse(readFileSync(jobsPath, "utf-8"));
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted[0]).toMatchObject({
      id: "job-1",
      name: "Array Updated",
      schedule: "0 8 * * *",
    });
  });
});

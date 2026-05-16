import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  isRemoteMode: vi.fn(),
  resolveRuntime: vi.fn(),
}));

vi.mock("child_process", () => ({
  default: { execFile: mocks.execFile },
  execFile: mocks.execFile,
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes",
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

async function loadCronJobs(): Promise<typeof import("../src/main/cronjobs")> {
  vi.resetModules();
  return import("../src/main/cronjobs");
}

beforeEach(() => {
  mocks.execFile.mockReset().mockImplementation((_bin, _args, _opts, cb) => {
    cb(null, "ok", "");
  });
  mocks.isRemoteMode.mockReset().mockReturnValue(false);
  mocks.resolveRuntime.mockReset();
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
      expect.objectContaining({ cwd: "/tmp/hermes/hermes-agent" }),
      expect.any(Function),
    );
  });

  it("fails closed for remote cron mutations when runtime identity is unverified", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockRejectedValue(new Error("runtime profile unverified"));
    const { createCronJob } = await loadCronJobs();

    await expect(
      createCronJob("0 9 * * *", "Daily prompt", "Daily", "local", "alpha"),
    ).resolves.toEqual({ success: false, error: "runtime profile unverified" });

    expect(mocks.resolveRuntime).toHaveBeenCalledWith({
      profile: "alpha",
      purpose: "cron",
      preferTransport: "api",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed when the resolved cron runtime does not match the requested profile", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockResolvedValue({
      request: { profile: "beta", mode: "local", purpose: "cron" },
      identity: { requestedProfile: "beta", actualProfile: "beta", verified: true },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19002",
    });
    const { createCronJob } = await loadCronJobs();

    await expect(
      createCronJob("0 9 * * *", "Daily prompt", "Daily", "local", "alpha"),
    ).resolves.toEqual({
      success: false,
      error: "Verified cron API runtime is not available for profile alpha",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes remote cron API calls through the verified runtime handle", async () => {
    mocks.isRemoteMode.mockReturnValue(true);
    mocks.resolveRuntime.mockResolvedValue({
      request: { profile: "alpha", mode: "local", purpose: "cron" },
      identity: { requestedProfile: "alpha", actualProfile: "alpha", verified: true },
      transport: "api",
      apiBaseUrl: "http://127.0.0.1:19001",
      authHeaders: { Authorization: "Bearer alpha" },
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ jobs: [] }),
    } as Response);
    const { listCronJobs } = await loadCronJobs();

    await expect(listCronJobs(true, "alpha")).resolves.toEqual([]);

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:19001/api/jobs?include_disabled=true",
      expect.objectContaining({
        headers: { Authorization: "Bearer alpha" },
      }),
    );
  });
});

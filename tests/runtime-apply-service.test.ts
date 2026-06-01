import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConnectionConfig: vi.fn(),
  markRuntimeStale: vi.fn(),
  setRuntimeApplyState: vi.fn(),
  clearRuntimeApplyState: vi.fn(),
  clearRuntimeStaleIfApplySource: vi.fn(),
  gatewayStatus: vi.fn(),
  restartGatewayAndRevalidate: vi.fn(),
  readGatewayHealthDetailed: vi.fn(),
  isProfileIdle: vi.fn(),
  onProfileIdle: vi.fn(),
  idleCallback: undefined as undefined | ((profile: string) => void),
}));

vi.mock("../src/main/config", () => ({
  getConnectionConfig: mocks.getConnectionConfig,
}));

vi.mock("../src/main/hermes", () => ({
  markRuntimeStale: mocks.markRuntimeStale,
  setRuntimeApplyState: mocks.setRuntimeApplyState,
  clearRuntimeApplyState: mocks.clearRuntimeApplyState,
  clearRuntimeStaleIfApplySource: mocks.clearRuntimeStaleIfApplySource,
}));

vi.mock("../src/main/hermes/session-activity", () => ({
  chatSessionActivityTracker: {
    isProfileIdle: mocks.isProfileIdle,
    onProfileIdle: mocks.onProfileIdle,
  },
}));

vi.mock("../src/main/services/gateway-service", () => ({
  gatewayStatus: mocks.gatewayStatus,
  readGatewayHealthDetailed: mocks.readGatewayHealthDetailed,
  restartGatewayAndRevalidate: mocks.restartGatewayAndRevalidate,
}));

async function resetRuntimeApplyServiceState(): Promise<void> {
  const { __resetRuntimeApplyStateForTests } = await import(
    "../src/main/services/runtime-apply-service"
  );
  __resetRuntimeApplyStateForTests();
}

describe("runtime apply service", () => {
  beforeEach(async () => {
    await resetRuntimeApplyServiceState();
    vi.clearAllMocks();
    mocks.idleCallback = undefined;
    mocks.getConnectionConfig.mockReturnValue({ mode: "local" });
    mocks.gatewayStatus.mockResolvedValue(true);
    mocks.readGatewayHealthDetailed.mockResolvedValue({ active_agents: 0 });
    mocks.restartGatewayAndRevalidate.mockResolvedValue(true);
    mocks.isProfileIdle.mockReturnValue(true);
    mocks.onProfileIdle.mockImplementation(
      (callback: (profile: string) => void) => {
        mocks.idleCallback = callback;
        return vi.fn();
      },
    );
  });

  afterEach(async () => {
    await resetRuntimeApplyServiceState();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("marks stale, applies immediately for an idle running gateway, and clears skill apply state", async () => {
    const { requestSkillRuntimeApply } =
      await import("../src/main/services/runtime-apply-service");

    await requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );

    expect(mocks.markRuntimeStale).toHaveBeenCalledWith(
      "alpha",
      "Skills changed for profile runtime.",
    );
    expect(mocks.setRuntimeApplyState).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({ status: "applying", source: "skills" }),
    );
    expect(mocks.restartGatewayAndRevalidate).toHaveBeenCalledWith("alpha");
    expect(mocks.clearRuntimeStaleIfApplySource).toHaveBeenCalledWith(
      "alpha",
      "skills",
      "Skills changed for profile runtime.",
    );
  });

  it("defers while a foreground chat run is active and applies after the profile becomes idle", async () => {
    mocks.isProfileIdle.mockReturnValue(false);
    const { requestSkillRuntimeApply } =
      await import("../src/main/services/runtime-apply-service");

    await requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );

    expect(mocks.restartGatewayAndRevalidate).not.toHaveBeenCalled();
    expect(mocks.setRuntimeApplyState).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({ status: "pending-idle", source: "skills" }),
    );

    mocks.isProfileIdle.mockReturnValue(true);
    mocks.idleCallback?.("alpha");
    await vi.waitFor(() =>
      expect(mocks.restartGatewayAndRevalidate).toHaveBeenCalledWith("alpha"),
    );
  });

  it("does not mark stale or restart when no gateway is running", async () => {
    mocks.gatewayStatus.mockResolvedValue(false);
    const { requestSkillRuntimeApply } =
      await import("../src/main/services/runtime-apply-service");

    await requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );

    expect(mocks.markRuntimeStale).not.toHaveBeenCalled();
    expect(mocks.restartGatewayAndRevalidate).not.toHaveBeenCalled();
    expect(mocks.clearRuntimeApplyState).toHaveBeenCalledWith(
      "alpha",
      "skills",
    );
  });

  it("warns before applying when other gateway agent work is active, then force-applies on user confirmation", async () => {
    vi.useFakeTimers();
    mocks.readGatewayHealthDetailed.mockResolvedValue({ active_agents: 1 });
    const { forcePendingSkillRuntimeApply, requestSkillRuntimeApply } =
      await import("../src/main/services/runtime-apply-service");

    const request = requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await request;

    expect(mocks.restartGatewayAndRevalidate).not.toHaveBeenCalled();
    expect(mocks.setRuntimeApplyState).toHaveBeenLastCalledWith(
      "alpha",
      expect.objectContaining({ status: "pending-confirm", source: "skills" }),
    );

    await forcePendingSkillRuntimeApply("alpha");

    expect(mocks.restartGatewayAndRevalidate).toHaveBeenCalledWith("alpha");
    expect(mocks.clearRuntimeStaleIfApplySource).toHaveBeenCalledWith(
      "alpha",
      "skills",
      "Skills changed for profile runtime.",
    );
  });

  it("keeps stale state and records failed apply diagnostics when restart/revalidate fails", async () => {
    mocks.restartGatewayAndRevalidate.mockResolvedValue(false);
    const { requestSkillRuntimeApply } =
      await import("../src/main/services/runtime-apply-service");

    await requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );

    expect(mocks.clearRuntimeStaleIfApplySource).not.toHaveBeenCalled();
    expect(mocks.setRuntimeApplyState).toHaveBeenLastCalledWith(
      "alpha",
      expect.objectContaining({
        status: "failed",
        source: "skills",
        failureReason: expect.stringContaining("Gateway restart"),
      }),
    );
  });

  it("coalesces multiple pending skill changes into one restart after idle", async () => {
    mocks.isProfileIdle.mockReturnValue(false);
    const { requestSkillRuntimeApply } =
      await import("../src/main/services/runtime-apply-service");

    await requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );
    await requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );
    expect(mocks.restartGatewayAndRevalidate).not.toHaveBeenCalled();

    mocks.isProfileIdle.mockReturnValue(true);
    mocks.idleCallback?.("alpha");
    await vi.waitFor(() =>
      expect(mocks.restartGatewayAndRevalidate).toHaveBeenCalledTimes(1),
    );
  });

  it("schedules a follow-up apply when a newer generation arrives during apply", async () => {
    let resolveFirst!: (value: boolean) => void;
    mocks.restartGatewayAndRevalidate
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(true);
    const { requestSkillRuntimeApply } =
      await import("../src/main/services/runtime-apply-service");

    const first = requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );
    await vi.waitFor(() =>
      expect(mocks.restartGatewayAndRevalidate).toHaveBeenCalledTimes(1),
    );
    const second = requestSkillRuntimeApply(
      "alpha",
      "Skills changed for profile runtime.",
    );

    resolveFirst(true);
    await Promise.all([first, second]);

    expect(mocks.restartGatewayAndRevalidate).toHaveBeenCalledTimes(2);
  });
});

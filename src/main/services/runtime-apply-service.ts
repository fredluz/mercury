import { getConnectionConfig } from "../config";
import {
  clearRuntimeApplyState,
  clearRuntimeStaleIfApplySource,
  markRuntimeStale,
  setRuntimeApplyState,
} from "../hermes";
import { chatSessionActivityTracker } from "../hermes/session-activity";
import type { RuntimeApplySource } from "../../shared/runtime";
import {
  gatewayStatus,
  readGatewayHealthDetailed,
  restartGatewayAndRevalidate,
} from "./gateway-service";

const SKILL_APPLY_SOURCE: RuntimeApplySource = "skills";
const ACTIVE_AGENTS_SETTLE_DELAYS_MS = [250, 500] as const;
const BACKGROUND_DEFER_RECHECK_MS = 15_000;

type PendingRuntimeApply = {
  profile: string;
  source: RuntimeApplySource;
  reason: string;
  generation: number;
  requestedAt: number;
  applying: boolean;
  checking: boolean;
  backgroundConfirmationDeferred: boolean;
  backgroundRecheckTimer?: ReturnType<typeof setTimeout>;
};

const pendingByProfile = new Map<string, PendingRuntimeApply>();
const settleTimers = new Set<ReturnType<typeof setTimeout>>();
let idleUnsubscribe: (() => void) | undefined;

export async function requestSkillRuntimeApply(
  profile: string | undefined,
  reason: string,
): Promise<void> {
  const normalizedProfile = normalizeProfile(profile);
  const conn = getConnectionConfig();
  if (conn.mode === "remote") return;

  const existing = pendingByProfile.get(normalizedProfile);
  let running = false;
  try {
    running = await Promise.resolve(gatewayStatus(normalizedProfile));
  } catch (error) {
    markRuntimeStale(normalizedProfile, reason);
    setRuntimeApplyState(normalizedProfile, {
      source: SKILL_APPLY_SOURCE,
      status: "failed",
      reason,
      pendingSince: Date.now(),
      failedAt: Date.now(),
      failureReason: `Could not check gateway status: ${errorMessage(error)}`,
      generation: (existing?.generation ?? 0) + 1,
    });
    clearBackgroundRecheck(existing);
    pendingByProfile.delete(normalizedProfile);
    return;
  }
  if (!running) {
    clearBackgroundRecheck(existing);
    pendingByProfile.delete(normalizedProfile);
    clearRuntimeStaleIfApplySource(normalizedProfile, SKILL_APPLY_SOURCE);
    clearRuntimeApplyState(normalizedProfile, SKILL_APPLY_SOURCE);
    return;
  }
  const generation = (existing?.generation ?? 0) + 1;
  const pending: PendingRuntimeApply = existing ?? {
    profile: normalizedProfile,
    source: SKILL_APPLY_SOURCE,
    reason,
    generation,
    requestedAt: Date.now(),
    applying: false,
    checking: false,
    backgroundConfirmationDeferred: false,
    backgroundRecheckTimer: undefined,
  };
  pending.reason = reason;
  pending.generation = generation;
  pending.requestedAt = Date.now();
  pending.backgroundConfirmationDeferred = false;
  pendingByProfile.set(normalizedProfile, pending);

  markRuntimeStale(normalizedProfile, reason);
  setRuntimeApplyState(normalizedProfile, {
    source: SKILL_APPLY_SOURCE,
    status: pending.applying ? "applying" : "pending-idle",
    reason,
    pendingSince: pending.requestedAt,
    applyingSince: pending.applying ? Date.now() : undefined,
    generation,
  });
  ensureIdleSubscription();

  if (chatSessionActivityTracker.isProfileIdle(normalizedProfile)) {
    await applyWhenPossible(normalizedProfile);
  }
}

export async function forcePendingSkillRuntimeApply(
  profile: string | undefined,
): Promise<boolean> {
  const normalizedProfile = normalizeProfile(profile);
  const pending = pendingByProfile.get(normalizedProfile);
  if (!pending || pending.applying) return false;
  pending.backgroundConfirmationDeferred = false;
  clearBackgroundRecheck(pending);
  await applyWhenPossible(normalizedProfile, { forceBackgroundRestart: true });
  return true;
}

export function deferPendingSkillRuntimeApply(
  profile: string | undefined,
): boolean {
  const normalizedProfile = normalizeProfile(profile);
  const pending = pendingByProfile.get(normalizedProfile);
  if (!pending || pending.applying) return false;
  pending.backgroundConfirmationDeferred = true;
  setPendingIdleState(pending);
  scheduleBackgroundRecheck(pending);
  return true;
}

export function __resetRuntimeApplyStateForTests(): void {
  for (const pending of pendingByProfile.values()) {
    clearBackgroundRecheck(pending);
  }
  pendingByProfile.clear();
  for (const timer of settleTimers) {
    clearTimeout(timer);
  }
  settleTimers.clear();
  idleUnsubscribe?.();
  idleUnsubscribe = undefined;
}

async function applyWhenPossible(
  profile: string,
  options: { forceBackgroundRestart?: boolean } = {},
): Promise<void> {
  const pending = pendingByProfile.get(profile);
  if (!pending || pending.applying || pending.checking) return;
  if (!chatSessionActivityTracker.isProfileIdle(profile)) return;

  pending.checking = true;
  let running = false;
  try {
    running = await Promise.resolve(gatewayStatus(profile));
  } catch (error) {
    markFailed(
      profile,
      pending,
      `Could not check gateway status: ${errorMessage(error)}`,
    );
    return;
  }
  if (!running) {
    clearBackgroundRecheck(pending);
    pendingByProfile.delete(profile);
    clearRuntimeStaleIfApplySource(
      profile,
      SKILL_APPLY_SOURCE,
      pending.reason,
    );
    return;
  }
  if (!chatSessionActivityTracker.isProfileIdle(profile)) {
    pending.checking = false;
    return;
  }

  if (!options.forceBackgroundRestart) {
    let activeAgents = 0;
    try {
      activeAgents = await readSettledActiveAgents(profile);
    } catch (error) {
      markFailed(
        profile,
        pending,
        `Could not check gateway background activity: ${errorMessage(error)}`,
      );
      return;
    }
    if (!chatSessionActivityTracker.isProfileIdle(profile)) {
      pending.checking = false;
      return;
    }
    if (activeAgents > 0) {
      // /health/detailed.active_agents is intentionally coarse: it is a
      // gateway-process-wide count and cannot distinguish background terminal
      // work from cron executions or sub-agents. We warn for any other active
      // agent work so an auto-apply restart never silently kills it.
      if (pending.backgroundConfirmationDeferred) {
        setPendingIdleState(pending);
        scheduleBackgroundRecheck(pending);
      } else {
        clearBackgroundRecheck(pending);
        setRuntimeApplyState(profile, {
          source: pending.source,
          status: "pending-confirm",
          reason: pending.reason,
          pendingSince: pending.requestedAt,
          generation: pending.generation,
        });
      }
      pending.checking = false;
      return;
    }
  }

  clearBackgroundRecheck(pending);
  pending.checking = false;
  pending.applying = true;
  const generation = pending.generation;
  const applyingSince = Date.now();
  setRuntimeApplyState(profile, {
    source: pending.source,
    status: "applying",
    reason: pending.reason,
    pendingSince: pending.requestedAt,
    applyingSince,
    generation,
  });

  try {
    const applied = await restartGatewayAndRevalidate(profile);
    const current = pendingByProfile.get(profile);
    if (!current) return;
    if (applied && current.generation === generation) {
      clearBackgroundRecheck(current);
      pendingByProfile.delete(profile);
      clearRuntimeStaleIfApplySource(
        profile,
        SKILL_APPLY_SOURCE,
        current.reason,
      );
      return;
    }
    if (applied) {
      current.applying = false;
      current.backgroundConfirmationDeferred = false;
      setPendingIdleState(current);
      await applyWhenPossible(profile);
      return;
    }
    markFailed(
      profile,
      current,
      "Gateway restart/revalidation did not verify the runtime.",
    );
  } catch (error) {
    const current = pendingByProfile.get(profile);
    if (!current) return;
    markFailed(
      profile,
      current,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function readSettledActiveAgents(profile: string): Promise<number> {
  let activeAgents = await readActiveAgents(profile);
  if (activeAgents === 0) return 0;
  for (const delayMs of ACTIVE_AGENTS_SETTLE_DELAYS_MS) {
    await wait(delayMs);
    activeAgents = await readActiveAgents(profile);
    if (activeAgents === 0) return 0;
  }
  return activeAgents;
}

async function readActiveAgents(profile: string): Promise<number> {
  const health = await readGatewayHealthDetailed(profile);
  return activeAgentsFromHealth(health);
}

function activeAgentsFromHealth(health: { active_agents?: unknown } | null): number {
  const value = health?.active_agents;
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function setPendingIdleState(pending: PendingRuntimeApply): void {
  setRuntimeApplyState(pending.profile, {
    source: pending.source,
    status: "pending-idle",
    reason: pending.reason,
    pendingSince: pending.requestedAt,
    generation: pending.generation,
  });
}

function scheduleBackgroundRecheck(pending: PendingRuntimeApply): void {
  if (pending.backgroundRecheckTimer) return;
  pending.backgroundRecheckTimer = setTimeout(() => {
    pending.backgroundRecheckTimer = undefined;
    void applyWhenPossible(pending.profile);
  }, BACKGROUND_DEFER_RECHECK_MS);
}

function clearBackgroundRecheck(pending: PendingRuntimeApply | undefined): void {
  if (!pending?.backgroundRecheckTimer) return;
  clearTimeout(pending.backgroundRecheckTimer);
  pending.backgroundRecheckTimer = undefined;
}

function markFailed(
  profile: string,
  pending: PendingRuntimeApply,
  failureReason: string,
): void {
  pending.applying = false;
  pending.checking = false;
  clearBackgroundRecheck(pending);
  pendingByProfile.delete(profile);
  setRuntimeApplyState(profile, {
    source: pending.source,
    status: "failed",
    reason: pending.reason,
    pendingSince: pending.requestedAt,
    failedAt: Date.now(),
    failureReason,
    generation: pending.generation,
  });
}

function ensureIdleSubscription(): void {
  if (idleUnsubscribe) return;
  idleUnsubscribe = chatSessionActivityTracker.onProfileIdle((profile) => {
    void applyWhenPossible(profile);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      settleTimers.delete(timer);
      resolve();
    }, ms);
    settleTimers.add(timer);
  });
}

function normalizeProfile(profile: string | undefined): string {
  return profile?.trim() || "default";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

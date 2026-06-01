import type {
  ChatSessionActivityStatus,
  ProfileSessionRuntimeActivitySnapshot,
  SessionRuntimeActivity,
} from "../../shared/runtime";

export type TrackedChatRun = {
  token: string;
  profile: string;
  sessionId: string | null;
  runId: string | null;
  status: Exclude<ChatSessionActivityStatus, "idle">;
  startedAt: number;
  updatedAt: number;
};

type BeginRunArgs = {
  profile: string;
  sessionId?: string;
  status: "queued" | "submitting";
};

type AttachRunArgs = {
  token: string;
  runId: string;
  sessionId?: string;
};

type ProfileIdleCallback = (profile: string) => void;

const ACTIVE_STATUS_PRIORITY: Record<
  Exclude<ChatSessionActivityStatus, "idle">,
  number
> = {
  stopping: 4,
  running: 3,
  submitting: 2,
  queued: 1,
};

export class ChatSessionActivityTracker {
  private readonly runs = new Map<string, TrackedChatRun>();
  private readonly idleCallbacks = new Set<ProfileIdleCallback>();
  private tokenCounter = 0;

  beginRun(args: BeginRunArgs): string {
    const now = Date.now();
    const token = `chat-run-${now}-${++this.tokenCounter}`;
    this.runs.set(token, {
      token,
      profile: normalizeProfile(args.profile),
      sessionId: normalizeSessionId(args.sessionId),
      runId: null,
      status: args.status,
      startedAt: now,
      updatedAt: now,
    });
    return token;
  }

  attachRun(args: AttachRunArgs): void {
    const run = this.runs.get(args.token);
    if (!run) return;
    run.runId = args.runId;
    const sessionId = normalizeSessionId(args.sessionId);
    if (sessionId) run.sessionId = sessionId;
    run.status = "running";
    run.updatedAt = Date.now();
  }

  markRunning(token: string): void {
    this.updateStatus(token, "running");
  }

  markStopping(token: string): void {
    this.updateStatus(token, "stopping");
  }

  finishRun(token: string): void {
    const run = this.runs.get(token);
    if (!run) return;
    const profile = run.profile;
    const wasActive = this.activeRunCount(profile) > 0;
    this.runs.delete(token);
    if (wasActive && this.activeRunCount(profile) === 0) {
      for (const callback of [...this.idleCallbacks]) callback(profile);
    }
  }

  isProfileIdle(profile: string): boolean {
    return this.activeRunCount(normalizeProfile(profile)) === 0;
  }

  getSnapshot(profile?: string): ProfileSessionRuntimeActivitySnapshot[] {
    const normalizedProfile =
      profile === undefined ? undefined : normalizeProfile(profile);
    const profiles = new Set<string>();
    if (normalizedProfile) profiles.add(normalizedProfile);
    for (const run of this.runs.values()) {
      if (!normalizedProfile || run.profile === normalizedProfile)
        profiles.add(run.profile);
    }
    return [...profiles]
      .sort()
      .map((profileName) => this.snapshotForProfile(profileName));
  }

  onProfileIdle(callback: ProfileIdleCallback): () => void {
    this.idleCallbacks.add(callback);
    return () => {
      this.idleCallbacks.delete(callback);
    };
  }

  private updateStatus(
    token: string,
    status: Exclude<ChatSessionActivityStatus, "idle">,
  ): void {
    const run = this.runs.get(token);
    if (!run) return;
    run.status = status;
    run.updatedAt = Date.now();
  }

  private snapshotForProfile(
    profile: string,
  ): ProfileSessionRuntimeActivitySnapshot {
    const sessions = new Map<string, SessionRuntimeActivity>();
    let activeRunCount = 0;

    for (const run of this.runs.values()) {
      if (run.profile !== profile) continue;
      activeRunCount += 1;
      const key = run.sessionId ?? "__unknown__";
      const existing = sessions.get(key);
      if (!existing) {
        sessions.set(key, {
          sessionId: run.sessionId,
          activeRunCount: 1,
          status: run.status,
          runIds: run.runId ? [run.runId] : [],
          updatedAt: run.updatedAt,
        });
        continue;
      }
      existing.activeRunCount += 1;
      if (run.runId) existing.runIds.push(run.runId);
      if (
        ACTIVE_STATUS_PRIORITY[run.status] >
        ACTIVE_STATUS_PRIORITY[
          existing.status as Exclude<ChatSessionActivityStatus, "idle">
        ]
      ) {
        existing.status = run.status;
      }
      existing.updatedAt = Math.max(existing.updatedAt, run.updatedAt);
    }

    return {
      profile,
      activeRunCount,
      isIdle: activeRunCount === 0,
      sessions: [...sessions.values()].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    };
  }

  private activeRunCount(profile: string): number {
    let count = 0;
    for (const run of this.runs.values()) {
      if (run.profile === profile) count += 1;
    }
    return count;
  }
}

function normalizeProfile(profile: string | undefined): string {
  return profile?.trim() || "default";
}

function normalizeSessionId(sessionId: string | undefined): string | null {
  const normalized = sessionId?.trim();
  return normalized || null;
}

export const chatSessionActivityTracker = new ChatSessionActivityTracker();

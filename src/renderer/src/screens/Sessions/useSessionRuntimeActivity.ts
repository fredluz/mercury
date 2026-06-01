import { useEffect, useRef, useState } from "react";
import type { ProfileSessionRuntimeActivitySnapshot } from "../../../../shared/runtime";
import { sessionRowKey } from "./sessionListUtils";

interface UseSessionRuntimeActivityOptions {
  /** Profile filter; omit to track activity across all profiles. */
  profile?: string;
  /** When false, polling is suspended and the maps stay empty. */
  enabled?: boolean;
  /** Poll cadence in ms (defaults to 1500ms). */
  intervalMs?: number;
}

export interface SessionRuntimeActivityMaps {
  /** Session row keys (`sessionRowKey`) that currently have an active run. */
  activeBySessionKey: Set<string>;
  /** Profile names that currently have any active run. */
  activeProfiles: Set<string>;
}

const DEFAULT_INTERVAL_MS = 1500;

const EMPTY_RESULT: SessionRuntimeActivityMaps = {
  activeBySessionKey: new Set<string>(),
  activeProfiles: new Set<string>(),
};

function normalizeProfile(profile: string): string {
  return profile.trim() || "default";
}

function buildMaps(
  snapshots: ProfileSessionRuntimeActivitySnapshot[],
): SessionRuntimeActivityMaps {
  const activeBySessionKey = new Set<string>();
  const activeProfiles = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshot.activeRunCount > 0 || !snapshot.isIdle) {
      activeProfiles.add(normalizeProfile(snapshot.profile));
    }
    for (const session of snapshot.sessions) {
      if (session.activeRunCount > 0 && session.sessionId) {
        activeBySessionKey.add(
          sessionRowKey(session.sessionId, snapshot.profile),
        );
      }
    }
  }
  return { activeBySessionKey, activeProfiles };
}

/**
 * Polls main-process session runtime activity and exposes per-session and
 * per-profile "active run" lookups for lightweight indicators. The indicator is
 * purely informational and must never gate navigation or resume.
 */
export function useSessionRuntimeActivity({
  profile,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
}: UseSessionRuntimeActivityOptions = {}): SessionRuntimeActivityMaps {
  const [maps, setMaps] = useState<SessionRuntimeActivityMaps>(EMPTY_RESULT);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setMaps(EMPTY_RESULT);
      return;
    }
    const fetchActivity = window.hermesAPI?.getSessionRuntimeActivity;
    if (typeof fetchActivity !== "function") {
      setMaps(EMPTY_RESULT);
      return;
    }

    let cancelled = false;

    async function poll(): Promise<void> {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      try {
        const snapshots = await fetchActivity(profile);
        if (cancelled || requestIdRef.current !== requestId) return;
        setMaps(buildMaps(snapshots));
      } catch {
        // Activity polling is best-effort; ignore transient IPC failures and
        // keep the previous indicator state until the next successful poll.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, profile, intervalMs]);

  return maps;
}

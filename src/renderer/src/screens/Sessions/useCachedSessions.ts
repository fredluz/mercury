import { useCallback, useEffect, useRef, useState } from "react";
import type { CachedSession } from "./sessionListUtils";

interface UseCachedSessionsOptions {
  limit: number;
  refreshToken?: number;
  profile?: string;
  enabled?: boolean;
}

interface UseCachedSessionsResult {
  sessions: CachedSession[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load sessions";
}

export function useCachedSessions({
  limit,
  refreshToken,
  profile,
  enabled = true,
}: UseCachedSessionsOptions): UseCachedSessionsResult {
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const reload = useCallback(async (): Promise<void> => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    let loaded = false;
    let firstError: unknown = null;

    try {
      const cached = await window.hermesAPI.listCachedSessions(
        limit,
        0,
        profile,
      );
      if (requestIdRef.current !== requestId) return;
      if (cached.length > 0) {
        setSessions(cached.slice(0, limit));
        setLoading(false);
        loaded = true;
      }
    } catch (error) {
      firstError = error;
    }

    try {
      const synced = await window.hermesAPI.syncSessionCache(profile);
      if (requestIdRef.current !== requestId) return;
      setSessions(synced.slice(0, limit));
      loaded = true;
    } catch (error) {
      firstError = error;
    }

    if (requestIdRef.current !== requestId) return;
    if (!loaded) setError(errorMessage(firstError));
    setLoading(false);
  }, [enabled, limit, profile]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  return { sessions, loading, error, reload };
}

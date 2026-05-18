import { useCallback, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { TraceEvent } from "../../../../../shared/traces";
import { isChatActivityEvent } from "../chatActivity";
import type {
  ChatActivityGroup,
  ChatActivityGroupStatus,
} from "../types";

interface UseChatActivityGroupsResult {
  activityGroups: ChatActivityGroup[];
  activeActivityGroupIdRef: MutableRefObject<string | null>;
  beginActivityGroup: (anchorMessageId: string) => void;
  appendActivityEvent: (traceEvent: TraceEvent) => void;
  markActiveActivityGroup: (status: ChatActivityGroupStatus) => void;
  resetActivityGroups: () => void;
  toggleActivityGroup: (groupId: string) => void;
}

export function useChatActivityGroups(): UseChatActivityGroupsResult {
  const [activityGroups, setActivityGroups] = useState<ChatActivityGroup[]>([]);
  const activeActivityGroupIdRef = useRef<string | null>(null);

  const beginActivityGroup = useCallback((anchorMessageId: string): void => {
    const now = Date.now();
    const id = `activity-${now}-${Math.random().toString(36).slice(2, 8)}`;
    activeActivityGroupIdRef.current = id;
    setActivityGroups((prev) => [
      ...prev,
      {
        id,
        anchorMessageId,
        status: "running",
        startedAt: now,
        updatedAt: now,
        expanded: false,
        events: [],
      },
    ]);
  }, []);

  const appendActivityEvent = useCallback((traceEvent: TraceEvent): void => {
    if (!isChatActivityEvent(traceEvent)) return;
    setActivityGroups((prev) => {
      let targetIndex = traceEvent.runId
        ? prev.findIndex((group) => group.runId === traceEvent.runId)
        : -1;
      if (targetIndex < 0 && activeActivityGroupIdRef.current) {
        targetIndex = prev.findIndex((group) => group.id === activeActivityGroupIdRef.current);
      }
      if (targetIndex < 0) return prev;

      const target = prev[targetIndex];
      if (target.events.some((event) => event.id === traceEvent.id)) return prev;

      const next = [...prev];
      next[targetIndex] = {
        ...target,
        runId: target.runId || traceEvent.runId,
        status: traceEvent.type === "transport.error" || traceEvent.type.endsWith(".failed") ? "failed" : target.status,
        updatedAt: traceEvent.timestamp,
        events: [...target.events, traceEvent],
      };
      return next;
    });
  }, []);

  const markActiveActivityGroup = useCallback((status: ChatActivityGroupStatus): void => {
    const activeId = activeActivityGroupIdRef.current;
    if (!activeId) return;
    setActivityGroups((prev) =>
      prev
        .map((group) =>
          group.id === activeId
            ? { ...group, status, updatedAt: Date.now() }
            : group,
        )
        .filter((group) => group.id !== activeId || group.events.length > 0),
    );
    activeActivityGroupIdRef.current = null;
  }, []);

  const resetActivityGroups = useCallback((): void => {
    setActivityGroups([]);
    activeActivityGroupIdRef.current = null;
  }, []);

  const toggleActivityGroup = useCallback((groupId: string): void => {
    setActivityGroups((prev) =>
      prev.map((group) =>
        group.id === groupId ? { ...group, expanded: !group.expanded } : group,
      ),
    );
  }, []);

  return {
    activityGroups,
    activeActivityGroupIdRef,
    beginActivityGroup,
    appendActivityEvent,
    markActiveActivityGroup,
    resetActivityGroups,
    toggleActivityGroup,
  };
}

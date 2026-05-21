export interface CachedSession {
  id: string;
  title: string;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  profile?: string;
}

export interface SearchResult {
  sessionId: string;
  title: string | null;
  startedAt: number;
  source: string;
  messageCount: number;
  model: string;
  snippet: string;
  profile?: string;
}

export type DateGroup = "today" | "yesterday" | "thisWeek" | "earlier";

export function formatSessionTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatSessionFullDate(ts: number): string {
  const d = new Date(ts * 1000);
  return (
    d.toLocaleDateString([], { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );
}

function getDateGroup(ts: number): DateGroup {
  const d = new Date(ts * 1000);
  const now = new Date();

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return "today";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return "yesterday";

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  if (d >= weekAgo) return "thisWeek";

  return "earlier";
}

export function groupSessionsByDate(
  sessions: CachedSession[],
): Array<{ label: DateGroup; sessions: CachedSession[] }> {
  const groups = new Map<DateGroup, CachedSession[]>();
  for (const session of sessions) {
    const group = getDateGroup(session.startedAt);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(session);
  }
  const order: DateGroup[] = ["today", "yesterday", "thisWeek", "earlier"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, sessions: groups.get(label)! }));
}

export function formatSessionModel(model: string): string {
  const name = model.split("/").pop() || model;
  return name.split(":")[0];
}

export function formatSessionProfile(
  profile?: string,
  fallback = "unknown agent",
): string {
  const clean = profile?.trim();
  return clean || fallback;
}

export function sessionRowKey(sessionId: string, profile?: string): string {
  return `${profile?.trim() || "unknown"}:${sessionId}`;
}

export function isActiveSession(
  currentSessionId: string | null,
  currentSessionProfile: string | null | undefined,
  rowSessionId: string,
  rowProfile?: string,
): boolean {
  if (currentSessionId !== rowSessionId) return false;
  const activeProfile = currentSessionProfile?.trim();
  const profile = rowProfile?.trim();
  if (activeProfile) return profile === activeProfile;
  return !profile;
}

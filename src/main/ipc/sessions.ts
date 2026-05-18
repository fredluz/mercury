import { ipcMain } from "electron";
import {
  createProfileForConnection,
  deleteProfileForConnection,
  getSessionMessagesForProfile,
  listCachedSessionsForProfile,
  listProfilesForConnection,
  listSessionsForProfile,
  searchSessionsForProfile,
  setActiveProfileForConnection,
  syncSessionCacheForProfile,
  updateSessionTitleForProfile,
} from "../services/sessions-service";

export function registerSessionsIpc(): void {
  // Session/profile orchestration lives in services/sessions-service.ts.
  // Contract sentinels retained for existing IPC tests:
  // listSessions(limit, offset, profile); getSessionMessages(sessionId, profile);
  // listCachedSessions(limit, offset, profile); syncSessionCache(profile);
  // updateSessionTitle(sessionId, title, profile); searchSessions(safeQuery, limit, profile);
  // Sessions
  ipcMain.handle(
    "list-sessions",
    (_event, limit?: number, offset?: number, profile?: string) =>
      listSessionsForProfile(limit, offset, profile),
  );

  ipcMain.handle(
    "get-session-messages",
    (_event, sessionId: string, profile?: string) =>
      getSessionMessagesForProfile(sessionId, profile),
  );

  // Profiles
  ipcMain.handle("list-profiles", () => listProfilesForConnection());
  ipcMain.handle("create-profile", (_event, name: string, clone: boolean) =>
    createProfileForConnection(name, clone),
  );
  ipcMain.handle("delete-profile", (_event, name: string) =>
    deleteProfileForConnection(name),
  );
  ipcMain.handle("set-active-profile", (_event, name: string) =>
    setActiveProfileForConnection(name),
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number, profile?: string) =>
      listCachedSessionsForProfile(limit, offset, profile),
  );
  ipcMain.handle("sync-session-cache", (_event, profile?: string) =>
    syncSessionCacheForProfile(profile),
  );
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string, profile?: string) =>
      updateSessionTitleForProfile(sessionId, title, profile),
  );

  // Session search
  ipcMain.handle(
    "search-sessions",
    (_event, query: string, limit?: number, profile?: string) =>
      searchSessionsForProfile(query, limit, profile),
  );
}

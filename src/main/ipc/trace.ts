import { ipcMain } from "electron";
import type { LocalChatTraceRequest } from "../../shared/traces";
import {
  createLocalChatTrace,
  getTraceRun,
  listCompletedScheduledRunsSince,
  listSkillTrainingRuns,
  listTraceRuns,
  listTraceRunsForSchedule,
} from "../trace-store";

export function registerTraceIpc(): void {
  // Trace Lab
  ipcMain.handle("list-trace-runs", () => listTraceRuns());
  ipcMain.handle("get-trace-run", (_event, runId: string) =>
    getTraceRun(runId),
  );
  ipcMain.handle(
    "list-trace-runs-for-schedule",
    (_event, scheduleId: string, profile?: string) =>
      listTraceRunsForSchedule(scheduleId, profile),
  );
  ipcMain.handle(
    "list-completed-scheduled-runs-since",
    (_event, timestamp: number, profile?: string) =>
      listCompletedScheduledRunsSince(timestamp, profile),
  );
  ipcMain.handle("list-skill-training-runs", () => listSkillTrainingRuns());
  ipcMain.handle(
    "record-local-chat-trace",
    (_event, request: LocalChatTraceRequest) => createLocalChatTrace(request),
  );
}

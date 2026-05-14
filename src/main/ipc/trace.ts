import { ipcMain } from "electron";
import type { LocalChatTraceRequest } from "../../shared/traces";
import {
  createLocalChatTrace,
  getTraceRun,
  listSkillTrainingRuns,
  listTraceRuns,
} from "../trace-store";

export function registerTraceIpc(): void {
  // Trace Lab
  ipcMain.handle("list-trace-runs", () => listTraceRuns());
  ipcMain.handle("get-trace-run", (_event, runId: string) =>
    getTraceRun(runId),
  );
  ipcMain.handle("list-skill-training-runs", () => listSkillTrainingRuns());
  ipcMain.handle(
    "record-local-chat-trace",
    (_event, request: LocalChatTraceRequest) => createLocalChatTrace(request),
  );
}

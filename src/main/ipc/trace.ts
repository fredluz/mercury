import { ipcMain } from "electron";
import {
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
}

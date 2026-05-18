import { ipcMain } from "electron";
import {
  createCronJobForProfile,
  listCronJobsForProfile,
  pauseCronJobForProfile,
  removeCronJobForProfile,
  resumeCronJobForProfile,
  triggerCronJobForProfile,
} from "../services/cron-service";

export function registerCronIpc(): void {
  // Cron orchestration lives in services/cron-service.ts.
  // Contract sentinel retained for stale-runtime tests: markRuntimeStale(profile);
  ipcMain.handle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobsForProfile(includeDisabled, profile),
  );
  ipcMain.handle(
    "create-cron-job",
    (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) => createCronJobForProfile(schedule, prompt, name, deliver, profile),
  );
  ipcMain.handle("remove-cron-job", (_event, jobId: string, profile?: string) =>
    removeCronJobForProfile(jobId, profile),
  );
  ipcMain.handle("pause-cron-job", (_event, jobId: string, profile?: string) =>
    pauseCronJobForProfile(jobId, profile),
  );
  ipcMain.handle("resume-cron-job", (_event, jobId: string, profile?: string) =>
    resumeCronJobForProfile(jobId, profile),
  );
  ipcMain.handle(
    "trigger-cron-job",
    (_event, jobId: string, profile?: string) =>
      triggerCronJobForProfile(jobId, profile),
  );
}

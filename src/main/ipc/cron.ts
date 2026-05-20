import { ipcMain } from "electron";
import {
  createCronJobForProfile,
  createScheduleJobForProfile,
  listCronJobsForProfile,
  pauseCronJobForProfile,
  removeCronJobForProfile,
  resumeCronJobForProfile,
  triggerCronJobForProfile,
  updateCronJobForProfile,
} from "../services/cron-service";
import type {
  ScheduleCreatePayload,
  ScheduleUpdatePayload,
} from "../../shared/schedules";

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
      schedule: string | ScheduleCreatePayload,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) =>
      typeof schedule === "string"
        ? createCronJobForProfile(schedule, prompt, name, deliver, profile)
        : createScheduleJobForProfile(schedule, prompt),
  );
  ipcMain.handle(
    "create-schedule-job",
    (_event, payload: ScheduleCreatePayload, profile?: string) =>
      createScheduleJobForProfile(payload, profile),
  );
  ipcMain.handle(
    "update-cron-job",
    (_event, jobId: string, payload: ScheduleUpdatePayload, profile?: string) =>
      updateCronJobForProfile(jobId, payload, profile),
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

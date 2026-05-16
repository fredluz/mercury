import { ipcMain } from "electron";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "../cronjobs";
import { markRuntimeStale } from "../hermes";

function markCronMutation(profile?: string): void {
  markRuntimeStale(profile, "Cron schedule changed for profile runtime.");
}

export function registerCronIpc(): void {
  // Cron Jobs
  ipcMain.handle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  ipcMain.handle(
    "create-cron-job",
    async (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) => {
      const result = await createCronJob(schedule, prompt, name, deliver, profile);
      if (result.success) markCronMutation(profile);
      return result;
    },
  );
  ipcMain.handle("remove-cron-job", async (_event, jobId: string, profile?: string) => {
    const result = await removeCronJob(jobId, profile);
    if (result.success) markCronMutation(profile);
    return result;
  });
  ipcMain.handle("pause-cron-job", async (_event, jobId: string, profile?: string) => {
    const result = await pauseCronJob(jobId, profile);
    if (result.success) markCronMutation(profile);
    return result;
  });
  ipcMain.handle("resume-cron-job", async (_event, jobId: string, profile?: string) => {
    const result = await resumeCronJob(jobId, profile);
    if (result.success) markCronMutation(profile);
    return result;
  });
  ipcMain.handle(
    "trigger-cron-job",
    (_event, jobId: string, profile?: string) => triggerCronJob(jobId, profile),
  );
}

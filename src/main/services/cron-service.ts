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

export function listCronJobsForProfile(includeDisabled?: boolean, profile?: string) {
  return listCronJobs(includeDisabled, profile);
}

export async function createCronJobForProfile(
  schedule: string,
  prompt?: string,
  name?: string,
  deliver?: string,
  profile?: string,
) {
  const result = await createCronJob(schedule, prompt, name, deliver, profile);
  if (result.success) markCronMutation(profile);
  return result;
}

export async function removeCronJobForProfile(jobId: string, profile?: string) {
  const result = await removeCronJob(jobId, profile);
  if (result.success) markCronMutation(profile);
  return result;
}

export async function pauseCronJobForProfile(jobId: string, profile?: string) {
  const result = await pauseCronJob(jobId, profile);
  if (result.success) markCronMutation(profile);
  return result;
}

export async function resumeCronJobForProfile(jobId: string, profile?: string) {
  const result = await resumeCronJob(jobId, profile);
  if (result.success) markCronMutation(profile);
  return result;
}

export function triggerCronJobForProfile(jobId: string, profile?: string) {
  return triggerCronJob(jobId, profile);
}

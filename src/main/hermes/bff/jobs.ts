import type { ProfileHermesBffClient } from "./client";
import type { JsonRecord } from "./types";

export type HermesRawJob = Record<string, unknown>;

export interface HermesJobsListPayload {
  jobs?: HermesRawJob[];
  data?: HermesRawJob[];
}

export class HermesJobsBffClient {
  constructor(private readonly client: ProfileHermesBffClient) {}

  async list(includeDisabled = true): Promise<HermesRawJob[]> {
    const suffix = includeDisabled ? "?include_disabled=true" : "";
    const payload = await this.client.json<HermesJobsListPayload | HermesRawJob[]>({
      family: "jobs",
      method: "GET",
      path: `/api/jobs${suffix}`,
    });
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.jobs)) return payload.jobs;
    if (Array.isArray(payload.data)) return payload.data;
    throw new Error("Hermes jobs response was malformed.");
  }

  create(payload: HermesRawJob): Promise<JsonRecord> {
    return this.client.json<JsonRecord>({
      family: "jobs",
      method: "POST",
      path: "/api/jobs",
      body: payload,
      expectedStatuses: [200, 201, 202, 204],
      retry: "none",
    });
  }

  async update(jobId: string, payload: HermesRawJob): Promise<void> {
    await this.client.json({
      family: "jobs",
      method: "PATCH",
      path: `/api/jobs/${encodeURIComponent(jobId)}`,
      body: payload,
      expectedStatuses: [200, 202, 204],
      jobId,
      retry: "none",
    });
  }

  async remove(jobId: string): Promise<void> {
    await this.client.json({
      family: "jobs",
      method: "DELETE",
      path: `/api/jobs/${encodeURIComponent(jobId)}`,
      expectedStatuses: [200, 202, 204],
      jobId,
      retry: "none",
    });
  }

  async action(jobId: string, action: "pause" | "resume" | "run"): Promise<void> {
    await this.client.json({
      family: "jobs",
      method: "POST",
      path: `/api/jobs/${encodeURIComponent(jobId)}/${action}`,
      body: {},
      expectedStatuses: [200, 202, 204],
      jobId,
      retry: "none",
    });
  }
}

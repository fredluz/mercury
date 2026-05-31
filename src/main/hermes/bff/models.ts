import type { ProfileHermesBffClient } from "./client";

export interface HermesModelOptionsPayload {
  providers?: unknown;
  [key: string]: unknown;
}

export class HermesModelsBffClient {
  constructor(private readonly client: ProfileHermesBffClient) {}

  options(): Promise<HermesModelOptionsPayload> {
    return this.client.json<HermesModelOptionsPayload>({
      family: "models",
      method: "GET",
      path: "/api/model/options",
      timeoutMs: 3_000,
    });
  }
}

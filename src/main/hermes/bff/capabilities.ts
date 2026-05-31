import type { HermesCapabilityDescriptor } from "../types";
import type { ProfileHermesBffClient } from "./client";

export class HermesCapabilitiesBffClient {
  constructor(private readonly client: ProfileHermesBffClient) {}

  get(): Promise<HermesCapabilityDescriptor> {
    return this.client.json<HermesCapabilityDescriptor>({
      family: "capabilities",
      method: "GET",
      path: "/v1/capabilities",
      timeoutMs: 5_000,
    });
  }

  health(): Promise<boolean> {
    return this.client.health();
  }
}

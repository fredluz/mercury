import type {
  ProfileRuntimeHandle,
  RuntimePurpose,
} from "../types";
import { ProfileRuntimeError } from "../types";

export type VerifiedApiRuntimeHandle = ProfileRuntimeHandle & {
  apiBaseUrl: string;
  transport: "api" | "ssh-api";
};

export function assertVerifiedApiRuntimeHandle(
  runtime: ProfileRuntimeHandle | undefined,
  expectedProfile: string,
  purpose: RuntimePurpose,
): asserts runtime is VerifiedApiRuntimeHandle {
  if (!runtime || !runtime.apiBaseUrl || !isApiTransport(runtime.transport)) {
    throw new ProfileRuntimeError(
      "runtime-unavailable",
      `Verified ${purpose} API runtime is not available for profile ${expectedProfile}.`,
      runtime?.identity,
    );
  }

  if (!runtime.identity.verified || !runtime.identity.actualProfile) {
    throw new ProfileRuntimeError(
      "runtime-profile-unverified",
      `Runtime identity for profile ${expectedProfile} is not verified for ${purpose} execution.`,
      runtime.identity,
    );
  }

  if (
    runtime.request.profile !== expectedProfile ||
    runtime.identity.actualProfile !== expectedProfile
  ) {
    throw new ProfileRuntimeError(
      "runtime-profile-mismatch",
      `Runtime profile ${runtime.identity.actualProfile} does not match requested profile ${expectedProfile}.`,
      runtime.identity,
    );
  }
}

function isApiTransport(transport: ProfileRuntimeHandle["transport"]): transport is "api" | "ssh-api" {
  return transport === "api" || transport === "ssh-api";
}

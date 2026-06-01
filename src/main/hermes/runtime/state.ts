import type { ChildProcess } from "child_process";
import type {
  RuntimeApplySource,
  RuntimeApplyStatus,
} from "../../../shared/runtime";
import type { RuntimeIdentity } from "../types";

export type TimerLike = ReturnType<typeof setInterval>;

export type RuntimeApplyState = {
  source: RuntimeApplySource;
  status: RuntimeApplyStatus;
  reason: string;
  pendingSince: number;
  applyingSince?: number;
  failedAt?: number;
  failureReason?: string;
  generation: number;
};

export type RuntimeState = {
  gatewayProcess: ChildProcess | null;
  gatewayStartedByApp: boolean;
  apiServerAvailable: boolean | null;
  healthCheckInterval: TimerLike | null;
  managedApiHost?: string;
  managedApiPort?: number;
  gatewayCommand?: string[];
  lastIdentity?: RuntimeIdentity;
  staleReason?: string;
  staleAt?: number;
  runtimeApplyState?: RuntimeApplyState;
};

export function createInitialRuntimeState(): RuntimeState {
  return {
    gatewayProcess: null,
    gatewayStartedByApp: false,
    apiServerAvailable: null,
    healthCheckInterval: null,
  };
}

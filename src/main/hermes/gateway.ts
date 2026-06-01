import { sendMessageViaApi } from "./chat-api";
import { isRemoteMode } from "./connection";
import {
  profileHermesBffClientForRuntime,
  type HermesDetailedHealthPayload,
} from "./bff";
import { profileRuntimeManager } from "./runtime";
import { assertVerifiedApiRuntimeHandle } from "./runtime/api-runtime";
import {
  isSyntheticChatStreamEnabled,
  sendSyntheticChatStream,
} from "./synthetic-chat";
import type { RuntimeApplySource } from "../../shared/runtime";
import type { RuntimeApplyState } from "./runtime/state";
import type { ChatCallbacks, ChatHandle, ProfileRuntimeHandle } from "./types";

export async function sendMessage(
  message: string,
  cb: ChatCallbacks,
  profile?: string,
  resumeSessionId?: string,
  history?: Array<{ role: string; content: string }>,
  preparedRuntime?: ProfileRuntimeHandle,
): Promise<ChatHandle> {
  if (isSyntheticChatStreamEnabled()) {
    return sendSyntheticChatStream(
      message,
      cb,
      profile,
      resumeSessionId,
      history,
    );
  }

  const normalizedProfile = profileRuntimeManager.normalizeProfile(profile);
  ensureInitialized(normalizedProfile);

  const runtime =
    preparedRuntime ??
    (await profileRuntimeManager.resolveRuntime({
      profile: normalizedProfile,
      purpose: "chat",
      sessionId: resumeSessionId,
    }));

  assertVerifiedApiRuntimeHandle(runtime, normalizedProfile, "chat");
  return sendMessageViaApi(
    message,
    cb,
    normalizedProfile,
    resumeSessionId,
    history,
    runtime,
  );
}

// Lazy init — called on first sendMessage or gateway start
const _initializedProfiles = new Set<string>();

function ensureInitialized(profile?: string): void {
  const normalizedProfile = profileRuntimeManager.normalizeProfile(profile);
  if (_initializedProfiles.has(normalizedProfile)) return;
  _initializedProfiles.add(normalizedProfile);
  if (!isRemoteMode()) {
    profileRuntimeManager.ensureInitialized(normalizedProfile);
  }
}

export function stopHealthPolling(profile?: string): void {
  profileRuntimeManager.stopHealthPolling(profile);
}

// ────────────────────────────────────────────────────
//  Gateway management
// ────────────────────────────────────────────────────

export function startGateway(profile?: string): boolean {
  const normalizedProfile = profileRuntimeManager.normalizeProfile(profile);
  ensureInitialized(normalizedProfile);
  return profileRuntimeManager.startGateway(normalizedProfile);
}

export function stopGateway(force = false, profile?: string): void {
  profileRuntimeManager.stopGateway(force, profile);
}

export function stopAllGateways(): void {
  profileRuntimeManager.stopAllGateways();
}

export function isGatewayRunning(profile?: string): boolean {
  return profileRuntimeManager.isGatewayRunning(profile);
}

export function isApiReady(profile?: string): boolean {
  return profileRuntimeManager.isApiReady(profile);
}

export function restartGateway(profile?: string): void {
  profileRuntimeManager.restartGateway(profile);
}

export function getRuntimeIdentity(profile?: string) {
  return profileRuntimeManager.getRuntimeIdentity(profile);
}

export function getRuntimeDiagnostic(profile?: string) {
  return profileRuntimeManager.getRuntimeDiagnostic(profile);
}

export async function getGatewayDetailedHealth(
  profile?: string,
): Promise<HermesDetailedHealthPayload> {
  const normalizedProfile = profileRuntimeManager.normalizeProfile(profile);
  const runtime = await profileRuntimeManager.resolveRuntimeForHealthProbe({
    profile: normalizedProfile,
    purpose: "gateway",
    preferTransport: "api",
  });
  return profileHermesBffClientForRuntime(
    runtime,
    normalizedProfile,
    "gateway",
  ).detailedHealth();
}

export function markRuntimeStale(
  profile: string | undefined,
  reason: string,
): void {
  profileRuntimeManager.markRuntimeStale(profile, reason);
}

export function markAllRuntimesStale(reason: string): void {
  profileRuntimeManager.markAllRuntimeStale(reason);
}

export function clearRuntimeStale(profile?: string): void {
  profileRuntimeManager.clearRuntimeStale(profile);
}

export function setRuntimeApplyState(
  profile: string | undefined,
  state: RuntimeApplyState,
): void {
  profileRuntimeManager.setRuntimeApplyState(profile, state);
}

export function clearRuntimeApplyState(
  profile: string | undefined,
  source: RuntimeApplySource,
): void {
  profileRuntimeManager.clearRuntimeApplyState(profile, source);
}

export function clearRuntimeStaleIfApplySource(
  profile: string | undefined,
  source: RuntimeApplySource,
  expectedReason?: string,
): void {
  profileRuntimeManager.clearRuntimeStaleIfApplySource(
    profile,
    source,
    expectedReason,
  );
}

export function revalidateRuntime(profile?: string): Promise<boolean> {
  return profileRuntimeManager.revalidateRuntime(profile);
}

import { sendMessageViaApi } from "./chat-api";
import { sendMessageViaCli } from "./chat-cli";
import { isRemoteMode } from "./connection";
import { profileRuntimeManager } from "./runtime";
import { isSyntheticChatStreamEnabled, sendSyntheticChatStream } from "./synthetic-chat";
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
    return sendSyntheticChatStream(message, cb, profile, resumeSessionId, history);
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

  if (runtime.request.profile !== normalizedProfile) {
    throw new Error(
      `Runtime profile ${runtime.request.profile} does not match requested profile ${normalizedProfile}`,
    );
  }

  if (runtime.transport === "api" || runtime.transport === "ssh-api") {
    return sendMessageViaApi(
      message,
      cb,
      normalizedProfile,
      resumeSessionId,
      history,
      runtime,
    );
  }

  if (runtime.transport === "cli") {
    return sendMessageViaCli(message, cb, normalizedProfile, resumeSessionId);
  }

  throw new Error(
    isRemoteMode()
      ? `Verified ${runtime.transport} chat runtime is not available for profile ${normalizedProfile}`
      : `Unsupported chat runtime transport ${runtime.transport}`,
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

export function markRuntimeStale(profile: string | undefined, reason: string): void {
  profileRuntimeManager.markRuntimeStale(profile, reason);
}

export function markAllRuntimesStale(reason: string): void {
  profileRuntimeManager.markAllRuntimeStale(reason);
}

export function clearRuntimeStale(profile?: string): void {
  profileRuntimeManager.clearRuntimeStale(profile);
}

export function revalidateRuntime(profile?: string): Promise<boolean> {
  return profileRuntimeManager.revalidateRuntime(profile);
}

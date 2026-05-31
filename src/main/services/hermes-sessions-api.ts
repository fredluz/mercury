import type { ProfileRuntimeHandle } from "../hermes/types";
import type { SessionMessage } from "../sessions";
import {
  profileHermesBffClientForRuntime,
  type HermesServerSession,
} from "../hermes/bff";

export type { HermesServerSession } from "../hermes/bff";
export {
  cachedSessionFromServerSession,
  normalizeMessage,
  normalizeSession,
  summaryFromServerSession,
} from "../hermes/bff";

function normalizeProfile(profile?: string): string {
  const trimmed = profile?.trim();
  return trimmed && trimmed !== "default" ? trimmed : "default";
}

function sessionsClientForRuntime(runtime: ProfileRuntimeHandle) {
  return profileHermesBffClientForRuntime(
    runtime,
    normalizeProfile(runtime.request.profile),
    "sessions",
  ).sessions;
}

export async function createHermesSession(
  runtime: ProfileRuntimeHandle,
): Promise<HermesServerSession> {
  return sessionsClientForRuntime(runtime).create();
}

export async function readHermesSession(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<HermesServerSession> {
  return sessionsClientForRuntime(runtime).read(sessionId);
}

export async function listHermesSessions(
  runtime: ProfileRuntimeHandle,
): Promise<HermesServerSession[]> {
  return sessionsClientForRuntime(runtime).list();
}

export async function getHermesSessionMessages(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<SessionMessage[]> {
  return sessionsClientForRuntime(runtime).messages(sessionId);
}

export async function forkHermesSession(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<HermesServerSession> {
  return sessionsClientForRuntime(runtime).fork(sessionId);
}

export async function updateHermesSessionTitle(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
  title: string,
): Promise<HermesServerSession> {
  return sessionsClientForRuntime(runtime).updateTitle(sessionId, title);
}

export async function deleteHermesSession(
  runtime: ProfileRuntimeHandle,
  sessionId: string,
): Promise<void> {
  await sessionsClientForRuntime(runtime).delete(sessionId);
}

import { ipcRenderer } from "electron";
import type { SkillTrainingRun, TraceRun } from "../../shared/traces";

export const navigationApi = {
  // Trace Lab
  listTraceRuns: (): Promise<TraceRun[]> =>
    ipcRenderer.invoke("list-trace-runs"),

  getTraceRun: (runId: string): Promise<TraceRun | null> =>
    ipcRenderer.invoke("get-trace-run", runId),

  listSkillTrainingRuns: (): Promise<SkillTrainingRun[]> =>
    ipcRenderer.invoke("list-skill-training-runs"),

  // Gateway
  startGateway: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("start-gateway", profile),
  stopGateway: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("stop-gateway", profile),
  gatewayStatus: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("gateway-status", profile),
  restartGateway: (profile?: string): Promise<boolean> =>
    ipcRenderer.invoke("restart-gateway", profile),

  // Platform toggles
  getPlatformEnabled: (profile?: string): Promise<Record<string, boolean>> =>
    ipcRenderer.invoke("get-platform-enabled", profile),
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-platform-enabled", platform, enabled, profile),

  // Sessions
  listSessions: (
    limit?: number,
    offset?: number,
    profile?: string,
  ): Promise<
    Array<{
      id: string;
      source: string;
      startedAt: number;
      endedAt: number | null;
      messageCount: number;
      model: string;
      title: string | null;
      preview: string;
      profile?: string;
    }>
  > => ipcRenderer.invoke("list-sessions", limit, offset, profile),

  getSessionMessages: (
    sessionId: string,
    profile?: string,
  ): Promise<
    Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }>
  > => ipcRenderer.invoke("get-session-messages", sessionId, profile),

  // Profiles
  listProfiles: (): Promise<
    Array<{
      name: string;
      path: string;
      isDefault: boolean;
      isActive: boolean;
      model: string;
      provider: string;
      hasEnv: boolean;
      hasSoul: boolean;
      skillCount: number;
      gatewayRunning: boolean;
    }>
  > => ipcRenderer.invoke("list-profiles"),

  createProfile: (
    name: string,
    clone: boolean,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("create-profile", name, clone),

  deleteProfile: (
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("delete-profile", name),

  setActiveProfile: (name: string): Promise<boolean> =>
    ipcRenderer.invoke("set-active-profile", name),
};

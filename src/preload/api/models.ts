import { ipcRenderer } from "electron";
import type {
  ModelCapability,
  ModelRoleDefaultsResult,
  ModelRoleId,
  ModelRoleListResult,
  ModelRoleResolution,
  ModelRoleSelection,
} from "../../shared/model-roles";

type SavedModelApiRecord = {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
  contextWindow?: number;
  capabilities?: ModelCapability[];
};

type CodexAuthStatus = {
  hasHermesAuth: boolean;
  hasCodexCliAuth: boolean;
  selectedProvider: string;
  selectedModel: string;
  hermesAuthPath: string;
  codexAuthPath: string;
};

type CodexDeviceAuthStart = {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: number;
};

type CodexDeviceAuthPoll = {
  status: "pending" | "authenticated" | "expired" | "error";
  message?: string;
  provider?: string;
  model?: string;
};

export const modelsApi = {
  // Session cache (fast local cache with generated titles)
  listCachedSessions: (
    limit?: number,
    offset?: number,
    profile?: string,
  ): Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      profile?: string;
    }>
  > => ipcRenderer.invoke("list-cached-sessions", limit, offset, profile),

  syncSessionCache: (
    profile?: string,
  ): Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      profile?: string;
    }>
  > => ipcRenderer.invoke("sync-session-cache", profile),

  updateSessionTitle: (
    sessionId: string,
    title: string,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("update-session-title", sessionId, title, profile),

  // Session search
  searchSessions: (
    query: string,
    limit?: number,
    profile?: string,
  ): Promise<
    Array<{
      sessionId: string;
      title: string | null;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      snippet: string;
      profile?: string;
    }>
  > => ipcRenderer.invoke("search-sessions", query, limit, profile),

  // Codex app-server OAuth
  getCodexAuthStatus: (profile?: string): Promise<CodexAuthStatus> =>
    ipcRenderer.invoke("get-codex-auth-status", profile),
  startCodexDeviceAuth: (): Promise<CodexDeviceAuthStart> =>
    ipcRenderer.invoke("start-codex-device-auth"),
  pollCodexDeviceAuth: (
    sessionId: string,
    profile?: string,
  ): Promise<CodexDeviceAuthPoll> =>
    ipcRenderer.invoke("poll-codex-device-auth", sessionId, profile),
  configureCodexAppServer: (
    profile?: string,
  ): Promise<{ provider: string; model: string }> =>
    ipcRenderer.invoke("configure-codex-app-server", profile),

  // Credential Pool
  getCredentialPool: (): Promise<
    Record<string, Array<{ key: string; label: string }>>
  > => ipcRenderer.invoke("get-credential-pool"),
  setCredentialPool: (
    provider: string,
    entries: Array<{ key: string; label: string }>,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-credential-pool", provider, entries),

  // Models
  listModels: (): Promise<SavedModelApiRecord[]> =>
    ipcRenderer.invoke("list-models"),

  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
    capabilities?: ModelCapability[],
  ): Promise<SavedModelApiRecord> =>
    ipcRenderer.invoke(
      "add-model",
      name,
      provider,
      model,
      baseUrl,
      capabilities,
    ),

  removeModel: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("remove-model", id),

  updateModel: (
    id: string,
    fields: Partial<{
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      contextWindow: number;
      capabilities: ModelCapability[];
    }>,
  ): Promise<boolean> => ipcRenderer.invoke("update-model", id, fields),

  listModelRoles: (profile?: string): Promise<ModelRoleListResult> =>
    ipcRenderer.invoke("list-model-roles", profile),

  getModelRoleDefaults: (profile?: string): Promise<ModelRoleDefaultsResult> =>
    ipcRenderer.invoke("get-model-role-defaults", profile),

  setGlobalModelRoleDefault: (
    role: ModelRoleId,
    selection: Partial<ModelRoleSelection>,
  ): Promise<boolean> =>
    ipcRenderer.invoke("set-global-model-role-default", role, selection),

  setProfileModelRoleOverride: (
    role: ModelRoleId,
    selection: Partial<ModelRoleSelection>,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke(
      "set-profile-model-role-override",
      role,
      selection,
      profile,
    ),

  clearProfileModelRoleOverride: (
    role: ModelRoleId,
    profile?: string,
  ): Promise<boolean> =>
    ipcRenderer.invoke("clear-profile-model-role-override", role, profile),

  resolveModelForRole: (
    role: ModelRoleId,
    profile?: string,
  ): Promise<ModelRoleResolution> =>
    ipcRenderer.invoke("resolve-model-for-role", role, profile),
};

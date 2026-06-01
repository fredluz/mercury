import { ElectronAPI } from "@electron-toolkit/preload";
import type { GenerateChatTitleRequest } from "../shared/chat-metadata";
import type { ChatErrorInfo } from "../shared/codex-auth-recovery";
import type { AppLocale } from "../shared/i18n/types";
import type {
  SkillMarkdownImportRequest,
  SkillMarkdownImportResult,
  SkillMetadata,
  SkillMutationBatchResult,
  SkillMutationTarget,
} from "../shared/skills";
import type {
  MigrationInventory,
  MigrationInventoryOptions,
  MigrationPromptOptions,
} from "../shared/migration";
import type { PerfTelemetryConfig, RendererPerfEvent } from "../shared/perf";
import type {
  RuntimeDebugAgentRequest,
  RuntimeDebugAgentResult,
  RuntimeDiagnostic,
} from "../shared/runtime";
import type {
  CronJob,
  CronMutationResult,
  ScheduleCreatePayload,
  ScheduleUpdatePayload,
} from "../shared/schedules";
import type {
  LocalChatTraceRequest,
  SkillTrainingRun,
  TraceEvent,
  TraceRun,
  TraceScheduleRunSummary,
} from "../shared/traces";
import type { ModelCapability } from "../shared/models";

interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
}

interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

interface HermesAPI {
  // Runtime diagnostics
  getRuntimeDiagnostic: (profile?: string) => Promise<RuntimeDiagnostic>;
  revalidateRuntime: (profile?: string) => Promise<boolean>;
  launchRuntimeDebugAgent: (
    request: RuntimeDebugAgentRequest,
  ) => Promise<RuntimeDebugAgentResult>;

  // Installation
  checkInstall: () => Promise<InstallStatus>;
  verifyInstall: () => Promise<boolean>;
  startInstall: () => Promise<{ success: boolean; error?: string }>;
  onInstallProgress: (
    callback: (progress: InstallProgress) => void,
  ) => () => void;

  // Hermes engine info
  getHermesVersion: () => Promise<string | null>;
  refreshHermesVersion: () => Promise<string | null>;
  runHermesDoctor: () => Promise<string>;
  getHermesApprovedUpdate: () => Promise<{
    currentVersion: string | null;
    recommendedVersion: string | null;
    summary: string | null;
    notesUrl: string | null;
    breakingChange: boolean;
    canUpdate: boolean;
    reason: string;
  }>;
  runHermesUpdate: (
    profile?: string,
    expectedVersion?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Migration inventory / OpenClaw migration
  getMigrationInventory: (
    options?: MigrationInventoryOptions,
  ) => Promise<MigrationInventory>;
  getMigrationPrompt: (options?: MigrationPromptOptions) => Promise<string>;
  checkOpenClaw: () => Promise<{ found: boolean; path: string | null }>;
  runClawMigrate: () => Promise<{ success: boolean; error?: string }>;

  getLocale: () => Promise<AppLocale>;
  setLocale: (locale: AppLocale) => Promise<AppLocale>;

  // Configuration (profile-aware)
  getEnv: (profile?: string) => Promise<Record<string, string>>;
  setEnv: (key: string, value: string, profile?: string) => Promise<boolean>;
  getConfig: (key: string, profile?: string) => Promise<string | null>;
  setConfig: (key: string, value: string, profile?: string) => Promise<boolean>;
  getHermesHome: (profile?: string) => Promise<string>;
  getModelConfig: (
    profile?: string,
  ) => Promise<{ provider: string; model: string; baseUrl: string }>;
  setModelConfig: (
    provider: string,
    model: string,
    baseUrl: string,
    profile?: string,
  ) => Promise<boolean>;

  // Connection mode (local / remote / ssh)
  isRemoteMode: () => Promise<boolean>;
  isRemoteOnlyMode: () => Promise<boolean>;
  getConnectionConfig: () => Promise<{
    mode: "local" | "remote" | "ssh";
    remoteUrl: string;
    apiKey: string;
    ssh: {
      host: string;
      port: number;
      username: string;
      keyPath: string;
      remotePort: number;
      localPort: number;
    };
  }>;
  setConnectionConfig: (
    mode: "local" | "remote" | "ssh",
    remoteUrl: string,
    apiKey?: string,
  ) => Promise<boolean>;
  setSshConfig: (
    host: string,
    port: number,
    username: string,
    keyPath: string,
    remotePort: number,
    localPort: number,
  ) => Promise<boolean>;
  testRemoteConnection: (url: string, apiKey?: string) => Promise<boolean>;
  testSshConnection: (
    host: string,
    port: number,
    username: string,
    keyPath: string,
    remotePort: number,
  ) => Promise<boolean>;
  isSshTunnelActive: (profile?: string) => Promise<boolean>;
  startSshTunnel: (profile?: string) => Promise<boolean>;
  stopSshTunnel: () => Promise<boolean>;

  // Chat
  sendMessage: (
    message: string,
    profile?: string,
    resumeSessionId?: string,
    history?: Array<{ role: string; content: string }>,
  ) => Promise<{ response: string; sessionId?: string }>;
  abortChat: () => Promise<void>;
  resolveChatRunApproval: (request: {
    runId: string;
    choice:
      | "once"
      | "session"
      | "always"
      | "deny"
      | "approve"
      | "approved"
      | "allow";
    profile?: string;
    all?: boolean;
    resolveAll?: boolean;
  }) => Promise<{ runId: string; choice: string; resolved: number }>;
  generateChatTitle: (request: GenerateChatTitleRequest) => Promise<string>;
  recordLocalChatTrace: (request: LocalChatTraceRequest) => Promise<TraceRun>;
  onChatChunk: (callback: (chunk: string) => void) => () => void;
  onChatDone: (callback: (sessionId?: string) => void) => () => void;
  onChatToolProgress: (callback: (tool: string) => void) => () => void;
  onChatTraceEvent: (callback: (event: TraceEvent) => void) => () => void;
  onChatUsage: (
    callback: (usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cost?: number;
      rateLimitRemaining?: number;
      rateLimitReset?: number;
    }) => void,
  ) => () => void;
  onChatError: (
    callback: (error: string, info?: ChatErrorInfo) => void,
  ) => () => void;

  // Trace Lab
  listTraceRuns: () => Promise<TraceRun[]>;
  getTraceRun: (runId: string) => Promise<TraceRun | null>;
  listTraceRunsForSchedule: (
    scheduleId: string,
    profile?: string,
  ) => Promise<TraceScheduleRunSummary[]>;
  listCompletedScheduledRunsSince: (
    timestamp: number,
    profile?: string,
  ) => Promise<TraceScheduleRunSummary[]>;
  listSkillTrainingRuns: () => Promise<SkillTrainingRun[]>;

  // Gateway
  startGateway: (profile?: string) => Promise<boolean>;
  stopGateway: (profile?: string) => Promise<boolean>;
  gatewayStatus: (profile?: string) => Promise<boolean>;
  restartGateway: (profile?: string) => Promise<boolean>;

  // Platform toggles
  getPlatformEnabled: (profile?: string) => Promise<Record<string, boolean>>;
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;

  // Sessions
  listSessions: (
    limit?: number,
    offset?: number,
    profile?: string,
  ) => Promise<
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
  >;
  // prettier-ignore
  getSessionMessages: (sessionId: string, profile?: string) => Promise<
    Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      timestamp: number;
    }>
  >;

  // Profiles
  listProfiles: () => Promise<
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
  >;
  createProfile: (
    name: string,
    clone: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteProfile: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setActiveProfile: (name: string) => Promise<boolean>;

  // Memory
  readMemory: (profile?: string) => Promise<{
    memory: { content: string; exists: boolean; lastModified: number | null };
    user: { content: string; exists: boolean; lastModified: number | null };
    stats: { totalSessions: number; totalMessages: number };
  }>;

  addMemoryEntry: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  updateMemoryEntry: (
    index: number,
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeMemoryEntry: (index: number, profile?: string) => Promise<boolean>;
  writeUserProfile: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Soul
  readSoul: (profile?: string) => Promise<string>;
  writeSoul: (content: string, profile?: string) => Promise<boolean>;
  resetSoul: (profile?: string) => Promise<string>;

  // Tools
  getToolsets: (
    profile?: string,
  ) => Promise<
    Array<{ key: string; label: string; description: string; enabled: boolean }>
  >;
  setToolsetEnabled: (
    key: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;

  // Skills
  listInstalledSkills: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; category: string; description: string; path: string; directoryName: string }>
  >;
  listBundledSkills: () => Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
      directoryName: string;
    }>
  >;
  getSkillContent: (skillPath: string) => Promise<string>;
  getSkillMetadata: (skillPath: string) => Promise<SkillMetadata>;
  installSkill: (
    identifier: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  uninstallSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  mutateSkills: (
    targets: SkillMutationTarget[],
    profile?: string,
  ) => Promise<SkillMutationBatchResult>;
  importSkillMarkdown: (
    request: SkillMarkdownImportRequest,
    profile?: string,
  ) => Promise<SkillMarkdownImportResult>;

  // Session cache
  listCachedSessions: (
    limit?: number,
    offset?: number,
    profile?: string,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      profile?: string;
    }>
  >;
  syncSessionCache: (profile?: string) => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      profile?: string;
    }>
  >;
  updateSessionTitle: (
    sessionId: string,
    title: string,
    profile?: string,
  ) => Promise<boolean>;
  // Session search
  searchSessions: (
    query: string,
    limit?: number,
    profile?: string,
  ) => Promise<
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
  >;

  // Codex app-server OAuth
  getCodexAuthStatus: (profile?: string) => Promise<{
    hasHermesAuth: boolean;
    hasCodexCliAuth: boolean;
    selectedProvider: string;
    selectedModel: string;
    hermesAuthPath: string;
    codexAuthPath: string;
  }>;
  startCodexDeviceAuth: () => Promise<{
    sessionId: string;
    userCode: string;
    verificationUri: string;
    intervalSeconds: number;
    expiresAt: number;
  }>;
  pollCodexDeviceAuth: (
    sessionId: string,
    profile?: string,
  ) => Promise<{
    status: "pending" | "authenticated" | "expired" | "error";
    message?: string;
    provider?: string;
    model?: string;
  }>;
  configureCodexAppServer: (
    profile?: string,
  ) => Promise<{ provider: string; model: string }>;

  // Credential Pool
  getCredentialPool: () => Promise<
    Record<string, Array<{ key: string; label: string }>>
  >;
  setCredentialPool: (
    provider: string,
    entries: Array<{ key: string; label: string }>,
  ) => Promise<boolean>;

  // Models
  listModels: () => Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      createdAt: number;
      contextWindow?: number;
      capabilities?: ModelCapability[];
    }>
  >;
  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
    capabilities?: ModelCapability[],
  ) => Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    createdAt: number;
    contextWindow?: number;
    capabilities?: ModelCapability[];
  }>;
  removeModel: (id: string) => Promise<boolean>;
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
  ) => Promise<boolean>;


  // Updates
  checkForUpdates: () => Promise<string | null>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;

  // Local performance telemetry (opt-in)
  getPerfTelemetryConfig: () => Promise<PerfTelemetryConfig>;
  recordPerfEvent: (event: RendererPerfEvent) => Promise<boolean>;

  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes: string }) => void,
  ) => () => void;
  onUpdateDownloadProgress: (
    callback: (info: { percent: number }) => void,
  ) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  onUpdateNotAvailable: (
    callback: (info: { version: string }) => void,
  ) => () => void;
  onUpdateError: (callback: (message: string) => void) => () => void;

  // Menu events
  onMenuNewChat: (callback: () => void) => () => void;
  onMenuSearchSessions: (callback: () => void) => () => void;

  // Cron Jobs
  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ) => Promise<CronJob[]>;
  createCronJob: (
    schedule: string,
    prompt?: string,
    name?: string,
    deliver?: string,
    profile?: string,
  ) => Promise<CronMutationResult>;
  createScheduleJob: (
    payload: ScheduleCreatePayload,
    profile?: string,
  ) => Promise<CronMutationResult>;
  updateCronJob: (
    jobId: string,
    payload: ScheduleUpdatePayload,
    profile?: string,
  ) => Promise<CronMutationResult>;
  removeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  pauseCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  resumeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  triggerCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Shell
  openExternal: (url: string) => Promise<void>;

  // Backup / Import
  runHermesBackup: (
    profile?: string,
  ) => Promise<{ success: boolean; path?: string; error?: string }>;
  runHermesImport: (
    archivePath: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Debug dump
  runHermesDump: () => Promise<string>;

  // Memory providers
  discoverMemoryProviders: (profile?: string) => Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
      active: boolean;
      envVars: string[];
    }>
  >;

  // MCP servers
  listMcpServers: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; type: string; enabled: boolean; detail: string }>
  >;

  // Log viewer
  readLogs: (
    logFile?: string,
    lines?: number,
    profile?: string,
  ) => Promise<{ content: string; path: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    hermesAPI: HermesAPI;
  }
}

/**
 * Compatibility barrel for SSH-proxied Hermes operations.
 * Domain implementations live under src/main/ssh/*.
 */
export { sshExec } from "./ssh/transport";
export {
  sshListInstalledSkills,
  sshGetSkillContent,
  sshInstallSkill,
  sshUninstallSkill,
  sshImportSkillMarkdown,
  sshSearchSkills,
  sshListBundledSkills,
} from "./ssh/skills";
export {
  sshReadMemory,
  sshAddMemoryEntry,
  sshUpdateMemoryEntry,
  sshRemoveMemoryEntry,
  sshWriteUserProfile,
  sshReadSoul,
  sshWriteSoul,
  sshResetSoul,
} from "./ssh/memory-soul";
export {
  sshGetToolsets,
  sshSetToolsetEnabled,
  sshReadEnv,
  sshSetEnvValue,
  sshGetConfigValue,
  sshSetConfigValue,
  sshGetHermesHome,
  sshGetModelConfig,
  sshSetModelConfig,
} from "./ssh/config";
export {
  sshListSessions,
  sshGetSessionMessages,
  sshSearchSessions,
  sshListProfiles,
  sshCreateProfile,
  sshDeleteProfile,
  type SshProfileInfo,
} from "./ssh/sessions-profiles";
export {
  buildSshHermesProfileCommand,
  parseMcpServersFromConfig,
  sshGatewayStatus,
  sshStartGateway,
  sshStopGateway,
  sshReadRemoteApiKey,
  sshGetHermesVersion,
  sshReadLogs,
  sshListMcpServers,
  sshGetPlatformEnabled,
  sshSetPlatformEnabled,
  sshListCachedSessions,
  sshRunDoctor,
  sshRunUpdate,
  sshRunDump,
  sshDiscoverMemoryProviders,
  sshListModels,
  sshSaveModels,
} from "./ssh/runtime";

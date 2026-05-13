/** Compatibility barrel for Hermes install/update/maintenance services. */
export {
  HERMES_HOME,
  HERMES_REPO,
  HERMES_VENV,
  HERMES_PYTHON,
  HERMES_SCRIPT,
  HERMES_ENV_FILE,
  HERMES_CONFIG_FILE,
  HERMES_AUTH_FILE,
  getEnhancedPath,
  hasHermesAuthCredential,
  checkInstallStatus,
  verifyInstall,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  checkOpenClawExists,
  type InstallStatus,
  type InstallProgress,
} from "./install/paths";
export { runClawMigrate, runHermesUpdate, runInstall } from "./install/executor";
export { runHermesBackup, runHermesImport, runHermesDump } from "./install/maintenance";
export {
  discoverMemoryProviders,
  getActiveMemoryProvider,
  listMcpServers,
  readLogs,
  type MemoryProviderInfo,
} from "./install/introspection";

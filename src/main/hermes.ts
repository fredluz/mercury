/** Compatibility barrel for Hermes chat and gateway services. */
export {
  getApiUrl,
  isRemoteMode,
  isRemoteOnlyMode,
  setSshRemoteApiKey,
  getRemoteAuthHeader,
  ensureSshTunnelIfNeeded,
  testRemoteConnection,
} from "./hermes/connection";
export {
  type ChatCallbacks,
  type ProfileRuntimeHandle,
  type ProfileRuntimeRequest,
  type RuntimeIdentity,
  ProfileRuntimeError,
} from "./hermes/types";
export {
  sendMessage,
  stopHealthPolling,
  startGateway,
  stopGateway,
  stopAllGateways,
  isGatewayRunning,
  isApiReady,
  restartGateway,
  getRuntimeIdentity,
  getRuntimeDiagnostic,
  getGatewayDetailedHealth,
  markRuntimeStale,
  markAllRuntimesStale,
  clearRuntimeStale,
  setRuntimeApplyState,
  clearRuntimeApplyState,
  clearRuntimeStaleIfApplySource,
  revalidateRuntime,
} from "./hermes/gateway";

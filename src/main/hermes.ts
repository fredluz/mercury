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
export { type ChatCallbacks } from "./hermes/types";
export {
  sendMessage,
  stopHealthPolling,
  startGateway,
  stopGateway,
  isGatewayRunning,
  isApiReady,
  restartGateway,
} from "./hermes/gateway";

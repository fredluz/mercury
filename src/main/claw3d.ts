/** Compatibility barrel for Claw3D configuration, setup, and runtime control. */
export {
  setClaw3dPort,
  getClaw3dPort,
  setClaw3dWsUrl,
  getClaw3dWsUrl,
  getClaw3dStatus,
  type Claw3dStatus,
  type Claw3dSetupProgress,
} from "./claw3d/config";
export { setupClaw3d } from "./claw3d/setup";
export { startDevServer, stopDevServer, startAdapter, stopAdapter, startAll, stopAll, getClaw3dLogs } from "./claw3d/runtime";

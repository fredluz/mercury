export { defaultLocalApiPortForProfile } from "./connection";
export { buildHermesProfileCommandArgs } from "./runtime/command";
export {
  ProfileRuntimeManager,
  type ProfileRuntimeManagerDeps,
} from "./runtime/manager";
import { ProfileRuntimeManager } from "./runtime/manager";

export const profileRuntimeManager = new ProfileRuntimeManager();

import { registerInstallIpc } from "./install";
import { registerConfigIpc } from "./config";
import { registerChatIpc } from "./chat";
import { registerTraceIpc } from "./trace";
import { registerGatewayIpc } from "./gateway";
import { registerSessionsIpc } from "./sessions";
import { registerKnowledgeIpc } from "./knowledge";
import { registerModelsIpc } from "./models";
import { registerClaw3dIpc } from "./claw3d";
import { registerCronIpc } from "./cron";
import { registerSystemIpc } from "./system";
import type { IpcRegistrationContext } from "./types";

export function registerIpcHandlers(context: IpcRegistrationContext): void {
  registerInstallIpc(context);
  registerConfigIpc();
  registerChatIpc(context);
  registerTraceIpc();
  registerGatewayIpc();
  registerSessionsIpc();
  registerKnowledgeIpc();
  registerModelsIpc();
  registerClaw3dIpc();
  registerCronIpc();
  registerSystemIpc();
}

export { abortActiveChat } from "./chat";

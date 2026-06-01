import { registerInstallIpc } from "./install";
import { registerConfigIpc } from "./config";
import { registerChatIpc } from "./chat";
import { registerTraceIpc } from "./trace";
import { registerGatewayIpc } from "./gateway";
import { registerSessionsIpc } from "./sessions";
import { registerKnowledgeIpc } from "./knowledge";
import { registerModelsIpc } from "./models";
import { registerCronIpc } from "./cron";
import { registerSystemIpc } from "./system";
import { registerAgentsIpc } from "./agents";
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
  registerCronIpc();
  registerSystemIpc();
  registerAgentsIpc(context);
}

export { abortActiveChat } from "./chat";

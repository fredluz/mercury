import { installApi } from "./install";
import { configApi } from "./config";
import { chatApi } from "./chat";
import { navigationApi } from "./navigation";
import { knowledgeApi } from "./knowledge";
import { modelsApi } from "./models";
import { appApi } from "./app";
import { agentsApi } from "./agents";

export const hermesAPI = {
  ...installApi,
  ...configApi,
  ...chatApi,
  ...navigationApi,
  ...knowledgeApi,
  ...modelsApi,
  ...appApi,
  ...agentsApi,
};

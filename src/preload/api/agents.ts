import { ipcRenderer } from "electron";
import type {
  AgentCommitRequest,
  AgentCommitResult,
  AgentCreationDraft,
  AgentDraftChangeEvent,
  AgentDraftMutationRequest,
  AgentDraftMutationResult,
  CreateAgentDraftRequest,
} from "../../shared/agents";

export const agentsApi = {
  createAgentDraft: (
    request?: CreateAgentDraftRequest,
  ): Promise<AgentCreationDraft> =>
    ipcRenderer.invoke("create-agent-draft", request),

  getAgentDraft: (draftId: string): Promise<AgentCreationDraft | null> =>
    ipcRenderer.invoke("get-agent-draft", draftId),

  updateAgentDraft: (
    request: AgentDraftMutationRequest,
  ): Promise<AgentDraftMutationResult> =>
    ipcRenderer.invoke("update-agent-draft", request),

  abandonAgentDraft: (
    draftId: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("abandon-agent-draft", draftId),

  commitAgentDraft: (request: AgentCommitRequest): Promise<AgentCommitResult> =>
    ipcRenderer.invoke("commit-agent-draft", request),

  onAgentDraftChanged: (
    callback: (event: AgentDraftChangeEvent) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      draftEvent: AgentDraftChangeEvent,
    ): void => callback(draftEvent);
    ipcRenderer.on("agent-draft-changed", handler);
    return () => ipcRenderer.removeListener("agent-draft-changed", handler);
  },
};

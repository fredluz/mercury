import { ipcRenderer } from "electron";
import type {
  AgentAvatarDataUrlResult,
  AgentAvatarMutationResult,
  AgentCommitRequest,
  AgentCommitResult,
  AgentCreationDraft,
  AgentDraftChangeEvent,
  AgentDraftMutationRequest,
  AgentDraftMutationResult,
  AttachAgentSeedSkillRequest,
  AttachAgentSeedSkillResult,
  ClearAgentAvatarRequest,
  CreateAgentDraftRequest,
  SetAgentAvatarRequest,
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

  attachAgentSeedSkill: (
    request: AttachAgentSeedSkillRequest,
  ): Promise<AttachAgentSeedSkillResult> =>
    ipcRenderer.invoke("attach-agent-seed-skill", request),

  abandonAgentDraft: (
    draftId: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("abandon-agent-draft", draftId),

  commitAgentDraft: (request: AgentCommitRequest): Promise<AgentCommitResult> =>
    ipcRenderer.invoke("commit-agent-draft", request),

  getAgentAvatarDataUrl: (profile: string): Promise<AgentAvatarDataUrlResult> =>
    ipcRenderer.invoke("get-agent-avatar-data-url", profile),

  setAgentAvatar: (
    request: SetAgentAvatarRequest,
  ): Promise<AgentAvatarMutationResult> =>
    ipcRenderer.invoke("set-agent-avatar", request),

  clearAgentAvatar: (
    request: ClearAgentAvatarRequest,
  ): Promise<AgentAvatarMutationResult> =>
    ipcRenderer.invoke("clear-agent-avatar", request),

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

import { ipcMain, type WebContents } from "electron";
import type { AgentCommitRequest } from "../../shared/agents";
import type { IpcRegistrationContext } from "./types";
import {
  abandonAgentDraft,
  commitAgentDraft,
  createAgentDraft,
  getAgentDraft,
  updateAgentDraft,
} from "../services/agents-service";

function reportBestEffortFailure(label: string, error: unknown): void {
  console.warn(`[agents-ipc] Non-critical ${label} failed`, error);
}

function safeSend(sender: WebContents, channel: string, ...args: unknown[]): void {
  if (sender.isDestroyed()) return;
  try {
    sender.send(channel, ...args);
  } catch (error) {
    reportBestEffortFailure(`IPC send ${channel}`, error);
  }
}

export function registerAgentsIpc({ getMainWindow: _getMainWindow }: IpcRegistrationContext): void {
  ipcMain.handle("create-agent-draft", (_event, request?: unknown) =>
    createAgentDraft(
      request && typeof request === "object"
        ? (request as { draftId?: string; displayName?: string; profileId?: string })
        : {},
    ),
  );
  ipcMain.handle("get-agent-draft", (_event, draftId: string) =>
    getAgentDraft(draftId),
  );
  ipcMain.handle("update-agent-draft", (event, request: unknown) =>
    updateAgentDraft(request, {
      onChange: (draftEvent) =>
        safeSend(event.sender, "agent-draft-changed", draftEvent),
    }),
  );
  ipcMain.handle("abandon-agent-draft", (event, draftId: string) =>
    abandonAgentDraft(draftId, {
      onChange: (draftEvent) =>
        safeSend(event.sender, "agent-draft-changed", draftEvent),
    }),
  );
  ipcMain.handle("commit-agent-draft", (_event, request: AgentCommitRequest) =>
    commitAgentDraft(request),
  );
}

import { getConnectionConfig, getCredentialPool } from "../config";
import { listModels } from "../models";
import { sshListModels } from "../ssh-remote";

export function listModelsForConnection() {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshListModels(conn.ssh);
  return listModels();
}

export function getCredentialPoolForConnection() {
  return getCredentialPool();
}

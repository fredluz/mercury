import { randomUUID } from "crypto";
import { getConnectionConfig, getCredentialPool } from "../config";
import {
  addModel,
  listModels,
  normalizeSavedModel,
  removeModel,
  updateModel,
  type SavedModel,
  type SavedModelUpdateFields,
} from "../models";
import { sshListModels, sshSaveModels } from "../ssh-remote";
import { inferContextWindow } from "../../shared/chat-metadata";
import { normalizeModelCapabilities, type ModelCapability } from "../../shared/model-roles";

export async function listModelsForConnection(): Promise<SavedModel[]> {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) {
    const models = await sshListModels(conn.ssh);
    return models.map((model) => normalizeSavedModel(model));
  }
  return listModels();
}

export async function addModelForConnection(
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
  capabilities?: ModelCapability[],
): Promise<SavedModel> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) {
    return addModel(name, provider, model, baseUrl, capabilities);
  }

  const models = (await sshListModels(conn.ssh)).map((entry) => normalizeSavedModel(entry));
  const existing = models.find((entry) => entry.model === model && entry.provider === provider);
  if (existing) return existing;

  const entry: SavedModel = normalizeSavedModel({
    id: randomUUID(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
    contextWindow: inferContextWindow(provider, model).tokens,
    capabilities: normalizeModelCapabilities(capabilities),
  });
  models.push(entry);
  await sshSaveModels(conn.ssh, models);
  return entry;
}

export async function removeModelForConnection(id: string): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return removeModel(id);

  const models = (await sshListModels(conn.ssh)).map((entry) => normalizeSavedModel(entry));
  const filtered = models.filter((entry) => entry.id !== id);
  if (filtered.length === models.length) return false;
  await sshSaveModels(conn.ssh, filtered);
  return true;
}

export async function updateModelForConnection(
  id: string,
  fields: SavedModelUpdateFields,
): Promise<boolean> {
  const conn = getConnectionConfig();
  if (conn.mode !== "ssh" || !conn.ssh) return updateModel(id, fields);

  const models = (await sshListModels(conn.ssh)).map((entry) => normalizeSavedModel(entry));
  const idx = models.findIndex((entry) => entry.id === id);
  if (idx === -1) return false;
  const modelChanged = fields.provider !== undefined || fields.model !== undefined;
  const contextWindowProvided = Object.prototype.hasOwnProperty.call(fields, "contextWindow");
  const nextModel = { ...models[idx], ...fields };
  if (modelChanged && !contextWindowProvided) delete nextModel.contextWindow;
  models[idx] = normalizeSavedModel(nextModel);
  await sshSaveModels(conn.ssh, models);
  return true;
}

export function getCredentialPoolForConnection() {
  return getCredentialPool();
}

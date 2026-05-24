import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";
import { inferContextWindow } from "../shared/chat-metadata";
import {
  normalizeModelCapabilities,
  type ModelCapability,
} from "../shared/models";

const MODELS_FILE = join(HERMES_HOME, "models.json");

export interface SavedModel {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
  contextWindow?: number;
  capabilities?: ModelCapability[];
}

export type SavedModelUpdateFields = Partial<
  Pick<
    SavedModel,
    "name" | "provider" | "model" | "baseUrl" | "contextWindow" | "capabilities"
  >
>;

export function normalizeSavedModel(model: SavedModel): SavedModel {
  return {
    ...model,
    contextWindow: inferContextWindow(
      model.provider,
      model.model,
      model.contextWindow,
    ).tokens,
    capabilities: normalizeModelCapabilities(model.capabilities),
  };
}

function normalizeModel(model: SavedModel): SavedModel {
  return normalizeSavedModel(model);
}

function readModels(): SavedModel[] {
  try {
    if (!existsSync(MODELS_FILE)) return [];
    const parsed = JSON.parse(readFileSync(MODELS_FILE, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((model) => normalizeModel(model as SavedModel));
  } catch {
    return [];
  }
}

function writeModels(models: SavedModel[]): void {
  safeWriteFile(MODELS_FILE, JSON.stringify(models, null, 2));
}

export function listModels(): SavedModel[] {
  return readModels().map(normalizeModel);
}

export function addModel(
  name: string,
  provider: string,
  model: string,
  baseUrl: string,
  capabilities?: ModelCapability[],
): SavedModel {
  const models = readModels();

  // Dedup: if same model ID + provider exists, return existing
  const existing = models.find(
    (m) => m.model === model && m.provider === provider,
  );
  if (existing) return existing;

  const entry: SavedModel = {
    id: randomUUID(),
    name,
    provider,
    model,
    baseUrl: baseUrl || "",
    createdAt: Date.now(),
    contextWindow: inferContextWindow(provider, model).tokens,
    capabilities: normalizeModelCapabilities(capabilities),
  };
  models.push(entry);
  writeModels(models);
  return entry;
}

export function removeModel(id: string): boolean {
  const models = readModels();
  const filtered = models.filter((m) => m.id !== id);
  if (filtered.length === models.length) return false;
  writeModels(filtered);
  return true;
}

export function updateModel(
  id: string,
  fields: SavedModelUpdateFields,
): boolean {
  const models = readModels();
  const idx = models.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  const modelChanged =
    fields.provider !== undefined || fields.model !== undefined;
  const contextWindowProvided = Object.prototype.hasOwnProperty.call(
    fields,
    "contextWindow",
  );
  const nextModel = { ...models[idx], ...fields };
  if (modelChanged && !contextWindowProvided) {
    delete nextModel.contextWindow;
  }
  models[idx] = normalizeModel(nextModel);
  writeModels(models);
  return true;
}

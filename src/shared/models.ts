export type ModelCapability = "text" | "image_input" | "codex_image_gen";

const CAPABILITIES = new Set<ModelCapability>([
  "text",
  "image_input",
  "codex_image_gen",
]);

export function isModelCapability(value: unknown): value is ModelCapability {
  return typeof value === "string" && CAPABILITIES.has(value as ModelCapability);
}

export function normalizeModelCapabilities(value: unknown): ModelCapability[] {
  if (!Array.isArray(value)) return ["text"];
  const result = value.filter(isModelCapability);
  return result.length > 0 ? [...new Set(result)] : ["text"];
}

export interface SavedModelDescriptor {
  id: string;
  name: string;
  provider: string;
  model: string;
  baseUrl: string;
  createdAt: number;
  contextWindow?: number;
  capabilities?: ModelCapability[];
}

export type ModelInventoryAvailabilitySource =
  | "runtime-api"
  | "local-metadata"
  | "ssh-metadata"
  | "unavailable";

export interface ModelInventoryAvailability {
  ok: boolean;
  source: ModelInventoryAvailabilitySource;
  refreshedAt: number;
  error?: string;
}

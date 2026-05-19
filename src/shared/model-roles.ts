export const MODEL_ROLE_IDS = [
  "chat",
  "plan",
  "code",
  "explore",
  "research",
  "review",
  "design",
  "image",
] as const;

export type ModelRoleId = (typeof MODEL_ROLE_IDS)[number];

export const TEXT_MODEL_ROLE_IDS = MODEL_ROLE_IDS.filter(
  (role): role is Exclude<ModelRoleId, "image"> => role !== "image",
);

export type TextModelRoleId = (typeof TEXT_MODEL_ROLE_IDS)[number];

export type ModelCapability = "text" | "image_input" | "codex_image_gen";
export type ModelRoleScope = "global" | "profile";
export type ImageRoleMode = "codex_builtin_image_gen" | "codex_imagegen_skill";

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

export interface ModelRoleSelection {
  role: ModelRoleId;
  modelId?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  contextWindow?: number;
  capabilities?: ModelCapability[];
  imageMode?: ImageRoleMode;
  updatedAt: number;
}

export interface ModelRoleDefault extends ModelRoleSelection {
  scope: ModelRoleScope;
  profile?: string;
}

export type ModelRoleResolutionSource =
  | "profile-override"
  | "global-default"
  | "role-fallback"
  | "legacy-chat-config"
  | "provider-auto"
  | "missing-model"
  | "image-capability";

export interface ResolvedTextModelRole {
  role: TextModelRoleId;
  kind: "text";
  ok: true;
  source: ModelRoleResolutionSource;
  provider: string;
  model: string;
  baseUrl: string;
  contextWindow: number;
  capabilities: ModelCapability[];
  modelId?: string;
  missingModelId?: string;
}

export interface ResolvedImageModelRole {
  role: "image";
  kind: "image";
  ok: boolean;
  source: "image-capability";
  imageMode?: ImageRoleMode;
  provider?: "openai-codex";
  model?: string;
  toolsetEnabled: boolean;
  providerConfigured: boolean;
  credentialAvailable: boolean;
  reason?: string;
}

export type ModelRoleResolution = ResolvedTextModelRole | ResolvedImageModelRole;

export interface ModelRoleEntry {
  id: ModelRoleId;
  nameKey: string;
  descriptionKey: string;
  global?: ModelRoleDefault;
  profileOverride?: ModelRoleDefault;
  resolved: ModelRoleResolution;
}

export interface ModelRoleDefaultsResult {
  global: Partial<Record<ModelRoleId, ModelRoleDefault>>;
  profileOverrides: Partial<Record<ModelRoleId, ModelRoleDefault>>;
  resolved: Partial<Record<ModelRoleId, ModelRoleResolution>>;
}

export interface ModelRoleListResult {
  roles: ModelRoleEntry[];
  savedModels: SavedModelDescriptor[];
  imageCapability: ResolvedImageModelRole;
}

export interface ModelRolesFile {
  version: 1;
  defaults: Partial<Record<ModelRoleId, ModelRoleSelection>>;
}

export const MODEL_ROLES: ReadonlyArray<{
  id: ModelRoleId;
  nameKey: string;
  descriptionKey: string;
}> = MODEL_ROLE_IDS.map((id) => ({
  id,
  nameKey: `models.roles.${id}.name`,
  descriptionKey: `models.roles.${id}.description`,
}));

export const MODEL_ROLE_FALLBACKS: Record<ModelRoleId, readonly ModelRoleId[]> = {
  chat: ["chat"],
  plan: ["plan", "chat"],
  code: ["code", "chat"],
  explore: ["explore", "code", "chat"],
  research: ["research", "chat"],
  review: ["review", "code", "chat"],
  design: ["design", "chat"],
  image: ["image"],
};

const CAPABILITIES = new Set<ModelCapability>([
  "text",
  "image_input",
  "codex_image_gen",
]);

export function isModelRoleId(value: unknown): value is ModelRoleId {
  return typeof value === "string" && MODEL_ROLE_IDS.includes(value as ModelRoleId);
}

export function isTextModelRoleId(value: unknown): value is TextModelRoleId {
  return typeof value === "string" && TEXT_MODEL_ROLE_IDS.includes(value as TextModelRoleId);
}

export function isModelCapability(value: unknown): value is ModelCapability {
  return typeof value === "string" && CAPABILITIES.has(value as ModelCapability);
}

export function normalizeModelCapabilities(value: unknown): ModelCapability[] {
  if (!Array.isArray(value)) return ["text"];
  const result = value.filter(isModelCapability);
  return result.length > 0 ? [...new Set(result)] : ["text"];
}

export function getModelRoleFallbackChain(role: ModelRoleId): readonly ModelRoleId[] {
  return MODEL_ROLE_FALLBACKS[role];
}

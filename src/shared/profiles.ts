import type { AgentDocsPointerSelection } from "./agents";

export type ProfileKind = "builtin" | "custom";

export const AGENT_AVATAR_FILE_NAME = "avatar.png";
export const AGENT_AVATAR_CONTENT_TYPE = "image/png";
export const AGENT_AVATAR_MAX_BYTES = 256 * 1024;

export interface ProfileAvatarMetadata {
  path: typeof AGENT_AVATAR_FILE_NAME;
  contentType: typeof AGENT_AVATAR_CONTENT_TYPE;
  updatedAt: string;
  byteLength?: number;
}

export interface ProfileAgentMetadata {
  version: 1;
  displayName?: string;
  description?: string;
  selectedPackIds?: string[];
  docsPointers?: AgentDocsPointerSelection[];
  avatar?: ProfileAvatarMetadata;
}

export interface ProfileInfo {
  name: string;
  path: string;
  isDefault: boolean;
  isActive: boolean;
  model: string;
  provider: string;
  hasEnv: boolean;
  hasSoul: boolean;
  skillCount: number;
  gatewayRunning: boolean;
  displayName: string;
  kind: ProfileKind;
  immutable: boolean;
  deletable: boolean;
  selectedPackIds: string[];
  docsPointers: AgentDocsPointerSelection[];
  avatar?: ProfileAvatarMetadata;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

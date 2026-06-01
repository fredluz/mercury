import type { AgentDocsPointerSelection } from "./agents";

export type ProfileKind = "builtin" | "custom";

export interface ProfileAgentMetadata {
  version: 1;
  displayName?: string;
  description?: string;
  selectedPackIds?: string[];
  docsPointers?: AgentDocsPointerSelection[];
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
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}

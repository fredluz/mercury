import type { AgentDocsPointerSelection } from "./agents";
import type { SkillMutationTarget } from "./skills";

export type AgentPackMember =
  | AgentPackSkillMember
  | AgentPackToolMember
  | AgentPackDocsPointerMember;

export interface AgentPackSkillMember {
  kind: "skill";
  name: string;
  category: string;
  directoryName: string;
}

export interface AgentPackToolMember {
  kind: "tool";
  key: string;
}

export interface AgentPackDocsPointerMember extends AgentDocsPointerSelection {
  kind: "docs-pointer";
}

export interface AgentPackSummary {
  id: string;
  displayName: string;
  description?: string;
  memberCount: number;
}

export interface AgentPackDefinition {
  id: string;
  displayName: string;
  description?: string;
  members: AgentPackMember[];
}

export interface AgentPackMembership {
  packId: string;
  selectedAt: string;
}

export type AgentPackSelectionState = "off" | "partial" | "on";

export interface ExpandedAgentPackSelection {
  packIds: string[];
  skillTargets: SkillMutationTarget[];
  toolKeys: string[];
  docsPointers: AgentDocsPointerSelection[];
}

export const DEFAULT_AGENT_PACK_ID = "default";
export const DEFAULT_AGENT_PACK_IDS = [DEFAULT_AGENT_PACK_ID] as const;

/**
 * The v1 lean baseline: core agent tools without media/automation extras.
 * It is represented as an ordinary pack so users can trim it like any other pack.
 */
export const DEFAULT_BASELINE_TOOL_KEYS = [
  "web",
  "browser",
  "terminal",
  "file",
  "code_execution",
  "vision",
  "skills",
  "memory",
  "session_search",
  "clarify",
  "delegation",
] as const;

export const UNASSIGNED_SKILL_DIRECTORY_KEYS = [
  "dogfood/dogfood",
  "mlops/evaluation/lm-evaluation-harness",
  "mlops/evaluation/weights-and-biases",
  "mlops/inference/llama-cpp",
  "mlops/inference/obliteratus",
  "mlops/inference/vllm",
  "mlops/models/audiocraft",
  "mlops/models/segment-anything",
  "mlops/research/dspy",
  "yuanbao/yuanbao",
] as const;

const skill = (
  category: string,
  directoryName: string,
  name = directoryName,
): AgentPackSkillMember => ({ kind: "skill", name, category, directoryName });

const tool = (key: string): AgentPackToolMember => ({ kind: "tool", key });

const docsPointer = (
  id: string,
  title: string,
  path?: string,
  url?: string,
): AgentPackDocsPointerMember => ({
  kind: "docs-pointer",
  id,
  title,
  ...(path ? { path } : {}),
  ...(url ? { url } : {}),
});

export const AGENT_PACK_CATALOG: AgentPackDefinition[] = [
  {
    id: "default",
    displayName: "Default",
    description:
      "Lean baseline skills and core tools for a generally capable agent.",
    members: [
      ...DEFAULT_BASELINE_TOOL_KEYS.map(tool),
      skill("devops", "kanban-orchestrator"),
      skill("devops", "kanban-worker"),
      skill("mcp", "native-mcp"),
      skill("software-development", "debugging-hermes-tui-commands"),
      skill("software-development", "hermes-agent-skill-authoring"),
      skill("software-development", "hermes-s6-container-supervision"),
      skill("software-development", "plan"),
      docsPointer(
        "default-baseline-docs",
        "Default baseline skill and profile behavior",
        "docs/subsystems/skills.md",
      ),
    ],
  },
  {
    id: "apple",
    displayName: "Apple",
    description: "Apple productivity and personal-device integrations.",
    members: [
      skill("apple", "apple-notes"),
      skill("apple", "apple-reminders"),
      skill("apple", "findmy"),
      skill("apple", "imessage"),
    ],
  },
  {
    id: "computer-use",
    displayName: "Computer Use",
    description:
      "macOS computer-control skill. Tool binding remains pending until a stable tool key exists.",
    members: [skill("apple", "macos-computer-use")],
  },
  {
    id: "coding",
    displayName: "Coding",
    description:
      "Autonomous coding, GitHub, debugging, and implementation workflows.",
    members: [
      skill("autonomous-ai-agents", "claude-code"),
      skill("autonomous-ai-agents", "codex"),
      skill("autonomous-ai-agents", "hermes-agent"),
      skill("autonomous-ai-agents", "kanban-codex-lane"),
      skill("autonomous-ai-agents", "opencode"),
      skill("creative", "p5js"),
      skill("data-science", "jupyter-live-kernel"),
      skill("github", "codebase-inspection"),
      skill("github", "github-auth"),
      skill("github", "github-code-review"),
      skill("github", "github-issues"),
      skill("github", "github-pr-workflow"),
      skill("github", "github-repo-management"),
      skill("software-development", "node-inspect-debugger"),
      skill("software-development", "python-debugpy"),
      skill("software-development", "requesting-code-review"),
      skill("software-development", "spike"),
      skill("software-development", "subagent-driven-development"),
      skill("software-development", "systematic-debugging"),
      skill("software-development", "test-driven-development"),
      skill("software-development", "writing-plans"),
    ],
  },
  {
    id: "architecture",
    displayName: "Architecture",
    description: "Architecture diagrams and collaborative system sketching.",
    members: [
      skill("creative", "architecture-diagram"),
      skill("creative", "excalidraw"),
    ],
  },
  {
    id: "design",
    displayName: "Design",
    description: "Visual design, sketching, and web-design references.",
    members: [
      skill("creative", "ascii-art"),
      skill("creative", "claude-design"),
      skill("creative", "design-md"),
      skill("creative", "popular-web-designs"),
      skill("creative", "sketch"),
    ],
  },
  {
    id: "image-generation",
    displayName: "Image Generation",
    description: "Illustration, comics, infographics, ComfyUI, and pixel art.",
    members: [
      tool("image_gen"),
      skill("creative", "baoyu-article-illustrator"),
      skill("creative", "baoyu-comic"),
      skill("creative", "baoyu-infographic"),
      skill("creative", "comfyui"),
      skill("creative", "pixel-art"),
    ],
  },
  {
    id: "video-making",
    displayName: "Video Making",
    description: "Video generation and creative coding visuals.",
    members: [
      skill("creative", "comfyui"),
      skill("creative", "manim-video"),
      skill("creative", "p5js"),
    ],
  },
  {
    id: "writing",
    displayName: "Writing",
    description: "Humanized writing assistance.",
    members: [skill("creative", "humanizer")],
  },
  {
    id: "ideation",
    displayName: "Ideation",
    description: "Creative ideation workflows.",
    members: [skill("creative", "creative-ideation", "ideation")],
  },
  {
    id: "mercury",
    displayName: "Mercury",
    description: "Mercury-specific automation and app integration behaviors.",
    members: [
      skill("devops", "webhook-subscriptions"),
      docsPointer(
        "mercury-agent-storage-docs",
        "Mercury agent storage and profile model",
        "docs/subsystems/storage-and-profiles.md",
      ),
    ],
  },
  {
    id: "inspector-gadget",
    displayName: "Inspector Gadget",
    description: "Media, games, smart-home, and prediction-market utilities.",
    members: [
      skill("creative", "songwriting-and-ai-music"),
      skill("gaming", "minecraft-modpack-server"),
      skill("gaming", "pokemon-player"),
      skill("media", "gif-search"),
      skill("media", "heartmula"),
      skill("media", "songsee"),
      skill("media", "spotify"),
      skill("research", "polymarket"),
      skill("smart-home", "openhue"),
    ],
  },
  {
    id: "research",
    displayName: "Research",
    description: "Web, YouTube, arXiv, blog watching, and LLM wiki research.",
    members: [
      tool("web"),
      skill("media", "youtube-content"),
      skill("research", "arxiv"),
      skill("research", "blogwatcher"),
      skill("research", "llm-wiki"),
    ],
  },
  independentPack("ascii-video", "ASCII Video", "creative", "ascii-video"),
  independentPack("pretext", "Pretext", "creative", "pretext"),
  independentPack(
    "touchdesigner-mcp",
    "TouchDesigner MCP",
    "creative",
    "touchdesigner-mcp",
  ),
  independentPack("himalaya", "Himalaya", "email", "himalaya"),
  independentPack(
    "huggingface-hub",
    "Hugging Face Hub",
    "mlops",
    "huggingface-hub",
  ),
  independentPack("obsidian", "Obsidian", "note-taking", "obsidian"),
  independentPack("airtable", "Airtable", "productivity", "airtable"),
  independentPack(
    "google-workspace",
    "Google Workspace",
    "productivity",
    "google-workspace",
  ),
  independentPack("linear", "Linear", "productivity", "linear"),
  independentPack("maps", "Maps", "productivity", "maps"),
  independentPack("nano-pdf", "Nano PDF", "productivity", "nano-pdf"),
  independentPack("notion", "Notion", "productivity", "notion"),
  independentPack(
    "ocr-and-documents",
    "OCR and Documents",
    "productivity",
    "ocr-and-documents",
  ),
  independentPack("powerpoint", "PowerPoint", "productivity", "powerpoint"),
  independentPack(
    "teams-meeting-pipeline",
    "Teams Meeting Pipeline",
    "productivity",
    "teams-meeting-pipeline",
  ),
  independentPack("god-mode", "God Mode", "red-teaming", "godmode"),
  independentPack(
    "research-paper-writing",
    "Research Paper Writing",
    "research",
    "research-paper-writing",
  ),
  independentPack("xurl", "XURL", "social-media", "xurl"),
];

function independentPack(
  id: string,
  displayName: string,
  category: string,
  directoryName: string,
  name = directoryName,
): AgentPackDefinition {
  return {
    id,
    displayName,
    description: "Independent one-skill pack.",
    members: [skill(category, directoryName, name)],
  };
}

/**
 * Presentation hints for the agent-creator Capabilities step. Keyed by pack id;
 * packs without an explicit hint fall back to a generic icon and their first
 * member's category. This keeps {@link AGENT_PACK_CATALOG} the single source of
 * truth while letting the UI render category-flavoured cards.
 */
export type AgentPackIconKey =
  | "search"
  | "pencil"
  | "code"
  | "chart"
  | "puzzle";

export interface AgentPackPresentation {
  icon: AgentPackIconKey;
  category: string;
}

const PACK_PRESENTATION: Record<string, AgentPackPresentation> = {
  research: { icon: "search", category: "research" },
  "research-paper-writing": { icon: "search", category: "research" },
  writing: { icon: "pencil", category: "writing" },
  ideation: { icon: "pencil", category: "writing" },
  coding: { icon: "code", category: "engineering" },
  architecture: { icon: "code", category: "engineering" },
  design: { icon: "pencil", category: "design" },
  "image-generation": { icon: "chart", category: "creative" },
  "video-making": { icon: "chart", category: "creative" },
};

export function agentPackPresentation(
  pack: AgentPackDefinition,
): AgentPackPresentation {
  const explicit = PACK_PRESENTATION[pack.id];
  if (explicit) return explicit;
  const firstSkill = pack.members.find((member) => member.kind === "skill");
  const category =
    firstSkill && firstSkill.kind === "skill" ? firstSkill.category : "general";
  return { icon: "puzzle", category };
}

/** A short, human-readable label for an individual pack member. */
export function agentPackMemberLabel(member: AgentPackMember): string {
  switch (member.kind) {
    case "skill":
      return member.name || member.directoryName;
    case "tool":
      return member.key;
    case "docs-pointer":
      return member.title;
  }
}

/** A best-effort description used in the skill-detail modal. */
export function agentPackMemberDescription(member: AgentPackMember): string {
  switch (member.kind) {
    case "skill":
      return `A ${member.category} skill: ${member.directoryName.replace(/-/g, " ")}.`;
    case "tool":
      return `Built-in tool: ${member.key.replace(/_/g, " ")}.`;
    case "docs-pointer":
      return member.title;
  }
}

const PACKS_BY_ID = new Map(AGENT_PACK_CATALOG.map((pack) => [pack.id, pack]));

export function listAgentPackSummaries(): AgentPackSummary[] {
  return AGENT_PACK_CATALOG.map((pack) => ({
    id: pack.id,
    displayName: pack.displayName,
    description: pack.description,
    memberCount: pack.members.length,
  }));
}

export function getAgentPack(packId: string): AgentPackDefinition | undefined {
  return PACKS_BY_ID.get(packId);
}

export function isAgentPackId(packId: string): boolean {
  return PACKS_BY_ID.has(packId);
}

export function validateAgentPackIds(packIds: readonly string[]): string[] {
  return packIds.filter((packId) => !isAgentPackId(packId));
}

export function agentSkillMemberKey(
  member: Pick<AgentPackSkillMember, "category" | "directoryName">,
): string {
  return `skill:${member.category}/${member.directoryName}`;
}

export function agentPackMemberKey(member: AgentPackMember): string {
  switch (member.kind) {
    case "skill":
      return agentSkillMemberKey(member);
    case "tool":
      return `tool:${member.key}`;
    case "docs-pointer":
      return `docs-pointer:${member.id}`;
  }
}

export function deriveAgentPackState(
  pack: AgentPackDefinition,
  enabledMemberKeys: ReadonlySet<string>,
): AgentPackSelectionState {
  const selectableMembers = pack.members.filter(
    (member) => member.kind !== "docs-pointer",
  );
  if (selectableMembers.length === 0) return "off";
  const enabledCount = selectableMembers.filter((member) =>
    enabledMemberKeys.has(agentPackMemberKey(member)),
  ).length;
  if (enabledCount === 0) return "off";
  return enabledCount === selectableMembers.length ? "on" : "partial";
}

export function expandAgentPackSelection(
  packIds: readonly string[],
  catalog: readonly AgentPackDefinition[] = AGENT_PACK_CATALOG,
  skillOverrides: Readonly<Record<string, boolean>> = {},
): ExpandedAgentPackSelection {
  const packsById = new Map(catalog.map((pack) => [pack.id, pack]));
  const selectedPackIds: string[] = [];
  const skillTargetsByKey = new Map<string, SkillMutationTarget>();
  const toolKeys = new Set<string>();
  const docsPointersById = new Map<string, AgentDocsPointerSelection>();

  for (const packId of packIds) {
    const pack = packsById.get(packId);
    if (!pack || selectedPackIds.includes(pack.id)) continue;
    selectedPackIds.push(pack.id);
    for (const member of pack.members) {
      // A `false` override trims that member out of an otherwise-selected pack.
      if (
        member.kind !== "docs-pointer" &&
        skillOverrides[agentPackMemberKey(member)] === false
      ) {
        continue;
      }
      if (member.kind === "skill") {
        const key = agentSkillMemberKey(member);
        if (!skillTargetsByKey.has(key)) {
          skillTargetsByKey.set(key, {
            action: "install",
            name: member.name,
            category: member.category,
            directoryName: member.directoryName,
          });
        }
      } else if (member.kind === "tool") {
        toolKeys.add(member.key);
      } else {
        docsPointersById.set(member.id, {
          id: member.id,
          title: member.title,
          path: member.path,
          url: member.url,
        });
      }
    }
  }

  return {
    packIds: selectedPackIds,
    skillTargets: [...skillTargetsByKey.values()],
    toolKeys: [...toolKeys],
    docsPointers: [...docsPointersById.values()],
  };
}

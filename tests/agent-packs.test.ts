import { describe, expect, it } from "vitest";
import {
  AGENT_PACK_CATALOG,
  DEFAULT_BASELINE_TOOL_KEYS,
  agentPackMemberKey,
  agentSkillMemberKey,
  deriveAgentPackState,
  expandAgentPackSelection,
  getAgentPack,
  UNASSIGNED_SKILL_DIRECTORY_KEYS,
} from "../src/shared/agent-packs";

describe("agent pack catalog", () => {
  it("contains representative v1 packs from the mapping doc", () => {
    expect(getAgentPack("research")).toMatchObject({ displayName: "Research" });
    expect(getAgentPack("coding")).toMatchObject({ displayName: "Coding" });
    expect(getAgentPack("image-generation")).toMatchObject({ displayName: "Image Generation" });
    expect(getAgentPack("mercury")).toMatchObject({ displayName: "Mercury" });
    expect(getAgentPack("ascii-video")).toMatchObject({ displayName: "ASCII Video" });

    const research = getAgentPack("research");
    expect(research?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tool", key: "web" }),
        expect.objectContaining({
          kind: "skill",
          category: "research",
          directoryName: "arxiv",
        }),
      ]),
    );
    expect(getAgentPack("default")?.members).toEqual(
      expect.arrayContaining(
        DEFAULT_BASELINE_TOOL_KEYS.map((key) => expect.objectContaining({ kind: "tool", key })),
      ),
    );
  });

  it("keeps unassigned skills out of selectable packs", () => {
    const selectableSkillKeys = new Set(
      AGENT_PACK_CATALOG.flatMap((pack) =>
        pack.members.flatMap((member) =>
          member.kind === "skill" ? [`${member.category}/${member.directoryName}`] : [],
        ),
      ),
    );

    for (const key of UNASSIGNED_SKILL_DIRECTORY_KEYS) {
      expect(selectableSkillKeys.has(key)).toBe(false);
    }
  });

  it("dedupes duplicate skills across selected packs", () => {
    const expanded = expandAgentPackSelection(["coding", "video-making", "image-generation"]);
    const comfyTargets = expanded.skillTargets.filter(
      (target) => target.category === "creative" && target.directoryName === "comfyui",
    );
    const p5Targets = expanded.skillTargets.filter(
      (target) => target.category === "creative" && target.directoryName === "p5js",
    );

    expect(comfyTargets).toHaveLength(1);
    expect(p5Targets).toHaveLength(1);
  });

  it("docs-pointer members produce metadata but no skill targets", () => {
    const expanded = expandAgentPackSelection(["default", "mercury"]);

    expect(expanded.docsPointers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "default-baseline-docs" }),
        expect.objectContaining({ id: "mercury-agent-storage-docs" }),
      ]),
    );
    expect(expanded.skillTargets).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "default-baseline-docs" }),
        expect.objectContaining({ name: "mercury-agent-storage-docs" }),
      ]),
    );
  });

  it("derives pack off/partial/on state from enabled skill and tool members", () => {
    const imagePack = getAgentPack("image-generation");
    const videoPack = getAgentPack("video-making");
    expect(imagePack).toBeTruthy();
    expect(videoPack).toBeTruthy();
    if (!imagePack || !videoPack) return;

    const enabled = new Set<string>([
      agentSkillMemberKey({ category: "creative", directoryName: "comfyui" }),
    ]);

    expect(deriveAgentPackState(imagePack, enabled)).toBe("partial");
    expect(deriveAgentPackState(videoPack, enabled)).toBe("partial");

    for (const member of imagePack.members) {
      if (member.kind !== "docs-pointer") enabled.add(agentPackMemberKey(member));
    }
    expect(deriveAgentPackState(imagePack, enabled)).toBe("on");

    expect(deriveAgentPackState(getAgentPack("research")!, new Set())).toBe("off");
  });
});

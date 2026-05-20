import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMigrationInventory } from "../src/main/migration/inventory";
import { buildMigrationAgentPrompt } from "../src/main/migration/prompt";

function makeTempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("migration inventory", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function tempRoot(prefix: string): string {
    const root = makeTempRoot(prefix);
    roots.push(root);
    return root;
  }

  it("builds redacted Hermes profile and synthesized candidates from profile evidence", () => {
    const root = tempRoot("mercury-hermes-inventory-");
    mkdirSync(join(root, "memories"), { recursive: true });
    mkdirSync(join(root, "skills", "research", "summarizer"), { recursive: true });
    mkdirSync(join(root, "cron"), { recursive: true });

    writeFileSync(join(root, "config.yaml"), "provider: openai\ndefault: gpt-test\n", "utf-8");
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=should-not-leak", "utf-8");
    writeFileSync(join(root, "SOUL.md"), "# Private soul text", "utf-8");
    writeFileSync(join(root, "memories", "MEMORY.md"), "first private memory\n§\nsecond private memory", "utf-8");
    writeFileSync(join(root, "memories", "USER.md"), "user private facts", "utf-8");
    writeFileSync(
      join(root, "skills", "research", "summarizer", "SKILL.md"),
      "---\nname: summarizer\ndescription: Summarize things\n---\nsecret skill body",
      "utf-8",
    );
    writeFileSync(
      join(root, "cron", "jobs.json"),
      JSON.stringify({ jobs: [{ id: "daily", name: "Daily report", prompt: "do not leak this prompt", skills: ["summarizer"], deliver: ["email:private@example.test"] }] }),
      "utf-8",
    );

    const inventory = buildMigrationInventory({ includeDefaultSources: false, hermesRoots: [root] });
    const explicit = inventory.candidates.find((candidate) => candidate.origin === "hermes-profile");
    const cron = inventory.candidates.find((candidate) => candidate.origin === "cron-cluster");

    expect(inventory.sources).toEqual([expect.objectContaining({ kind: "hermes", path: root, exists: true })]);
    expect(explicit).toMatchObject({
      sourceKind: "hermes",
      confidence: "high",
      proposedTargetProfile: "default",
      activity: expect.objectContaining({ skillCount: 1, cronJobCount: 1 }),
    });
    expect(explicit?.personaSummary).toContain("2 memory entries");
    expect(explicit?.privacyFlags).toContain("secrets-redacted");
    expect(explicit?.privacyFlags).toContain("raw-content-redacted");
    expect(cron).toMatchObject({ origin: "cron-cluster", confidence: "medium" });

    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain("should-not-leak");
    expect(serialized).not.toContain("Private soul text");
    expect(serialized).not.toContain("private memory");
    expect(serialized).not.toContain("do not leak this prompt");
    expect(serialized).not.toContain("private@example.test");
  });

  it("builds redacted OpenClaw agent candidates from agent/workspace evidence", () => {
    const root = tempRoot("mercury-openclaw-inventory-");
    const agentDir = join(root, "agents", "support");
    mkdirSync(join(agentDir, "agent"), { recursive: true });
    mkdirSync(join(agentDir, "sessions"), { recursive: true });
    mkdirSync(join(root, "skills", "support", "triage"), { recursive: true });
    mkdirSync(join(root, "credentials"), { recursive: true });

    writeFileSync(join(root, "openclaw.json"), JSON.stringify({ defaultAgent: "support" }), "utf-8");
    writeFileSync(join(agentDir, "agent", "AGENTS.md"), "# Support private persona", "utf-8");
    writeFileSync(join(agentDir, "agent", "MEMORY.md"), "customer private memory", "utf-8");
    writeFileSync(join(agentDir, "sessions", "sessions.json"), JSON.stringify([{ id: "s1", displayName: "Private channel" }]), "utf-8");
    writeFileSync(join(agentDir, "sessions", "s1.jsonl"), "{\"content\":\"raw private transcript\"}\n", "utf-8");
    writeFileSync(join(agentDir, "auth-profiles.json"), JSON.stringify({ token: "do-not-leak" }), "utf-8");
    writeFileSync(join(root, "skills", "support", "triage", "SKILL.md"), "---\nname: triage\n---\nsecret skill body", "utf-8");

    const inventory = buildMigrationInventory({ includeDefaultSources: false, openClawRoots: [root] });
    const agent = inventory.candidates.find((candidate) => candidate.origin === "openclaw-agent");

    expect(inventory.sources).toEqual([expect.objectContaining({ kind: "openclaw", path: root, exists: true })]);
    expect(agent).toMatchObject({
      sourceKind: "openclaw",
      displayName: "OpenClaw agent: support",
      confidence: "high",
      proposedTargetProfile: "support",
      activity: expect.objectContaining({ sessionCount: 1, skillCount: 1 }),
    });
    expect(agent?.privacyFlags).toContain("credentials-present");
    expect(agent?.privacyFlags).toContain("transcript-derived");
    expect(agent?.personaSummary).toContain("AGENTS.md");

    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain("Support private persona");
    expect(serialized).not.toContain("customer private memory");
    expect(serialized).not.toContain("raw private transcript");
    expect(serialized).not.toContain("do-not-leak");
    expect(serialized).not.toContain("Private channel");
  });

  it("redacts sensitive cron names and OpenClaw agent identifiers", () => {
    const hermesRoot = tempRoot("mercury-sensitive-hermes-");
    mkdirSync(join(hermesRoot, "cron"), { recursive: true });
    writeFileSync(
      join(hermesRoot, "cron", "jobs.json"),
      JSON.stringify({ jobs: [{ name: "owner@example.test", prompt: "private prompt" }] }),
      "utf-8",
    );

    const openClawRoot = tempRoot("mercury-sensitive-openclaw-");
    const privateAgentId = "ops-team@example.test";
    mkdirSync(join(openClawRoot, "agents", privateAgentId, "agent"), { recursive: true });
    writeFileSync(join(openClawRoot, "agents", privateAgentId, "agent", "AGENTS.md"), "private persona", "utf-8");

    const inventory = buildMigrationInventory({
      includeDefaultSources: false,
      hermesRoots: [hermesRoot],
      openClawRoots: [openClawRoot],
    });
    const openClawAgent = inventory.candidates.find((candidate) => candidate.origin === "openclaw-agent");
    const cron = inventory.candidates.find((candidate) => candidate.origin === "cron-cluster");

    expect(openClawAgent?.displayName).toMatch(/^OpenClaw agent: agent-[a-f0-9]{10}$/);
    expect(openClawAgent?.proposedTargetProfile).toMatch(/^agent-[a-f0-9]{10}$/);
    expect(cron?.useCaseSummary).toMatch(/job-[a-f0-9]{10}/);

    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain("owner@example.test");
    expect(serialized).not.toContain(privateAgentId);
    expect(serialized).not.toContain("private prompt");
    expect(serialized).not.toContain("private persona");
  });

  it("builds a redacted migration agent prompt from inventory", () => {
    const root = tempRoot("mercury-prompt-hermes-");
    mkdirSync(join(root, "memories"), { recursive: true });
    writeFileSync(join(root, "SOUL.md"), "private soul text", "utf-8");
    writeFileSync(join(root, "memories", "MEMORY.md"), "private memory", "utf-8");
    writeFileSync(join(root, ".env"), "OPENAI_API_KEY=secret", "utf-8");

    const inventory = buildMigrationInventory({ includeDefaultSources: false, hermesRoots: [root] });
    const prompt = buildMigrationAgentPrompt(inventory);

    expect(prompt).toContain("Mercury migration agent prompt");
    expect(prompt).toContain("candidate IDs as selectors");
    expect(prompt).toContain(inventory.candidates[0]?.id);
    expect(prompt).toContain("SOUL.md");
    expect(prompt).not.toContain("private soul text");
    expect(prompt).not.toContain("private memory");
    expect(prompt).not.toContain("OPENAI_API_KEY=secret");
  });

  it("does not synthesize a Hermes profile from an empty directory", () => {
    const root = tempRoot("mercury-empty-hermes-");

    const inventory = buildMigrationInventory({ includeDefaultSources: false, hermesRoots: [root] });

    expect(inventory.candidates).toEqual([]);
    expect(inventory.sources[0]).toMatchObject({ kind: "hermes", path: root, exists: true });
    expect(inventory.sources[0]?.warnings).toContain("No Hermes profile markers found.");
    expect(inventory.warnings).toContain("No migration candidate agents were found in detected source roots.");
  });

  it("counts OpenClaw skills beyond the displayed names cap", () => {
    const root = tempRoot("mercury-openclaw-skills-");
    const agentDir = join(root, "agents", "support", "agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "AGENTS.md"), "support persona", "utf-8");
    for (let index = 0; index < 10; index += 1) {
      const skillDir = join(root, "skills", "bulk", `skill-${index}`);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, "SKILL.md"), `---\nname: skill-${index}\n---\n`, "utf-8");
    }

    const inventory = buildMigrationInventory({ includeDefaultSources: false, openClawRoots: [root] });
    const agent = inventory.candidates.find((candidate) => candidate.origin === "openclaw-agent");

    expect(agent?.activity.skillCount).toBe(10);
    expect(agent?.capabilitySummary).toContain("10 skills");
  });
});

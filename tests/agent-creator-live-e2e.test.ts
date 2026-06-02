import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";

import type {
  AgentCreationDraft,
  AgentDraftChange,
  AgentDraftChangeEvent,
} from "../src/shared/agents";
import type { TraceEvent } from "../src/shared/traces";

const RUN_LIVE_E2E = process.env.LIVE_AGENT_CREATOR_E2E === "1";
const LIVE_TIMEOUT_MS = Number(process.env.LIVE_AGENT_CREATOR_TIMEOUT_MS ?? 420_000);

interface TurnResult {
  label: string;
  user: string;
  response: string;
  sessionId?: string;
  chunks: string[];
  traces: TraceEvent[];
  usage: unknown[];
  draftChanges: AgentDraftChangeEvent[];
}

interface ScenarioResult {
  name: string;
  draftId: string;
  initialDraft: AgentCreationDraft;
  finalDraft: AgentCreationDraft;
  turns: TurnResult[];
  /** Deltas the live stream surfaced and Mercury applied (from onAgentDraftChanged). */
  appliedDeltas: AgentDraftChange[];
}

let hermesHome: string | undefined;
let cleanupGateway: (() => void) | undefined;

function readOpenCodeGoKey(): string {
  const authPath = join(homedir(), ".local", "share", "opencode", "auth.json");
  if (!existsSync(authPath)) {
    throw new Error(`Missing real provider auth file: ${authPath}`);
  }
  const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { key?: string }>;
  const key = auth["opencode-go"]?.key;
  if (!key) throw new Error(`Missing opencode-go key in ${authPath}`);
  return key;
}

function createLiveHermesHome(): string {
  const key = readOpenCodeGoKey();
  const home = mkdtempCompat(join(tmpdir(), "mercury-agent-creator-live-"));
  const installedAgent = join(homedir(), ".hermes", "hermes-agent");
  if (!existsSync(installedAgent)) {
    throw new Error(`Hermes agent not found at ${installedAgent}`);
  }
  symlinkSync(installedAgent, join(home, "hermes-agent"), "dir");
  writeFileSync(join(home, ".env"), `OPENCODE_GO_API_KEY=${key}\n`, { mode: 0o600 });
  writeFileSync(
    join(home, "config.yaml"),
    [
      "model:",
      "  provider: opencode-go",
      "  default: deepseek-v4-flash",
      '  base_url: ""',
      "streaming: true",
      "max_turns: 20",
      "approvals:",
      "  mode: off",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify({ active_provider: "opencode-go" }, null, 2),
    { mode: 0o600 },
  );
  return home;
}

function mkdtempCompat(prefix: string): string {
  const fs = require("fs") as typeof import("fs");
  const home = fs.mkdtempSync(prefix);
  fs.chmodSync(home, 0o700);
  return home;
}

function summarizeDraft(draft: AgentCreationDraft): Record<string, unknown> {
  return {
    id: draft.id,
    revision: draft.revision,
    profile: draft.profile,
    displayName: draft.displayName,
    description: draft.description,
    persona: draft.persona,
    selectedPackIds: draft.selectedPackIds,
    docsPointers: draft.docsPointers,
    toolsetOverrides: draft.toolsetOverrides,
    skillOverrides: draft.skillOverrides,
    model: draft.model,
    memory: draft.memory,
  };
}

function populatedByConversation(initial: AgentCreationDraft, final: AgentCreationDraft): boolean {
  return Boolean(
    final.revision > initial.revision &&
      final.displayName !== initial.displayName &&
      final.description &&
      final.persona &&
      JSON.stringify(final.selectedPackIds) !== JSON.stringify(initial.selectedPackIds),
  );
}

async function withTimeout<T>(label: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${LIVE_TIMEOUT_MS}ms`)), LIVE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const liveDescribe = RUN_LIVE_E2E ? describe : describe.skip;

liveDescribe("live conversational agent creator via chat-service.runChatMessage", () => {
  afterAll(() => {
    cleanupGateway?.();
    if (hermesHome) {
      try {
        rmSync(join(hermesHome, "hermes-agent"), { force: true });
        rmSync(hermesHome, { recursive: true, force: true });
      } catch (error) {
        console.warn("live e2e cleanup skipped", error);
      }
    }
  });

  it("spends real tokens and populates two agent drafts through draft mutations", async () => {
    hermesHome = createLiveHermesHome();
    process.env.HERMES_HOME = hermesHome;
    process.env.MERCURY_CHAT_SYNTHETIC_STREAM = "0";
    process.env.NODE_ENV = "test";

    const [{ createAgentDraft, getAgentDraft }, chatService, gateway] = await Promise.all([
      import("../src/main/services/agents-service"),
      import("../src/main/services/chat-service"),
      import("../src/main/hermes/gateway"),
    ]);
    cleanupGateway = () => {
      try {
        gateway.stopGateway(true, "default");
        gateway.stopHealthPolling("default");
      } catch (error) {
        console.warn("gateway cleanup skipped", error);
      }
    };

    type RuntimeScenario = {
      name: string;
      draftName: string;
      turns: string[];
      expectedPackId: string;
    };

    const scenarios: RuntimeScenario[] = [
      {
        name: "research assistant",
        draftName: "Live E2E Research Draft",
        expectedPackId: "research",
        turns: [
          "Create a Mercury agent draft for a web-first research assistant. Do not call tools. Choose a clear display name, description, persona, and add the research pack. It should use web/research capabilities and be careful about citations. Emit the draft mutation block for the changes you decide.",
          "Refine that same draft: make the persona more explicit about synthesis, source quality, and asking clarifying questions before broad research. Do not call tools; just update the draft via a mutation block if needed.",
        ],
      },
      {
        name: "coding agent",
        draftName: "Live E2E Coding Draft",
        expectedPackId: "coding",
        turns: [
          "Create a Mercury agent draft for an autonomous TypeScript/Codex coding agent. Do not call tools. Choose a clear display name, description, persona, and add the coding pack. It should emphasize tests, code review, and safe terminal/file use. Emit the draft mutation block for the changes you decide.",
          "Refine that coding draft: make the persona stricter about reading the code before editing, writing tests first when appropriate, and reporting changed files. Do not call tools; just update the draft via a mutation block if needed.",
        ],
      },
    ];

    const results: ScenarioResult[] = [];

    for (const scenario of scenarios) {
      const initialDraft = await createAgentDraft({ displayName: scenario.draftName });
      let sessionId: string | undefined;
      const history: Array<{ role: string; content: string }> = [];
      const turns: TurnResult[] = [];

      for (const [index, user] of scenario.turns.entries()) {
        const chunks: string[] = [];
        const traces: TraceEvent[] = [];
        const usage: unknown[] = [];
        const draftChanges: AgentDraftChangeEvent[] = [];
        const response = await withTimeout(
          `${scenario.name} turn ${index + 1}`,
          chatService.runChatMessage({
            message: user,
            profile: "default",
            resumeSessionId: sessionId,
            history: [...history],
            options: { mode: "agent-creation", agentDraftId: initialDraft.id },
            callbacks: {
              onChunk: (text) => chunks.push(text),
              onDone: (doneSessionId) => {
                sessionId = doneSessionId ?? sessionId;
              },
              onError: (error) => {
                throw new Error(error);
              },
              onLiveTraceEvent: (event) => traces.push(event),
              onUsage: (event) => usage.push(event),
              onAgentDraftChanged: (event) => draftChanges.push(event),
            },
          }),
        );
        sessionId = response.sessionId ?? sessionId;
        history.push({ role: "user", content: user });
        history.push({ role: "agent", content: response.response });
        turns.push({
          label: `${scenario.name} turn ${index + 1}`,
          user,
          response: response.response,
          sessionId,
          chunks,
          traces,
          usage,
          draftChanges,
        });
      }

      const finalDraft = await getAgentDraft(initialDraft.id);
      if (!finalDraft) throw new Error(`Draft missing after scenario: ${scenario.name}`);

      // Proof comes from the live draft-change stream (onAgentDraftChanged), which only
      // fires when chat-service parses a <draft-mutation> block out of the model's reply,
      // merges it against fresh draft state, and applies it via updateAgentDraft. No
      // sessions.db spelunking — the applied deltas and the persisted draft are the proof.
      const appliedDeltas = turns
        .flatMap((turn) => turn.draftChanges)
        .flatMap((event) => event.changes);

      expect(populatedByConversation(initialDraft, finalDraft), scenario.name).toBe(true);
      expect(finalDraft.selectedPackIds, scenario.name).toContain(scenario.expectedPackId);
      expect(appliedDeltas.length, `${scenario.name} applied draft deltas`).toBeGreaterThan(0);
      expect(turns.flatMap((turn) => turn.usage).length, `${scenario.name} usage`).toBeGreaterThan(0);
      expect(
        turns.flatMap((turn) => turn.traces).some((event) => event.type === "approval.requested"),
        `${scenario.name} approval hang guard`,
      ).toBe(false);

      results.push({
        name: scenario.name,
        draftId: initialDraft.id,
        initialDraft,
        finalDraft,
        turns,
        appliedDeltas,
      });
    }

    const report = {
      hermesHome,
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      realTokensFlowed: results.every((result) =>
        result.turns.some((turn) => turn.usage.length > 0),
      ),
      scenarios: results.map((result) => ({
        name: result.name,
        draftId: result.draftId,
        populatedCorrectly: populatedByConversation(result.initialDraft, result.finalDraft),
        initialDraft: summarizeDraft(result.initialDraft),
        finalDraft: summarizeDraft(result.finalDraft),
        usage: result.turns.flatMap((turn) => turn.usage),
        visibleResponses: result.turns.map((turn) => turn.response),
        traceTypes: result.turns.flatMap((turn) => turn.traces.map((event) => event.type)),
        // Deltas the stream surfaced and Mercury applied, turn-by-turn.
        appliedDeltas: result.appliedDeltas.map((change) => ({
          path: change.path,
          previous: change.previous,
          next: change.next,
        })),
        draftChangePaths: result.turns.flatMap((turn) =>
          turn.draftChanges.flatMap((event) => event.changes.map((change) => change.path)),
        ),
      })),
    };

    console.log(`LIVE_AGENT_CREATOR_E2E_REPORT ${JSON.stringify(report, null, 2)}`);
  }, LIVE_TIMEOUT_MS * 3);
});

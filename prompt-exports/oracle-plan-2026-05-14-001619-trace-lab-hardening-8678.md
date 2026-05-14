## Final Prompt
<taskname="Trace Lab Hardening"/>
<task>
Build and run a broad real-token Trace Lab validation/hardening effort for Mercury, then fix the trace coverage gaps it exposes. The harness must execute inside the actual Mercury app path or through scripts that drive the same user-visible app functions (renderer -> preload -> IPC -> main Hermes gateway/chat), not a mocked Trace Lab fixture. It should spend real Codex/Hermes tokens through the app server when suitable OAuth/credentials are configured; otherwise it must stop with a clear login/setup blocker. The run should exercise several scenarios: normal conversations, resumed/history conversations, tool calls, sub-agent/delegation, image generation, errors, cancellations/aborts, and then verify Trace Lab captures meaningful events, usage, statuses, and artifacts.
</task>

<architecture>
Mercury is an Electron/Vite app with four relevant boundaries:
- Renderer UI calls `window.hermesAPI`; the Chat screen owns user-visible chat behavior in `useChatController.ts` and Trace Lab reads stored runs in `TraceLab.tsx`.
- Preload exposes renderer-safe APIs in `src/preload/api/*` and types in `src/preload/index.d.ts`.
- Main IPC handlers in `src/main/ipc/*` bridge renderer calls to services. Chat tracing is currently implemented in `src/main/ipc/chat.ts`; Trace Lab read APIs are in `src/main/ipc/trace.ts`.
- Main Hermes services in `src/main/hermes/*` choose API-server streaming vs CLI fallback. `sendMessageViaApi()` parses OpenAI-compatible SSE, custom `hermes.tool.progress` events, usage chunks, and aborts through `AbortController`.

Current trace persistence:
- Schema lives in `src/shared/traces.ts`; store implementation in `src/main/trace-store.ts`; contract doc in `docs/contracts/trace-schema.md`.
- `createTraceRun()` writes `run.started` and `message.user` to `<HERMES_HOME>/desktop-traces.json`.
- `src/main/ipc/chat.ts` records first/completed `message.agent.delta`, `tool.progress`, `usage.recorded`, and terminal `run.completed`/`run.failed`/`run.aborted` for `send-message`.
- Trace Lab currently renders run metrics, a fixed run map, skill summaries derived from `skill.*` events, timeline rows, and event metadata.

Existing real-app harness:
- `scripts/e2e-flow-sweep.mjs` launches packaged Electron through Playwright against a temporary `HERMES_HOME`, symlinks the installed Hermes agent, writes a configured profile, sends a real chat prompt through the UI, waits for `desktop-traces.json`, opens Trace Lab, and writes docs/screenshots.
- It currently uses OpenCode Go auth from local opencode auth and only validates a single simple chat plus broad UI navigation. It is the closest starting point for the requested broad harness.
</architecture>

<selected_context>
package.json: scripts (`build`, `start`, `dev`, typecheck/test commands) and dependencies for Electron/Vite/Vitest.
electron.vite.config.ts: Electron build entry/output shape used by Playwright launch scripts.

src/main/index.ts: Electron app lifecycle, window creation, IPC registration, updater/menu events, SSH startup, shutdown cleanup including `abortActiveChat()`.
src/main/ipc/index.ts: IPC composition root; registering new IPC APIs requires wiring here.
src/main/ipc/chat.ts: real `send-message` / `abort-chat` implementation and current trace writes around chat lifecycle.
src/main/ipc/trace.ts: Trace Lab list/get IPC handlers.
src/main/ipc/install.ts: install/doctor/update IPC and SSH update path.
src/main/ipc/knowledge.ts: tools/skills/memory/soul IPC, including `set-toolset-enabled` for enabling image/delegation/tool scenarios.
src/main/ipc/sessions.ts: sessions/profiles/cache IPC relevant to resumed/history conversation validation.
src/main/ipc/types.ts: registration context.

src/main/hermes.ts: barrel export for Hermes gateway/chat/connection APIs.
src/main/hermes/gateway.ts: `sendMessage()` chooses API server vs CLI fallback; starts/stops gateway.
src/main/hermes/chat-api.ts: OpenAI-compatible streaming path; parses custom tool-progress SSE, usage, errors, aborts.
src/main/hermes/chat-cli.ts: CLI fallback path; injects env/profile keys, streams stdout/stderr, supports abort.
src/main/hermes/connection.ts: local/remote/SSH API URL and readiness checks.
src/main/hermes/types.ts: `ChatCallbacks` and usage/tool callback contract.
src/main/config.ts: profile env/config/model/credential pool and connection config.
src/main/install/paths.ts: `HERMES_HOME`, install status, `hasHermesAuthCredential()`, API-key/OAuth credential detection.
src/main/installer.ts: install barrel re-export used by trace/config modules.
src/main/tools.ts: toolset definitions, including `image_gen`, `delegation`, `skills`, `memory`, `session_search`, and config mutation.
src/main/trace-store.ts: trace persistence, run lifecycle events, usage accumulation, skill-training derivation, run/event caps.

src/shared/traces.ts: current TraceRun/TraceEvent/TraceUsage/SkillTrainingRun schema and event type union.

src/preload/index.ts: contextBridge exposure of `hermesAPI`.
src/preload/api/index.ts: preload API composition.
src/preload/api/chat.ts: renderer-facing chat send/abort/events.
src/preload/api/navigation.ts: Trace Lab, gateway, sessions, profiles preload APIs.
src/preload/api/install.ts: install/status preload APIs.
src/preload/api/config.ts: env/config/model/connection preload APIs.
src/preload/api/app.ts: app/cron/debug/log APIs; useful if adding harness-visible diagnostics.
src/preload/index.d.ts: renderer TypeScript contract; update if adding new APIs.

src/renderer/src/App.tsx: startup routing; blocks to setup when local install lacks API key/auth.
src/renderer/src/screens/Layout/Layout.tsx: navigation, active profile, chat state, remote-mode gating, menu new-chat behavior.
src/renderer/src/screens/Setup/Setup.tsx: setup API-key UI and provider selection.
src/renderer/src/constants/providers.ts and index/types: provider/setup constants, including current absence of an explicit Codex provider and current OpenCode Go support.
src/renderer/src/screens/Chat/Chat.tsx: Chat view composition.
src/renderer/src/screens/Chat/hooks/useChatController.ts: user-visible send/quick-ask/abort/approve/deny behavior; maps renderer events to `window.hermesAPI.sendMessage()`.
src/renderer/src/screens/Chat/chat.constants.ts: slash commands for `/image`, `/web`, `/shell`, `/approve`, `/deny`, `/btw`, etc.
src/renderer/src/screens/Chat/chatCommands.ts: local-only slash commands that do not hit `send-message` and currently will not produce trace runs.
src/renderer/src/screens/Chat/types.ts: chat/controller types.

src/renderer/src/screens/TraceLab/TraceLab.tsx: current Trace Lab UI and filtering/loading behavior.
src/renderer/src/screens/TraceLab/components/TraceLabComponents.tsx: run map, skill summary, event row, inspector rendering.
src/renderer/src/screens/TraceLab/trace-lab.helpers.ts: fixed run-map steps and event explanations; likely needs expansion if schema gains richer event types.
src/renderer/src/screens/TraceLab/trace-lab.types.ts: event labels/icons/filter definitions.
src/renderer/src/assets/main.css and trace-lab*.css: Trace Lab styling for timeline/map/inspector and any new event/status UI.

scripts/e2e-flow-sweep.mjs: existing Playwright/Electron real-app sweep and best starting point for broad real-token harness.
tests/trace-store.test.ts: current trace-store/skill derivation tests.
tests/ipc-handlers.test.ts: main IPC/preload channel consistency test.
tests/preload-api-surface.test.ts: preload API/type surface consistency test.

docs/architecture/overview.md: Electron boundary and ownership docs.
docs/contracts/trace-schema.md: current trace contract and write behavior.
docs/contracts/ipc-preload.md: IPC/preload contract docs.
docs/testing/contract-tests.md: test expectations/commands.
docs/e2e-flow-sweep-report.md: prior real-app flow sweep report.
docs/labs-e2e/trace-lab-skill-evolution-report.md: prior mocked/high-volume Trace Lab fixture report and bugs fixed.
.agents/skills/hermes-agent/SKILL.md: reference for Hermes capabilities outside Mercury source, including API server, tool progress, delegate/subagent tool, image generation/toolsets, skills, usage, and OAuth/provider concepts.
</selected_context>

<relationships>
- User Chat UI -> `useChatController.handleSend()` / `handleQuickAsk()` / `handleApprove()` / `handleDeny()` -> `window.hermesAPI.sendMessage()` -> preload `chatApi.sendMessage()` -> IPC `send-message` -> `sendMessage()` in `src/main/hermes/gateway.ts` -> API or CLI transport -> callbacks -> trace-store writes -> renderer chat events.
- User abort/cancel -> `useChatController.handleAbort()` or new-chat clearing -> `window.hermesAPI.abortChat()` -> IPC `abort-chat` / `abortActiveChat()` -> transport abort -> `finishTraceRun(..., "aborted")` when current run is tracked.
- API streaming path -> `sendMessageViaApi()` parses `delta.content`, custom `event: hermes.tool.progress`, `usage`, HTTP/SSE errors, empty-stream probing -> main chat IPC records only coarse `tool.progress`, usage, and response deltas.
- Trace Lab UI -> `window.hermesAPI.listTraceRuns()` / `listSkillTrainingRuns()` -> preload navigation API -> IPC trace handlers -> `trace-store` -> `TraceLab.tsx` list/detail/timeline/inspector.
- Toolset setup for scenarios -> renderer/tools or harness preload calls -> `set-toolset-enabled` IPC -> `src/main/tools.ts` mutates `platform_toolsets.cli`; tool keys include `image_gen` and `delegation`.
- Install/auth gating -> `App.runInstallCheck()` -> `checkInstall()` -> `checkInstallStatus()` -> local Hermes binary/script checks + `.env` keys or `auth.json` via `hasHermesAuthCredential(provider)`.
- Existing e2e harness -> Playwright `_electron.launch()` -> packaged `out/main/index.js` -> real renderer UI selectors -> real `send-message` path -> disk trace store -> Trace Lab UI assertions.
</relationships>

<observed_gaps_to_validate>
- Trace schema has only coarse event types; no explicit tool start/end/error, tool name/id/arguments/result metadata, delegation/subagent lifecycle, approval requested/approved/denied, image artifact, thinking/reasoning, retry, history/resume, or local slash-command trace semantics.
- `message.agent.delta` is capped and records only first and completed response details from IPC; token-by-token content is intentionally not fully stored.
- CLI fallback has no usage callback and less structured tool progress than API streaming.
- Local slash commands in `chatCommands.ts` bypass `send-message`, so they are currently invisible to Trace Lab unless explicitly traced elsewhere.
- Current Trace Lab run map infers “Files Edited” from free-text detail/tool events and has fixed stages, so richer event types will likely need helper/UI updates.
- Existing real-app sweep validates only one simple real chat and Trace Lab rendering; prior Trace Lab high-volume report used fixture data rather than broad real-token app behavior.
</observed_gaps_to_validate>

<implementation_expectations>
- Prefer extending or adding a script patterned after `scripts/e2e-flow-sweep.mjs` that launches the actual app and drives UI/preload calls. Avoid isolated unit mocks for the broad run.
- The harness should create an isolated temporary `HERMES_HOME`, reuse installed Hermes binaries when present, copy or reference credentials only at runtime, and avoid committing secrets.
- Use the app’s own install/status/model/tool APIs to determine whether a real-token run can proceed. If Codex OAuth is not discoverable/configured, fail early with a clear actionable blocker rather than silently falling back to fake traces.
- After running scenarios, compare expected scenario evidence against `desktop-traces.json` and Trace Lab UI: statuses, events, usage tokens/cost when available, tool/delegation/image/error/abort markers, session IDs/history, and inspector metadata.
- Fix trace coverage gaps in schema/store/chat transport/UI/tests/docs as needed, keeping IPC/preload contracts and docs updated.
- Run focused tests for changed areas: at minimum `npm run test -- tests/trace-store.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts`; run typecheck and the real-token harness when credentials/environment permit.
</implementation_expectations>

<ambiguities>
- “Codex OAuth” is not an explicit provider in the selected Mercury provider constants; current code has generic Hermes `auth.json` credential detection and OpenCode Go setup. The implementation should inspect actual local Hermes auth/model state at runtime and report the exact missing provider/auth blocker if Codex credentials are absent.
- The Hermes agent implementation lives outside this Mercury repo; `.agents/skills/hermes-agent/SKILL.md` is included as reference, but the harness should validate behavior through Mercury’s real app/API path rather than assuming undocumented internal event shapes.
</ambiguities>

## Selection
- Files: 61 total (60 full, 1 codemap)
- Total tokens: 94864 (Auto view)
- Token breakdown: full 94821, codemap 43

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── .agents/
│   └── skills/
│       └── hermes-agent/
│           └── SKILL.md — 19 867 tokens (full)
├── docs/
│   ├── architecture/
│   │   └── overview.md — 2 305 tokens (full)
│   ├── contracts/
│   │   ├── ipc-preload.md — 2 642 tokens (full)
│   │   └── trace-schema.md — 1 921 tokens (full)
│   ├── labs-e2e/
│   │   └── trace-lab-skill-evolution-report.md — 489 tokens (full)
│   ├── testing/
│   │   └── contract-tests.md — 1 782 tokens (full)
│   └── e2e-flow-sweep-report.md — 533 tokens (full)
├── scripts/
│   └── e2e-flow-sweep.mjs — 2 973 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 128 tokens (full)
│   │   │   ├── chat-cli.ts — 1 596 tokens (full)
│   │   │   ├── connection.ts — 1 052 tokens (full)
│   │   │   ├── gateway.ts — 1 531 tokens (full)
│   │   │   └── types.ts — 116 tokens (full)
│   │   ├── install/
│   │   │   └── paths.ts — 2 378 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 1 551 tokens (full)
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   ├── install.ts — 832 tokens (full)
│   │   │   ├── knowledge.ts — 1 605 tokens (full)
│   │   │   ├── sessions.ts — 789 tokens (full)
│   │   │   ├── trace.ts — 108 tokens (full)
│   │   │   └── types.ts — 35 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── hermes.ts — 120 tokens (full)
│   │   ├── index.ts — 2 112 tokens (full)
│   │   ├── installer.ts — 207 tokens (full)
│   │   ├── tools.ts — 1 944 tokens (full)
│   │   └── trace-store.ts — 1 662 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── app.ts — 1 266 tokens (full)
│   │   │   ├── chat.ts — 625 tokens (full)
│   │   │   ├── config.ts — 748 tokens (full)
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   ├── install.ts — 521 tokens (full)
│   │   │   └── navigation.ts — 638 tokens (full)
│   │   ├── index.d.ts — 3 345 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── styles/
│   │       │   │   ├── trace-lab-events.css — 1 337 tokens (full)
│   │       │   │   ├── trace-lab-map.css — 1 183 tokens (full)
│   │       │   │   └── trace-lab.css — 1 771 tokens (full)
│   │       │   └── main.css — 284 tokens (full)
│   │       ├── constants/
│   │       │   ├── index.ts — 50 tokens (full)
│   │       │   ├── providers.ts — 1 424 tokens (full)
│   │       │   └── types.ts — 81 tokens (full)
│   │       ├── screens/
│   │       │   ├── Chat/
│   │       │   │   ├── hooks/
│   │       │   │   │   └── useChatController.ts — 3 706 tokens (full)
│   │       │   │   ├── Chat.tsx — 1 054 tokens (full)
│   │       │   │   ├── chat.constants.ts — 669 tokens (full)
│   │       │   │   ├── chatCommands.ts — 1 369 tokens (full)
│   │       │   │   └── types.ts — 585 tokens (full)
│   │       │   ├── Layout/
│   │       │   │   └── Layout.tsx — 2 827 tokens (full)
│   │       │   ├── Setup/
│   │       │   │   └── Setup.tsx — 2 393 tokens (full)
│   │       │   └── TraceLab/
│   │       │       ├── components/
│   │       │       │   └── TraceLabComponents.tsx — 1 536 tokens (full)
│   │       │       ├── TraceLab.tsx — 3 180 tokens (full)
│   │       │       ├── trace-lab.helpers.ts — 1 734 tokens (full)
│   │       │       └── trace-lab.types.ts — 421 tokens (full)
│   │       └── App.tsx — 1 303 tokens (full)
│   └── shared/
│       └── traces.ts — 300 tokens (full)
├── tests/
│   ├── ipc-handlers.test.ts — 1 223 tokens (full)
│   ├── preload-api-surface.test.ts — 1 962 tokens (full)
│   └── trace-store.test.ts — 517 tokens (full)
├── electron.vite.config.ts — 121 tokens (full)
└── package.json — 672 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    └── shared/
        └── i18n/
            └── types.ts — 43 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `trace-lab-hardening-D75B10` | **Mode**: plan

### Response
## 1. Summary

Extend Mercury’s Trace Lab from coarse chat lifecycle tracing into structured, real-app trace coverage for resumed conversations, tool/delegation/image/artifact activity, transport errors, aborts, and local slash-command actions. This is best solved as a targeted trace-layer hardening effort: add structured trace-event normalization to the existing Hermes chat transports, persist richer event types through the current `desktop-traces.json` store without a storage refactor, update Trace Lab UI/helpers to explain those events, and add a real-token Playwright/Electron harness modeled after `scripts/e2e-flow-sweep.mjs` that drives the actual renderer → preload → IPC → main Hermes gateway/chat path and fails early when real credentials are unavailable.

## 2. Current-state analysis

Mercury’s chat and Trace Lab flow currently crosses these boundaries:

1. **Renderer**
   - `src/renderer/src/screens/Chat/hooks/useChatController.ts` sends user messages through `window.hermesAPI.sendMessage(...)`.
   - Local slash commands in `src/renderer/src/screens/Chat/chatCommands.ts` are handled entirely in the renderer and do **not** create trace runs.
   - `src/renderer/src/screens/TraceLab/TraceLab.tsx` reads persisted runs through `window.hermesAPI.listTraceRuns()` and `listSkillTrainingRuns()`.

2. **Preload**
   - `src/preload/api/chat.ts` exposes `sendMessage`, `abortChat`, and chat stream listeners.
   - `src/preload/api/navigation.ts` exposes Trace Lab read APIs.
   - `src/preload/index.d.ts` is the renderer-facing contract and must change for any new renderer-visible tracing API.

3. **Main IPC**
   - `src/main/ipc/chat.ts` owns chat trace lifecycle:
     - `createTraceRun(message, profile)`
     - records first/completed `message.agent.delta`
     - records coarse `tool.progress`
     - records `usage.recorded`
     - finishes runs as `completed`, `failed`, or `aborted`
   - `src/main/ipc/trace.ts` only exposes read handlers today.

4. **Hermes services**
   - `src/main/hermes/gateway.ts` chooses API streaming vs CLI fallback.
   - `src/main/hermes/chat-api.ts` parses OpenAI-compatible SSE, custom `hermes.tool.progress`, usage, errors, and aborts.
   - `src/main/hermes/chat-cli.ts` streams stdout/stderr but has less structured progress and no usage callback.

5. **Persistence**
   - `src/shared/traces.ts` defines a narrow `TraceEventType`.
   - `src/main/trace-store.ts` writes `<HERMES_HOME>/desktop-traces.json`.
   - Store shape is simple and reusable; no database migration is needed if richer events remain additive.

Blocking gaps:

- No explicit event types for `tool.started`, `tool.completed`, `tool.failed`, delegation, artifacts, history/resume, transport errors, or local slash commands.
- `send-message` receives `resumeSessionId` and `history`, but does not trace either.
- Image artifacts are not detected unless they appear as generic tool progress.
- Abort tracing finishes the run, but the pending IPC promise can remain unsettled depending on transport behavior.
- Trace Lab’s run map infers tool/file/artifact concepts from free text, so richer event types need helper/UI updates.
- Existing `scripts/e2e-flow-sweep.mjs` validates only one simple real chat.

## 3. Design

### A. Trace schema and persistence

Keep the existing `desktop-traces.json` store and `version: 1`. This is an additive schema change: older stores still load, and older Mercury builds can still render unknown event types as strings.

Modify `src/shared/traces.ts`:

```ts
export type TraceEventType =
  | existing types
  | "session.resumed"
  | "message.history.loaded"
  | "slash.local"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "delegation.started"
  | "delegation.completed"
  | "delegation.failed"
  | "artifact.created"
  | "approval.requested"
  | "approval.resolved"
  | "transport.error";
```

Add shared request type for local renderer-handled commands:

```ts
export interface LocalChatTraceRequest {
  command: string;
  profile?: string;
  responsePreview?: string;
  metadata?: Record<string, unknown>;
}
```

Modify `src/main/trace-store.ts`:

- Add `createLocalChatTrace(request: LocalChatTraceRequest): TraceRun`.
- Implementation behavior:
  1. Calls existing `createTraceRun(request.command, request.profile)`.
  2. Records `slash.local` with:
     - `title`: `Local command`
     - `detail`: command string capped with existing compaction behavior
     - `metadata`: sanitized metadata plus `{ command }`
  3. If `responsePreview` is non-empty, records `message.agent.delta` with title `Local response`.
  4. Calls `finishTraceRun(run.id, "completed", undefined, "Handled locally in Mercury.")`.
- Do not trace `/new` or `/clear` by default because they mutate chat state rather than producing an inspectable agent response.

### B. Structured chat trace events

Modify `src/main/hermes/types.ts` with additive internal callback types:

```ts
export interface ChatTraceCallbackEvent {
  type: TraceEventType;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatCallbacks {
  existing callbacks...
  onTraceEvent?: (event: ChatTraceCallbackEvent) => void;
}
```

Add new file `src/main/hermes/trace-events.ts`.

Responsibilities:

- Normalize custom SSE events and CLI progress text into `ChatTraceCallbackEvent[]`.
- Sanitize metadata before persistence:
  - Drop keys matching `/api[_-]?key|token|authorization|secret|password/i`.
  - Cap string values to a small preview, e.g. 2,000 chars.
  - For objects/arrays, JSON-stringify and cap.
  - Store large `args`/`result` fields as preview fields only.
- Detect image/artifact references from final agent text.

Key functions:

```ts
normalizeHermesStreamEvent(
  eventType: string,
  payload: unknown,
): ChatTraceCallbackEvent[];

normalizeCliProgressLine(line: string): ChatTraceCallbackEvent[];

extractArtifactEventsFromText(text: string): ChatTraceCallbackEvent[];
```

Normalization rules:

- `hermes.tool.progress`:
  - Extract tool name from `payload.tool`, `payload.tool_name`, `payload.name`, or label fallback.
  - Map `payload.status` / `payload.phase`:
    - `started` → `tool.started`
    - `completed` / `done` → `tool.completed`
    - `failed` / `error` → `tool.failed`
    - otherwise → existing `tool.progress`
  - If tool name or label matches `/delegate|subagent|delegate_task/i`, map to `delegation.*`.
  - If tool name or label matches `/image|generate_image/i` and payload contains URL/path/artifact fields, also emit `artifact.created`.

- `hermes.approval.*`:
  - `requested` → `approval.requested`
  - `approved` / `denied` → `approval.resolved`

- `hermes.artifact.created`:
  - Always map to `artifact.created`.

- Final response artifact scan:
  - Detect Markdown images: `![alt](url-or-path)`.
  - Detect direct URLs ending in common image extensions or containing image-generation output URLs.
  - Detect file paths in phrases such as `saved to /path/file.png`.
  - Emit `artifact.created` with metadata:
    - `artifactType: "image"`
    - `source: "response-scan"`
    - `url` or `path`
    - `alt` when available.

### C. API streaming transport

Modify `src/main/hermes/chat-api.ts`:

- In `processCustomEvent(...)`, keep the existing `onToolProgress` behavior for renderer UI.
- Additionally call `normalizeHermesStreamEvent(eventType, parsedPayload)` and forward each normalized event through `cb.onTraceEvent`.
- On SSE `parsed.error`, do not persist directly here; continue setting `lastError`. `src/main/ipc/chat.ts` will record `transport.error` when `onError` fires.
- Preserve all existing streaming, usage, empty-stream probing, and abort behavior.

### D. CLI fallback transport

Modify `src/main/hermes/chat-cli.ts`:

- For stdout lines after ANSI stripping/noise filtering, call `normalizeCliProgressLine(line)`.
- Forward normalized events via `cb.onTraceEvent`.
- Preserve existing `onChunk` behavior.
- For stderr that is forwarded as visible error text, also emit a `transport.error` trace callback with sanitized detail.
- CLI still cannot emit usage unless Hermes CLI exposes it; harness should mark usage as required for API-server runs and optional for CLI fallback only.

### E. Main chat IPC lifecycle hardening

Modify `src/main/ipc/chat.ts`.

Replace globals:

```ts
let currentChatAbort: (() => void) | null = null;
let currentTraceRunId: string | null = null;
```

with an internal active-run object:

```ts
type ActiveChatRun = {
  traceRunId: string;
  abort: () => void;
  settleAbort: () => void;
};

let activeChatRun: ActiveChatRun | null = null;
```

Behavior changes:

- Before sending a new message:
  - If an active run exists, call its `abort()`, record `run.aborted`, and settle its pending IPC promise as an abort rather than leaving it unresolved.
- After `createTraceRun(...)`:
  - If `resumeSessionId` is provided, record `session.resumed` with metadata `{ sessionId: resumeSessionId }`.
  - If `history` is non-empty, record `message.history.loaded` with metadata:
    - `messageCount`
    - `userCount`
    - `agentCount`
    - no raw message content.
- In callbacks:
  - `onTraceEvent`: record structured events only if this run is still active/running.
  - `onToolProgress`: keep sending `chat-tool-progress`; use as a legacy trace fallback only when no structured event was emitted for that same detail.
  - `onDone`: scan `fullResponse` using `extractArtifactEventsFromText(...)` before `finishTraceRun(..., "completed")`.
  - `onError`: record `transport.error`, then finish as `failed`.
- On explicit `abort-chat`:
  - Abort transport.
  - Finish current run as `aborted`.
  - Settle the pending invoke with an empty response, not `chat-error`, because user abort is not an error.
  - Keep renderer behavior unchanged: `handleAbort()` already clears loading state.

### F. Local slash-command tracing

Add renderer-visible API:

- Preload implementation in `src/preload/api/chat.ts`:

```ts
recordLocalChatTrace(request: LocalChatTraceRequest): Promise<TraceRun>
```

- IPC handler in `src/main/ipc/trace.ts`:

```ts
ipcMain.handle("record-local-chat-trace", (_event, request) =>
  createLocalChatTrace(request),
);
```

- Type declaration in `src/preload/index.d.ts`.

Modify `src/renderer/src/screens/Chat/chatCommands.ts`:

- When a local informational command produces a local response (`/model`, `/memory`, `/tools`, `/skills`, `/persona`, `/version`, `/fast`, `/usage`, `/help`), call `window.hermesAPI.recordLocalChatTrace(...)`.
- Do not block UI on trace write failure; catch and ignore after optionally logging to console.
- Do not trace `/new` or `/clear`.

### G. Trace Lab UI updates

Modify `src/renderer/src/screens/TraceLab/trace-lab.types.ts`:

- Add labels/icons for all new event types.
- Use existing Lucide icons where possible:
  - session/history: `Clock` or `Database`
  - tool lifecycle: `Wrench`
  - delegation: `BrainCircuit` or `Users`
  - artifact: `Image`
  - transport error: `AlertCircle`
  - local slash: `Sparkles` or `MessageSquareText`

Modify `trace-lab.helpers.ts`:

- Update `buildRunMap(run)`:
  - Always include Ask and Answer.
  - Include Context if `session.resumed` or `message.history.loaded` exists.
  - Include Tool Calls if any event type starts with `tool.`.
  - Include Delegation if any event type starts with `delegation.`.
  - Include Artifacts if `artifact.created` exists.
  - Keep fixed layout order but make optional steps appear only when relevant.
- Update `explainEvent(...)` for new event types.
- Update search matching to include new metadata via existing `safeStringify`.

Modify `TraceLabComponents.tsx`:

- In `EventInspector`, render object metadata with `safeStringify` instead of `String(value)`.
- Add a small artifact block when `event.type === "artifact.created"`:
  - Show artifact type.
  - Show URL/path.
  - If URL is present, provide an “Open artifact” button using `window.hermesAPI.openExternal(url)`.
  - Do not auto-load remote image URLs to avoid leaking authenticated or expiring artifact URLs.

Modify CSS files:

- `trace-lab-events.css`: styles for artifact inspector block.
- `trace-lab-map.css`: optional artifact/delegation map step tones if needed.
- Keep existing visual language; no full redesign.

### H. Real-token Trace Lab hardening harness

Add `scripts/e2e-trace-lab-hardening.mjs`.

Base it on `scripts/e2e-flow-sweep.mjs`, but expand credential checks and scenarios.

#### Harness launch

- Requires built app at `out/main/index.js`; if missing, fail with:
  - `Run npm run build before npm run e2e:trace-lab-hardening.`
- Creates temp `HERMES_HOME`.
- Symlinks real installed Hermes agent from `~/.hermes/hermes-agent`.
- Fails if Hermes agent is missing with:
  - `Hermes Agent is not installed at ~/.hermes/hermes-agent. Install/configure Hermes first.`
- Writes temp `.env`, `config.yaml`, and optional `auth.json`.
- Never writes secrets into repo files or reports.

#### Credential discovery

Use this deterministic priority:

1. Explicit harness env:
   - `TRACE_LAB_E2E_PROVIDER`
   - `TRACE_LAB_E2E_MODEL`
   - `TRACE_LAB_E2E_BASE_URL`
   - one of `TRACE_LAB_E2E_API_KEY` or `TRACE_LAB_E2E_API_KEY_ENV`
2. OpenCode Go:
   - env `OPENCODE_GO_API_KEY`
   - or local `~/.local/share/opencode/auth.json` key at `["opencode-go"].key`
3. OpenAI:
   - `OPENAI_API_KEY`
   - model default from `TRACE_LAB_E2E_MODEL` or a configured Codex-capable model when provided
4. OpenRouter:
   - `OPENROUTER_API_KEY`
5. Anthropic:
   - `ANTHROPIC_API_KEY`
6. Hermes auth:
   - Copy local `~/.hermes/auth.json` only when it has a usable `active_provider` / `providers` / `credential_pool` entry and `TRACE_LAB_E2E_PROVIDER` identifies which provider/model to use.

If none is found, stop with:

```text
Trace Lab hardening requires real model credentials.
Configure one of:
- Codex/Hermes OAuth: `hermes auth codex`, an existing `~/.hermes/auth.json` `openai-codex` provider, or an existing `~/.codex/auth.json` ChatGPT/Codex login (preferred for this hardening run)
- opencode auth login
- OPENCODE_GO_API_KEY
- OPENAI_API_KEY
- OPENROUTER_API_KEY
- ANTHROPIC_API_KEY
- TRACE_LAB_E2E_PROVIDER + TRACE_LAB_E2E_MODEL + TRACE_LAB_E2E_API_KEY(_ENV)
```

Image scenario is enabled by default when the `image_gen` toolset is enabled and should exercise the selected real app/Hermes provider path. For Codex-backed runs, configure `image_gen.provider: openai-codex` so Hermes uses its bundled OpenAI Codex image backend (`gpt-image-2` through the Codex app-server/Responses `image_generation` tool), not Fal. Pass `FAL_KEY` through only when present as an optional credential for non-Codex backends; do not block on it before the model/provider path is exercised.

Use `TRACE_LAB_E2E_SKIP_IMAGE=1` only for reduced local validation. For release hardening, do not use `TRACE_LAB_E2E_SKIP_IMAGE=1`.

#### Temp config

Write `config.yaml` with:

- selected provider/model/base URL
- `streaming: true`
- enough turns for multi-step scenarios
- `platform_toolsets.cli` including:
  - `web`
  - `terminal`
  - `file`
  - `code_execution`
  - `image_gen`
  - `delegation`
  - `skills`
  - `memory`
  - `session_search`
  - `todo`

#### Scenarios

Drive the actual UI wherever possible through Playwright selectors.

1. **Normal conversation**
   - Prompt: reply with exact marker `TRACE_HARDEN_NORMAL_OK`.
   - Expect:
     - completed trace
     - `message.user`
     - `message.agent.delta`
     - `run.completed`
     - usage tokens when API server emits usage.

2. **Resumed/history conversation**
   - Send second prompt in same chat: reference previous marker and reply `TRACE_HARDEN_RESUME_OK`.
   - Expect:
     - completed trace
     - `session.resumed`
     - `message.history.loaded`
     - session id present.

3. **Tool call**
   - Prompt asks Hermes to use terminal safely: run `pwd` only, then reply `TRACE_HARDEN_TOOL_OK`.
   - Expect:
     - completed trace
     - at least one `tool.started`, `tool.progress`, or `tool.completed`.

4. **Delegation/sub-agent**
   - Prompt asks Hermes to delegate a short summary task, then reply `TRACE_HARDEN_DELEGATION_OK`.
   - Expect:
     - completed trace
     - `delegation.*` event or tool metadata identifying `delegate_task`.

5. **Image generation**
   - Prompt through backend `/image` path: generate a tiny harmless abstract image and reply `TRACE_HARDEN_IMAGE_OK`.
   - Expect:
     - completed trace or explicit tool/provider failure if image generation is unsupported by the selected real provider/app path
     - `artifact.created` for success
     - image/artifact/OpenAI/GPT-image/tool-related evidence.

6. **Intentional error**
   - Temporarily set model to an invalid model through `window.hermesAPI.setModelConfig(...)`.
   - Send marker prompt `TRACE_HARDEN_ERROR_EXPECTED`.
   - Restore model immediately after failure.
   - Expect:
     - failed trace
     - `transport.error`
     - `run.failed`.

7. **Cancellation/abort**
   - Send long response prompt with marker `TRACE_HARDEN_ABORT_EXPECTED`.
   - Click/trigger abort after loading begins.
   - Expect:
     - aborted trace
     - `run.aborted`.

8. **Local slash command**
   - Run `/model`.
   - Expect:
     - completed trace
     - `slash.local`.

#### Verification

After scenarios:

- Read `<temp HERMES_HOME>/desktop-traces.json`.
- Match runs by marker in `messagePreview`, event detail, or agent response detail.
- Assert each scenario’s expected status/event evidence.
- Open Trace Lab UI:
  - Search each marker.
  - Verify selected detail renders.
  - Verify inspector metadata renders for at least one structured tool/artifact event.
- Write:
  - `docs/labs-e2e/trace-lab-hardening-report.md`
  - `docs/labs-e2e/trace-lab-hardening-summary.json`
  - screenshots under `docs/labs-e2e/`.

Add package script:

```json
"e2e:trace-lab-hardening": "node scripts/e2e-trace-lab-hardening.mjs"
```

## 4. File-by-file impact

### `src/shared/traces.ts`

- Add new `TraceEventType` variants.
- Add `LocalChatTraceRequest`.
- Reason: shared schema must represent richer trace evidence and local renderer-handled actions.

### `src/main/trace-store.ts`

- Add `createLocalChatTrace(...)`.
- Reuse `createTraceRun`, `recordTraceEvent`, and `finishTraceRun`.
- No store version bump.
- Depends on `LocalChatTraceRequest`.

### `src/main/hermes/types.ts`

- Add `ChatTraceCallbackEvent`.
- Add optional `onTraceEvent` to `ChatCallbacks`.
- Internal additive interface change; update API and CLI transports.

### `src/main/hermes/trace-events.ts` new

- Add normalization/sanitization helpers.
- Add final-response artifact extraction.
- Used by `chat-api.ts`, `chat-cli.ts`, and `ipc/chat.ts`.

### `src/main/hermes/chat-api.ts`

- Normalize custom SSE events into structured trace callbacks.
- Preserve existing streaming/tool-progress/usage behavior.

### `src/main/hermes/chat-cli.ts`

- Normalize CLI progress/error lines into structured trace callbacks.
- Preserve existing stdout/stderr streaming behavior.

### `src/main/ipc/chat.ts`

- Record resume/history events.
- Record structured trace callbacks.
- Add artifact extraction on completion.
- Harden abort lifecycle so pending send invokes settle.
- Preserve existing chat stream event names.

### `src/main/ipc/trace.ts`

- Add `record-local-chat-trace` handler.
- Continue owning Trace Lab read APIs.

### `src/preload/api/chat.ts`

- Add `recordLocalChatTrace(...)` invoking `record-local-chat-trace`.

### `src/preload/index.d.ts`

- Import/declare `LocalChatTraceRequest`.
- Add `recordLocalChatTrace(...)` to `HermesAPI`.

### `src/renderer/src/screens/Chat/chatCommands.ts`

- Trace local informational slash commands after response generation.
- Do not trace `/new` or `/clear`.

### `src/renderer/src/screens/TraceLab/trace-lab.types.ts`

- Add labels/icons for new event types.

### `src/renderer/src/screens/TraceLab/trace-lab.helpers.ts`

- Update run-map categorization.
- Add explanations for new event types.
- Reuse `safeStringify` for metadata search.

### `src/renderer/src/screens/TraceLab/components/TraceLabComponents.tsx`

- Render object metadata as JSON-like strings.
- Render artifact inspector cards and open-artifact action.

### `src/renderer/src/assets/styles/trace-lab-events.css`

- Add artifact inspector styling.

### `scripts/e2e-trace-lab-hardening.mjs` new

- Real-token Playwright/Electron harness.
- Drives actual app UI and preload APIs.
- Writes report/summary/screenshots.

### `package.json`

- Add `e2e:trace-lab-hardening` script.

### `tests/trace-store.test.ts`

Add coverage for:

- New structured event types persist.
- Local slash trace creates completed run with `slash.local`.
- Artifact event metadata persists and is searchable through listed runs.
- Existing skill derivation tests remain unchanged.

### `tests/ipc-handlers.test.ts`

- Optionally add `record-local-chat-trace` to explicit new channel list.

### `tests/preload-api-surface.test.ts`

- Optionally add `recordLocalChatTrace` to explicit API expectations.

### `docs/contracts/trace-schema.md`

- Document new event types.
- Document local slash trace behavior.
- Document structured tool/delegation/artifact metadata expectations.
- Document no store version bump.

### `docs/contracts/ipc-preload.md`

- Document new preload method and IPC channel.

### `docs/testing/contract-tests.md`

- Add the new harness command and when to run it.
- Update `trace-store.test.ts` responsibilities.

### `docs/labs-e2e/trace-lab-hardening-report.md` new/generated

- Written by harness after successful run.

### `docs/labs-e2e/trace-lab-hardening-summary.json` new/generated

- Written by harness after successful run.

## 5. Risks and migration

- **Store compatibility:** No migration required. Existing stores remain valid because only event-type strings and optional metadata semantics expand.
- **Rollback:** Older Mercury builds will still parse `desktop-traces.json`; unknown event types render through fallback text in current Trace Lab.
- **Secrets:** The largest risk is persisting tool args/results with secrets. The trace normalizer must sanitize metadata before `recordTraceEvent(...)`.
- **Provider ambiguity:** Codex OAuth is not represented in current Mercury provider constants. The harness must report exactly which provider/auth source it found or why it blocked.
- **Tool nondeterminism:** LLMs may ignore tool/delegation instructions. Harness prompts should be explicit, and verification should fail when required trace evidence is absent.

## Orchestrator work items

- [x] Item 1: Core trace instrumentation
  - Goal: Add structured trace event schema, sanitization/normalization, API/CLI transport trace callbacks, main chat IPC lifecycle hardening, resume/history tracking, artifact extraction, and local slash-command tracing API.
  - Done when: core trace events persist without secrets; chat send/abort/error/resume/local slash paths produce expected events; focused trace-store/preload/IPC tests are updated for touched contracts.
  - Key files/modules: `src/shared/traces.ts`, `src/main/trace-store.ts`, `src/main/hermes/*`, `src/main/ipc/chat.ts`, `src/main/ipc/trace.ts`, `src/preload/api/chat.ts`, `src/preload/index.d.ts`, `src/renderer/src/screens/Chat/chatCommands.ts`, focused tests.
  - Dependencies: none.
  - Size: large.

- [x] Item 2: Real-token app-path hardening harness
  - Goal: Add a Playwright/Electron script modeled on `scripts/e2e-flow-sweep.mjs` that launches the real app, checks real credentials/OAuth, drives broad scenarios through the real UI/preload path, verifies `desktop-traces.json` and Trace Lab UI, and writes report artifacts.
  - Done when: `npm run e2e:trace-lab-hardening` exists, fails clearly if credentials/Hermes/image auth are missing, avoids committing secrets, and produces documented summary/report outputs when runnable.
  - Key files/modules: `scripts/e2e-trace-lab-hardening.mjs`, `package.json`, `docs/testing/contract-tests.md`, generated report paths under `docs/labs-e2e/`.
  - Dependencies: can start after plan; final expectations may be adjusted after Item 1 event names land.
  - Size: large.

- [x] Item 3: Trace Lab presentation and contract docs
  - Goal: Teach Trace Lab to label/explain/render the richer structured events and update trace/IPC docs after the core event contract lands.
  - Done when: new event labels/icons/run-map steps/inspector metadata/artifact display work, docs describe the richer trace contract and local trace API, and UI changes compile.
  - Key files/modules: `src/renderer/src/screens/TraceLab/*`, `src/renderer/src/assets/styles/trace-lab-*.css`, `docs/contracts/trace-schema.md`, `docs/contracts/ipc-preload.md`, docs/tests as needed.
  - Dependencies: Item 1.
  - Size: medium.

- [x] Item 4: Verification run and gap-fix pass
  - Goal: Run focused tests/build and the real-token harness when credentials are available; inspect output for missed coverage and fix remaining gaps.
  - Done when: focused tests and typecheck pass, harness either completes with report/summary or reports a precise credential/login blocker, and any discovered trace coverage gaps are fixed or explicitly deferred.
  - Verification result: focused tests, typecheck, and build passed. Follow-up patches removed the false `FAL_KEY` preflight blocker and changed credential discovery to prefer Codex/Hermes OAuth (`openai-codex`) over OpenCode/API-key fallbacks. For Codex runs the harness configures `image_gen.provider: openai-codex`, reaches Hermes' Codex app-server image backend by default, passes `FAL_KEY` only when present for non-Codex backends, and uses `TRACE_LAB_E2E_SKIP_IMAGE=1` only for reduced validation.
  - Key files/modules: test outputs, `desktop-traces.json` from temp `HERMES_HOME`, hardening report/summary, any files implicated by failures.
  - Dependencies: Items 1–3.
  - Size: medium/large depending on findings.

## 6. Implementation order

1. Extend `src/shared/traces.ts` with new event types and `LocalChatTraceRequest`.
2. Add `src/main/hermes/trace-events.ts` with normalization, sanitization, and artifact extraction.
3. Update `src/main/hermes/types.ts`, `chat-api.ts`, and `chat-cli.ts` to emit `onTraceEvent`.
4. Update `src/main/ipc/chat.ts` for resume/history tracing, structured event recording, artifact extraction, and abort settling. This step should land atomically with step 3.
5. Add `createLocalChatTrace(...)` in `trace-store.ts`, IPC handler in `ipc/trace.ts`, preload method in `preload/api/chat.ts`, and type declaration in `preload/index.d.ts`. This IPC/preload set must land atomically.
6. Update `chatCommands.ts` to trace local informational slash commands.
7. Update Trace Lab labels, run-map helpers, inspector rendering, and CSS.
8. Add/extend `trace-store`, IPC, and preload contract tests.
9. Add `scripts/e2e-trace-lab-hardening.mjs` and package script.
10. Update trace, IPC/preload, and testing docs.
11. Run focused checks:
    ```bash
    npm run test -- tests/trace-store.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
    npm run typecheck
    ```
12. Build and run real-token harness when credentials are available:
    ```bash
    npm run build
    npm run e2e:trace-lab-hardening
    ```
13. Commit the generated hardening report, summary JSON, and screenshots only after verifying they contain no secrets.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "trace-lab-hardening-D75B10", new_chat: false)
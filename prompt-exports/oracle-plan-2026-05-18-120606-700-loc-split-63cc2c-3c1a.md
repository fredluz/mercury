## Final Prompt
<taskname="700 LOC Split"/>
<task>Create an implementation plan to logically split the current 700+ LOC code files in Mercury. Do not implement code. Produce a practical, sequenced refactor plan with target modules/files, preserved public APIs, dependencies between batches, validation commands, and risk controls.</task>

<architecture>
Mercury is a TypeScript/Electron app with renderer React code under `src/renderer`, main-process/services/runtime code under `src/main`, shared cross-boundary types under `src/shared`, Node scripts under `scripts`, and Vitest tests under `tests`. Current scope is limited to the exactly three code files reported at >=700 LOC:
- `scripts/e2e-trace-lab-hardening.mjs` (1085 LOC): Node Playwright/Electron real-app harness for Trace Lab validation.
- `src/renderer/src/screens/Chat/hooks/useChatController.ts` (892 LOC): renderer hook that owns chat input/state, activity groups, model config, slash menu, IPC event listeners, send/title/abort flows, perf telemetry, and the returned `ChatController` contract.
- `src/main/hermes/runtime.ts` (868 LOC): main-process profile runtime manager for local/SSH/remote runtime resolution, gateway process lifecycle, runtime identity/diagnostics, stale markers, port/profile safety, and command construction.

Existing LOC guard is `scripts/check-loc.mjs`: warns at >=400 LOC and fails above 500 LOC for tracked source-like files. `package.json` exposes `npm run check:loc` and focused scripts/tests. Prior investigation `docs/investigations/large-file-split-2026-05-13.md` documents previous large-file split strategy and guardrail philosophy; treat it as history/constraints, not current scope expansion.</architecture>

<selected_context>
`scripts/e2e-trace-lab-hardening.mjs`: full target file. Responsibilities observed: credential discovery (`readHermesAuth`, `readCodexCliAuth`, `discoverCredentials`), temp Hermes home/config/auth setup (`writeHermesHome`), app launch/env (`assertBuiltApp`, `buildElectronEnv`, `launchApp`), Playwright UI actions (`clickNav`, `sendPrompt*`), trace-store polling/check helpers (`waitForRun`, `runContains`, event/image classifiers), scenario verification/report writing (`verifyScenario`, `verifyImageScenario`, `writeArtifacts`), and top-level scenario orchestration in `run()`.
`scripts/check-loc.mjs`: full LOC guard; plan should keep new extracted files comfortably below 500 where practical.
`package.json`: scripts for `check:loc`, `test`, `typecheck`, `build`, `e2e:trace-lab-hardening`, and relevant focused test commands.
`docs/testing/contract-tests.md` slice: current documentation for Trace Lab hardening harness and validation commands.
`docs/investigations/large-file-split-2026-05-13.md`: prior split investigation, completed checklist, and preventive measures.

`src/renderer/src/screens/Chat/hooks/useChatController.ts`: full target hook. Responsibilities observed: core hook state/refs; activity group helpers; run/finalization/cancel state machine; renderer perf markers; model config loading/selection; scroll/focus/click-outside effects; IPC chat event listener wiring (`onChatChunk`, `onChatTraceEvent`, `onChatDone`, `onChatError`, `onChatUsage`); title generation; local slash command dispatch; send/quick-ask/approve/deny/abort/clear/input-key handlers; context usage derivation; exported `useChatController()` must remain the public entrypoint returning `ChatController`.
`src/renderer/src/screens/Chat/hooks/useChatController.test.tsx`: focused hook tests covering loading lifecycle, terminal IPC fallback, perf metadata secrecy, and session reset/resolution behavior.
`src/renderer/src/screens/Chat/Chat.tsx`, `types.ts`, `chat.constants.ts`, `chatCommands.ts`, `chatActivity.ts`: renderer consumer/types/constants/local-command/activity helpers for preserving hook contracts.
`src/renderer/src/constants/*`, `src/renderer/src/components/useI18n.ts`, `src/renderer/src/perf.ts`, `src/shared/chat-metadata.ts`, `src/shared/traces.ts`: direct dependencies used by the hook.

`src/main/hermes/runtime.ts`: full target file. Responsibilities observed: dependency injection surface (`ProfileRuntimeManagerDeps`), helper exports (`defaultLocalApiPortForProfile`, `buildHermesProfileCommandArgs`), `ProfileRuntimeManager` public methods (`normalizeProfile`, `resolveRuntime`, gateway lifecycle, health polling, stale markers, diagnostics, revalidation), private local API runtime resolution, CLI fallback handle creation, identity construction, SSH runtime verification, remote fail-closed identity, port conflict guards, auth headers, pid/config/home path helpers, and singleton export `profileRuntimeManager`.
`src/main/hermes/types.ts`, `connection.ts`, `gateway.ts`, `chat-api.ts`, `chat-cli.ts`, `title.ts`: runtime contracts and call sites. Preserve exports `ProfileRuntimeManager`, `profileRuntimeManager`, `buildHermesProfileCommandArgs`, and existing runtime handle semantics.
`src/main/config.ts`, `src/main/install/paths.ts`, `src/main/utils.ts`, `src/main/ssh-tunnel.ts`, `src/main/ssh/runtime.ts`, `src/main/ssh/config.ts`, `src/main/ssh/transport.ts`: dependencies for profile config/env, paths, SSH tunnel/runtime verification, and remote helpers.
`src/main/ipc/chat.ts`, `ipc/gateway.ts`, `ipc/config.ts`, `src/main/services/chat-service.ts`, `src/main/cronjobs.ts`: key runtime call sites and IPC/service paths that should not change behavior.
`tests/hermes-runtime.test.ts`: direct contract tests for runtime manager, command args, local/SSH/remote fail-closed behavior, diagnostics, stale invalidation, and port conflicts.
`tests/reliable-profile-runtime-contract.test.ts`: sentinel tests that read source strings and currently expect `ProfileRuntimeManager`, `private readonly states = new Map<string, RuntimeState>()`, `createUnverifiedExternalIdentity`, runtime fail-closed strings, and call-site wiring. The plan should call out that these will need deliberate updates if extraction moves sentinel strings.
`tests/chat-ipc-lifecycle.test.ts`, `tests/cron-runtime.test.ts`, `tests/hermes-title.test.ts`: adjacent tests that mock or assert runtime usage through chat/title/cron paths.</selected_context>

<relationships>
- Trace harness path: `npm run e2e:trace-lab-hardening` -> `scripts/e2e-trace-lab-hardening.mjs` -> built Electron `out/main/index.js` -> renderer UI/preload `window.hermesAPI` -> main chat/trace behavior -> generated report/summary/screenshot under `docs/labs-e2e`.
- Chat renderer path: `Chat.tsx` calls `useChatController()` -> hook returns `ChatController` typed in `types.ts` -> uses `window.hermesAPI` chat/model/config/event APIs, `chatCommands.ts` for local slash commands, `chatActivity.ts` for trace-event grouping, and shared chat/traces types.
- Runtime path: `gateway.ts`, `chat-service.ts`, `chat-api.ts`, `title.ts`, and `cronjobs.ts` use `profileRuntimeManager` / runtime handles -> `runtime.ts` depends on `connection.ts`, `config.ts`, `ssh-tunnel.ts`, `ssh/runtime.ts`, install paths, and `utils.profileHome`.
- Test path: source splits must preserve or consciously migrate imports and sentinels in `hermes-runtime.test.ts`, `reliable-profile-runtime-contract.test.ts`, `useChatController.test.tsx`, chat IPC lifecycle, title, and cron tests.
</relationships>

<plan_requirements>
Produce a plan, not code. Include separate sections for each of the three 700+ files. For each, specify:
- proposed target modules/directories and the responsibilities moved into each;
- public API/backward-compatible exports to preserve, including compatibility barrels where useful;
- extraction order that minimizes import churn and keeps tests green batch-by-batch;
- which tests/commands to run after each batch;
- risk controls for behavior-sensitive areas like chat terminal IPC, title generation races, runtime identity verification, SSH/pure-remote fail-closed behavior, secret handling, and real-app E2E artifacts;
- expected LOC outcome relative to the 500-line guard.

Stay scoped to these three files first. Mention related near-threshold or sibling files only if they materially affect extraction boundaries; do not expand the plan into a whole-repo split unless explicitly framed as future work.</plan_requirements>

<validation>
Recommended validation commands to include in the plan:
- `npm run check:loc`
- `vitest run src/renderer/src/screens/Chat/hooks/useChatController.test.tsx`
- `vitest run tests/hermes-runtime.test.ts tests/reliable-profile-runtime-contract.test.ts tests/chat-ipc-lifecycle.test.ts tests/hermes-title.test.ts tests/cron-runtime.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm run e2e:trace-lab-hardening` only when built app and real model credentials are available; otherwise document as optional/manual and preserve blocker semantics.
</validation>

<ambiguities>
- The discover prompt says the current scan found exactly three code files >=700 LOC; rely on that scope rather than rescanning the whole repo.
- No implementation should be performed in this handoff task; the requested deliverable is an implementation plan suitable for later refactor work.
- `tests/reliable-profile-runtime-contract.test.ts` has source-string sentinels that may resist mechanical extraction unless updated intentionally; account for this in sequencing.
</ambiguities>

## Selection
- Files: 48 total (42 full, 1 slice, 5 codemap)
- Total tokens: 98957 (Auto view)
- Token breakdown: full 95827, slice 999, codemap 2131

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── investigations/
│   │   └── large-file-split-2026-05-13.md — 6 036 tokens (full)
│   └── testing/
│       └── contract-tests.md — 999 tokens (lines 384-451 (Real-app Trace Lab hardening harness documentation and validation commands for e2e-trace-lab-hardening plus project checks including check:loc.))
├── scripts/
│   ├── check-loc.mjs — 641 tokens (full)
│   └── e2e-trace-lab-hardening.mjs — 9 155 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 237 tokens (full)
│   │   │   ├── chat-cli.ts — 1 803 tokens (full)
│   │   │   ├── connection.ts — 1 646 tokens (full)
│   │   │   ├── gateway.ts — 1 091 tokens (full)
│   │   │   ├── runtime.ts — 7 981 tokens (full)
│   │   │   ├── title.ts — 1 250 tokens (full)
│   │   │   └── types.ts — 775 tokens (full)
│   │   ├── install/
│   │   │   └── paths.ts — 2 378 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 1 015 tokens (full)
│   │   │   ├── config.ts — 892 tokens (full)
│   │   │   └── gateway.ts — 386 tokens (full)
│   │   ├── services/
│   │   │   └── chat-service.ts — 3 433 tokens (full)
│   │   ├── ssh/
│   │   │   ├── config.ts — 2 703 tokens (full)
│   │   │   ├── runtime.ts — 4 322 tokens (full)
│   │   │   └── transport.ts — 1 881 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── cronjobs.ts — 2 528 tokens (full)
│   │   ├── ssh-tunnel.ts — 2 723 tokens (full)
│   │   └── utils.ts — 378 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── components/
│   │       │   └── useI18n.ts — 143 tokens (full)
│   │       ├── constants/
│   │       │   ├── index.ts — 50 tokens (full)
│   │       │   └── providers.ts — 1 424 tokens (full)
│   │       ├── screens/
│   │       │   └── Chat/
│   │       │       ├── hooks/
│   │       │       │   ├── useChatController.test.tsx — 3 127 tokens (full)
│   │       │       │   └── useChatController.ts — 8 658 tokens (full)
│   │       │       ├── Chat.tsx — 1 417 tokens (full)
│   │       │       ├── chat.constants.ts — 669 tokens (full)
│   │       │       ├── chatActivity.ts — 1 461 tokens (full)
│   │       │       ├── chatCommands.ts — 1 457 tokens (full)
│   │       │       └── types.ts — 851 tokens (full)
│   │       └── perf.ts — 636 tokens (full)
│   └── shared/
│       ├── chat-metadata.ts — 1 139 tokens (full)
│       ├── runtime.ts — 310 tokens (full)
│       └── traces.ts — 417 tokens (full)
├── tests/
│   ├── chat-ipc-lifecycle.test.ts — 3 776 tokens (full)
│   ├── cron-runtime.test.ts — 1 166 tokens (full)
│   ├── hermes-runtime.test.ts — 4 996 tokens (full)
│   ├── hermes-title.test.ts — 821 tokens (full)
│   └── reliable-profile-runtime-contract.test.ts — 3 568 tokens (full)
└── package.json — 1 276 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   └── ipc/
    │       └── types.ts — 44 tokens (auto)
    ├── preload/
    │   └── index.d.ts — 1 652 tokens (auto)
    ├── renderer/
    │   └── src/
    │       └── screens/
    │           └── Schedules/
    │               └── Schedules.tsx — 189 tokens (auto)
    └── shared/
        ├── i18n/
        │   └── types.ts — 43 tokens (auto)
        └── perf.ts — 203 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `700-loc-split-63CC2C` | **Mode**: plan

### Response
## 1. Summary

Refactor exactly the three current Mercury files at or above 700 LOC by extracting cohesive helper modules while preserving their existing public entrypoints: `scripts/e2e-trace-lab-hardening.mjs` remains the executable harness, `useChatController()` remains the renderer chat hook returning the existing `ChatController` contract, and `src/main/hermes/runtime.ts` remains the public runtime-manager barrel exporting `ProfileRuntimeManager`, `profileRuntimeManager`, `buildHermesProfileCommandArgs`, and `defaultLocalApiPortForProfile`. This should be a targeted modularization, not a behavioral rewrite: extract by responsibility, keep state ownership where it is behavior-sensitive, update source-string sentinel tests deliberately, and validate each batch with focused tests before running full type/build/LOC checks.

---

## 2. Current-state analysis

### Scope and constraints

Current scope is limited to:

1. `scripts/e2e-trace-lab-hardening.mjs` — 1085 LOC.
2. `src/renderer/src/screens/Chat/hooks/useChatController.ts` — 892 LOC.
3. `src/main/hermes/runtime.ts` — 868 LOC.

The existing guard `scripts/check-loc.mjs` warns at `>=400` LOC and fails above `500` LOC for tracked source-like files. The refactor should aim for each extracted module to stay comfortably below 500 LOC, ideally below 350–400 LOC where practical.

### Shared constraints

- Do **not** change public behavior or contracts.
- Preserve current script names and package scripts:
  - `npm run e2e:trace-lab-hardening`
  - `npm run check:loc`
- Preserve renderer public hook import path:
  - `src/renderer/src/screens/Chat/hooks/useChatController.ts`
- Preserve runtime public import path:
  - `src/main/hermes/runtime.ts`
- Preserve cross-boundary IPC behavior:
  - `window.hermesAPI.sendMessage`
  - chat chunk/done/error/usage/trace listeners
  - runtime handle shape from `src/main/hermes/types.ts`
- Update `tests/reliable-profile-runtime-contract.test.ts` intentionally because it reads source strings and currently expects implementation details inside `runtime.ts`.

---

## 3. Design

## A. Split `scripts/e2e-trace-lab-hardening.mjs`

### Current responsibilities

`e2e-trace-lab-hardening.mjs` currently owns all harness behavior end-to-end:

- Credential discovery:
  - `readOpenCodeGoKey`
  - `readHermesAuth`
  - `hasHermesProvider`
  - `readCodexCliAuth`
  - `discoverCredentials`
- Temporary Hermes home setup:
  - `writeHermesHome`
  - required toolset list
  - temp `config.yaml`, `.env`, `auth.json`
- Electron launch:
  - `assertBuiltApp`
  - `buildElectronEnv`
  - `launchApp`
- Playwright chat/navigation helpers:
  - `clickNav`
  - `sendPrompt`
  - `sendPromptExpectingFailure`
  - `sendPromptAndAbort`
  - `sendPromptAndWaitForTraceTerminal`
- Trace-store polling and classifiers:
  - `waitForRun`
  - `runContains`
  - `eventTypes`
  - `hasAnyEvent`
  - image artifact/failure classifiers
- Scenario verification:
  - `verifyScenario`
  - `verifyImageScenario`
  - `verifyTraceLabSearch`
- Artifact writing:
  - `writeArtifacts`
- Top-level orchestration:
  - `run()`

### Target directory and modules

Create a harness-specific folder:

```text
scripts/trace-lab-hardening/
├── constants.mjs
├── credentials.mjs
├── hermes-home.mjs
├── electron-app.mjs
├── playwright-actions.mjs
├── trace-assertions.mjs
├── scenario-verifiers.mjs
├── artifacts.mjs
└── scenarios.mjs
```

Keep:

```text
scripts/e2e-trace-lab-hardening.mjs
```

as the executable entrypoint and orchestration shim.

### Module responsibilities

#### `scripts/trace-lab-hardening/constants.mjs`

Own static paths and constants:

- `repoRoot`
- `appEntry`
- `labsDir`
- `reportPath`
- `summaryPath`
- `screenshotPath`
- `requiredToolsets`
- `blocker(message)`
- `compact(value, max?)`
- `sleep(ms)`
- `readJsonIfExists(filePath)`

Keep this module small and dependency-light.

#### `scripts/trace-lab-hardening/credentials.mjs`

Own credential discovery and secret-safe credential metadata.

Exports:

```js
discoverCredentials(): Credentials
readHermesAuth(): HermesAuth | null
readCodexCliAuth(): CodexAuth | null
```

Shape:

```js
// illustrative only
{
  source: string,
  provider: string,
  model: string,
  baseUrl: string,
  env: Record<string, string>,
  auth?: object,
  authPath?: string,
  imageGenProvider?: string
}
```

Risk control:

- Do not log or return raw secrets except in `env`/`auth` for temporary runtime setup.
- Artifact writing must only use `credentials.source`, `provider`, and `model`.

#### `scripts/trace-lab-hardening/hermes-home.mjs`

Own isolated Hermes home creation.

Exports:

```js
writeHermesHome(credentials): string
shouldRunImageScenario(): boolean
```

Responsibilities:

- Validate installed Hermes agent at `~/.hermes/hermes-agent`.
- Create temp `HERMES_HOME`.
- Symlink installed Hermes agent.
- Write temp `.env`, `config.yaml`, and `auth.json`.
- Include `requiredToolsets`.

Risk control:

- Preserve `0o700` temp home and `0o600` sensitive files.
- Preserve Codex image-gen provider configuration.
- Preserve `FAL_KEY` pass-through behavior.

#### `scripts/trace-lab-hardening/electron-app.mjs`

Own built app validation and app launch.

Exports:

```js
assertBuiltApp(): void
buildElectronEnv(hermesHome, credentials): Record<string, string>
launchApp(hermesHome, credentials): Promise<ElectronApplication>
```

Keep Playwright import via `createRequire(import.meta.url)` in this module or pass `require` from entrypoint. Prefer localizing it here.

#### `scripts/trace-lab-hardening/playwright-actions.mjs`

Own UI driving helpers.

Exports:

```js
clickNav(page, label)
sendPrompt(page, prompt, marker, timeout?)
sendPromptExpectingFailure(page, prompt, timeout?)
sendPromptAndAbort(page, prompt)
sendPromptAndWaitForTraceTerminal(page, tracePath, prompt, marker, timeout?)
```

Dependencies:

- `readJsonIfExists`, `compact`, `sleep` from `constants.mjs`.
- `runContains` from `trace-assertions.mjs`.

Risk control:

- Preserve timeout values.
- Preserve page-closed harness failure message in `sendPromptAndWaitForTraceTerminal`.

#### `scripts/trace-lab-hardening/trace-assertions.mjs`

Own trace-store predicates and classifiers.

Exports:

```js
waitForRun(tracePath, predicate, timeout?)
runContains(run, marker): boolean
eventTypes(run): Set<string>
hasAnyEvent(run, types): boolean
hasEventMatching(run, pattern): boolean
hasImageArtifactEvidence(run): boolean
classifyExpectedImageFailure(run): string | null
isHarnessClosureError(error): boolean
```

Risk control:

- Preserve regexes for image provider dependency classification.
- Preserve `runContains` search fields so existing scenarios continue matching.

#### `scripts/trace-lab-hardening/scenario-verifiers.mjs`

Own scenario result construction.

Exports:

```js
verifyScenario(scenario, run, checks): ScenarioResult
verifyImageScenario(scenario, run): ScenarioResult
verifyTraceLabSearch(page, scenario): Promise<TraceLabResult>
```

Dependencies:

- `eventTypes`, `hasAnyEvent`, `classifyExpectedImageFailure`, `hasImageArtifactEvidence`.

#### `scripts/trace-lab-hardening/artifacts.mjs`

Own summary/report/screenshot paths and report writing.

Exports:

```js
writeArtifacts(summary): void
```

Dependencies:

- `labsDir`, `reportPath`, `summaryPath`, `screenshotPath`, `compact`.

Risk control:

- Continue excluding API keys/auth payloads from report and summary.
- Preserve exact output file paths documented in `docs/testing/contract-tests.md`.

#### `scripts/trace-lab-hardening/scenarios.mjs`

Own top-level scenario execution sequence currently embedded in `run()`.

Exports:

```js
runTraceLabHardening(): Promise<void>
```

Responsibilities:

- Discover credentials.
- Assert built app.
- Create temp Hermes home.
- Launch Electron.
- Enable toolsets.
- Execute normal, resume, tool, delegation, optional image, model-error, abort, slash scenarios.
- Verify Trace Lab UI search.
- Write artifacts.
- Close app in `finally`.

This module will likely be the largest, but keep it under 500 by moving all helper logic out.

#### `scripts/e2e-trace-lab-hardening.mjs`

Becomes:

- shebang
- imports `runTraceLabHardening`
- calls it
- preserves blocker vs non-blocker error handling and `process.exit(1)` behavior.

### Public API preservation

- Preserve command:
  - `node scripts/e2e-trace-lab-hardening.mjs`
  - `npm run e2e:trace-lab-hardening`
- Preserve report paths:
  - `docs/labs-e2e/trace-lab-hardening-report.md`
  - `docs/labs-e2e/trace-lab-hardening-summary.json`
  - `docs/labs-e2e/trace-lab-hardening.png`
- Preserve environment variables:
  - `TRACE_LAB_E2E_PROVIDER`
  - `TRACE_LAB_E2E_MODEL`
  - `TRACE_LAB_E2E_BASE_URL`
  - `TRACE_LAB_E2E_API_KEY`
  - `TRACE_LAB_E2E_API_KEY_ENV`
  - `TRACE_LAB_E2E_SKIP_IMAGE`
  - `TRACE_LAB_E2E_IMAGE_MODEL`
  - provider keys and `FAL_KEY`

### Extraction order

1. Extract `constants.mjs`.
2. Extract `credentials.mjs`.
3. Extract `hermes-home.mjs`.
4. Extract `electron-app.mjs`.
5. Extract `trace-assertions.mjs`.
6. Extract `playwright-actions.mjs`.
7. Extract `scenario-verifiers.mjs`.
8. Extract `artifacts.mjs`.
9. Move orchestration to `scenarios.mjs`.
10. Shrink entrypoint.

### Validation after this batch

Run:

```bash
npm run check:loc
npm run typecheck
npm run build
```

Optional/manual, only with built app and real credentials:

```bash
npm run e2e:trace-lab-hardening
```

If credentials are not available, verify blocker semantics manually by running the script in an environment without credentials and confirming it exits with the existing actionable blocker message.

### Expected LOC outcome

- `scripts/e2e-trace-lab-hardening.mjs`: under 50 LOC.
- `scenarios.mjs`: target 300–450 LOC.
- Other helper modules: target 50–250 LOC each.

---

## B. Split `src/renderer/src/screens/Chat/hooks/useChatController.ts`

### Current responsibilities

`useChatController.ts` currently owns:

- Core hook state and refs.
- Chat activity group state machine.
- Send run/finalization/cancellation state machine.
- Renderer perf telemetry.
- Model loading and model selection.
- Scroll/focus/click-outside effects.
- Slash menu state and local command execution.
- IPC listener registration:
  - chunks
  - trace events
  - done
  - error
  - usage
- Send flows:
  - normal send
  - quick ask
  - approve
  - deny
  - abort
  - clear
- Title generation.
- Context usage calculation.
- `ChatController` returned object.

The behavior-sensitive parts are IPC terminal state, stale run suppression, title generation races, and perf metadata secrecy.

### Target modules

Create:

```text
src/renderer/src/screens/Chat/hooks/
├── useChatController.ts
├── useChatActivityGroups.ts
├── useChatRunState.ts
├── useChatModelConfig.ts
├── useChatScroll.ts
├── useChatSlashMenu.ts
├── useChatIpcListeners.ts
├── useChatTitleGeneration.ts
├── chatPerf.ts
└── chatSendFlows.ts
```

Alternative if implementer prefers fewer modules: combine `chatPerf.ts` into `useChatRunState.ts`, but keep `useChatController.ts` below 500.

### Module responsibilities

#### `useChatActivityGroups.ts`

Own activity group lifecycle.

Inputs:

```ts
appendActivityEvent(traceEvent: TraceEvent): void
beginActivityGroup(anchorMessageId: string): void
markActiveActivityGroup(status: ChatActivityGroupStatus): void
toggleActivityGroup(groupId: string): void
```

State owned:

```ts
activityGroups: ChatActivityGroup[]
activeActivityGroupIdRef: RefObject<string | null>
```

Dependencies:

- `isChatActivityEvent` from `../chatActivity`.
- `TraceEvent`, `ChatActivityGroup`, `ChatActivityGroupStatus`.

Contract:

- Deduplicate events by `event.id`.
- Attach event to matching `runId` group first, otherwise active group.
- Drop empty activity group after completion/abort.

#### `useChatRunState.ts`

Own send run sequencing/finalization/cancellation.

State/refs:

```ts
sendRunSeqRef
activeSendRunSeqRef
finalizedSendRunSeqRef
cancelledSendRunSeqsRef
isLoading
isLoadingRef
```

Exports:

```ts
beginChatRun(): number
finalizeChatRun(runSeq, status): boolean
finalizeActiveChatRun(status): void
cancelActiveChatRun(status): void
isSendRunCurrentOrFinalized(runSeq): boolean
resetRunState(): void
```

Dependencies:

- `markActiveActivityGroup(status)` callback from `useChatActivityGroups`.

Risk control:

- Preserve stale result suppression:
  - cancelled run must not apply session/title.
  - finalized run can still apply result when terminal IPC arrived before `sendMessage` promise resolved.
- Preserve loading-clearing behavior covered by `useChatController.test.tsx`.

#### `chatPerf.ts`

Own pure perf helper functions and metadata shape.

Exports:

```ts
createChatPerfTracker(markRendererPerf, getNow)
```

or simpler helper functions:

```ts
markChatPerfRunStart(...)
markChatPerfChunk(...)
markChatPerfDone(...)
markChatPerfError(...)
markChatPerfIpcResolved(...)
markChatPerfIpcRejected(...)
markChatPerfAbort(...)
```

State can remain in `useChatController` or move into a small hook:

```ts
useChatPerf(): {
  currentChatPerfRef,
  chunkCallbackCountRef,
  firstChunkMarkedRunSeqRef,
  markRunStart,
  markChunk,
  markDone,
  markError,
  markIpcResolved,
  markIpcRejected,
  markAbort,
  reset
}
```

Risk control:

- Keep metadata length-only:
  - `messageLength`
  - `responseLength`
  - `errorLength`
  - no raw prompt or raw response.
- Preserve test expectation in `useChatController.test.tsx`.

#### `useChatModelConfig.ts`

Own model-related state and operations.

State:

```ts
currentModel
currentProvider
currentBaseUrl
currentContextInfo
modelGroups
showModelPicker
customModelInput
pickerRef
```

Exports:

```ts
loadModelConfig(): Promise<void>
selectModel(provider, model, baseUrl, contextWindow?): Promise<void>
handleCustomModelSubmit(): Promise<void>
displayModel: string
currentContextInfoRef
currentModelRef
currentProviderRef
```

Dependencies:

- `window.hermesAPI.getModelConfig`
- `window.hermesAPI.listModels`
- `window.hermesAPI.setModelConfig`
- `inferContextWindow`
- `PROVIDERS`
- `t`

Risk control:

- Preserve profile dependency behavior.
- Preserve context-window inference.

#### `useChatScroll.ts`

Own scroll/focus effects.

Inputs:

```ts
messages
activityGroups
isLoading
onNewChat
```

Exports:

```ts
messagesEndRef
messagesContainerRef
inputRef
scrollToBottom(force?)
userScrolledUpRef
```

Responsibilities:

- Scroll listener.
- Auto-scroll on messages/activity.
- Reset scroll on new user message.
- Focus input when loading ends.
- Cmd/Ctrl+N shortcut can either stay in main hook or move here; if moved, name it clearly.

#### `useChatSlashMenu.ts`

Own slash menu UI state.

State:

```ts
slashMenuOpen
slashFilter
slashSelectedIndex
slashMenuRef
filteredSlashCommands
```

Exports:

```ts
handleInputChange(e)
handleKeyDownSlashPart(e, onSelect)
handleSlashSelect(...)
setSlashMenuOpen
setSlashSelectedIndex
```

Because `handleKeyDown` also sends on Enter, the cleanest split is:

- `useChatSlashMenu` provides slash-specific helpers.
- Main hook composes final `handleKeyDown`.

Dependencies:

- `SLASH_COMMANDS`
- `SlashCommand`

Risk control:

- Preserve slash filtering only for input starting with `/` and no spaces.
- Preserve arrow/tab/enter/escape behavior.

#### `useChatIpcListeners.ts`

Own registration of `window.hermesAPI` chat event listeners.

Inputs:

```ts
setMessages
appendActivityEvent
finalizeActiveChatRun
setHermesSessionId
setUsage
currentContextInfoRef
currentModelRef
currentProviderRef
perfTracker
```

Responsibilities:

- `onChatChunk`: append/merge agent message.
- `onChatTraceEvent`: call `appendActivityEvent`.
- `onChatDone`: set session id and finalize completed.
- `onChatError`: append error and finalize failed.
- `onChatUsage`: aggregate usage.

Risk control:

- Effect dependencies must remain stable to avoid re-registering terminal listeners on model/context state changes. Existing test asserts `onChatDone` and `onChatError` are registered once after model selection.
- Use refs for model/context inside usage handler, not effect dependencies.

#### `useChatTitleGeneration.ts`

Own title generation race control.

Inputs:

```ts
profileRef
sessionIdRef
sessionTitleRef
messagesRef
titleRequestSeqRef
onSessionTitleChange
```

State:

```ts
titleGenerationPending
```

Exports:

```ts
requestGeneratedTitleOnce(resolvedSessionId, conversationMessages, requestSeq): Promise<void>
resetTitleGeneration(): void
bumpTitleRequestSeq(): number
```

Risk control:

- Preserve current constraints:
  - only generate after first eligible non-slash user message.
  - ignore stale results by request sequence.
  - do not overwrite existing title.
  - do not apply if conversation was cleared/reset.
  - use `window.hermesAPI.generateChatTitle`.

#### `chatSendFlows.ts`

Own imperative send flow helpers, but avoid hiding too much state. Use functions that receive an explicit context object instead of creating a second state owner.

Exports:

```ts
sendNormalMessage(ctx): Promise<void>
sendQuickAsk(ctx): Promise<void>
sendApprovalCommand(ctx, command: "/approve" | "/deny"): void
clearChat(ctx): void
abortChat(ctx): void
```

However, do this only after the state hooks above exist. If this extraction becomes too parameter-heavy, keep send handlers in `useChatController.ts`; the file should still drop below 500 after extracting activity/model/IPC/title/scroll/slash/perf.

### Public API preservation

`useChatController.ts` must continue exporting:

```ts
export function useChatController(args: UseChatControllerArgs): ChatController
```

`Chat.tsx` and tests should not change imports.

The returned `ChatController` fields in `types.ts` must remain unchanged.

### Extraction order

1. Extract pure/low-risk modules:
   - `chatPerf.ts`
   - `useChatActivityGroups.ts`
2. Extract model config:
   - `useChatModelConfig.ts`
3. Extract title generation:
   - `useChatTitleGeneration.ts`
4. Extract run state:
   - `useChatRunState.ts`
5. Extract IPC listeners:
   - `useChatIpcListeners.ts`
6. Extract scroll and slash menu:
   - `useChatScroll.ts`
   - `useChatSlashMenu.ts`
7. Optionally extract send flows if `useChatController.ts` still exceeds 500 LOC.
8. Keep final `useChatController.ts` as composition layer that wires hooks and returns `ChatController`.

### Validation after each meaningful extraction

Run focused hook tests frequently:

```bash
vitest run src/renderer/src/screens/Chat/hooks/useChatController.test.tsx
```

After completing chat hook split:

```bash
npm run typecheck
npm run check:loc
```

For broader chat path confidence:

```bash
vitest run tests/chat-ipc-lifecycle.test.ts tests/hermes-title.test.ts
```

### Behavior risk controls

- **Terminal IPC:** `onChatDone`/`onChatError` must still clear loading even if `sendMessage` promise later resolves/rejects.
- **Promise fallback:** if send promise rejects without terminal IPC, append fallback error once.
- **Session state:** external empty resume session id must be preserved unless explicit clear occurs.
- **Conversation reset:** stale send result must not resolve session/title after reset.
- **Listener churn:** model/context changes must not re-register done/error listeners.
- **Perf secrecy:** never include raw prompt or response in telemetry metadata.
- **Title races:** keep sequence and session/title guards unchanged.

### Expected LOC outcome

- `useChatController.ts`: target 250–450 LOC.
- Extracted hook modules: target 80–250 LOC each.
- No extracted file should exceed 500 LOC.

---

## C. Split `src/main/hermes/runtime.ts`

### Current responsibilities

`runtime.ts` currently owns:

- Types for dependency injection:
  - `ProfileRuntimeManagerDeps`
  - internal `RuntimeState`
- Pure helpers:
  - profile normalization
  - named profile detection
  - secret fingerprinting
  - command arg construction
- Runtime manager public lifecycle:
  - `resolveRuntime`
  - `ensureInitialized`
  - `startGateway`, `stopGateway`, `restartGateway`
  - `isGatewayRunning`, `isApiReady`
  - health polling
  - stale markers and revalidation
  - diagnostics
- Runtime handle creation:
  - local API runtime
  - CLI runtime
  - SSH API runtime
  - unverified remote identity
- Identity construction:
  - local API identity
  - SSH identity
  - diagnostic identity
- Safety checks:
  - named profile default-port conflict
  - shared port conflict
- File/pid/config/home helpers.
- Singleton export:
  - `profileRuntimeManager`

### Target modules

Create:

```text
src/main/hermes/runtime/
├── profile.ts
├── command.ts
├── state.ts
├── identity.ts
├── diagnostics.ts
├── local-runtime.ts
├── ssh-runtime.ts
├── gateway-lifecycle.ts
└── manager.ts
```

Keep existing:

```text
src/main/hermes/runtime.ts
```

as a compatibility barrel.

### Module responsibilities

#### `src/main/hermes/runtime/profile.ts`

Pure helpers:

```ts
export function normalizeProfile(profile?: string): string
export function isNamedProfile(profile: string): boolean
export function fingerprintSecret(secret?: string): string | undefined
```

Contracts:

- `undefined`, empty, whitespace, and `"default"` normalize to `"default"`.
- Named profile remains trimmed string.

#### `src/main/hermes/runtime/command.ts`

Exports:

```ts
export function buildHermesProfileCommandArgs(
  hermesScript: string,
  profile: string | undefined,
  commandArgs: string[],
): string[]
```

Dependencies:

- `normalizeProfile`, `isNamedProfile`.

Public API:

- Re-export this from `src/main/hermes/runtime.ts`.

#### `src/main/hermes/runtime/state.ts`

Own internal state types and helpers.

Exports:

```ts
export type RuntimeState = { ... }
export function createInitialRuntimeState(): RuntimeState
```

Important: `RuntimeState` does not need to remain public from barrel unless tests need typed construction. Prefer internal exports only for manager modules.

#### `src/main/hermes/runtime/identity.ts`

Own identity construction helpers that do not mutate manager state directly.

Functions can be methods on a helper class or pure functions with explicit dependency input. To minimize churn, prefer a small class:

```ts
export class RuntimeIdentityFactory {
  constructor(deps: IdentityFactoryDeps)

  createCliRuntimeHandle(request): ProfileRuntimeHandle
  createLocalApiIdentity(profile, evidence): RuntimeIdentity
  createSshIdentity(request, apiBaseUrl, evidence, verified, apiKey?): RuntimeIdentity
  createDiagnosticIdentity(profile, mode): RuntimeIdentity
  createUnverifiedExternalIdentity(request): RuntimeIdentity
  authSourceFor(identity): RuntimeDiagnostic["authSource"]
}
```

Dependencies passed in:

- `readEnv`
- `getLocalApiPort`
- `getLocalApiUrl`
- `getConnectionConfig`
- `getSshTunnelUrl`
- `profileHome`
- `now`
- `hermesScript`

Risk control:

- Preserve all identity fields and mismatch reason strings unless tests are deliberately updated.
- Preserve `authKeyFingerprint` behavior.

#### `src/main/hermes/runtime/diagnostics.ts`

Can either be:

1. A pure function:

```ts
buildRuntimeDiagnostic(args): RuntimeDiagnostic
```

or

2. Kept inside `manager.ts` if extraction creates too much coupling.

Recommended: extract only after `identity.ts` exists.

Responsibilities:

- Compute status:
  - `verified`
  - `unverified`
  - `mismatch`
  - `stale`
  - `unsupported`
- Apply mode mismatch stale reason.
- Mark unsupported for pure remote or unsupported identity.

Risk control:

- Preserve fields in `RuntimeDiagnostic` from `src/shared/runtime.ts`.
- Preserve pure remote unsupported behavior.

#### `src/main/hermes/runtime/local-runtime.ts`

Own local API and CLI runtime resolution helpers.

Possible shape:

```ts
export class LocalRuntimeResolver {
  resolveLocalApiRuntime(request, options, state): Promise<ProfileRuntimeHandle | null>
  createCliRuntimeHandle(request): ProfileRuntimeHandle
  checkLocalApiReady(profile): Promise<boolean>
  localAuthHeaders(profile): Record<string, string>
}
```

But avoid over-abstraction. If class introduces too much dependency passing, keep these as private methods in `manager.ts` and instead extract identity/command/profile first. The primary target is under 500 LOC, not maximum decomposition.

Recommended practical split:

- Move `createCliRuntimeHandle` to `identity.ts`.
- Move `checkLocalApiReady` and `localAuthHeaders` to small injected helper functions or keep in manager.
- Move only `resolveLocalApiRuntime` once identity factory exists.

Risk control:

- Preserve named profile fallback to CLI when no managed API evidence exists.
- Preserve default profile legacy API probe allowance.
- Preserve stale marker preventing API runtime use.

#### `src/main/hermes/runtime/ssh-runtime.ts`

Own SSH runtime verification flow.

Exports:

```ts
resolveSshApiRuntime(ctx, request): Promise<ProfileRuntimeHandle>
```

Inputs via context:

- `getConnectionConfig`
- `getSshTunnelUrl`
- `verifySshRuntime`
- `getRemoteAuthHeader`
- identity factory
- state setter callback for `lastIdentity`

Risk control:

- Preserve fail-closed behavior:
  - named profile on default remote port rejects.
  - missing tunnel rejects.
  - unverified SSH evidence rejects and stores last identity.
  - only verified evidence returns `ssh-api` handle.
- Preserve `ProfileRuntimeError` codes.

#### `src/main/hermes/runtime/gateway-lifecycle.ts`

Own local gateway process lifecycle helpers if needed.

Possible extraction:

```ts
startLocalGateway(ctx, profile, state): boolean
stopLocalGateway(ctx, profile, state, force): void
isLocalGatewayRunning(ctx, profile, state): boolean
```

However, gateway lifecycle uses many private helpers and state mutation. Extract after identity/profile/command if `manager.ts` remains too large.

Risk control:

- Preserve process env:
  - `PATH`
  - `HOME`
  - `HERMES_HOME`
  - `API_SERVER_ENABLED`
  - `API_SERVER_HOST`
  - `API_SERVER_PORT`
  - profile env variables.
- Preserve `child.unref()`.
- Preserve delayed API readiness check.
- Preserve `close` handler state reset.

#### `src/main/hermes/runtime/manager.ts`

Own `ProfileRuntimeManager` class and dependency injection surface.

Exports:

```ts
export interface ProfileRuntimeManagerDeps { ... }
export class ProfileRuntimeManager { ... }
```

This remains the orchestration owner:

- `states = new Map<string, RuntimeState>()`
- public methods
- delegates to extracted helpers.

Important source-string sentinel:

- Current test expects `private readonly states = new Map<string, RuntimeState>()`.
- To minimize sentinel churn, keep that exact declaration in `manager.ts`.
- Update sentinel test to read `src/main/hermes/runtime/manager.ts` for this string instead of `runtime.ts`.

#### `src/main/hermes/runtime.ts`

Compatibility barrel:

```ts
export { defaultLocalApiPortForProfile } from "./connection";
export { buildHermesProfileCommandArgs } from "./runtime/command";
export {
  ProfileRuntimeManager,
  type ProfileRuntimeManagerDeps,
} from "./runtime/manager";
export const profileRuntimeManager = new ProfileRuntimeManager();
```

If cyclic naming confusion arises from `runtime.ts` and `runtime/`, TypeScript can handle it, but keep imports explicit.

### Public API preservation

Must preserve imports used by call sites/tests:

```ts
import {
  buildHermesProfileCommandArgs,
  ProfileRuntimeManager,
  type ProfileRuntimeManagerDeps,
  profileRuntimeManager,
} from "../src/main/hermes/runtime";
```

Must preserve:

- runtime handle semantics in `ProfileRuntimeHandle`.
- `ProfileRuntimeError` throwing behavior and codes.
- local/SSH/remote mode behavior.
- stale marker semantics.
- diagnostics shape.

### Extraction order

1. Extract pure helpers:
   - `runtime/profile.ts`
   - `runtime/command.ts`
   - update `runtime.ts` to re-export command.
   - Validate command tests.
2. Extract `RuntimeState`:
   - `runtime/state.ts`
   - keep `states` declaration in `ProfileRuntimeManager` for sentinel compatibility, but import `RuntimeState`.
3. Extract identity factory:
   - `runtime/identity.ts`
   - update manager private identity methods to delegate or remove them.
   - Preserve helper method names if sentinel tests still expect strings; otherwise update sentinels in same batch.
4. Extract SSH runtime resolver:
   - `runtime/ssh-runtime.ts`
   - update `resolveRuntime` to delegate mode `"ssh"` path.
5. Extract diagnostics builder:
   - `runtime/diagnostics.ts`
6. Extract local runtime/gateway lifecycle only if `manager.ts` remains above 500 LOC.
7. Convert root `runtime.ts` into compatibility barrel and move class implementation to `runtime/manager.ts`.
8. Update tests that read source-string sentinels:
   - `tests/reliable-profile-runtime-contract.test.ts`

### Required sentinel test updates

`tests/reliable-profile-runtime-contract.test.ts` currently reads:

```ts
const runtimeManager = src("src/main/hermes/runtime.ts");
```

Update the plan implementation to make it read both:

```ts
const runtimeBarrel = src("src/main/hermes/runtime.ts");
const runtimeManager = src("src/main/hermes/runtime/manager.ts");
const runtimeIdentity = src("src/main/hermes/runtime/identity.ts");
const runtimeSsh = src("src/main/hermes/runtime/ssh-runtime.ts");
```

Then adjust expectations:

- Barrel contains exported public API.
- Manager contains `export class ProfileRuntimeManager`.
- Manager contains `private readonly states = new Map<string, RuntimeState>()`.
- Identity module contains `createUnverifiedExternalIdentity`.
- SSH module contains SSH fail-closed strings.
- Manager/barrel still exposes stale methods.

This is not weakening the test; it is aligning source sentinels with the new architecture.

### Validation after each runtime extraction batch

Run:

```bash
vitest run tests/hermes-runtime.test.ts
```

After moving manager/barrel and updating sentinels:

```bash
vitest run tests/hermes-runtime.test.ts tests/reliable-profile-runtime-contract.test.ts
```

Then adjacent runtime consumers:

```bash
vitest run tests/chat-ipc-lifecycle.test.ts tests/hermes-title.test.ts tests/cron-runtime.test.ts
```

Then broader checks:

```bash
npm run typecheck
npm run check:loc
```

### Runtime risk controls

- **SSH fail-closed:** preserve rejection for named SSH profile using default remote port.
- **Pure remote fail-closed:** preserve `runtime-unsupported-remote-profile`.
- **Runtime identity:** only return API handles when `identity.verified` and `actualProfile` match.
- **Port conflicts:** keep named profile default-port guard and cross-profile port conflict guard.
- **Stale markers:** `clearRuntimeStale` must not clear stale before verified revalidation.
- **Auth:** preserve API key fingerprinting and `Authorization` headers.
- **Process lifecycle:** preserve gateway state keyed per profile and health polling cleanup.
- **Dependency injection:** keep `ProfileRuntimeManagerDeps` names compatible with tests.

### Expected LOC outcome

- `src/main/hermes/runtime.ts`: under 80 LOC as compatibility barrel.
- `runtime/manager.ts`: target 300–450 LOC.
- `runtime/identity.ts`: target 150–300 LOC.
- `runtime/ssh-runtime.ts`: target 80–180 LOC.
- Other helper modules: target 30–150 LOC.

---

## 4. File-by-file impact

### `scripts/e2e-trace-lab-hardening.mjs`

- Replace monolithic implementation with executable entrypoint.
- Preserve shebang and error handling.
- Depends on all new `scripts/trace-lab-hardening/*` modules.

### `scripts/trace-lab-hardening/constants.mjs`

- Add shared constants, paths, and utility helpers.
- Must be created first.

### `scripts/trace-lab-hardening/credentials.mjs`

- Add credential discovery logic.
- Depends on `constants.mjs`.

### `scripts/trace-lab-hardening/hermes-home.mjs`

- Add temp Hermes home/config/auth setup.
- Depends on `constants.mjs` and credential shape.

### `scripts/trace-lab-hardening/electron-app.mjs`

- Add build assertion and launch helpers.
- Depends on `constants.mjs`.

### `scripts/trace-lab-hardening/playwright-actions.mjs`

- Add UI action helpers.
- Depends on `constants.mjs` and `trace-assertions.mjs`.

### `scripts/trace-lab-hardening/trace-assertions.mjs`

- Add trace predicates/classifiers.
- Depends on `constants.mjs`.

### `scripts/trace-lab-hardening/scenario-verifiers.mjs`

- Add scenario result builders and Trace Lab UI search verifier.
- Depends on `trace-assertions.mjs`.

### `scripts/trace-lab-hardening/artifacts.mjs`

- Add report/summary writing.
- Depends on `constants.mjs`.

### `scripts/trace-lab-hardening/scenarios.mjs`

- Add top-level orchestration.
- Depends on all harness helper modules.

### `src/renderer/src/screens/Chat/hooks/useChatController.ts`

- Reduce to composition layer.
- Preserve exported `useChatController`.
- Wire extracted hooks/helpers and return unchanged `ChatController`.

### New chat hook modules

- `useChatActivityGroups.ts`
- `useChatRunState.ts`
- `useChatModelConfig.ts`
- `useChatScroll.ts`
- `useChatSlashMenu.ts`
- `useChatIpcListeners.ts`
- `useChatTitleGeneration.ts`
- `chatPerf.ts`
- optionally `chatSendFlows.ts`

All are internal to the Chat feature folder. No external imports should target them initially except tests if future focused tests are added.

### `src/main/hermes/runtime.ts`

- Convert to compatibility barrel.
- Preserve public exports.

### New runtime modules

- `src/main/hermes/runtime/profile.ts`
- `src/main/hermes/runtime/command.ts`
- `src/main/hermes/runtime/state.ts`
- `src/main/hermes/runtime/identity.ts`
- `src/main/hermes/runtime/diagnostics.ts`
- `src/main/hermes/runtime/local-runtime.ts`
- `src/main/hermes/runtime/ssh-runtime.ts`
- `src/main/hermes/runtime/gateway-lifecycle.ts`
- `src/main/hermes/runtime/manager.ts`

Implement only modules needed to get all files below 500; `local-runtime.ts` and `gateway-lifecycle.ts` may be deferred if `manager.ts` is already below threshold.

### `tests/reliable-profile-runtime-contract.test.ts`

- Deliberately update source-string sentinel paths to inspect new runtime modules.
- Keep behavioral assertions unchanged.

### `tests/hermes-runtime.test.ts`

- Ideally no import changes because root `runtime.ts` preserves public exports.
- If source-string expectations are added later, point them at new module paths.

### `src/main/hermes/gateway.ts`, `src/main/hermes/chat-cli.ts`, `src/main/cronjobs.ts`

- No import changes expected if barrel exports are preserved.
- Validate with runtime and cron tests.

---

## 5. Risks and migration

### Breaking-change risk

Low if compatibility barrels are used. The only expected test break is intentional in source-string sentinel tests.

### Main risks

- Chat hook extraction can accidentally change closure dependencies and re-register IPC listeners.
- Runtime extraction can weaken fail-closed identity checks if helpers return handles too early.
- E2E harness extraction can accidentally leak secrets to reports or alter blocker semantics.
- New extracted files can themselves exceed 500 LOC if orchestration is not split enough.

### Mitigations

- Extract pure helpers first.
- Keep public entrypoints unchanged.
- Run focused tests after each batch.
- Update sentinel tests in the same commit as moving `ProfileRuntimeManager`.
- Run `npm run check:loc` before considering the work complete.
- Keep optional real-app E2E manual because it requires build artifacts and real credentials.

---

## 6. Implementation order

1. **Trace harness split**
   1. Add `scripts/trace-lab-hardening/constants.mjs`.
   2. Extract credentials, Hermes home setup, app launch, trace assertions, Playwright actions, verifiers, artifacts.
   3. Move scenario orchestration to `scenarios.mjs`.
   4. Shrink `e2e-trace-lab-hardening.mjs`.
   5. Validate:
      ```bash
      npm run check:loc
      npm run typecheck
      npm run build
      ```

2. **Chat hook split**
   1. Extract `chatPerf.ts` and `useChatActivityGroups.ts`.
   2. Extract `useChatModelConfig.ts`.
   3. Extract `useChatTitleGeneration.ts`.
   4. Extract `useChatRunState.ts`.
   5. Extract `useChatIpcListeners.ts`.
   6. Extract scroll/slash helpers.
   7. Extract send flows only if needed for LOC.
   8. Validate:
      ```bash
      vitest run src/renderer/src/screens/Chat/hooks/useChatController.test.tsx
      vitest run tests/chat-ipc-lifecycle.test.ts tests/hermes-title.test.ts
      npm run typecheck
      npm run check:loc
      ```

3. **Runtime manager split**
   1. Extract profile/command/state helpers.
   2. Extract identity construction.
   3. Extract SSH runtime resolver.
   4. Extract diagnostics and local/gateway helpers as needed.
   5. Move class to `runtime/manager.ts`.
   6. Convert root `runtime.ts` to compatibility barrel.
   7. Update source-string sentinel tests.
   8. Validate:
      ```bash
      vitest run tests/hermes-runtime.test.ts tests/reliable-profile-runtime-contract.test.ts tests/chat-ipc-lifecycle.test.ts tests/hermes-title.test.ts tests/cron-runtime.test.ts
      npm run typecheck
      npm run check:loc
      ```

4. **Final project validation**
   ```bash
   npm run check:loc
   npm run typecheck
   npm run build
   ```

5. **Optional/manual release-path validation**
   Run only when the built app and real model credentials are available:
   ```bash
   npm run e2e:trace-lab-hardening
   ```

   If credentials are unavailable, preserve and manually verify the existing blocker behavior rather than faking traces.

---

## Orchestrator progress

- [x] Item 1 — Split `scripts/e2e-trace-lab-hardening.mjs` into `scripts/trace-lab-hardening/*` helper modules while preserving the executable script and artifact paths. Completed by session `4CB63B32-0494-4F01-8E72-5C15BA94FB70`. Reported validation: `node --check` passed, `npm run typecheck` passed, no-credential blocker smoke preserved; `npm run check:loc` still fails due remaining planned/out-of-scope large files. Spot-check confirmed 13-line entrypoint and helper modules under 500 LOC.
- [x] Item 2 — Split `src/renderer/src/screens/Chat/hooks/useChatController.ts` into focused hooks/helpers while preserving the public `useChatController()` contract. Completed by session `168C7996-4F29-40F1-94EF-CA4D4F597061`. Reported validation: focused `useChatController` tests passed via `npx vitest`, chat IPC/title tests passed, `npm run typecheck` passed; `npm run check:loc` still fails due remaining runtime and pre-existing large files. Spot-check confirmed `useChatController.ts` at 399 LOC and new helper hooks under 500 LOC.
- [x] Item 3 — Split `src/main/hermes/runtime.ts` into `src/main/hermes/runtime/*` modules plus a compatibility barrel while preserving runtime public exports and tests. Completed by session `B6A990AE-9704-4F44-9919-6F49604A056D`. Reported validation: runtime tests passed. Orchestrator validation: direct runtime tests passed, chat IPC/title/cron tests passed, `npm run typecheck` passed; `npm run check:loc` no longer lists the three targeted 700+ files but still fails on separate pre-existing >500 LOC files. Spot-check confirmed 9-line runtime barrel, `manager.ts` at 474 LOC, and updated sentinel tests.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "700-loc-split-63CC2C", new_chat: false)
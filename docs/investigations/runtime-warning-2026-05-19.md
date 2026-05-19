# Investigation: Runtime Warning Banner

## Summary
The banner is one conservative local-runtime diagnostic shown twice: `Layout` polls runtime diagnostics before chat execution has verified a local runtime, then renders the warning globally while `ChatHeader` renders the same diagnostic compactly next to `Agent: Default`.

The underlying state is usually idle/preflight “no verified runtime identity yet,” not two failures and not necessarily a failed verification attempt.

## Symptoms
- New Chat screen shows a top-level banner: “RUNTIME WARNING Local runtime identity has not been verified yet.”
- Chat header also shows the same warning inline next to `Agent: Default`.
- The warning appears before a user message is sent, suggesting it is derived from selected agent/runtime/profile state rather than a failed chat request.
- The wording is security-oriented and may be too alarming or too prominent if the runtime is merely unverified/pending setup.

## Background / Prior Research
No external research gathered yet. This appears to be a workspace-local behavior involving Mercury’s runtime/profile/connection state and renderer presentation.

Initial hypotheses to test:
- Runtime identity verification state is computed in shared/main runtime code and exposed to the renderer as chat/profile metadata.
- The renderer renders the same warning from two surfaces: a global/system warning area and chat header metadata.
- The warning may be expected for local runtime mode until an explicit identity verification handshake succeeds.
- The warning may be stale/default state if runtime identity verification was added but not initialized for local default profile.

## Investigator Findings
<!-- Pair investigator appends structured analysis here: file:line refs, evidence, conclusions. -->

### 2026-05-19 - Runtime identity warning trace

#### Verdict

The hypothesis is confirmed with one important nuance: the exact string `Local runtime identity has not been verified yet.` is the idle/local diagnostic fallback when the selected local profile has no stored `lastIdentity` (or the stored identity is unusable because the connection mode changed). It reaches the renderer through the `get-runtime-diagnostic` IPC/preload path, and it appears twice on the Chat screen because the same `runtimeDiagnostic` object is rendered globally by `Layout` and compactly by `ChatHeader`. After a verified API runtime resolution the warning should disappear; after CLI fallback alone it may not, because the CLI handle is returned as verified but is not persisted into `state.lastIdentity`.

#### End-to-end data flow

1. **Shared diagnostic shape.** `RuntimeDiagnostic` defines the cross-process fields carried to the renderer, including `selectedProfile`, `requestedProfile`, `actualProfile`, `verified`, `verificationSource`, `mode`, `transport`, `status`, URL/port/PID/config/auth evidence, `stale`, `staleReason`, `mismatchReason`, and `unsupportedReason` (`src/shared/runtime.ts:1-47`). Valid statuses are `verified`, `unverified`, `mismatch`, `stale`, and `unsupported` (`src/shared/runtime.ts:12-17`).
2. **Idle local diagnostic source.** `ProfileRuntimeManager.getRuntimeDiagnostic(profile)` normalizes the selected profile, reads per-profile runtime state, and uses `state.lastIdentity` only when present and not mode-mismatched; otherwise it calls `createDiagnosticIdentity(...)` (`src/main/hermes/runtime/manager.ts:363-376`). Fresh state has `lastIdentity?: RuntimeIdentity` unset (`src/main/hermes/runtime/state.ts:3-14`) and is initialized without an identity (`src/main/hermes/runtime/state.ts:16-25`).
3. **Exact string origin.** For `mode === "local"`, `createDiagnosticIdentity(...)` constructs a synthetic local API identity with `actualProfile: null`, `verified: false`, `verificationSource: "unverified"`, `transport: "api"`, local API URL/port/PID/config evidence, `startedByMercury: false`, and `mismatchReason: "Local runtime identity has not been verified yet."` (`src/main/hermes/runtime/identity.ts:136-160`). This is the only source-code match for the exact warning string outside this investigation report.
4. **Status classification.** `buildRuntimeDiagnostic(...)` computes `stale`, `profileMismatch`, and `unsupported`, then classifies in priority order: `stale` -> `unsupported` -> `mismatch` -> `verified` -> `unverified` (`src/main/hermes/runtime/diagnostics.ts:13-28`). The idle local fallback has no stale reason, no unsupported mode, no actual-profile mismatch, and `verified: false`, so it becomes `status: "unverified"`. The returned diagnostic preserves `mismatchReason` unless stale overrides it (`src/main/hermes/runtime/diagnostics.ts:30-56`).
5. **Main-process export.** `src/main/hermes/gateway.ts` exposes `getRuntimeDiagnostic(profile)` as a thin call to `profileRuntimeManager.getRuntimeDiagnostic(profile)` (`src/main/hermes/gateway.ts:105-106`), and `src/main/hermes.ts` re-exports it through the compatibility barrel (`src/main/hermes.ts:18-31`).
6. **Service and IPC bridge.** `getRuntimeDiagnosticForProfile(profile)` delegates to `getRuntimeDiagnostic(profile)` (`src/main/services/system-service.ts:18-20`). `registerSystemIpc()` registers `ipcMain.handle("get-runtime-diagnostic", (_event, profile) => getRuntimeDiagnosticForProfile(profile))` (`src/main/ipc/system.ts:29-34`).
7. **Preload bridge.** `appApi.getRuntimeDiagnostic(profile)` invokes the IPC channel with the selected profile (`src/preload/api/app.ts:5-8`). `hermesAPI` spreads `appApi` into the exposed preload API (`src/preload/api/index.ts:1-16`), and `contextBridge.exposeInMainWorld("hermesAPI", hermesAPI)` publishes it to the renderer (`src/preload/index.ts:1-9`). The TypeScript preload contract includes `getRuntimeDiagnostic: (profile?: string) => Promise<RuntimeDiagnostic>` (`src/preload/index.d.ts:33-35`).
8. **Renderer polling.** `Layout` stores `runtimeDiagnostic` state (`src/renderer/src/screens/Layout/Layout.tsx:98-101`), calls `window.hermesAPI.getRuntimeDiagnostic(requestedProfile)` (`src/renderer/src/screens/Layout/Layout.tsx:134-139`), guards async results against profile switches (`src/renderer/src/screens/Layout/Layout.tsx:139-142`), refreshes on view changes (`src/renderer/src/screens/Layout/Layout.tsx:147-150`), and polls every 10 seconds (`src/renderer/src/screens/Layout/Layout.tsx:152-156`).
9. **Renderer message formatting.** `RuntimeDiagnosticNotice.runtimeDiagnosticMessage(...)` returns `diagnostic.mismatchReason` for `status === "unverified"`, falling back only if no mismatch reason exists (`src/renderer/src/components/RuntimeDiagnosticNotice.tsx:8-24`). The notice labels non-verified diagnostics as `Runtime warning` (`src/renderer/src/components/RuntimeDiagnosticNotice.tsx:70-74`) and styles every non-verified/non-stale status with warning tone (`src/renderer/src/components/RuntimeDiagnosticNotice.tsx:52-67`). CSS makes the regular notice a banner with margin/padding (`src/renderer/src/assets/styles/layout.css:215-227`) and defines a compact variant (`src/renderer/src/assets/styles/layout.css:229-234`).

#### Conditions that produce the warning

- **Exact reported string:** produced when `getRuntimeDiagnostic(profile)` is called in local mode and the normalized profile's `RuntimeState` has no usable `lastIdentity`; this is the idle/new-chat path because `getRuntimeDiagnostic(...)` synthesizes a local diagnostic identity (`src/main/hermes/runtime/manager.ts:363-376`, `src/main/hermes/runtime/identity.ts:136-160`). For the default agent/profile, this means `selectedProfile: "default"`, `actualProfile: null`, `verified: false`, `transport: "api"`, and `status: "unverified"` by the diagnostic classifier (`src/main/hermes/runtime/diagnostics.ts:19-28`).
- **After local gateway start:** `startGateway(profile)` seeds `state.lastIdentity` with a different unverified reason, `Gateway process has started but API readiness has not been verified yet.` (`src/main/hermes/runtime/manager.ts:150-202`). The test suite expects the immediate post-start diagnostic to be `verified: false`, `status: "unverified"`, with that gateway-readiness mismatch reason (`tests/hermes-runtime.test.ts:147-170`).
- **After verified local API resolution:** `resolveLocalApiRuntime(...)` checks managed-process evidence/readiness, creates a verified local API identity, writes it to `state.lastIdentity`, and returns an API handle (`src/main/hermes/runtime/local-runtime.ts:33-66`). Tests confirm that after `startGateway(...)` plus `resolveRuntime(... preferTransport: "api")`, diagnostics become `actualProfile: "alpha"`, `verified: true`, `status: "verified"`, `mode: "local"`, `transport: "api"`, and `stale: false` (`tests/hermes-runtime.test.ts:224-246`).
- **After CLI fallback only:** `resolveRuntime(...)` falls back to `createCliRuntimeHandle(...)` when no API handle is available (`src/main/hermes/runtime/manager.ts:129-141`). `createCliRuntimeHandle(...)` returns a verified `transport: "cli"` handle (`src/main/hermes/runtime/identity.ts:30-58`), and tests cover that handle (`tests/hermes-runtime.test.ts:94-115`), but the manager does not assign that CLI identity to `state.lastIdentity` on the fallback path (`src/main/hermes/runtime/manager.ts:129-141`). Therefore a successful CLI-backed chat can leave the renderer diagnostic unchanged or still unverified until a later verified API runtime is persisted.
- **After stale mutation:** `markRuntimeStale(...)` sets `staleReason`, `staleAt`, and `apiServerAvailable = false` (`src/main/hermes/runtime/manager.ts:298-304`), and the diagnostic classifier prioritizes `stale` over unverified/verified (`src/main/hermes/runtime/diagnostics.ts:14-24`). Tests expect stale diagnostics to remain until `revalidateRuntime(...)` succeeds (`tests/hermes-runtime.test.ts:247-303`).

#### Why it appears twice

- `Layout` renders a global notice before the Chat pane: `<RuntimeDiagnosticNotice diagnostic={runtimeDiagnostic} />` (`src/renderer/src/screens/Layout/Layout.tsx:361-363`).
- The same object is passed from `Layout` into `Chat` as `runtimeDiagnostic={runtimeDiagnostic}` (`src/renderer/src/screens/Layout/Layout.tsx:364-372`).
- `Chat` forwards it into `ChatHeader` (`src/renderer/src/screens/Chat/Chat.tsx:60-76`).
- `ChatHeader` renders the same component compactly in the metadata row next to the agent identity: `<RuntimeDiagnosticNotice diagnostic={runtimeDiagnostic} compact />` (`src/renderer/src/screens/Chat/components/ChatHeader.tsx:80-91`). `profileName` renders the default profile as the localized default agent label (`src/renderer/src/screens/Chat/components/ChatHeader.tsx:55-56`), explaining why the compact warning is adjacent to `Agent: Default`.
- `RuntimeDiagnosticNotice` returns `null` only when there is no diagnostic or when there is no message and `showWhenVerified` is false (`src/renderer/src/components/RuntimeDiagnosticNotice.tsx:52-55`). An unverified diagnostic has a message, so both the global and compact instances render simultaneously.

#### Expected by tests/docs?

- **Diagnostic surfaces are intentionally protected.** The sentinel contract test asserts the IPC channel, preload API, Layout notice, `RuntimeDiagnosticNotice` warning/verified strings, Chat propagation, ChatHeader notice, Gateway notice, and Settings notice all remain present (`tests/reliable-profile-runtime-contract.test.ts:193-228`). This does not explicitly require duplicate warnings on the Chat screen, but it does intentionally allow both Layout and ChatHeader to render runtime diagnostics.
- **Renderer polling is documented.** The architecture overview says `Layout` polls `window.hermesAPI.getRuntimeDiagnostic(activeProfile)` and shows runtime diagnostics when the selected profile is stale, unverified, mismatched, or unsupported, with async results guarded against profile switches (`docs/architecture/overview.md:150-157`).
- **Runtime isolation docs support warning states.** Storage/profile docs distinguish storage isolation from runtime isolation and state that UI surfaces stale/mismatch/unverified states in Chat, Gateway, Settings, and the main layout when Mercury cannot prove the runtime identity (`docs/subsystems/storage-and-profiles.md:35-46`).
- **Connection-mode docs support local verification semantics.** Local API handles require managed-process/profile evidence except the legacy default probe, SSH handles require tunnel/remote evidence, and runtime diagnostics expose stale/mismatch/unverified/unsupported states to the renderer (`docs/subsystems/connection-modes.md:80-87`). Local `send-message` is documented as lazy-starting the selected gateway and resolving a runtime handle before dispatch (`docs/subsystems/connection-modes.md:93-101`).
- **Chat flow docs support late verification.** `prepareChatBackend(...)` is documented as the first chat-time path that starts/prepares the selected runtime and resolves a handle (`docs/subsystems/chat-and-tracing.md:168-181`). The dispatcher then uses the prepared/verified handle and rejects wrong-profile handles (`docs/subsystems/chat-and-tracing.md:246-263`).
- **Contract-test docs explicitly list diagnostics through Layout and Chat.** `tests/reliable-profile-runtime-contract.test.ts` is described as protecting runtime diagnostics and stale-state warnings through IPC, preload, Layout, Gateway, Chat, Settings, and the notice component (`docs/testing/contract-tests.md:312-325`).

#### Conclusions

- **Confirmed:** The exact warning string originates in `src/main/hermes/runtime/identity.ts:159` as the local-mode fallback `mismatchReason` for a diagnostic identity with no verified runtime identity.
- **Confirmed:** It is transported over `get-runtime-diagnostic` from runtime manager -> Hermes gateway/barrel -> system service -> Electron IPC -> preload `window.hermesAPI.getRuntimeDiagnostic(...)` -> `Layout` renderer state (`src/main/hermes/runtime/manager.ts:363-376`, `src/main/hermes/gateway.ts:105-106`, `src/main/services/system-service.ts:18-20`, `src/main/ipc/system.ts:29-34`, `src/preload/api/app.ts:5-8`, `src/renderer/src/screens/Layout/Layout.tsx:134-156`).
- **Confirmed:** It appears twice because `Layout` renders a global `RuntimeDiagnosticNotice` and `ChatHeader` renders the same diagnostic compactly from the same `runtimeDiagnostic` prop chain (`src/renderer/src/screens/Layout/Layout.tsx:361-372`, `src/renderer/src/screens/Chat/Chat.tsx:60-76`, `src/renderer/src/screens/Chat/components/ChatHeader.tsx:80-91`).
- **Confirmed with nuance:** The initial state is technically accurate for runtime-proof semantics: before chat/gateway preparation there may be no `lastIdentity`, so Mercury cannot prove which profile backs an API runtime. It is UX-hostile because the app polls and displays that security-oriented diagnostic immediately on an idle New Chat screen, before it has attempted chat/gateway runtime preparation (`src/renderer/src/screens/Layout/Layout.tsx:147-156`, `src/main/services/chat-service.ts:116-131`).
- **Not fully guaranteed:** The warning should disappear after verified API resolution, but not necessarily after CLI fallback. Verified API resolution persists `state.lastIdentity`; CLI fallback returns a verified handle without persisting it (`src/main/hermes/runtime/local-runtime.ts:53-66`, `src/main/hermes/runtime/manager.ts:129-141`, `tests/hermes-runtime.test.ts:94-115`).

#### Remaining ambiguities / recommended fix locations

- **UX policy ambiguity:** Decide whether idle local/no-identity should be user-visible at all. If it is expected preflight state rather than a problem, the likely fix is in `RuntimeDiagnosticNotice`/call sites: hide or soften `status: "unverified"` diagnostics for idle local `startedByMercury: false` + no `actualProfile`, at least in the global Chat shell (`src/renderer/src/components/RuntimeDiagnosticNotice.tsx:8-24`, `src/renderer/src/screens/Layout/Layout.tsx:361-363`).
- **Duplication policy ambiguity:** Decide which surface should own actionable runtime diagnostics on Chat. Likely fix sites are the global Layout render (`src/renderer/src/screens/Layout/Layout.tsx:361-363`) or the compact ChatHeader render (`src/renderer/src/screens/Chat/components/ChatHeader.tsx:80-91`). A scoped option is to keep global notices for non-chat screens or severe states (`stale`, `mismatch`, `unsupported`) and keep ChatHeader compact metadata for lower-severity runtime context.
- **State-transition ambiguity:** Decide whether `createCliRuntimeHandle(...)` should update `state.lastIdentity` when CLI fallback is selected, or whether diagnostics should separately understand the last successful CLI execution. The likely runtime fix site is the fallback branch in `ProfileRuntimeManager.resolveRuntime(...)` (`src/main/hermes/runtime/manager.ts:129-141`) plus tests near the existing CLI fallback coverage (`tests/hermes-runtime.test.ts:94-115`).
- **Gateway-start ambiguity:** Manual/local `startGateway(profile)` seeds an unverified identity and only sets readiness later; it does not by itself persist a verified identity unless `resolveRuntime(...)` or `revalidateRuntime(...)` succeeds (`src/main/hermes/runtime/manager.ts:150-218`, `src/main/hermes/runtime/local-runtime.ts:53-66`). If the intended UX is that starting the gateway clears the warning once ready, likely fix locations are `ProfileRuntimeManager.startGateway(...)` readiness follow-up or the gateway-service local start path (`src/main/services/gateway-service.ts:36-43`).
- **Test update locations:** Any change to surface policy should update the sentinel expectations that currently require Layout, Chat/ChatHeader, Gateway, Settings, and `RuntimeDiagnosticNotice` integration (`tests/reliable-profile-runtime-contract.test.ts:193-228`) and the documented contract list (`docs/testing/contract-tests.md:312-343`).

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The screenshot reflects a duplicated renderer warning caused by a local runtime identity verification state.
**Findings:** The repository contains prior investigation docs on reliable profile runtime and code areas under `src/shared/runtime.ts`, `src/main/hermes/runtime*`, `src/main/ssh/runtime.ts`, IPC/services, and renderer chat/profile UI.
**Evidence:** User-provided screenshot and file map.
**Conclusion:** Needs workspace trace from runtime state source to renderer warning display.

### Phase 2 - Context Builder
**Hypothesis:** Runtime diagnostics flow from main runtime state through IPC/preload into renderer surfaces.
**Findings:** Context discovery selected runtime manager/identity/diagnostic files, system IPC/preload files, renderer `Layout`/`ChatHeader`/notice files, prior runtime docs, and runtime contract tests.
**Evidence:** `src/main/hermes/runtime/*`, `src/main/ipc/system.ts`, `src/preload/api/app.ts`, `src/renderer/src/screens/Layout/Layout.tsx`, `src/renderer/src/screens/Chat/components/ChatHeader.tsx`, `tests/hermes-runtime.test.ts`, `tests/reliable-profile-runtime-contract.test.ts`.
**Conclusion:** Initial strongest theory was one unverified diagnostic rendered twice.

### Phase 3 - Pair Investigator
**Hypothesis:** The exact warning and duplicate rendering can be proven with line-level evidence.
**Findings:** Pair investigator confirmed the exact string source, runtime diagnostic classification, IPC/preload transport, renderer duplication, expected state transitions, test/docs expectations, and the CLI fallback nuance.
**Evidence:** Detailed findings above under `## Investigator Findings`.
**Conclusion:** Confirmed root cause with actionable fix locations.

### Phase 4 - Oracle Synthesis
**Hypothesis:** Findings support a product/runtime distinction between idle preflight unverified state and actionable runtime failure.
**Findings:** Oracle synthesis agreed that the warning is technically accurate but UX-hostile, eliminated failed-chat/two-failures hypotheses, and recommended dedupe, softened idle-state rendering, and optional CLI diagnostic persistence.
**Evidence:** Spot-checked refs: `identity.ts:136-160`, `manager.ts:363-380`, `diagnostics.ts:13-28`, `Layout.tsx:134-156` and `361-372`, `Chat.tsx:64-76`, `ChatHeader.tsx:80-91`, `RuntimeDiagnosticNotice.tsx:8-24` and `70-74`.
**Conclusion:** Ready for final recommendations; no source code changes were made.

## Root Cause

The duplicated warning is caused by one unverified local runtime diagnostic being rendered by two UI surfaces on the Chat view.

On New Chat, `Layout` immediately polls `getRuntimeDiagnostic(activeProfile)` and repeats that polling every 10 seconds (`src/renderer/src/screens/Layout/Layout.tsx:134-156`). Before any chat/title execution, `prepareChatBackend()` has not run (`src/main/services/chat-service.ts:116-131`), so the local runtime manager may have no usable `state.lastIdentity` for the selected profile. In that state, `ProfileRuntimeManager.getRuntimeDiagnostic()` synthesizes a local diagnostic identity via `createDiagnosticIdentity()` (`src/main/hermes/runtime/manager.ts:363-380`). For local mode, that identity carries the exact `mismatchReason`: `Local runtime identity has not been verified yet.` (`src/main/hermes/runtime/identity.ts:136-160`). The diagnostic classifier maps that identity to `status: "unverified"` (`src/main/hermes/runtime/diagnostics.ts:13-28`).

The renderer displays the same diagnostic twice: once as the global `Layout` runtime notice (`src/renderer/src/screens/Layout/Layout.tsx:361-363`) and once after passing it through `Chat` into the compact `ChatHeader` runtime notice next to the Agent metadata (`src/renderer/src/screens/Layout/Layout.tsx:364-372`, `src/renderer/src/screens/Chat/Chat.tsx:64-76`, `src/renderer/src/screens/Chat/components/ChatHeader.tsx:80-91`). `RuntimeDiagnosticNotice` renders `mismatchReason` for unverified diagnostics and labels it `Runtime warning` (`src/renderer/src/components/RuntimeDiagnosticNotice.tsx:8-24`, `src/renderer/src/components/RuntimeDiagnosticNotice.tsx:70-74`).

This is not evidence of two runtime failures. It is a technically accurate but UX-hostile idle/preflight state being shown as an alarming warning and duplicated on the New Chat screen.

A secondary runtime-state limitation is that verified API resolution persists `state.lastIdentity`, but CLI fallback can return a verified runtime handle without necessarily updating diagnostic identity state (`src/main/hermes/runtime/manager.ts:129-141`). If chat succeeds through CLI fallback, the UI may still show the unverified diagnostic until a verified API identity is persisted.

## Recommendations

1. **Deduplicate Chat-view diagnostics.** Choose a single owner for chat-visible runtime diagnostics: either the global `Layout` banner or the compact `ChatHeader` notice. A likely policy is to show the global banner only for severe/actionable statuses (`stale`, `mismatch`, `unsupported`) and keep lower-severity context in the header or hidden.

2. **Soften or hide initial local idle diagnostics.** The current `unverified` warning is accurate in the runtime-proof model, but on pristine New Chat it usually means verification has not happened yet, not that verification failed. Consider neutral copy such as “Runtime will be verified when chat starts,” or suppress this state until verification has been attempted.

3. **Improve diagnostic state after CLI fallback.** If local API verification is unavailable and chat succeeds through verified CLI fallback, persist that verified CLI identity into diagnostic state or expose last successful CLI execution as diagnostic evidence.

4. **Consider finer-grained diagnostic statuses.** Split preflight absence of proof from actionable runtime problems with states such as `idle-unverified`, `verification-pending`, and `verification-failed`.

5. **Update tests and docs to encode the chosen policy.** Renderer tests should assert whether New Chat may show duplicate warnings and which statuses render globally, compactly, both, or neither. Runtime-manager tests should cover CLI fallback diagnostic persistence if implemented.

## Preventive Measures

- Add a renderer test for New Chat with an unverified local diagnostic to assert the chosen deduplication policy.
- Add `ChatHeader`/`Layout` tests covering status-specific visibility: `unverified`, `stale`, `mismatch`, `unsupported`, and `verified`.
- Add runtime-manager tests for diagnostic transitions: fresh local profile with no `lastIdentity`, gateway started but readiness unverified, verified API identity, verified CLI fallback, and stale runtime marker.
- Keep contract tests for the IPC/preload diagnostic path, but avoid requiring duplicate Chat-view rendering unless that is an explicit product decision.
- Update architecture, connection-mode, chat-flow, and contract-test documentation if diagnostic semantics or rendering policy changes.

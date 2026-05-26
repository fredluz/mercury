# Investigation: Runtime Profile Unverified on Chat Startup

## Summary
API-only behavior is intentional, but auto-connect is failing because local runtime verification conflates “Mercury just started this gateway but pid-file proof is not settled yet” with “unmanaged/untrusted runtime.” A live Mercury-spawned child with missing/stale/corrupt/mismatched `gateway.pid` becomes non-retryable `runtime-profile-unverified`, so the readiness-card repair loop can abort before retry/restart recovery.

## Symptoms
- On app startup, Chat shows: “Chat requires a verified API runtime.”
- Banner says local runtime identity has not been verified yet.
- Manual verification fails: `API runtime verification failed. Error invoking remote method 'revalidate-runtime': ProfileRuntimeError: Mercury cannot prove the local API belongs to profile default; start or restart the selected Agent gateway from Mercury and try again.`
- Sending a message fails with `send-message` / `runtime-profile-unverified` errors.
- User believes they already authenticated in Mercury through Hermes, but local runtime proof does not persist or does not match the selected profile.

## Background / Prior Research

### Git archaeology - profile runtime verification
- `ec0ede7` (2026-05-16, "Enforce agent runtime identity") introduced `ProfileRuntimeError` / `runtime-profile-unverified` and the runtime identity contract.
- `0d12fec` (2026-05-19, "Improve runtime warning chat UX") added `revalidate-runtime` IPC and readiness-card verification/debug UX.
- `b9e5a28` (2026-05-21, "Enforce API-only chat runtime") made chat/title execution require a verified API runtime, with no CLI fallback.
- `dcdd2b6` (2026-05-24, "Align Hermes provider and model selection") refined the current “cannot prove local API belongs to profile …” error and tied revalidation to model resolution + API probe.
- `5e27b35` (2026-05-24, "Auto-repair chat gateway runtime") added readiness-card auto start/restart/revalidate behavior.
- Current likely evidence areas from archaeology: `src/main/hermes/runtime/api-runtime.ts`, `src/main/hermes/runtime/local-runtime.ts`, `src/main/hermes/runtime/manager.ts`, `src/main/services/system-service.ts`, `src/main/ipc/system.ts`, and `src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx`.

## Investigator Findings

### Phase 2 - Current HEAD Startup/Revalidate Trace

#### Finding 1 - Chat startup readiness auto-repair is renderer-driven and begins only after an unverified diagnostic is displayed.
**Evidence:** `Layout` refreshes the selected profile diagnostic by calling `window.hermesAPI.getRuntimeDiagnostic(requestedProfile)` and stores the result only if the active profile still matches (`src/renderer/src/screens/Layout/Layout.tsx:185-196`). It refreshes diagnostics on tab switch and every 10 seconds (`src/renderer/src/screens/Layout/Layout.tsx:199-207`). `Chat` always mounts `ChatRuntimeReadinessCard` above the transcript/empty state with the current `runtimeDiagnostic`, profile, and refresh callback (`src/renderer/src/screens/Chat/Chat.tsx:133-138`). The card renders for `diagnostic.status === "unverified"` (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx:22-26`) and auto-runs `handleVerify()` once per selected local profile when status is unverified, mode is local, no action is busy, and auto-verify has not already been attempted for that profile (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx:71-90`).

**Flow:** renderer card -> preload gateway/app APIs -> Electron IPC -> services. `repairLocalRuntime(profile)` calls `startGateway(profile)`, then `revalidateWithRetry(profile)`, then `restartGateway(profile)` only if the first revalidate pass returns `false`, then another retry pass (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx:32-45`). Preload maps `startGateway`/`restartGateway` to `start-gateway`/`restart-gateway` (`src/preload/api/navigation.ts:36-43`) and `revalidateRuntime` to `revalidate-runtime` (`src/preload/api/app.ts:17-20`). Main IPC delegates `start-gateway`/`restart-gateway` to `gateway-service` (`src/main/ipc/gateway.ts:17-28`) and `revalidate-runtime` to `system-service` (`src/main/ipc/system.ts:34-36`). Local `gateway-service.startGateway` delegates to `startLocalGateway(profile)` and local `restartGateway` delegates to `restartLocalGateway(profile)` (`src/main/services/gateway-service.ts:36-44`, `src/main/services/gateway-service.ts:64-74`).

**Conclusion:** auto-repair is not a background startup daemon; it is a readiness-card side effect triggered by the UI seeing an unverified local diagnostic. A thrown revalidation error exits the card's `repairLocalRuntime` before the planned restart branch because `handleVerify` catches the exception outside `repairLocalRuntime` (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx:99-126`).

#### Finding 2 - `revalidateRuntimeForProfile` catches model-resolution failures, but does not catch runtime proof failures from `prepareChatBackend`/API assertion.
**Evidence:** `revalidateRuntimeForProfile(profile)` first calls `resolveChatRuntimeModel(profile)` and returns `false` on any thrown model-resolution error (`src/main/services/system-service.ts:27-33`). It also returns `false` when provider is missing, provider is `auto`, or model is missing (`src/main/services/system-service.ts:34-36`). After that it awaits `prepareChatBackend(profile, "chat")` and probes the API; there is no `try/catch` around either call (`src/main/services/system-service.ts:37-40`). The system IPC handler directly returns that promise (`src/main/ipc/system.ts:34-36`), and the preload type is boolean-only (`src/preload/api/app.ts:17-20`).

**Evidence:** `probeChatCompletionViaApi` asserts the runtime is verified before probing (`src/main/hermes/chat-api.ts:38-45`), catches model-resolution errors into `{ success: false, error }` (`src/main/hermes/chat-api.ts:44-54`), returns `{ success: false }` for missing provider/model (`src/main/hermes/chat-api.ts:55-64`), and converts HTTP/API/auth failures into `{ success: false, error }` rather than throwing (`src/main/hermes/chat-api.ts:66-114`). `revalidateRuntimeForProfile` discards that detail by returning only `probe.success` (`src/main/services/system-service.ts:39-40`).

**Conclusion:** provider/model setup failures and provider auth/API failures usually collapse to `false` and the readiness card displays the generic "still not verified" status (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx:111-114`). Runtime ownership proof failures from `prepareChatBackend`/`assertVerifiedApiRuntimeHandle` surface as rejected IPC calls and are displayed as `API runtime verification failed. <error message>` by the card (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx:117-122`).

#### Finding 3 - `prepareChatBackend` can immediately resolve after starting a local gateway, so it depends on proof artifacts being available synchronously enough.
**Evidence:** In local mode, `prepareChatBackend` starts the selected local gateway if `isGatewayRunning(normalizedProfile)` is false; if a gateway is running but the last identity was not `startedByMercury`, it force-stops and starts a new one (`src/main/services/chat-service.ts:119-136`). It then immediately calls `profileRuntimeManager.resolveRuntime({ profile, purpose, sessionId })` (`src/main/services/chat-service.ts:138-146`).

**Evidence:** `ProfileRuntimeManager.startGateway` spawns the Hermes gateway child, stores `state.gatewayProcess`, marks `state.gatewayStartedByApp = true`, stores managed host/port/command, and seeds `state.lastIdentity` as unverified with mismatch reason "Gateway process has started but API readiness has not been verified yet." (`src/main/hermes/runtime/manager.ts:178-245`). `isGatewayRunning` returns true if the in-memory child process exists and is not killed, even before considering `gateway.pid` (`src/main/hermes/runtime/manager.ts:291-304`).

**Conclusion:** the local path is designed to start and then rely on `resolveRuntime`'s bounded retry, but that retry only applies after managed-process evidence passes. A just-spawned child with no matching pid file reaches `resolveRuntime` immediately through both chat setup and readiness-card revalidation.

#### Finding 4 - Local verification requires both in-memory child state and a matching `gateway.pid`; missing/stale pid evidence is classified as non-retryable `runtime-profile-unverified`, not retryable `not-ready`.
**Evidence:** `resolveLocalApiRuntimeAttempt` first treats stale state as non-retryable (`src/main/hermes/runtime/local-runtime.ts:59-85`). It then calls `hasManagedProcessEvidence`; if that returns false, it sets `state.apiServerAvailable = false`, writes an unverified identity, and returns failure `{ reason: "unmanaged", retryable: false, code: "runtime-profile-unverified" }` with the current user-facing message (`src/main/hermes/runtime/local-runtime.ts:87-124`).

**Evidence:** `hasManagedProcessEvidence` requires all of the following: `state.gatewayStartedByApp`, live `state.gatewayProcess`, `expectedPid`, `pidFilePid === expectedPid`, managed host `127.0.0.1`, managed port equal to expected port, and command exactly equal to expected gateway args (`src/main/hermes/runtime/local-runtime.ts:251-268`). `readGatewayPidFile` returns `null` when the pid file is missing, unreadable, invalid, or not parseable as a number/string pid (`src/main/hermes/runtime/local-runtime.ts:272-288`).

**Evidence:** The only retryable local failure is `reason: "not-ready"`, which is reached after managed-process evidence passes and `checkLocalApiReady` returns false (`src/main/hermes/runtime/local-runtime.ts:126-155`). The manager retries only `attempt.failure.retryable` failures and immediately throws `ProfileRuntimeError` for non-retryable failures (`src/main/hermes/runtime/manager.ts:441-461`). On retry exhaustion it throws `runtime-unavailable` (`src/main/hermes/runtime/manager.ts:464-470`).

**Conclusion:** context_builder's hypothesis is confirmed for current HEAD. A Mercury-started in-memory child whose `gateway.pid` is not yet written, stale, corrupt, or mismatched is not treated as "managed but not ready". It is treated as "unmanaged/unverified" and throws `ProfileRuntimeError`/`runtime-profile-unverified` without retry. This can prevent the readiness-card flow from reaching its `restartGateway` fallback because the exception interrupts `repairLocalRuntime`.

#### Finding 5 - Chat send fails closed with structured runtime codes, but renderer revalidate has only a boolean/error-message surface.
**Evidence:** The runtime contract has no CLI fallback transport; `RuntimeTransport` is `"api" | "ssh-api" | "remote-api"` and `ProfileRuntimeError` carries `code` and optional `identity` (`src/main/hermes/types.ts:17-42`, `src/main/hermes/types.ts:74-95`). `sendMessage` resolves or receives a runtime, asserts it is a verified API runtime, and sends through `sendMessageViaApi` (`src/main/hermes/gateway.ts:19-35`). `assertVerifiedApiRuntimeHandle` throws `runtime-unavailable`, `runtime-profile-unverified`, or `runtime-profile-mismatch` depending on missing API transport, unverified identity, or profile mismatch (`src/main/hermes/runtime/api-runtime.ts:12-40`). Chat setup failures extract `error.code` and surface visible text as `code: message` while recording a transport error (`src/main/services/chat-service.ts:401-427`).

**Conclusion:** API-only is intentional and enforced. The automatic connection failure is not because Mercury falls back to CLI or ignores provider auth; it is because the local ownership proof can fail before readiness retry logic is allowed to run.

#### Finding 6 - Tests cover happy-path pid evidence and API readiness retry, but not the just-started missing/stale `gateway.pid` race.
**Evidence:** The main managed local runtime test writes `gateway.pid` after `manager.startGateway("alpha")` and before `manager.resolveRuntime(...)`; only then does it expect a verified API runtime (`tests/hermes-runtime.test.ts:174-205`). The readiness retry test also writes `gateway.pid` before resolving, then verifies retry across API readiness false->true (`tests/hermes-runtime.test.ts:256-273`). The never-ready test writes `gateway.pid` first and expects retry exhaustion as `runtime-unavailable` (`tests/hermes-runtime.test.ts:302-323`). The no-evidence fail-closed test covers resolving without a Mercury-started child and expects `runtime-profile-unverified` (`tests/hermes-runtime.test.ts:103-137`).

**Evidence:** Renderer readiness tests mock `startGateway`, `restartGateway`, and `revalidateRuntime` as booleans. They verify auto-start/revalidate and restart-after-false behavior (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.test.tsx:145-183`), but they do not model `revalidateRuntime` throwing `ProfileRuntimeError` before restart.

**Conclusion:** there is no direct regression test for "Mercury just spawned a child, but `gateway.pid` is missing/stale/corrupt/mismatched." Current tests therefore do not catch the likely startup/revalidate race.

#### Overall Conclusion
The most likely root cause is the local verification state machine's classification boundary: missing or stale pid-file evidence for a Mercury-started child is a non-retryable ownership-proof failure (`runtime-profile-unverified`) rather than a short-lived retryable startup-not-ready condition. Because `revalidateRuntimeForProfile` does not catch `ProfileRuntimeError` from `prepareChatBackend`, the readiness card sees a thrown IPC error and stops before restart/retry recovery. Provider/model/auth failures are separate: they generally return `false` from revalidate/probe and do not produce the `runtime-profile-unverified` ownership-proof message.

#### Suggested Fix Direction
Consider treating a live `state.gatewayStartedByApp && state.gatewayProcess && !state.gatewayProcess.killed` with missing/mismatched `gateway.pid` as retryable "managed evidence not settled yet" for a bounded startup window, or have `startGateway`/Hermes write the pid evidence synchronously before resolving. Also consider making `repairLocalRuntime` continue to restart on `revalidateRuntime` exceptions classified as runtime ownership/not-ready failures, and add tests for missing, stale, corrupt, and mismatched `gateway.pid` immediately after Mercury starts a child.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Runtime verification depends on more than provider authentication; Mercury must prove the selected local API gateway belongs to the active profile, likely via a per-profile token, runtime identity endpoint, gateway lifecycle state, or persisted runtime metadata.
**Findings:** Report created. External git archaeology will check when this verification flow was introduced and whether prior docs mention known failure modes.
**Evidence:** Screenshot errors supplied by user: `ProfileRuntimeError`, `runtime-profile-unverified`, selected profile `default`, selected debug gateways `Codex`, `Claude Code`, `Pi`.
**Conclusion:** Needs code and history investigation.

### Phase 5 - Fix Implementation
**Hypothesis:** If pending pid-file proof is retryable and revalidate failures remain boolean, then startup auto-repair can keep trying until the Mercury-started API runtime verifies.
**Findings:** Implemented `verified | pending | unmanaged` managed-process evidence classification, made pending pid evidence retryable `runtime-unavailable`, made revalidation return `false` instead of rejecting on expected runtime/probe errors, and hardened the readiness card retry loop against transient revalidate rejections.
**Evidence:** Changed `src/main/hermes/runtime/local-runtime.ts`, `src/main/services/system-service.ts`, and `src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx`; added regressions in `tests/hermes-runtime.test.ts`, `tests/system-service.test.ts`, and `src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.test.tsx`.
**Verification:** `npm test -- tests/hermes-runtime.test.ts tests/system-service.test.ts src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.test.tsx` passed; `npm run typecheck` passed; full `npm test` passed with 573 passed / 2 skipped.
**Review:** Oracle review found no blocking design issue and requested extra regressions for stale/corrupt PID evidence, killed child fail-closed behavior, and API probe rejection; these were added.
**Conclusion:** Confirmed and fixed.

## Root Cause
Mercury does attempt to auto-connect to the local API runtime, but the verifier has the wrong classification boundary for startup evidence.

The local repair flow starts the gateway and immediately revalidates (`src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx:32-45`). Revalidation calls `prepareChatBackend` without catching runtime proof failures (`src/main/services/system-service.ts:27-40`). `prepareChatBackend` starts or restarts the local gateway and immediately calls `profileRuntimeManager.resolveRuntime` (`src/main/services/chat-service.ts:119-146`).

At that point, `resolveLocalApiRuntimeAttempt` calls `hasManagedProcessEvidence`. If it returns false, Mercury writes an unverified identity with `startedByMercury: false` and returns non-retryable `runtime-profile-unverified` (`src/main/hermes/runtime/local-runtime.ts:87-124`). But `hasManagedProcessEvidence` requires all process evidence to be settled, including a matching `gateway.pid` file (`src/main/hermes/runtime/local-runtime.ts:251-268`), and pid-file read failures return `null` for missing, invalid, unreadable, or unparsable pid files (`src/main/hermes/runtime/local-runtime.ts:272-288`).

Therefore a just-started Mercury-managed child whose pid file has not appeared yet, or whose pid file is stale/corrupt/mismatched, is classified as an unmanaged ownership failure instead of a retryable startup-not-ready condition. The manager retries only `retryable` failures; non-retryable failures are thrown immediately as `ProfileRuntimeError` (`src/main/hermes/runtime/manager.ts:441-461`). The existing retryable `runtime-unavailable` path is only reached after managed evidence passes and API readiness fails (`src/main/hermes/runtime/local-runtime.ts:126-155`).

This explains the user-visible behavior: authentication/model config can be valid, API-only enforcement can be correct, and Mercury can still fail to auto-connect because ownership proof fails too early in the startup window.

## Recommendations
1. In `src/main/hermes/runtime/local-runtime.ts`, replace boolean `hasManagedProcessEvidence` with an inspector that distinguishes `verified`, `pending`, and `unmanaged` evidence.
2. Treat a live Mercury-started child with matching host/port/command but missing/stale/corrupt/mismatched pid-file evidence as bounded, retryable `not-ready` / `runtime-unavailable`, with identity `startedByMercury: true`; do not overwrite `lastIdentity.startedByMercury` to false for this pending case.
3. Keep true unmanaged cases fail-closed as `runtime-profile-unverified`: no live Mercury child, wrong host, wrong port, wrong command, or stale profile state.
4. In `src/main/services/system-service.ts`, catch expected `ProfileRuntimeError`/runtime proof failures from `prepareChatBackend` and probe during `revalidateRuntimeForProfile`, returning `false` instead of rejecting IPC. Revalidation should be a boolean readiness check; chat send can still throw fail-closed.
5. Optionally harden `src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx` so individual `revalidateRuntime` rejections count as failed attempts and do not abort the restart fallback.

## Preventive Measures
- Add runtime-manager regression tests where a Mercury child starts before `gateway.pid` appears, where the pid never appears, and where stale/corrupt/wrong pid evidence is corrected during retry.
- Preserve negative tests proving no managed child and host/port/command mismatches remain non-retryable `runtime-profile-unverified`.
- Add a system-service test proving `revalidateRuntimeForProfile` returns `false`, not a rejected IPC call, when `prepareChatBackend` throws `ProfileRuntimeError`.
- Add renderer readiness-card coverage for rejected revalidation if renderer hardening is implemented.
- Log or expose diagnostic mismatch reasons that separate “managed gateway starting” from “unmanaged gateway detected,” so future users do not confuse provider authentication with runtime ownership proof.

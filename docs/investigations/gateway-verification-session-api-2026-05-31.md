# Investigation: Gateway Verification and Hermes Session API Failure

## Summary
This investigation is historical. It captured a real 2026-05-31 failure mode, but the final runtime decision was **not** to make runs-only compatibility the success goal. Mercury now targets the current Hermes Gateway surface: `/health` plus authenticated `/v1/capabilities` must verify both `run_submission` and `session_resources`, chat uses `/v1/runs`, and normal session lifecycle uses `/api/sessions`.

## Resolution status — 2026-05-31
- Final fix refreshed pid-file-only local gateways instead of attaching to potentially stale older Hermes API processes.
- Local gateway start now repairs Mercury's managed API-server config block, generates and persists a per-profile `API_SERVER_KEY` when missing, merges profile `.env`, then forces `API_SERVER_ENABLED`, `API_SERVER_HOST`, `API_SERVER_PORT`, and the persisted/generated key into the child env after that merge.
- Capability probing and the BFF capabilities subclient use authenticated `GET /v1/capabilities`; `/capabilities` is not the current endpoint.
- Runtime gating intentionally still requires `session_resources` alongside `run_submission`; runs-only compatibility remains a diagnostic clue, not an accepted desktop runtime contract.
- App shutdown now calls explicit `stopAllGateways()` so all known profile/default `gateway.pid` files are handled, while renderer/profile `stopGateway(profile?)` remains targeted.
- Live API smoke passed after the stale gateway refresh: the refreshed local gateway exposed `/api/sessions`, so the UI-equivalent session preflight can succeed before `/v1/runs` dispatch.

## Original symptoms
- `runChatMessage(...)` from the same service the UI calls failed before token use with `runtime-unavailable`: `Local API runtime for profile default did not become ready within 12000ms`.
- Retrying with `implementation-agent` produced the same `runtime-unavailable` readiness failure after Mercury started a gateway process.
- Existing ready gateways like `story-scout` returned `/health` and `/v1/capabilities`, and real-token `/v1/runs` + SSE succeeded through BFF, but `/api/sessions` returned 404 and capabilities omitted `session_resources` before stale gateways were refreshed.
- User reported the app gateway verifier path did not work and considered the prior implementation unacceptable until Mercury worked with the Hermes API.

## Background / Prior Research

### Installed Hermes API surface probe
- The installed Hermes tree under `~/.hermes/hermes-agent` is not runs/chat-only according to its docs: `website/docs/user-guide/features/api-server.md` documents `/api/sessions/*` endpoints and session capability discovery.
- Probe report cited docs lines around `api-server.md:313` stating session endpoints are gated by `API_SERVER_KEY` and live under `/api/sessions/*`, plus lines around `317-318` for `GET /api/sessions` and `POST /api/sessions`.
- The same docs say `/v1/capabilities` advertises the full surface via `session_*` feature flags and `endpoints.session_*` entries.
- Implication: live gateways returning 404 for `/api/sessions` are either running an older/different API implementation, starting with the wrong code/env, or not enabling the session API surface despite installed docs.

### Live gateway startup/env probe
- Existing ready gateway `story-scout-agent` has log evidence like `api_server listening on http://127.0.0.1:20384 (model: story-scout-agent) ✓` in `~/.hermes/profiles/story-scout-agent/logs/gateway.log`.
- Mercury-tried profiles `default` and `implementation-agent` did not show equivalent `api_server listening ...` readiness evidence in the probe output.
- Installed Hermes config defaults indicate `API_SERVER_ENABLED` defaults false, `API_SERVER_HOST` defaults `127.0.0.1`, and `API_SERVER_PORT` defaults `8642` unless env/profile startup overrides are applied.
- Implication: a gateway process can exist without exposing the API if Mercury's env/profile bootstrap does not actually cause the Hermes gateway to enable/bind the API server.

### Live smoke observations from prior turn
- CLI path `out/cli/index.js --ndjson chat send ...` exercises `src/cli/chat-commands.ts` -> `runChatMessage(...)`, the same service target used by IPC `send-message`.
- `default` profile attempt started `/Users/fredluz/.hermes/hermes-agent/venv/bin/python /Users/fredluz/.hermes/hermes-agent/hermes -p default gateway` but failed with `runtime-unavailable` after 12s; `apiBaseUrl` was `http://127.0.0.1:8642`.
- `implementation-agent` attempt started `hermes -p implementation-agent gateway` but failed with `runtime-unavailable` after 12s; `apiBaseUrl` was `http://127.0.0.1:23756`.
- Existing gateways on ports such as `21992`, `20384`, `23325`, `24069`, and `20040` answered `/health` and `/v1/capabilities`, but `/api/sessions` returned 404 for all sampled profiles.
- Direct BFF + `gateway.sendMessage(..., preparedRuntime)` against `story-scout` on `http://127.0.0.1:21992` succeeded with real tokens through `/v1/runs` + SSE and recorded redacted BFF diagnostics.

## Historical investigator findings
<!-- Pair investigator appends structured findings here with file:line refs, evidence, and conclusions. -->

The findings below are preserved as the pre-fix diagnosis. Where they recommend accepting runs-only chat or purpose-specific relaxation of `session_resources`, that recommendation was superseded by the final decision above: refresh stale gateways and require the full current Gateway session surface.

### 2026-05-31 - Runtime verification/session API investigation

#### Scope / method
- Read-only Mercury code trace across chat setup, runtime verification, gateway startup, BFF subclients, and tests.
- Read-only installed-Hermes/source and local-gateway probes via shell, excluding `venv` and avoiding mutation.
- Live localhost HTTP GET probes only: `/health`, `/v1/capabilities`, `/capabilities`, and `/api/sessions` on known profile ports.

#### Findings by hypothesis

1. **Proved: full UI chat path currently blocks on `/api/sessions` before `/v1/runs`.**
   - `runChatMessage(...)` resolves/prepares a runtime first, then, when `runtime` exists, it unconditionally calls `readHermesSession(...)` for a resume or `createHermesSession(...)` for a new chat before calling `sendMessage(...)`: `src/main/services/chat-service.ts:458-483`.
   - Those helpers route to the BFF sessions client: `src/main/services/hermes-sessions-api.ts:20-37`.
   - The BFF sessions client uses `/api/sessions` and `/api/sessions/{id}`: `src/main/hermes/bff/sessions.ts:19-37`.
   - Only after that preflight succeeds does chat call `sendMessage(...)`, which leads to `sendMessageViaApi(...)` and then the runs API: `src/main/services/chat-service.ts:475-483`, `src/main/hermes/gateway.ts:8-37`, `src/main/hermes/chat-api.ts:8-19`, `src/main/hermes/runs-api.ts:56-103`.
   - `/v1/runs` itself is correctly targeted by `HermesRunsBffClient.submit(...)`: `src/main/hermes/bff/runs.ts:39-63`.
   - Live evidence: profiles on ports `21992`, `20384`, `23325`, `24069`, and `20040` returned `200` for `/health` and `/v1/capabilities`, `404` for `/capabilities`, and `404` for `/api/sessions`; thus this full path fails before it can use the known-working `/v1/runs` path.
   - Existing tests encode this behavior: `tests/chat-ipc-lifecycle.test.ts:371-401` expects a pre-created server session to provide durability when the stream returns no session header, and test setup mocks `createHermesSession(...)` as always available at `tests/chat-ipc-lifecycle.test.ts:189-220`.

2. **Proved: Mercury capability gating currently over-requires `session_resources` for chat/runtime verification.**
   - The capability gate globally requires both `run_submission` and `session_resources`: `src/main/hermes/connection.ts:141-146`.
   - `probeHermesCapabilities(...)` classifies any missing required feature as `missing-required-features` and emits an update-required message before returning `ok: false`: `src/main/hermes/connection.ts:286-309`.
   - Local runtime resolution always runs this gate after health verification and records `identity.capabilityProblem` on failure: `src/main/hermes/runtime/local-runtime.ts:171-199`.
   - `assertVerifiedApiRuntimeHandle(...)` turns `missing-required-features` into `runtime-capability-missing` for any purpose, including `chat`: `src/main/hermes/runtime/api-runtime.ts:42-48`.
   - Tests currently assert the over-strict contract: `tests/hermes-capabilities.test.ts:118-140` is named “requires run submission and session resources”, and `tests/hermes-runtime.test.ts:694-745` expects missing run/session capabilities to produce update-required diagnostics.
   - Live evidence: reachable gateways advertise `run_submission` but omit `session_resources`; the live descriptor keys included `run_submission`, `run_events_sse`, `run_stop`, `run_approval_response`, `session_continuity_header`, and `session_key_header`, but not `session_resources` or session endpoints. This is sufficient for `/v1/runs` chat but fails Mercury's current gate.

3. **Partly proved / root-cause contributor: local runtime verification requires in-process child state plus PID-file parity, so reconnects and PID divergence fail or stall.**
   - `RuntimeState` only stores in-memory child state (`gatewayProcess`, `gatewayStartedByApp`, managed host/port, command): `src/main/hermes/runtime/state.ts:4-16`.
   - `inspectManagedProcessEvidence(...)` returns `unmanaged` unless all of these are true: Mercury started the gateway in this process, `state.gatewayProcess` exists and is not killed, child PID exists, host/port match, and the stored command matches expected args: `src/main/hermes/runtime/local-runtime.ts:312-330`.
   - Even after those pass, it requires `gateway.pid` to equal `state.gatewayProcess.pid`; if not, it returns `pending`, and readiness polling never reaches `/health`: `src/main/hermes/runtime/local-runtime.ts:332-341`. The tests confirm `isApiServerReady` is not called while PID evidence is missing/corrupt: `tests/hermes-runtime.test.ts:350-397` and `tests/hermes-runtime.test.ts:398-454`.
   - `resolveRequiredLocalApiRuntime(...)` retries pending evidence until the startup timeout and then throws `runtime-unavailable`: `src/main/hermes/runtime/manager.ts:438-477`.
   - This proves a new Mercury process cannot reconnect to a gateway it previously started: after restart, `state.gatewayStartedByApp` and `state.gatewayProcess` are gone, so a healthy PID-file-backed local gateway is classified as unmanaged before health/capabilities are checked.
   - Installed Hermes PID format is compatible with Mercury parsing but carries different command metadata: live pid files are JSON like `{"pid": ..., "kind": "hermes-gateway", "argv": ["/Users/fredluz/.hermes/hermes-agent/hermes", "gateway"], ...}`; Mercury accepts JSON/plain PID in `src/main/hermes/runtime/local-runtime.ts:344-360`, but compares the PID to its in-process child and separately compares the Mercury command array, not Hermes' `argv`.
   - Installed Hermes writes the PID from the running gateway process via `gateway.status.write_pid_file()` (`~/.hermes/hermes-agent/gateway/status.py:479-495`) after `gateway.run.start_gateway(...)` acquires the runtime lock (`~/.hermes/hermes-agent/gateway/run.py:18820-18845`). I did not find normal POSIX `fork()`/daemonization in the direct `hermes -p <profile> gateway` path, so permanent PID divergence from fork is not proven for the normal path. However, the current Mercury verifier is still too strict for process restarts and any wrapper/respawn path that changes the final PID.

4. **Partly proved: Mercury sets API-server env, but its config/env ordering can still leave wrong settings authoritative.**
   - `ensureApiServerConfig(...)` writes `platforms.api_server.enabled: true` and `extra.port/host` only for missing configs, but if any `api_server` text already exists it returns without correcting disabled/wrong settings: `src/main/hermes/connection.ts:328-358`.
   - `readConfiguredApiPort(...)` scrapes `api_server` text and uses the first `port:` it finds, without checking `platforms.api_server.extra` specifically or `enabled`: `src/main/hermes/connection.ts:38-57`.
   - `startGateway(...)` injects `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, and `API_SERVER_PORT=<localApiPort>` into the spawned environment: `src/main/hermes/runtime/manager.ts:194-209`.
   - But it then merges per-profile `.env` values on top, so `.env` can override the forced API host/port/enabled values: `src/main/hermes/runtime/manager.ts:211-214`; `.env` parsing comes from `profileHome(profile)/.env`: `src/main/config.ts:100-143`.
   - Installed Hermes supports env overrides and enables the API server when `API_SERVER_ENABLED` or `API_SERVER_KEY` is present, mapping host/port/key into `platforms.api_server.extra`: `~/.hermes/hermes-agent/gateway/config.py:1442-1467`.
   - Local config snippets currently show `platforms.api_server.enabled: true` with expected profile-specific ports for several profiles, including `implementation-agent` at `23756`, so a disabled config is not proven for those live files. The default and some profiles share `8642`, which can still collide.
   - Therefore this is a hardening bug and possible failure mode, but the observed `default`/`implementation-agent` readiness timeout is more directly explained by verifier PID/evidence gating if `/health` is never reached.

5. **Proved: BFF capabilities subclient uses the wrong path, but this is not the main runtime verifier path.**
   - `HermesCapabilitiesBffClient.get()` sends `GET /capabilities`: `src/main/hermes/bff/capabilities.ts:7-14`.
   - Mercury's runtime verifier uses `GET /v1/capabilities` directly in `probeHermesCapabilities(...)`: `src/main/hermes/connection.ts:230-255`, so the wrong BFF path does not explain the readiness/capability gate failure.
   - Live evidence: `/v1/capabilities` returns `200` on ready gateways; `/capabilities` returns `404` on the same gateways. Any future caller of `bff.capabilities.get()` will fail until it changes to `/v1/capabilities`.
   - Search found no current source/tests calling `.capabilities.get()` outside construction/export, so this appears latent rather than the active chat blocker.

#### Additional installed-Hermes evidence
- Installed Hermes source advertises the full newer surface in `gateway/platforms/api_server.py`: capabilities include `session_resources` and session endpoints at `~/.hermes/hermes-agent/gateway/platforms/api_server.py:1098-1123` and `:1124-1146`; route registration includes `/api/sessions` at `:4059-4068`.
- Live gateways returning `/v1/capabilities` without `session_resources` and returning 404 for `/api/sessions` therefore appear to be running an older/different gateway implementation than the installed source tree, or an already-running process that has not been restarted onto the current source.
- The live `gateway.pid` records also show `argv` without the `-p <profile>` arguments because Hermes profiles scope `HERMES_HOME` before the gateway process writes its PID. This is not necessarily wrong, but it means Mercury should not rely on exact command-array equivalence as durable ownership evidence across processes.

#### Eliminated or narrowed hypotheses
- **Wrong path for runtime capability probing is eliminated.** The verifier itself uses `/v1/capabilities`, not `/capabilities`: `src/main/hermes/connection.ts:230-255`.
- **Hermes PID file format incompatibility is eliminated.** Mercury parses both JSON and plain PID files: `src/main/hermes/runtime/local-runtime.ts:344-360`; installed/live pid files use JSON with a `pid` field.
- **Normal direct Hermes gateway forking is not proven.** Installed direct gateway startup calls `asyncio.run(start_gateway(...))` in-process (`~/.hermes/hermes-agent/hermes_cli/gateway.py:3291-3294`), and `start_gateway` writes the pid file from that process (`~/.hermes/hermes-agent/gateway/run.py:18820-18845`). The bug does not require forking to reproduce; Mercury process-local ownership state is enough.
- **Config not forcing API enabled is narrowed, not eliminated.** Mercury does inject enabling env, but preserves existing config and lets `.env` override. This can break profiles, but current observed 12s `runtime-unavailable` also matches the PID-evidence gate that prevents health probing.

#### Root cause
The failure is a combination of two active Mercury compatibility bugs plus one verifier robustness bug:
1. The chat setup path couples normal `/v1/runs` chat to the `/api/sessions` resource API by creating/reading a Hermes session before submitting a run. Older/live Hermes gateways that can run chat via `/v1/runs` but lack `/api/sessions` are blocked before token use.
2. Runtime capability gating treats `session_resources` as mandatory for all verified API runtime purposes, including chat, even though chat via `/v1/runs` only needs run submission/events/stop/approval capabilities and can use returned session headers/IDs best-effort.
3. Local runtime verification cannot recover across Mercury process restarts and can time out before checking `/health` because it requires in-memory child-process state and exact PID-file parity before probing the API.

#### Recommended fixes
1. **Decouple chat from `/api/sessions`.** In `runChatMessage(...)`, do not call `createHermesSession(...)` before a new `/v1/runs` chat unless capability discovery explicitly says session resources are available. Let `/v1/runs` create/return `session_id`, and project the returned ID/cache best-effort. For resume, only call `readHermesSession(...)` when `session_resources` is present; otherwise pass the `resumeSessionId` directly to `/v1/runs` and tolerate missing metadata.
2. **Make capability requirements purpose-specific.** Require `run_submission` for `purpose: "chat"`; require `run_events_sse` if streaming is mandatory; keep `run_stop`/`run_approval_response` optional/degraded; require `session_resources` only for `purpose: "sessions"` and session-management features.
3. **Relax/rework local verifier ownership.** Treat a live pid-file process plus matching configured host/port plus successful `/health`/`/v1/capabilities` as sufficient to verify a local profile after Mercury restarts. Keep strict in-process child evidence as a fast path, not the only path. Consider validating profile identity through an API identity/capabilities field rather than exact command-array/PID parity.
4. **Harden startup config.** Make Mercury's API-server bootstrap idempotently set `platforms.api_server.enabled=true` and correct `extra.host/port` for Mercury-managed profiles, or explicitly reject conflicting config with a diagnostic. Merge `.env` before forced Mercury API env, or block `.env` from overriding `API_SERVER_ENABLED/HOST/PORT` for managed launches.
5. **Fix latent BFF capabilities path.** Change `src/main/hermes/bff/capabilities.ts` from `/capabilities` to `/v1/capabilities` and add a unit test that would fail against `/capabilities`.
6. **Restart or reconcile live gateways after Hermes update.** Since installed source now has `/api/sessions` routes but live gateways do not, add diagnostics that surface source/runtime mismatch and prompt a gateway restart/update when `/v1/capabilities` lacks session endpoints despite installed code supporting them.

#### Tests to change/add
- Update `tests/hermes-capabilities.test.ts:118-140` so chat capability probes accept `run_submission` without `session_resources`; add a separate `purpose: "sessions"` test that requires `session_resources`.
- Add a chat-service test where `createHermesSession(...)` returns a 404/BFF error but `/v1/runs` succeeds; assert `sendMessage(...)` is still called and the final session ID comes from the run/stream when available.
- Update `tests/chat-ipc-lifecycle.test.ts:371-401` to keep durable-session behavior only when session resources are available, and add fallback coverage for runs-only gateways.
- Add runtime-manager tests for reconnecting to an existing healthy pid-file gateway after a new `ProfileRuntimeManager` is constructed with no `gatewayProcess` in memory.
- Add config tests for existing `api_server.enabled: false`, wrong `extra.port`, and `.env` overriding `API_SERVER_PORT`, asserting either correction or explicit diagnostics.
- Add/adjust BFF client coverage so `HermesCapabilitiesBffClient.get()` requests `/v1/capabilities`.

## Investigation Log

### Phase 1 - Initial Assessment and External Probes
**Hypothesis:** The failure likely combines a Mercury runtime verification/startup bug with a Hermes API surface mismatch around `/api/sessions`.
**Findings:** Installed Hermes docs/source advertise `/api/sessions`, but sampled live gateways expose `/health` and `/v1/capabilities` while returning 404 for `/api/sessions`. Existing older gateways have `api_server listening ...` logs; Mercury-started test gateways did not become API-ready during the live smoke.
**Evidence:** `## Background / Prior Research`; live smoke errors in `## Symptoms`.
**Conclusion:** Confirmed mismatch: current runtime can be runs-capable without sessions-capable, and Mercury must handle that.

### Phase 2 - Chat Path Coupling
**Hypothesis:** UI-equivalent chat is blocked by an unconditional session API preflight.
**Findings:** `runChatMessage(...)` calls `readHermesSession(...)` or `createHermesSession(...)` before `sendMessage(...)` (`src/main/services/chat-service.ts:458-483`). Those helpers route to BFF `/api/sessions` (`src/main/services/hermes-sessions-api.ts:20-37`, `src/main/hermes/bff/sessions.ts:19-37`). Only after that does Mercury submit `/v1/runs`.
**Evidence:** Pair findings and direct spot-check of `src/main/services/chat-service.ts:450-494`.
**Conclusion:** Confirmed active blocker. A missing sessions API blocks chat before tokens despite working `/v1/runs`.

### Phase 3 - Capability Gate
**Hypothesis:** Mercury over-requires session capabilities for chat verification.
**Findings:** `REQUIRED_CAPABILITY_FEATURES` is currently `["run_submission", "session_resources"]` (`src/main/hermes/connection.ts:141`). Missing required features become `missing-required-features`, and `assertVerifiedApiRuntimeHandle(...)` rejects any purpose on that capability problem.
**Evidence:** Pair findings and direct spot-check of `src/main/hermes/connection.ts:138-217`.
**Conclusion:** Confirmed. Capability requirements must be purpose-specific.

### Phase 4 - Local Runtime Verification and Startup
**Hypothesis:** Runtime verification is too tied to same-process managed child state.
**Findings:** `inspectManagedProcessEvidence(...)` returns unmanaged unless `state.gatewayStartedByApp`, `state.gatewayProcess`, host/port, command, and child PID evidence all exist; then it requires pid-file PID to equal child PID before health probing (`src/main/hermes/runtime/local-runtime.ts:312-341`). `startGateway(...)` sets API env, but then overlays profile `.env`, allowing `.env` to override forced `API_SERVER_ENABLED/HOST/PORT` (`src/main/hermes/runtime/manager.ts:194-214`).
**Evidence:** Pair findings and direct spot-checks of `local-runtime.ts:304-363` and `manager.ts:190-234`.
**Conclusion:** Confirmed robustness bug. Mercury cannot reliably reconnect to healthy local gateways across process boundaries and can allow env/config to defeat API startup.

### Phase 5 - BFF Capability Endpoint
**Hypothesis:** BFF capabilities uses the wrong endpoint.
**Findings:** `HermesCapabilitiesBffClient.get()` calls `/capabilities`, while live/current Hermes uses `/v1/capabilities` (`src/main/hermes/bff/capabilities.ts:7-14`). The main runtime verifier already uses `/v1/capabilities`, so this is latent rather than the active UI blocker.
**Evidence:** Direct spot-check of `src/main/hermes/bff/capabilities.ts:1-19`; live probe showed `/capabilities` 404 and `/v1/capabilities` 200.
**Conclusion:** Confirmed latent bug; fix alongside the main remediation.

## Final Root Cause
The blocker was not that Mercury needed to accept a runs-only Hermes surface. The practical failure was that Mercury could attach to or be blocked by stale local gateway state: pid-file-only gateways could keep serving an older API surface without `/api/sessions`, local launches could lack a durable per-profile `API_SERVER_KEY`, and profile `.env` values could override Mercury's forced API-server env. Those conditions made the current Hermes surface look unavailable even though the installed Hermes API server supported it.

## Final Fix Direction
1. **Refresh pid-file-only local gateways.** If `startGateway(profile)` sees a running `gateway.pid` process without a live Mercury child for that profile, it force-stops that stale process and starts a new Mercury-managed gateway instead of treating it as verified ownership.
2. **Keep the full Gateway contract.** `/v1/runs` plus `/api/sessions` remains the desktop runtime target; missing `session_resources` is an update/stale-gateway problem, not an accepted runs-only compatibility mode.
3. **Generate and persist local API auth.** Before local gateway start, Mercury ensures each selected profile has an `API_SERVER_KEY`, generating a `mercury_<uuid>` value and persisting it when absent.
4. **Force API env after profile env merge.** Profile `.env` is still honored for ordinary settings, but Mercury applies `API_SERVER_ENABLED=true`, the expected host/port, and the selected `API_SERVER_KEY` after the merge so stale env cannot disable or redirect the managed gateway API.
5. **Use `/v1/capabilities` consistently.** Both runtime probes and the BFF capabilities client target authenticated `GET /v1/capabilities`.
6. **Stop all gateways explicitly only on app shutdown.** `stopGateway(profile?)` stays profile-targeted; app lifecycle uses `stopAllGateways()` to walk known state and pid files for all local profiles.
7. **Validate with live smoke.** After refreshing stale gateways, a live API smoke against `/api/sessions` passed, confirming the final path works with the current session API rather than bypassing it.

## Preventive Measures
- Do not redefine success as runs-only compatibility when the installed/current Hermes Gateway supports sessions.
- Smoke test both `/v1/capabilities` and `/api/sessions` after gateway refresh/update work.
- Keep generated API keys profile-scoped and persisted before local gateway launch.
- Preserve the ordering invariant: profile env merge first, Mercury-forced API env last.
- Keep shutdown all-profile cleanup explicit through `stopAllGateways()` rather than overloading targeted profile stop semantics.

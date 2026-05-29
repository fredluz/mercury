# Investigation: Toolset Runtime Refresh UX

## Summary
Mercury does not need to restart/revalidate the Hermes runtime for ordinary toolset toggles when the active Hermes API server hot-reads `platform_toolsets.api_server` on each new request. The bad UX comes from Mercury treating toolset config edits as generic runtime-stale mutations, which blocks chat before Hermes is contacted and surfaces a scary global warning for a normal settings change.

## Symptoms
- Changing a toolset, such as `image_gen`, marks the selected profile runtime stale and surfaces a global runtime warning.
- Chat can briefly show an internal runtime verification/start error for named profiles, then recover after a few seconds.
- Restarting/revalidating on every tool toggle feels too heavy and creates bad UX.
- Desired behavior: settings changes should feel normal, with no scary warning or chat escape unless the runtime truly cannot continue.

## Background / Prior Research

### Git archaeology: toolset config history
- `b7a952a` (May 14, 2026, "Harden Trace Lab real app coverage") introduced local mirroring of `platform_toolsets.cli` and `platform_toolsets.api_server` in `src/main/tools.ts`. Current comments at `src/main/tools.ts:114-117` and `src/main/tools.ts:281-285` say Mercury chat prefers the local API server, so UI-facing tool toggles must mirror API-server toolsets to avoid a different tool registry than the runtime.
- SSH toolset handling started in `1572619` (May 13, 2026) and was later mirrored to both `cli` and `api_server` in `ec0ede7` (May 16, 2026).
- `b9e5a28` (May 21, 2026, "Enforce API-only chat runtime") made chat more API-server-centric, increasing the importance of `api_server` toolset alignment.

### Git archaeology: runtime stale diagnostics history
- `ec0ede7` (May 16, 2026, "Enforce agent runtime identity") introduced runtime identity diagnostics and `RuntimeDiagnosticNotice`.
- `afeb98d` (May 18, 2026) split runtime code into `src/main/hermes/runtime/manager.ts`; current stale APIs are `markRuntimeStale`, `clearRuntimeStale`, and `revalidateRuntime`.
- `302adb6` (May 18, 2026, "feat: add autonomous mercury cli") introduced broad service-layer stale marking for profile/config mutations, including config/env/model changes, knowledge/profile content changes, cron changes, and profile imports.
- Later commits tightened the runtime warning/readiness UI and API-only runtime flow. The stated rationale was preventing silent profile/runtime drift, especially when profile-scoped config/data changes while the running runtime may still reflect old state.

## Investigator Findings

### 2026-05-29 - Toolset toggle runtime-refresh trace

#### Verdict

- **(1) Disproved for Mercury policy:** Mercury has no current change-classification layer that distinguishes hot-readable toolset config edits from restart-required runtime edits. `setToolsetEnabledForProfile(...)` always treats a successful toolset write as a generic profile runtime mutation, marks the selected runtime stale, and then restarts/revalidates a running runtime (`src/main/services/knowledge-service.ts:160-173`, `src/main/services/knowledge-service.ts:47-64`). The stale marker itself stores only a string reason and timestamp, not a mutation class or reload policy (`src/main/hermes/runtime/manager.ts:345-351`, `src/main/hermes/runtime/state.ts:13-16`).
- **(1) Proven for upstream API-server behavior, outside Mercury policy:** installed Hermes hot-reads API-server toolsets for each new API request. The API server creates a new `AIAgent` for each `_run_agent(...)` call (`/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2700-2743`), `_create_agent(...)` reloads gateway config and resolves `platform_toolsets.api_server` immediately before constructing the agent (`/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:842-867`), and Hermes' tool-definition cache keys include enabled toolsets plus config mtime/size (`/Users/fredluz/.hermes/hermes-agent/model_tools.py:263-313`). Therefore a toolset toggle should be visible to the next Hermes API request without restarting the server process, though not to an already-running streamed turn.
- **(2) Confirmed:** toolset changes should be treated differently from model/env/profile/runtime identity mutations. Toolsets change the desired tool schema for subsequent agent construction; model/env/profile/connection changes can affect API credentials, provider/base URL, profile ownership, port/auth/PID proof, or runtime identity and may still justify restart/revalidation (`src/main/services/config-service.ts:70-169`, `src/main/hermes/runtime/local-runtime.ts:55-85`).
- **(3) Confirmed with bounds:** restart/revalidate for toolset toggles can be safely deferred/batched for idle or subsequent-turn use because chat preparation currently fails only when Mercury's own stale marker blocks runtime resolution (`src/main/hermes/runtime/local-runtime.ts:59-85`), not because Hermes cannot hot-read the changed toolsets. Do not apply toggles retroactively to an active run; policy should say “applies to the next message / next run.”

#### End-to-end flow: Tools UI toggle to Hermes API request

1. **Renderer toggles optimistically and does not expose runtime policy.** The Tools screen loads config-derived toolsets with `window.hermesAPI.getToolsets(profile)` and on click flips local state before awaiting `window.hermesAPI.setToolsetEnabled(key, !currentEnabled, profile)` (`src/renderer/src/screens/Tools/Tools.tsx:267-290`). There is no batching/debounce, no “applies next turn” copy, and no restart-required/hot-readable distinction at the UI boundary.
2. **IPC forwards directly to knowledge service.** Main registers `get-toolsets` and `set-toolset-enabled` handlers and delegates to `getToolsetsForProfile(...)` / `setToolsetEnabledForProfile(...)` (`src/main/ipc/knowledge.ts:62-70`).
3. **Config persistence mirrors CLI and API-server toolsets.** Local `setToolsetEnabled(...)` reads selected-profile `config.yaml`, toggles the key in the parsed `platform_toolsets.cli` set, and writes both `platform_toolsets.cli` and `platform_toolsets.api_server` so Mercury's API chat path sees the same registry as the UI (`src/main/tools.ts:114-119`, `src/main/tools.ts:240-263`, `src/main/tools.ts:267-292`). SSH has matching profile-aware mirroring for `cli` and `api_server` (`src/main/ssh/config.ts:55-115`).
4. **Stale/restart is unconditional for successful toolset writes.** After persistence succeeds, `setToolsetEnabledForProfile(...)` calls `markProfileMutation(profile, \`Toolset ${key}\`)`, which becomes `markRuntimeStale(profile, "Toolset <key> changed for profile runtime.")`; it then calls `refreshRunningRuntimeAfterMutation(profile)` (`src/main/services/knowledge-service.ts:47-64`, `src/main/services/knowledge-service.ts:160-173`). If local/SSH gateway is currently running, that helper restarts and revalidates (`src/main/services/gateway-service.ts:29-67`).
5. **Stale state blocks chat before any Hermes request.** `prepareChatBackend(...)` starts a local gateway only if needed and then calls `profileRuntimeManager.resolveRuntime(...)` (`src/main/services/chat-service.ts:125-170`). `resolveLocalApiRuntimeAttempt(...)` checks `state.staleReason` first and returns non-retryable `runtime-stale-after-profile-switch` before `/health` or `/v1/chat/completions` is reached (`src/main/hermes/runtime/local-runtime.ts:59-85`). This is why Mercury appears to require restart/revalidation after every toggle: Mercury blocks itself on the stale flag.
6. **If runtime resolution succeeds, Mercury's Hermes request does not send toolsets.** `sendMessageViaVerifiedApi(...)` builds a body with only `model`, `messages`, and `stream: true` (`src/main/hermes/chat-api.ts:180-204`) and POSTs it to `${runtime.apiBaseUrl}/v1/chat/completions` (`src/main/hermes/chat-api.ts:363-366`). Toolset selection therefore comes from the Hermes API server's own config read, not from a per-request Mercury payload.
7. **Hermes API server hot-reads desired API-server toolsets per request.** The installed Hermes API server parses each chat request, starts `_run_agent(...)`, and creates a fresh agent (`/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:989-1038`, `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:1178-1188`, `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2700-2743`). `_create_agent(...)` reloads config and reads `platform_toolsets.api_server` immediately before passing `enabled_toolsets` into `AIAgent(...)` (`/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:842-867`). This eliminates the hypothesis that an API-server process restart is inherently required for ordinary toolset toggles to affect future requests.

#### Runtime diagnostics and capability introspection

- Mercury diagnostics carry identity/lifecycle evidence, not loaded tool inventory. `RuntimeDiagnostic.capabilities` is a generic boolean map (`src/shared/runtime.ts:39-46`), and current local/SSH identities fill it with flags such as `managedByMercury`, `profileBoundApi`, `forcedApiPort`, `sshTunnelProfileBound`, and remote status/port verification (`src/main/hermes/runtime/identity.ts:61-66`, `src/main/hermes/runtime/identity.ts:95-100`). The diagnostic builder passes those flags through unchanged (`src/main/hermes/runtime/diagnostics.ts:50-56`).
- Mercury readiness uses `/health` only (`src/main/hermes/connection.ts:113-136`). Hermes exposes `/v1/capabilities`, but the installed implementation advertises API features/endpoints and server-side tool execution, not currently loaded toolset names (`/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:930-987`, `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:3363-3368`). So Mercury can verify desired config and runtime identity, but it cannot currently ask the running Hermes process “which toolsets are active?”

#### Evidence from tests and gaps

- Existing runtime tests prove generic stale semantics: marking stale flips diagnostics to `status: "stale"`, and `clearRuntimeStale(...)` does not clear until revalidation succeeds (`tests/hermes-runtime.test.ts:561-670`). System-service tests prove renderer-facing revalidation returns `false` instead of throwing on prep/probe failures (`tests/system-service.test.ts:55-83`). Contract tests only sentinel that stale hooks and diagnostic surfaces exist (`tests/reliable-profile-runtime-contract.test.ts:198-232`).
- Search did not find a behavioral test proving `tools set` specifically marks stale, restarts a running gateway, or can be deferred; existing toolset tests are mostly API-surface/parity sentinels (`tests/cli-parity.test.ts:16`, `tests/preload-api-surface.test.ts:283-284`) and config snippets (`tests/cli-mutating-commands.test.ts:63-75`).

#### Eliminated / qualified hypotheses

- **Eliminated:** “Hermes API server must restart after every toolset toggle.” The installed API server creates a fresh agent per request and reads `platform_toolsets.api_server` during that creation, so future requests can see toggles without process restart (`/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:842-867`, `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2700-2743`).
- **Eliminated:** “Mercury currently verifies loaded toolsets/capabilities.” It does not; the UI reads config, diagnostics expose runtime identity flags, and readiness probes `/health` (`src/main/tools.ts:240-263`, `src/shared/runtime.ts:39-46`, `src/main/hermes/connection.ts:113-136`).
- **Qualified:** “All profile file mutations should behave like toolsets.” Memory/SOUL/skills may alter prompt/system context, skill index, memory files, or long-lived semantics, and some current code intentionally warns `gateway-restart-required` for skill imports instead of auto-restarting (`src/main/services/knowledge-service.ts:80-266`). Toolsets are narrower: they only alter which tool schemas are offered to the next agent/request, provided Hermes keeps reading config per request.
- **Qualified:** “Revalidate can be removed entirely.” For model/env/connection/profile mutations, stale/revalidation still protects against wrong-profile or wrong-credential runtime drift (`src/main/services/config-service.ts:70-169`, `src/main/hermes/runtime/diagnostics.ts:14-33`). For toolset toggles, the safe replacement is not no state at all; it is lower-severity pending runtime-config state that is applied on next run and batched/debounced when needed.

#### Recommended replacement policy / UX

1. **Split runtime invalidation by mutation class.** Introduce a policy enum such as `hot-readable-next-request`, `restart-required`, `identity-revalidate-required`, and `unknown-conservative`. Ordinary toolset toggles should be `hot-readable-next-request`; model/env/connection/profile identity changes remain restart/revalidate-required.
2. **Stop using the global stale blocker for ordinary toolset toggles.** Do not set `state.staleReason` for toolset toggles that Hermes can hot-read. Instead store a non-blocking pending note such as `runtimeConfigPending: { kind: "toolsets", applies: "next-message" }`, or do nothing beyond successful config persistence if no runtime is active.
3. **Batch/debounce running-runtime refresh.** If product still wants verification after a cluster of toggles, debounce it (for example 500-1000ms after the last toggle) and make it background/non-blocking. Avoid stop/start per click.
4. **Use calm Tools-screen copy.** Replace global “Runtime updating/settings changed” for toolset toggles with inline copy: “Tool changes saved. They apply to the next message; running replies keep their original tools.” Only show global warnings when chat is actually blocked or runtime identity is unverified/mismatched/unsupported.
5. **Add optional introspection later.** If Mercury wants proof beyond config reads, add/use a Hermes endpoint that returns effective `enabled_toolsets`, resolved tool names, config path, config mtime, and profile identity. `/v1/capabilities` is not enough today.
6. **Add regression tests.** Cover Tools toggle → config mirrors `cli`/`api_server`; no `runtime-stale-after-profile-switch` for hot-readable toolset toggles; rapid toggles batch any refresh; chat after toggle reaches `/v1/chat/completions`; model/env/connection mutations still mark stale and restart/revalidate as today.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Toolset toggles are persisted to profile config, and Mercury currently treats that as a runtime-affecting mutation because the running Hermes API server may have loaded toolsets at startup.
**Findings:** Confirmed Mercury uses a generic stale/restart path for tool toggles, but disproved the assumption that the local Hermes API server inherently needs a restart for future requests.
**Evidence:** `src/main/services/knowledge-service.ts:47-64`, `src/main/services/knowledge-service.ts:160-173`, `src/main/hermes/runtime/local-runtime.ts:59-85`, `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:842-867`, `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2700-2743`.
**Conclusion:** Confirmed root cause: Mercury lacks a mutation-policy distinction and overuses blocking runtime-stale state for hot-readable toolset changes.

### Phase 2 - Context Builder and Pair Investigation
**Hypothesis:** A broader trace across renderer, IPC, config persistence, runtime readiness, chat send, and Hermes API behavior would reveal whether the restart requirement is real or only conservative Mercury policy.
**Findings:** Context Builder selected the runtime/tooling/chat files, and the pair investigator traced the full flow from `Tools.tsx` through Hermes API request construction. The pair found that Mercury never sends toolsets in the chat request, so the effective toolset source is Hermes API-server config read on agent creation.
**Evidence:** `src/renderer/src/screens/Tools/Tools.tsx:267-290`, `src/main/ipc/knowledge.ts:62-70`, `src/main/tools.ts:267-292`, `src/main/hermes/chat-api.ts:207-211`.
**Conclusion:** Toolset changes should be modeled as next-request config changes, not as runtime identity failures.

### Phase 3 - Oracle Synthesis
**Hypothesis:** The right fix is a typed mutation policy with `hot-readable-next-request` for ordinary toolsets and conservative refresh for identity/startup-sensitive mutations.
**Findings:** Oracle agreed with the verified evidence and recommended splitting mutation classes, avoiding global stale state for ordinary tool toggles, preserving strict checks for identity/env/model/connection changes, and capability-gating SSH/remote behavior.
**Evidence:** Current report selection plus installed Hermes file excerpts listed above.
**Conclusion:** Recommended policy is evidence-based hot-read for local ordinary toolsets today, with conservative fallback where runtime capability/version evidence is absent.

## Root Cause
Mercury currently has only a generic profile-mutation path, not a runtime-mutation policy. `setToolsetEnabledForProfile(...)` persists the toolset change and then unconditionally calls `markProfileMutation(profile, \`Toolset ${key}\`)`, which maps to `markRuntimeStale(profile, "Toolset <key> changed for profile runtime.")`, followed by restart/revalidation if a runtime is running (`src/main/services/knowledge-service.ts:47-64`, `src/main/services/knowledge-service.ts:160-173`).

That stale marker is blocking. `resolveLocalApiRuntimeAttempt(...)` checks `state.staleReason` before probing `/health` or sending chat, and returns `runtime-stale-after-profile-switch` immediately (`src/main/hermes/runtime/local-runtime.ts:59-85`). This makes Mercury appear to require a full runtime refresh after every tool toggle even though the block is self-imposed by Mercury state.

The installed Hermes API server evidence points the other way for ordinary toolsets: it creates a fresh `AIAgent` per `_run_agent(...)`, reloads gateway config inside `_create_agent(...)`, resolves `platform_toolsets.api_server` there, and keys tool-definition caching by enabled toolsets plus config mtime/size (`/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:842-867`, `/Users/fredluz/.hermes/hermes-agent/gateway/platforms/api_server.py:2700-2743`, `/Users/fredluz/.hermes/hermes-agent/model_tools.py:263-313`). Mercury also already mirrors toggles into both `platform_toolsets.cli` and `platform_toolsets.api_server` (`src/main/tools.ts:114-119`, `src/main/tools.ts:267-292`).

So the root problem is not that Hermes cannot use the changed tools. The root problem is that Mercury lacks an explicit distinction between runtime changes that are hot-readable on the next request and changes that require restart/revalidation for identity, credentials, process environment, or startup-loaded state.

## Recommendations
1. Introduce an explicit runtime mutation policy instead of treating every profile config write as stale. Suggested classes:
   - `hot-readable-next-request`: runtime reads changed config when constructing the next request/agent; persist only, no stale blocker.
   - `restart-required`: running process may have startup-loaded stale state; restart/revalidate or mark stale.
   - `identity-revalidate-required`: mutation affects profile/runtime ownership evidence, ports, auth, credentials, provider/base URL, or process identity; keep strict verification.
   - `unknown-conservative`: no proof; use the existing conservative path, but avoid alarming UX unless chat is truly blocked.
2. Treat ordinary local toolset toggles as `hot-readable-next-request` today, based on current Hermes behavior. Keep config persistence and CLI/API-server mirroring, but do not call `markRuntimeStale` or restart/revalidate per click.
3. Show inline Tools feedback instead of a global runtime warning: “Tool changes saved. They apply to the next message; running replies keep their original tools.”
4. Keep strict stale/revalidation behavior for model, provider, API key/env, connection mode, port/auth, profile identity, gateway ownership, and other mutations that can affect runtime identity or startup-only state.
5. For SSH and remote runtimes, gate the hot-readable policy by evidence. If the remote Hermes version/capability is unknown, use a compatibility fallback rather than assuming hot-read.
6. Longer term, add Hermes introspection/capability support for effective `enabled_toolsets`, config path/mtime/hash, profile identity, and `toolsetsHotReadable`. `/v1/capabilities` currently advertises API features but not loaded/effective toolsets.
7. Add regression tests covering:
   - tool toggles mirror both `platform_toolsets.cli` and `platform_toolsets.api_server`;
   - ordinary tool toggles do not set runtime diagnostic status to `stale`;
   - chat after a tool toggle reaches `/v1/chat/completions` instead of failing with `runtime-stale-after-profile-switch`;
   - rapid toggles do not restart the gateway repeatedly;
   - model/env/connection/profile identity mutations still mark stale or refresh;
   - renderer UX shows calm inline Tools feedback, not a global runtime warning, for ordinary tool toggles.

## Preventive Measures
- Encode runtime mutation semantics as typed policy, not ad hoc service calls to `markRuntimeStale`.
- Require new settings mutations to declare whether they are hot-readable, restart-required, identity-sensitive, or unknown.
- Add contract tests around runtime invalidation behavior so future settings features cannot accidentally reuse the scary stale path.
- Document that tool changes apply to the next message/new agent construction, never retroactively to an active streamed response.

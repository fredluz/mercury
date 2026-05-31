# Chat and Tracing

This document traces the current chat path from renderer input to preload, main IPC, Hermes transport, streaming events, live activity groups, title/context metadata, and trace persistence.

Every section describes current behavior **except** the clearly marked [remaining evolution](#remaining-evolution-run-remediation-and-renderer-targeting) section near the end, which tracks the Hermes API hardening work that still needs the remediation engine and renderer-targeted run state.

## Source anchors

- Renderer chat controller: `src/renderer/src/screens/Chat/hooks/useChatController.ts`
- Renderer chat send/listener helpers: `src/renderer/src/screens/Chat/hooks/chatSendFlows.ts`, `src/renderer/src/screens/Chat/hooks/useChatIpcListeners.ts`
- Renderer chat shell: `src/renderer/src/screens/Chat/Chat.tsx`
- Activity grouping/helpers: `src/renderer/src/screens/Chat/chatActivity.ts`, `src/renderer/src/screens/Chat/components/ChatActivityGroup.tsx`
- Chat runtime/auth recovery UI: `src/renderer/src/screens/Chat/components/ChatRuntimeReadinessCard.tsx`, `src/renderer/src/screens/Chat/components/ChatCodexAuthRecoveryCard.tsx`, `src/renderer/src/hooks/useCodexAuthFlow.ts`
- Runtime diagnostic notice: `src/renderer/src/components/RuntimeDiagnosticNotice.tsx`
- Header metadata UI: `src/renderer/src/screens/Chat/components/ChatHeader.tsx`
- Preload chat API: `src/preload/api/chat.ts`, `src/preload/index.d.ts`
- Main chat IPC: `src/main/ipc/chat.ts`
- Shared chat service used by IPC and CLI: `src/main/services/chat-service.ts`
- Codex auth recovery detection: `src/shared/codex-auth-recovery.ts`
- CLI chat adapter: `src/cli/chat-commands.ts`, `src/cli/output.ts`, `src/cli/errors.ts`, [CLI contract](../contracts/cli.md)
- Chat title generation: `src/main/hermes/title.ts`, `src/shared/chat-metadata.ts`
- Hermes dispatch: `src/main/hermes/gateway.ts`
- Agent model config resolution: `src/main/hermes/chat-model.ts`, `src/main/services/config-service.ts`, [Agent model configuration and provider inventory](model-roles-and-provider-inventory.md)
- Profile runtime manager/identity contract: `src/main/hermes/runtime.ts`, `src/main/hermes/types.ts`, `src/shared/runtime.ts`
- API transport: `src/main/hermes/chat-api.ts`
- Internal Hermes BFF client and typed subclients: `src/main/hermes/bff/*`
- Stream trace normalization: `src/main/hermes/trace-events.ts`
- Toolset writes/runtime staleness: `src/main/services/knowledge-service.ts`, `src/main/ipc/knowledge.ts`
- Codex image generation and image artifact behavior: [Codex image generation](codex-image-generation.md)
- Callback/handle types: `src/main/hermes/types.ts`
- Connection helpers: `src/main/hermes/connection.ts`
- Trace persistence: `src/main/trace-store.ts`
- Trace schema: `src/shared/traces.ts`, [Trace schema contract](../contracts/trace-schema.md)
- Contract tests: `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`, `tests/chat-ipc-lifecycle.test.ts`, `tests/chat-role-runtime.test.ts`, `tests/model-roles.test.ts`, `tests/reliable-profile-runtime-contract.test.ts`, `tests/chat-metadata.test.ts`, `tests/hermes-title.test.ts`, `tests/hermes-trace-events.test.ts`, `tests/trace-store.test.ts`

## Renderer flow

`useChatController(...)` owns the renderer chat state:

- `input` and slash-command menu state.
- `isLoading` plus run sequencing used to ignore stale callbacks from superseded/cancelled sends.
- current Hermes session id.
- `activityGroups`, each anchored to the user message that started a send.
- current Codex auth recovery card state.
- accumulated usage and derived context usage.
- generated title pending state.
- current configured provider/model summary and inferred context-window information.
- `fastMode`, backed by `agent.service_tier` config.
- scroll/focus behavior.

On conversation/profile changes, the controller resets usage, activity groups, pending title state, and active run bookkeeping so old stream events do not bleed into the next visible conversation.

On mount, `useChatIpcListeners(...)` registers cleanup-returning listeners from `window.hermesAPI`:

- `onChatChunk(chunk)` appends chunks to the last agent message or creates a new agent message for the first non-empty chunk.
- `onChatTraceEvent(event)` calls `appendActivityEvent(...)`, which adds visible live activity events to the active activity group.
- `onChatDone(sessionId)` stores a session id if provided, marks the active activity group completed, and clears loading state.
- `onChatError(error, info?)` appends an error agent message, marks the active activity group failed, and clears loading state. If the structured `ChatErrorInfo` or local fallback detection contains Codex auth recovery metadata, the transcript gets the short Codex reauthentication message and the controller opens the recovery card instead of exposing the raw refresh-token error as the primary user action.
- `onChatUsage(usage)` accumulates prompt/completion/total token counts and cost, then records context-window details for header display.

The renderer no longer models chat progress as one global tool-progress label. `chat-tool-progress` still exists at the IPC/preload layer for compatibility, but current renderer activity UI is driven by `chat-trace-event` and `activityGroups`.

## Activity groups and live trace events

Each outbound chat send calls `beginActivityGroup(userMessage.id)`. `Chat.tsx` renders any groups whose `anchorMessageId` matches a transcript message by inserting `ChatActivityGroup` directly below that user message.

Only activity-like trace events are shown live in chat. Both the main process and renderer use the same filter shape:

- `tool.*`
- `delegation.*`
- `artifact.created`
- `approval.*`
- `transport.error`

For Codex-backed image generation, a successful run must include image tool evidence plus `artifact.created`; prose that merely describes an image is not success. See [Codex image generation](codex-image-generation.md) for the `image_gen` toolset, `openai-codex` provider config, artifact path handling, and validation rules.

`src/main/services/chat-service.ts` records matching callback events to the trace store and the IPC callback sends the persisted `TraceEvent` over `chat-trace-event`. `src/renderer/src/screens/Chat/chatActivity.ts` then:

- groups repeated tool/delegation/artifact/approval/transport events into compact summaries;
- maps statuses to `running`, `completed`, `failed`, `waiting`, or `info`;
- humanizes common tool names;
- formats bounded metadata for expanded activity cards.
- can extract `ChatAuthRecovery` from `transport.error` metadata so activity UI can surface Codex reauthentication from the relevant failed run.

A group becomes failed when a `transport.error` or `*.failed` event arrives. Completed/failed/aborted terminal chat callbacks mark the active group and remove empty groups, so ordinary messages without activity do not leave blank activity cards.

## Sending messages

`handleSend()` currently:

1. Trims the input and returns if empty or already loading.
2. Handles local slash commands without calling the main chat IPC.
3. Creates a user message, captures the current title-request sequence, and builds history from current renderer messages.
4. Starts a run (`beginChatRun()`), begins an activity group anchored to the user message, and calls `onSessionStarted?.()`.
5. Calls `window.hermesAPI.sendMessage(text, profile, resumeSessionId, history)`.
6. Applies the resolved session id to renderer/session-list state if this run is still current or just finalized.
7. Requests a generated title once when the send produced the first eligible non-slash user message.
8. Handles promise rejection only as a fallback, because visible errors usually arrive through `onChatError`. The fallback path also runs Codex auth recovery detection using the current provider/profile in case the promise rejects before structured IPC error metadata arrives.

`handleQuickAsk()` sends `/btw <text>` through the same `sendMessage(...)` API with the current profile, but displays the local user message as `💭 <text>` and does not request a generated title. It now applies a returned or resumed session id through the same current-run guard as normal sends, so quick-ask can resolve session state without title generation.

`handleApprove()` and `handleDeny()` send `/approve` and `/deny` respectively through `sendMessage(...)`, start their own activity groups, and reuse the current profile, resume session id, and history.

`handleAbort()` calls `window.hermesAPI.abortChat()`, marks the active renderer group aborted, clears loading state, and refocuses input.

`handleClear()` aborts if loading, clears messages, clears current session id, clears usage, clears pending title state, clears activity groups, resets active run bookkeeping, and calls `onSessionReset?.()`.

Starting a normal send, quick ask, approval, deny, clear, profile change, conversation change, or empty-message reset also clears any visible Codex auth recovery card so stale recovery prompts do not linger after the user changes context.

## Generated title lifecycle

Generated titles are intentionally delayed until a real Hermes session id exists:

1. `handleSend()` records `requestSeq = titleRequestSeqRef.current` before sending.
2. After `sendMessage(...)` resolves, the controller chooses `result.sessionId || resumeSessionId` as the resolved session id.
3. `requestGeneratedTitleOnce(...)` returns unless there is a resolved session id, no current session title, and exactly one eligible user message whose content does not start with `/`.
4. The renderer sets `titleGenerationPending`, filters title input to non-slash messages starting at the first eligible user message, and calls `window.hermesAPI.generateChatTitle({ profile, sessionId, messages })`.
5. The main `generate-chat-title` handler validates the request with `isGenerateChatTitleRequest(...)`, normalizes it, prepares the chat backend, calls `src/main/hermes/title.ts`, and persists non-empty titles with `updateSessionTitle(sessionId, title, profile)`.
6. The renderer applies the title through `onSessionTitleChange?.(title)` only if the request sequence is still current, no title has appeared meanwhile, the resolved session still matches, and the conversation still has messages.

`ChatHeader.tsx` displays the visible title as:

- the persisted/generated title when present;
- `chat.generatingTitle` while title generation is pending and no clean title exists;
- the default chat title for empty chats;
- `chat.untitledChat` for non-empty conversations without a title.

If the model title path fails, `src/main/hermes/title.ts` falls back to a sanitized heuristic title based on the first user message. If title IPC itself fails, the renderer keeps the visible untitled state and clears pending state.

## Agent model display, context usage, and fast mode

`useChatController` delegates current model display state to `useChatModelConfig(...)`. That hook loads `window.hermesAPI.getModelConfig(profile)` and applies the configured provider/model to context-window metadata through `inferContextWindow(provider, model)` from `src/shared/chat-metadata.ts`.

The chat composer shows a compact read-only current agent model badge. Opening it renders `AgentModelConfigModal` for the current profile. The modal loads saved model inventory, profile env, credential pool, and Codex auth status, then filters the picker to connected providers through `filterInventoryToConnectedProviders(...)`. The currently configured provider/model is kept visible even if it is no longer in the connected inventory, so users can see and replace stale bindings. Saving writes the profile's direct `config.yaml` model binding and reloads the chat model display.

Sending without a configured provider/model fails before transport with setup guidance from `src/main/hermes/chat-model.ts`. The runtime does not fall back to provider auto-detect or legacy storage.

`onChatUsage(usage)` accumulates token/cost totals and stores the latest prompt/completion/total token counts alongside:

- `contextWindow`
- `contextWindowSource` (`explicit`, `known-model`, `family`, or `fallback`)
- `contextModel`

The `contextUsage` memo uses the latest run's total token count and the current context window to compute a percentage with `calculateContextUsage(...)`. `ChatHeader.tsx` renders this as a context counter with a tooltip that distinguishes explicit/known context windows from estimated family/fallback context windows.

Fast mode is profile-aware UI state backed by `agent.service_tier`:

- on mount/profile change, the controller reads `getConfig("agent.service_tier", profile)` and treats `fast` or `priority` as active;
- the header Zap button toggles local state and writes `setConfig("agent.service_tier", next ? "fast" : "normal", profile)`;
- the button popover reflects active/inactive fast-mode copy.

## Runtime readiness and diagnostics in chat

`Chat.tsx` treats any runtime diagnostic whose status is not `verified` as chat-blocking. The transcript area renders `ChatRuntimeReadinessCard` and the composer remains disabled with the runtime-disabled reason until the parent refreshes diagnostics back to verified.

The readiness card only appears for unverified diagnostics or after a verification attempt has failed. For local unverified runtimes it automatically starts one verification attempt per selected profile:

1. call `startGateway(profile)`;
2. call `revalidateRuntime(profile)` up to three times with short backoff, ignoring transient verification exceptions as "not ready yet";
3. if still unverified, call `restartGateway(profile)`;
4. revalidate up to three more times;
5. refresh parent runtime diagnostics.

Manual Verify uses the same repair path. If verification still fails, the card keeps the failure visible and exposes debug-agent launch actions for Codex, Claude, and Pi through `launchRuntimeDebugAgent({ agent, profile })`.

`RuntimeDiagnosticNotice` labels stale diagnostics as "Runtime updating" and explains that Mercury is applying runtime setting changes automatically. Ordinary toolset toggles no longer create this stale state: `setToolsetEnabledForProfile(...)` writes the profile's `platform_toolsets` config for local or SSH profiles, then returns without calling `markRuntimeStale`, restarting, or revalidating the gateway. Hermes API-server toolsets are hot-read when the next request constructs its agent, so the change applies on the next message instead of blocking chat behind runtime repair.

## Internal Hermes BFF boundary

Hermes Gateway HTTP access is centralized inside the main process through `ProfileHermesBffClient` and typed subclients in `src/main/hermes/bff/*`. The BFF client is constructed from a verified API runtime handle, injects the runtime's profile-scoped auth headers, records redacted diagnostics, and owns JSON/SSE request mechanics for runs, sessions, jobs, models, capabilities, and health. Mercury treats the combined `/v1/runs` + `/api/sessions` surface as the supported chat/session contract; runs-only compatibility is not considered sufficient for the desktop runtime.

Chat still enters through typed preload/IPC (`send-message`) and `src/main/services/chat-service.ts`. The transport path then uses `sendMessage(...)` -> `sendMessageViaApi(...)` -> `runs-api.ts`, where run submission, SSE event streaming, stop, approval, and terminal status polling delegate to `bff.runs`. Session create/read/list/message/title/delete calls delegate through `hermes-sessions-api.ts` to `bff.sessions`. Runtime model inventory uses the verified runtime plus `bff.models.options()`, and remote cron operations use `bff.jobs` while local cron file/CLI behavior remains separate.

`src/main/hermes/connection.ts` remains the pre-verification probe boundary for health/capability evidence needed before a verified handle exists. After verification, migrated runtime paths should not call `getApiUrl(...)`, `getRemoteAuthHeader(...)`, raw `fetch`, or Node `http`/`https` request helpers directly. Renderer/preload APIs remain typed; Mercury does not expose a generic raw `/v1/*` or `/api/*` proxy.

## Preload chat contract

`src/preload/api/chat.ts` exposes:

- `sendMessage(message, profile?, resumeSessionId?, history?)` -> invokes `send-message`.
- `abortChat()` -> invokes `abort-chat`.
- `resolveChatRunApproval(request)` -> invokes `resolve-chat-run-approval`.
- `generateChatTitle(request)` -> invokes `generate-chat-title`.
- `recordLocalChatTrace(request)` -> invokes `record-local-chat-trace`.
- `onChatChunk(callback)` -> listens to `chat-chunk`.
- `onChatDone(callback)` -> listens to `chat-done`.
- `onChatToolProgress(callback)` -> listens to `chat-tool-progress`.
- `onChatTraceEvent(callback)` -> listens to `chat-trace-event`.
- `onChatUsage(callback)` -> listens to `chat-usage`.
- `onChatError(callback)` -> listens to `chat-error` with `(error, info?)`, where `info` is optional `ChatErrorInfo` from `src/shared/codex-auth-recovery.ts`.

Each event listener returns a cleanup function that removes the listener.

## Codex auth recovery surfaced in chat

Codex auth recovery is intentionally a chat error path, not a separate runtime mode. `src/shared/codex-auth-recovery.ts` defines the stable recovery envelope:

- `provider: "openai-codex"`;
- `kind: "codex-auth"`;
- `reason`: `refresh-token-consumed`, `refresh-token-invalid`, `refresh-token-expired`, or `refresh-token-revoked`;
- `action: "start-codex-device-auth"`;
- optional profile;
- a display message telling the user to refresh Codex sign-in with Mercury's in-app Codex login.

`sendMessageViaApi(...)` detects that envelope only when the selected chat runtime model provider is `openai-codex` and the transport error mentions a refresh token with one of the supported failure reasons. It passes the resulting `ChatErrorInfo` through `ChatCallbacks.onError(error, info)`. The same `ChatErrorInfo` may also carry `remediation` metadata from `src/shared/chat-remediation.ts`.

`runChatMessage(...)` then:

- records a `transport.error` trace event using the user-facing display message when recovery exists;
- stores `metadata.recovery` on that trace event so activity cards and persisted traces retain the structured action;
- stores `metadata.remediation` when the transport or setup layer classifies a recovery/debug/instruction path;
- finishes the trace run as failed with the same visible message;
- calls renderer/CLI callbacks with `(visibleError, info)`, while rejecting the returned promise with the original transport error for debugging.

`src/main/ipc/chat.ts` forwards the optional `info` argument over `chat-error`, and the preload/index type surface exposes `onChatError((error, info?) => ...)`.

In the renderer:

- `useChatIpcListeners(...)` prefers structured `info.recovery` from IPC, but also runs local `detectCodexAuthRecovery(...)` against the current provider/profile as a fallback for setup or promise-rejection paths.
- `useChatController(...)` stores `codexAuthRecovery`, formats the transcript message with `chat.codexAuthRecoveryTranscript`, and exposes `showCodexAuthRecovery` / `dismissCodexAuthRecovery`.
- `ChatActivityGroup` can surface recovery from persisted `transport.error` metadata by calling back into the controller.
- `Chat.tsx` renders `ChatCodexAuthRecoveryCard` below the transcript when recovery is active.

`ChatCodexAuthRecoveryCard` uses `useCodexAuthFlow(...)` for the actual in-app login. The hook loads `getCodexAuthStatus(profile)`, starts device auth with `startCodexDeviceAuth()`, shows the verification URI and user code, supports copying the code, and polls `pollCodexDeviceAuth(sessionId, profile)` at the server-provided interval with a minimum of three seconds. On `authenticated`, it refreshes auth status, calls the card's `onAuthenticated`, reloads chat model config, and asks the parent to refresh runtime diagnostics. Users retry the failed chat manually after reauthentication.

## CLI chat automation

`mercury chat send` and `mercury chat title` are adapter peers to `send-message` and `generate-chat-title`. They do not use IPC or preload; `src/cli/chat-commands.ts` parses terminal inputs and calls `src/main/services/chat-service.ts`, which owns the same backend preparation, runtime verification, title generation, trace persistence, and session cache side effects used by IPC.

Input and output behavior is CLI-specific:

- `chat send` accepts message text from `--message`, positional arguments, stdin, and optional history files, then forwards normalized history to the shared chat service.
- Text mode streams assistant chunks directly to stdout.
- `--json` suppresses intermediate chunks and prints one final success/error envelope suitable for scripts that only need terminal data.
- `--ndjson` prints one JSON object per line for streaming automation. Callback mapping is stable: `onChunk` -> `"chunk"`, `onLiveTraceEvent` -> `"trace"`, `onToolProgress` -> `"tool"`, `onUsage` -> `"usage"`, completion -> `"done"`, and failures -> `"error"`. The stream also starts with `"start"`.
- `SIGINT` aborts the active chat run through the shared abort path, finalizes the trace as aborted when possible, and exits with code `130`.

Trace/session effects are the same as the IPC path: each send creates a trace run, records user/history/session-resume evidence, persists structured tool/delegation/artifact/approval/transport events, accumulates usage, finishes completed/failed/aborted runs, and associates returned session ids with the requested profile in the desktop session cache. Generated titles from `chat title --session` update the same profile-aware session title storage as renderer title generation.

Pure remote HTTP profile execution still fails closed before dispatch. Local mode requires a verified local API runtime; if Mercury cannot verify the selected profile's API runtime after the bounded startup wait, chat/title fail with structured runtime verification errors. SSH mode uses the verified `ssh-api` runtime after tunnel/gateway/API-key preparation. The CLI command is a client of this same API-runtime service path and does not spawn Hermes CLI as a fallback transport. See [Connection modes](connection-modes.md) and the [CLI contract](../contracts/cli.md) for mode-specific errors and output envelopes.

## Main `send-message` flow

`src/main/ipc/chat.ts` handles `send-message` as follows:

1. Calls `prepareChatBackend(profile, "chat", resumeSessionId)` unless synthetic stream mode is enabled.
2. `prepareChatBackend(...)` normalizes the profile through `profileRuntimeManager.normalizeProfile(profile)`.
3. In local mode, if the selected profile's gateway is not running, it calls `startGateway(normalizedProfile)`. If a gateway is running but its identity was not started by Mercury, it stops that unmanaged gateway and starts Mercury's gateway for the selected profile. It then resolves a verified `ProfileRuntimeHandle` with `profileRuntimeManager.resolveRuntime({ profile: normalizedProfile, purpose: "chat", sessionId })`.
4. In SSH mode, it ensures the tunnel, checks remote gateway status and tunnel health for the normalized profile, starts the remote gateway/tunnel when either is unhealthy, reads the remote API key, caches it with `setSshRemoteApiKey(key, normalizedProfile)`, then resolves the runtime handle.
5. In pure remote HTTP mode, runtime resolution currently fails closed with `runtime-unsupported-remote-profile` because profile identity is unverified for execution.
6. If another chat is active, abort it and finish the previous trace run as `aborted` with detail `Superseded by a new Hermes message.`
7. Create a new trace run with `createTraceRun(message, profile)`.
8. Record session resume and history metadata when supplied.
9. Resolve the direct agent model config through `getModelConfigForProfile(profile)`. If provider/model is missing, fail before transport with setup guidance.
10. With a verified runtime, create or read the server session through the BFF sessions client (`/api/sessions` or `/api/sessions/{id}`) before dispatch; Mercury does not downgrade to a runs-only chat path when session resources are missing.
11. Call `sendMessage(...)` from `src/main/hermes/gateway.ts`, passing the prepared runtime handle, effective session id, and callbacks for chunks, done, error, structured diagnostics, trace events, tool progress, and usage.
12. Store the returned chat handle and trace run metadata as `activeChatRun`.
13. Return a promise that resolves with `{ response, sessionId }` on completion/abort or rejects on error.

The main handler tracks only one active chat at a time through `activeChatRun`.

## Main callbacks and renderer events

The `sendMessage(...)` callbacks bridge transport events to both trace persistence and renderer events:

- `onChunk(chunk)`
  - Appends to `fullResponse`.
  - Records the first non-empty agent chunk as `message.agent.delta` titled `Agent response started`.
  - Sends `chat-chunk` to the renderer.
- `onDone(sessionId)`
  - Clears active chat state if this run is current.
  - Records a final `message.agent.delta` titled `Agent response completed` when `fullResponse` is non-empty.
  - Extracts artifact events from the completed response text, records them, and sends matching `chat-trace-event` events.
  - Finishes the trace run as `completed` with the session id.
  - If neither a new session id nor a resume id exists, records a warning `transport.error` diagnostic titled `Missing durable session id`; this preserves the successful response while making non-persistence visible in traces.
  - Updates the session profile when a session id is present.
  - Sends `chat-done` to the renderer.
  - Resolves the returned promise.
  - Shows a desktop notification when the main window exists, is not focused, and the response took more than 10 seconds.
- `onError(error, info?)`
  - Clears active chat state if this run is current.
  - Uses `info.displayMessage` as the visible error when present.
  - Records and sends a `transport.error` live activity event, including `info.recovery` metadata for Codex auth recovery when present.
  - Finishes the trace run as `failed` with the visible error.
  - Sends `chat-error` plus optional structured info to the renderer.
  - Rejects the returned promise with the original error.
  - Shows an error notification if the window is not focused.
- `onTraceEvent(traceEvent)`
  - Records structured tool/delegation/artifact/approval/transport events.
  - Sends persisted live activity events through `chat-trace-event` when they match the activity filter.
  - Marks the next legacy tool progress callback as duplicate when the structured event was `tool.*` or `delegation.*`.
- `onToolProgress(tool)`
  - Maintains legacy `chat-tool-progress` renderer compatibility.
  - Records and sends a fallback `tool.progress` event only when a structured tool/delegation event did not just arrive.
- `onUsage(usage)`
  - Accumulates trace usage through `recordTraceUsage(...)`.
  - Sends `chat-usage` to the renderer.
- `onDiagnostic(diagnostic)`
  - Currently records a one-time missing-session-id `transport.error` warning when a non-resumed API chat completes without `x-hermes-session-id`.

`safeSend(...)` and best-effort trace helpers keep non-critical trace or renderer-send failures from blocking stream completion/error delivery.

## Legacy `chat-tool-progress` compatibility

`chat-tool-progress` remains part of the IPC/preload contract for compact progress labels and older UI integrations. It should not be treated as the primary live activity model.

Preferred modern flow:

1. API transports parse custom SSE event names such as `hermes.tool.progress`, `hermes.approval.*`, and `hermes.artifact.created`.
2. Transports call `ChatCallbacks.onTraceEvent(...)` with structured events.
3. Main IPC records those events and emits `chat-trace-event` for live renderer activity groups.

Compatibility paths still exist:

- API `hermes.tool.progress` events also call `onToolProgress(...)` with a label for legacy listeners.
- Legacy inline backtick progress markers in streamed content are split out of prose by `splitLegacyToolProgressContent(...)` and forwarded as tool-progress labels.
- The main process suppresses duplicate fallback `tool.progress` records after structured tool/delegation events, while still emitting `chat-tool-progress`.

## Abort behavior

`abort-chat` currently delegates to `abortCurrentRun(...)`, which:

- Calls the active transport abort function if present.
- Clears `activeChatRun`.
- Finishes the active trace run as `aborted` with detail `User stopped the active Hermes run.`
- Sends `chat-done` with an empty session id through the active run's abort settler and resolves the send promise with the response accumulated so far.

`abortActiveChat()` is exported from `src/main/ipc/chat.ts` and called from `src/main/index.ts` during `before-quit`. It also delegates to `abortCurrentRun(...)`, so shutdown aborts the active transport and finishes the active trace run as `aborted`.

## Hermes dispatch choice

`src/main/hermes/gateway.ts` exposes `sendMessage(...)` and dispatches from a verified `ProfileRuntimeHandle`:

- Synthetic chat stream mode bypasses real runtime preparation.
- The selected profile is normalized through `profileRuntimeManager.normalizeProfile(profile)`.
- Local initialization is profile-aware and only enables API server config/health polling when not in remote/SSH mode.
- The gateway uses a caller-supplied `preparedRuntime` when `send-message` has already resolved one; otherwise it calls `profileRuntimeManager.resolveRuntime({ profile: normalizedProfile, purpose: "chat", sessionId })` itself.
- It rejects runtime handles whose `runtime.request.profile` does not match the normalized requested profile.
- `runtime.transport === "api"` or `"ssh-api"` routes to `sendMessageViaApi(...)` with the handle.
- Any missing, unverified, mismatched, or non-API executable handle is rejected with `ProfileRuntimeError` before dispatch.
- Pure remote HTTP currently does not produce an executable chat handle; `ProfileRuntimeManager.resolveRuntime(...)` throws `ProfileRuntimeError` with code `runtime-unsupported-remote-profile` until remote profile identity can be declared or verified.

The transport names used by executable chat paths are `api` and `ssh-api`. `remote-api` exists only for unverified external diagnostics, and current profile-bound chat execution fails closed before using it.

## API transport behavior

`sendMessageViaApi(...)` in `src/main/hermes/chat-api.ts`:

- Requires a verified `ProfileRuntimeHandle`; it throws `Verified API runtime handle is required for chat API execution` when the handle or `runtime.apiBaseUrl` is missing.
- Reads model config for the selected profile.
- Builds a runs request from the current user message, the explicit `session_id`, model config, and optional `conversation_history`, mapping renderer `agent` roles to `assistant`.
- Posts to `${runtime.apiBaseUrl}/v1/runs`, then subscribes to `GET /v1/runs/{run_id}/events`.
- Adds `runtime.authHeaders` to run submission, event streaming, status polling, and stop requests. Local API handles usually source auth from profile `.env`; SSH API handles source auth from the cached remote API key.
- Parses runs SSE as unnamed `data:` blocks whose JSON payload contains the event kind in `payload.event`; it does not rely on SSE `event:` lines.
- Routes `message.delta` to `onChunk`, `tool.started` / `tool.completed` / `reasoning.available` / approval events to structured trace callbacks, `run.completed` to usage plus `onDone(sessionId)`, and `run.failed` / `run.cancelled` to `onError`.
- Polls `GET /v1/runs/{run_id}` when the event stream closes before a terminal event so provider errors and completed output are not lost.
- Uses a local `HermesRunRegistry` to enforce the Hermes 10-run concurrency cap and queue excess sends until capacity frees.
- Returns a `ChatHandle` whose `abort()` aborts the active request and posts `POST /v1/runs/{run_id}/stop` once a run id exists.
- On transport errors, builds optional Codex auth recovery info for `openai-codex` refresh-token failures and passes it through `onError`.
- Times out requests after 120 seconds with an SSH/gateway-oriented timeout message.

The API transport no longer calls `getApiUrl()` or `getRemoteAuthHeader()` directly during chat execution. URL and auth are resolved earlier by `ProfileRuntimeManager.resolveRuntime(...)` and passed as `runtime.apiBaseUrl` and `runtime.authHeaders`.

## Removed local CLI fallback transport

Mercury no longer has an executable local Hermes CLI fallback transport for chat/title. The former internal `src/main/hermes/chat-cli.ts` path was removed so local execution cannot silently bypass API runtime verification.

Current behavior:

- Renderer and CLI chat/title both call `src/main/services/chat-service.ts`.
- Local mode starts the selected profile gateway when needed, waits a bounded time for the API to become ready, and requires a verified `api` runtime handle before dispatch.
- SSH mode requires a verified `ssh-api` runtime handle before dispatch.
- Runtime verification failures surface through renderer `chat-error` / rejected IPC promises and CLI normalized error envelopes instead of being hidden by a second transport.

## Trace lifecycle summary

For schema details, see [Trace schema contract](../contracts/trace-schema.md).

The chat path currently records:

- run creation and user message through `createTraceRun(...)`;
- session continuity evidence through `session.resumed` when a resume id is supplied;
- prior-message counts through `message.history.loaded` when renderer history is sent;
- first agent delta;
- final agent delta when available;
- structured tool/delegation/approval/artifact/transport events;
- Codex auth recovery metadata on `transport.error` events when an `openai-codex` refresh token failure is detected;
- legacy `tool.progress` fallback events when no structured equivalent arrived;
- accumulated usage and `usage.recorded` events;
- terminal completed, failed, or aborted run status.

Trace runs are persisted to `<HERMES_HOME>/desktop-traces.json` and capped by the trace store.

## Trace Lab conversation view

Persistence remains run-based: each send-message call creates one `TraceRun`. Trace Lab groups those runs into conversation/session rows in the renderer so the dashboard starts from the full conversation and nests individual runs/messages underneath it. The screen is launched from Sessions: each session row can open its session trace detail, while the Sessions header exposes Trace Activity for all traces and orphan/non-session fallback rows.

Grouping uses, in order:

1. `TraceRun.sessionId` from completed Hermes responses;
2. `session.resumed` event metadata/detail for resumed runs that failed, aborted, or have not yet received a terminal session id;
3. a one-run fallback for local slash commands, old stores, or traces with no session evidence.

Session-backed renderer keys include both profile and session id (`session:<profile>:<sessionId>`) to match Sessions rows across profile-specific databases. When a trace is opened from a session row, Trace Lab preselects/filter-matches that profile/session target and hides its internal Recent activity list so Sessions remains the list used to access other conversations. The all-trace fallback keeps the Recent activity list visible.

The selected conversation detail renders a merged Event Timeline first, then aggregate facts and constituent message summaries, with skill/evolution summaries at the bottom. The inspector remains scoped to the currently selected event metadata/artifact evidence.

## Remaining evolution: auto-retry and renderer targeting

The core chat transport now uses Hermes structured runs and emits structured remediation metadata. Remaining hardening work is narrower: complete renderer-visible per-run targeting for approvals/abort across multiple visible chats, and turn remediation metadata into bounded auto-retry/UI actions where appropriate.

### Runs replace the chat-completions stream

Current sends use `POST /v1/runs` with the user input and the chat's `session_id`, receive a `run_id` (HTTP 202), then subscribe to `GET /v1/runs/{run_id}/events` (SSE). The runs SSE stream uses **unnamed** `data:` messages whose JSON payload carries the kind in an `event` field; Mercury parses `JSON.parse(data).event`, not the SSE `event:` line. The run event stream maps onto the existing trace/activity model rather than inventing a parallel one:

| Run event | Existing handling it feeds |
| --- | --- |
| `message.delta` | `onChunk(...)` → `chat-chunk` → renderer transcript append (unchanged renderer contract) |
| `tool.started` / `tool.completed` / `reasoning.available` | structured `onTraceEvent(...)` → `chat-trace-event` → activity groups (same filter shape as today's `tool.*`) |
| `approval.request` / `approval.responded` | `approval.*` activity events (already in the live filter) |
| `run.completed` | `onDone(sessionId)` equivalent: final agent delta, artifact extraction, trace run finished `completed` |
| `run.failed` | `onError(...)` with a **clean** `error` string (the key win — no more swallowed provider message) |
| `run.cancelled` | aborted terminal state |

Because the existing renderer event contract (`chat-chunk`, `chat-trace-event`, `chat-usage`, `chat-done`, `chat-error`) is preserved, the renderer flow and activity groups stay intact. The non-streaming error re-probe is retired: `run.failed.error` and `GET /v1/runs/{run_id}` status carry the real error directly.

### Multi-run registry

`HermesRunRegistry` enforces the server's 10-run concurrency limit and queues excess sends locally:

- Active network execution is capped at **10 runs**; additional sends stay in process until capacity frees.
- Completion, failure, cancellation, aborted queued work, and stop cleanup all release capacity and drain the next queued run.
- Event routing still flows through the callback object for the owning send; the service-level `activeChatRun` guard remains the renderer compatibility layer for the current single-visible-chat UI.

### Per-run stop and tool approval

The transport `ChatHandle.abort()` aborts the active request and posts `POST /v1/runs/{run_id}/stop` for the run it submitted. The public IPC contract is still `abort-chat`, scoped to the current active renderer chat. Tool approval gates are surfaced as `approval.requested` trace events, and the main/preload API exposes `resolve-chat-run-approval` / `resolveChatRunApproval(...)` to call `POST /v1/runs/{run_id}/approval`. The remaining UI work is making approval controls target the concrete `run_id` instead of sending `/approve` or `/deny` as chat text.

### Error taxonomy as a remediation engine

Errors are classified by `src/shared/chat-remediation.ts`; each class carries an ordered remediation strategy. The guiding principle is: *don't show the user a button to fix it when Mercury can safely recover; when Mercury genuinely can't, hand the user a copy-pasteable debugging prompt.* The landed classifier generalizes Codex-auth recovery with reliable signals from `run.failed.error`, run submission/status failures, and capability/runtime errors.

| Tier | Trigger examples | Action |
| --- | --- | --- |
| **Auto-fix** | server `429` / run cap signals | emits `queue-retry` remediation; local run queue handles normal cap pressure, and transient submission 429s get a bounded retry before Mercury surfaces an error |
| **Assisted** | Codex refresh-token `consumed`/`invalid`/`expired`/`revoked` | emits `codex-auth` remediation and existing recovery metadata; UI opens the existing in-app device-auth flow, while automatic resend after auth remains future work |
| **Debug-prompt** | upstream provider/model exception such as `'NoneType' object is not iterable'` from `run.failed.error` | emits `debug-prompt` remediation with a copy-pasteable prompt containing error, provider, model, run/session id, request shape, and response preview. The prompt is redacted for API keys, bearer tokens, passwords, and other secret-shaped values. |
| **Instruct** | invalid gateway API key or capability mismatch | emits `gateway-auth` or `update-hermes` remediation with a clear operator instruction |

The classifier records structured diagnostics (profile, provider, model, error source, run/session id, request shape, response preview) on the `transport.error` trace event for both the debugging-prompt generator and persisted traces, extending the metadata already attached for Codex recovery.

### No fallback

There is deliberately no `/v1/chat/completions` fallback for older Hermes, and no runs-only compatibility mode when `/api/sessions`/`session_resources` are absent. Mercury has no external users and targets the current Hermes surface; capability mismatch fails loudly via the gate rather than degrading.

## Verification guidance

For chat, IPC, title, metadata, and trace changes, run:

```bash
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/chat-ipc-lifecycle.test.ts tests/chat-metadata.test.ts tests/hermes-title.test.ts tests/hermes-trace-events.test.ts tests/trace-store.test.ts
npm run typecheck
```

If the change touches local/remote/SSH routing, also review [Connection modes](connection-modes.md). If the change touches CLI chat parsing/output or shared chat service behavior consumed by `mercury chat send` / `mercury chat title`, also run `npm run test:cli`. For docs-only edits, manually verify file paths, links, IPC names, preload API names, CLI event names, and renderer state names against the source anchors above.

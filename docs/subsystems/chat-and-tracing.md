# Chat and Tracing

This document traces the current chat path from renderer input to preload, main IPC, Hermes transport, streaming events, live activity groups, title/context metadata, and trace persistence.

## Source anchors

- Renderer chat controller: `src/renderer/src/screens/Chat/hooks/useChatController.ts`
- Renderer chat shell: `src/renderer/src/screens/Chat/Chat.tsx`
- Activity grouping/helpers: `src/renderer/src/screens/Chat/chatActivity.ts`, `src/renderer/src/screens/Chat/components/ChatActivityGroup.tsx`
- Header metadata UI: `src/renderer/src/screens/Chat/components/ChatHeader.tsx`
- Preload chat API: `src/preload/api/chat.ts`, `src/preload/index.d.ts`
- Main chat IPC: `src/main/ipc/chat.ts`
- Chat title generation: `src/main/hermes/title.ts`, `src/shared/chat-metadata.ts`
- Hermes dispatch: `src/main/hermes/gateway.ts`
- API transport: `src/main/hermes/chat-api.ts`
- CLI transport: `src/main/hermes/chat-cli.ts`
- Stream/CLI trace normalization: `src/main/hermes/trace-events.ts`
- Callback/handle types: `src/main/hermes/types.ts`
- Connection helpers: `src/main/hermes/connection.ts`
- Trace persistence: `src/main/trace-store.ts`
- Trace schema: `src/shared/traces.ts`, [Trace schema contract](../contracts/trace-schema.md)
- Contract tests: `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`, `tests/chat-ipc-lifecycle.test.ts`, `tests/chat-metadata.test.ts`, `tests/hermes-title.test.ts`, `tests/hermes-trace-events.test.ts`, `tests/trace-store.test.ts`

## Renderer flow

`useChatController(...)` owns the renderer chat state:

- `input` and slash-command menu state.
- `isLoading` plus run sequencing used to ignore stale callbacks from superseded/cancelled sends.
- current Hermes session id.
- `activityGroups`, each anchored to the user message that started a send.
- accumulated usage and derived context usage.
- generated title pending state.
- current model/provider/base URL and inferred or saved context-window information.
- `fastMode`, backed by `agent.service_tier` config.
- scroll/focus behavior.

On conversation/profile changes, the controller resets usage, activity groups, pending title state, and active run bookkeeping so old stream events do not bleed into the next visible conversation.

On mount, it registers cleanup-returning listeners from `window.hermesAPI`:

- `onChatChunk(chunk)` appends chunks to the last agent message or creates a new agent message for the first non-empty chunk.
- `onChatTraceEvent(event)` calls `appendActivityEvent(...)`, which adds visible live activity events to the active activity group.
- `onChatDone(sessionId)` stores a session id if provided, marks the active activity group completed, and clears loading state.
- `onChatError(error)` appends an `Error: ...` agent message, marks the active activity group failed, and clears loading state.
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

`src/main/ipc/chat.ts` records matching callback events to the trace store and sends the persisted `TraceEvent` over `chat-trace-event`. `src/renderer/src/screens/Chat/chatActivity.ts` then:

- groups repeated tool/delegation/artifact/approval/transport events into compact summaries;
- maps statuses to `running`, `completed`, `failed`, `waiting`, or `info`;
- humanizes common tool names;
- formats bounded metadata for expanded activity cards.

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
8. Handles promise rejection only as a fallback, because visible errors usually arrive through `onChatError`.

`handleQuickAsk()` sends `/btw <text>` through the same `sendMessage(...)` API, but displays the local user message as `💭 <text>` and does not request a generated title.

`handleApprove()` and `handleDeny()` send `/approve` and `/deny` respectively through `sendMessage(...)`, start their own activity groups, and reuse the current resume session id and history.

`handleAbort()` calls `window.hermesAPI.abortChat()`, marks the active renderer group aborted, clears loading state, and refocuses input.

`handleClear()` aborts if loading, clears messages, clears current session id, clears usage, clears pending title state, clears activity groups, resets active run bookkeeping, and calls `onSessionReset?.()`.

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

## Context usage and fast mode

`useChatController` loads the active model config and saved model list with `getModelConfig(profile)` and `listModels()`. It derives context-window metadata through `inferContextWindow(provider, model, selectedSavedModel?.contextWindow)` from `src/shared/chat-metadata.ts`.

`onChatUsage(usage)` accumulates token/cost totals and stores the latest prompt/completion/total token counts alongside:

- `contextWindow`
- `contextWindowSource` (`explicit`, `known-model`, `family`, or `fallback`)
- `contextModel`

The `contextUsage` memo uses the latest run's total token count and the current context window to compute a percentage with `calculateContextUsage(...)`. `ChatHeader.tsx` renders this as a context counter with a tooltip that distinguishes explicit/known context windows from estimated family/fallback context windows.

Fast mode is profile-aware UI state backed by `agent.service_tier`:

- on mount/profile change, the controller reads `getConfig("agent.service_tier", profile)` and treats `fast` or `priority` as active;
- the header Zap button toggles local state and writes `setConfig("agent.service_tier", next ? "fast" : "normal", profile)`;
- the button popover reflects active/inactive fast-mode copy.

## Preload chat contract

`src/preload/api/chat.ts` exposes:

- `sendMessage(message, profile?, resumeSessionId?, history?)` -> invokes `send-message`.
- `abortChat()` -> invokes `abort-chat`.
- `generateChatTitle(request)` -> invokes `generate-chat-title`.
- `recordLocalChatTrace(request)` -> invokes `record-local-chat-trace`.
- `onChatChunk(callback)` -> listens to `chat-chunk`.
- `onChatDone(callback)` -> listens to `chat-done`.
- `onChatToolProgress(callback)` -> listens to `chat-tool-progress`.
- `onChatTraceEvent(callback)` -> listens to `chat-trace-event`.
- `onChatUsage(callback)` -> listens to `chat-usage`.
- `onChatError(callback)` -> listens to `chat-error`.

Each event listener returns a cleanup function that removes the listener.

## Main `send-message` flow

`src/main/ipc/chat.ts` handles `send-message` as follows:

1. If not remote mode and the local gateway is not running, call `startGateway(profile)`.
2. Call `ensureSshTunnelIfNeeded()`.
3. If connection mode is SSH, check remote gateway status and tunnel health. If either is not healthy, start the remote gateway, start the tunnel, read the remote API key, and cache it with `setSshRemoteApiKey(...)`.
4. If another chat is active, abort it and finish the previous trace run as `aborted` with detail `Superseded by a new Hermes message.`
5. Create a new trace run with `createTraceRun(message, profile)`.
6. Record session resume and history metadata when supplied.
7. Call `sendMessage(...)` from `src/main/hermes/gateway.ts` with callbacks for chunks, done, error, trace events, tool progress, and usage.
8. Store the returned chat handle and trace run metadata as `activeChatRun`.
9. Return a promise that resolves with `{ response, sessionId }` on completion/abort or rejects on error.

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
  - Updates the session profile when a session id is present.
  - Sends `chat-done` to the renderer.
  - Resolves the returned promise.
  - Shows a desktop notification when the main window exists, is not focused, and the response took more than 10 seconds.
- `onError(error)`
  - Clears active chat state if this run is current.
  - Records and sends a `transport.error` live activity event.
  - Finishes the trace run as `failed`.
  - Sends `chat-error` to the renderer.
  - Rejects the returned promise.
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

`safeSend(...)` and best-effort trace helpers keep non-critical trace or renderer-send failures from blocking stream completion/error delivery.

## Legacy `chat-tool-progress` compatibility

`chat-tool-progress` remains part of the IPC/preload contract for compact progress labels and older UI integrations. It should not be treated as the primary live activity model.

Preferred modern flow:

1. API transports parse custom SSE event names such as `hermes.tool.progress`, `hermes.approval.*`, and `hermes.artifact.created`.
2. CLI transports normalize standalone activity-looking lines.
3. Transports call `ChatCallbacks.onTraceEvent(...)` with structured events.
4. Main IPC records those events and emits `chat-trace-event` for live renderer activity groups.

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

`src/main/hermes/gateway.ts` exposes `sendMessage(...)` and chooses the transport:

- Calls `ensureInitialized()` on every send.
- If `isRemoteMode()` is true, always uses `sendMessageViaApi(...)`; there is no CLI fallback in remote or SSH mode.
- In local mode, checks API readiness with `isApiServerReady()` when availability is unknown or false.
- If local API is available, uses `sendMessageViaApi(...)`.
- Otherwise, falls back to `sendMessageViaCli(...)`.

`ensureInitialized()` enables local API server config and starts health polling only when not remote mode.

## API transport behavior

`sendMessageViaApi(...)` in `src/main/hermes/chat-api.ts`:

- Reads model config for the selected profile.
- Builds an OpenAI-style `messages` array from history plus the current user message, mapping renderer `agent` roles to `assistant`.
- Posts to `<getApiUrl()>/v1/chat/completions` with `stream: true`.
- Adds auth headers from `getRemoteAuthHeader()` for remote/SSH as applicable.
- Reads `x-hermes-session-id` from response headers when present.
- Parses SSE blocks containing `data:` lines and optional custom `event:` lines.
- Normalizes custom Hermes events into structured trace callbacks for tool/delegation/approval/artifact activity.
- Handles custom `event: hermes.tool.progress` by parsing JSON, calling `onTraceEvent`, and also calling `onToolProgress` with an emoji/label string when possible.
- Handles standard stream data by forwarding prose chunks, usage metadata, and errors.
- Treats legacy inline backtick tool progress patterns as tool progress rather than chat content.
- On `[DONE]`, finishes when content or stream activity exists, otherwise surfaces a captured error or probes a non-streaming request for a clearer error.
- Times out requests after 120 seconds with an SSH/gateway-oriented timeout message.
- Returns a `ChatHandle` whose `abort()` aborts the request through `AbortController`.

## CLI transport behavior

`sendMessageViaCli(...)` in `src/main/hermes/chat-cli.ts` is local-mode fallback only.

Current behavior:

- Builds Hermes CLI args from `HERMES_SCRIPT`, optional `-p <profile>`, `chat -q <message> -Q --source desktop`, optional `--resume <sessionId>`, and optional `-m <model>`.
- Builds an environment with enhanced `PATH`, `HOME`, `HERMES_HOME`, `PYTHONUNBUFFERED=1`, and known API keys from the profile `.env` when available.
- For custom/local providers with a base URL, sets `HERMES_INFERENCE_PROVIDER=custom`, `OPENAI_BASE_URL`, and an appropriate `OPENAI_API_KEY` fallback, including `no-key-required` for localhost/127.0.0.1 endpoints without a key.
- Captures `session_id: <id>` from output.
- Strips ANSI escape sequences and suppresses known UI/noise lines.
- Normalizes standalone activity-looking stdout lines into structured trace callbacks and omits those lines from visible prose.
- Forwards remaining meaningful stdout chunks to `onChunk`.
- For stderr, ignores empty warning-only output, records/sends `transport.error` for error-looking text, forwards that text visibly as chunks, and buffers other stderr for non-zero exit reporting.
- Calls `onDone(capturedSessionId)` when exit code is zero or output was produced without a transport error.
- Calls `onError(...)` when the process exits non-zero without successful output.
- Returns a `ChatHandle` whose `abort()` sends `SIGTERM`, then sends `SIGKILL` after 3 seconds if needed.

## Trace lifecycle summary

For schema details, see [Trace schema contract](../contracts/trace-schema.md).

The chat path currently records:

- run creation and user message through `createTraceRun(...)`;
- session continuity evidence through `session.resumed` when a resume id is supplied;
- prior-message counts through `message.history.loaded` when renderer history is sent;
- first agent delta;
- final agent delta when available;
- structured tool/delegation/approval/artifact/transport events;
- legacy `tool.progress` fallback events when no structured equivalent arrived;
- accumulated usage and `usage.recorded` events;
- terminal completed, failed, or aborted run status.

Trace runs are persisted to `<HERMES_HOME>/desktop-traces.json` and capped by the trace store.

## Trace Lab conversation view

Persistence remains run-based: each send-message call creates one `TraceRun`. Trace Lab groups those runs into conversation/session rows in the renderer so the dashboard starts from the full conversation and nests individual runs/messages underneath it.

Grouping uses, in order:

1. `TraceRun.sessionId` from completed Hermes responses;
2. `session.resumed` event metadata/detail for resumed runs that failed, aborted, or have not yet received a terminal session id;
3. a one-run fallback for local slash commands, old stores, or traces with no session evidence.

The selected conversation detail renders a merged Event Timeline first, then aggregate facts and constituent message summaries, with skill/evolution summaries at the bottom. The inspector remains scoped to the currently selected event metadata/artifact evidence.

## Verification guidance

For chat, IPC, title, metadata, and trace changes, run:

```bash
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/chat-ipc-lifecycle.test.ts tests/chat-metadata.test.ts tests/hermes-title.test.ts tests/hermes-trace-events.test.ts tests/trace-store.test.ts
npm run typecheck
```

If the change touches local/remote/SSH routing, also review [Connection modes](connection-modes.md). For docs-only edits, manually verify file paths, links, IPC names, preload API names, and renderer state names against the source anchors above.

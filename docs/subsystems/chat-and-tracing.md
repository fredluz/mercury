# Chat and Tracing

This document traces the current chat path from renderer input to preload, main IPC, Hermes transport, streaming events, and trace persistence.

## Source anchors

- Renderer chat controller: `src/renderer/src/screens/Chat/hooks/useChatController.ts`
- Preload chat API: `src/preload/api/chat.ts`, `src/preload/index.d.ts`
- Main chat IPC: `src/main/ipc/chat.ts`
- Hermes dispatch: `src/main/hermes/gateway.ts`
- API transport: `src/main/hermes/chat-api.ts`
- CLI transport: `src/main/hermes/chat-cli.ts`
- Callback/handle types: `src/main/hermes/types.ts`
- Connection helpers: `src/main/hermes/connection.ts`
- Trace persistence: `src/main/trace-store.ts`
- Trace schema: `src/shared/traces.ts`, [Trace schema contract](../contracts/trace-schema.md)
- Contract tests: `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`, `tests/trace-store.test.ts`

## Renderer flow

`useChatController(...)` owns the renderer chat state:

- `input`
- `isLoading`
- current Hermes session id
- tool progress label
- accumulated usage
- current model/provider/base URL
- slash command menu state
- scroll/focus behavior

On mount, it registers cleanup-returning listeners from `window.hermesAPI`:

- `onChatChunk(chunk)` appends chunks to the last agent message or creates a new agent message for the first non-empty chunk.
- `onChatDone(sessionId)` stores a session id if provided, clears tool progress, and clears loading state.
- `onChatError(error)` appends an `Error: ...` agent message, clears tool progress, and clears loading state.
- `onChatToolProgress(tool)` stores the current tool progress label.
- `onChatUsage(usage)` accumulates prompt/completion/total token counts and cost into renderer state.

## Sending messages

`handleSend()` currently:

1. Trims the input and returns if empty or already loading.
2. Handles local slash commands without calling the main chat IPC.
3. Sets loading state.
4. Adds a user message to renderer state.
5. Calls `onSessionStarted?.()`.
6. Calls `window.hermesAPI.sendMessage(text, profile, hermesSessionId || undefined, history)` where `history` is built from current renderer messages.
7. Ignores the thrown promise error because `onChatError` handles visible errors through IPC events.

`handleQuickAsk()` sends `/btw <text>` through the same `sendMessage(...)` API.

`handleApprove()` and `handleDeny()` send `/approve` and `/deny` respectively through `sendMessage(...)`.

`handleAbort()` calls `window.hermesAPI.abortChat()`, clears loading state, and refocuses input.

`handleClear()` aborts if loading, clears messages, clears current session id, clears usage, and clears tool progress.

## Preload chat contract

`src/preload/api/chat.ts` exposes:

- `sendMessage(message, profile?, resumeSessionId?, history?)` -> invokes `send-message`.
- `abortChat()` -> invokes `abort-chat`.
- `onChatChunk(callback)` -> listens to `chat-chunk`.
- `onChatDone(callback)` -> listens to `chat-done`.
- `onChatToolProgress(callback)` -> listens to `chat-tool-progress`.
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
6. Call `sendMessage(...)` from `src/main/hermes/gateway.ts` with callbacks for chunks, done, error, tool progress, and usage.
7. Store the returned chat handle and trace run metadata as `activeChatRun`.
8. Return a promise that resolves with `{ response, sessionId }` on completion or rejects on error.

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
  - Finishes the trace run as `completed` with the session id.
  - Sends `chat-done` to the renderer.
  - Resolves the returned promise.
  - Shows a desktop notification when the main window exists, is not focused, and the response took more than 10 seconds.
- `onError(error)`
  - Clears active chat state if this run is current.
  - Finishes the trace run as `failed`.
  - Sends `chat-error` to the renderer.
  - Rejects the returned promise.
  - Shows an error notification if the window is not focused.
- `onToolProgress(tool)`
  - Records a `tool.progress` trace event.
  - Sends `chat-tool-progress` to the renderer.
- `onUsage(usage)`
  - Accumulates trace usage through `recordTraceUsage(...)`.
  - Sends `chat-usage` to the renderer.

## Abort behavior

`abort-chat` currently delegates to `abortCurrentRun(...)`, which:

- Calls the active transport abort function if present.
- Clears `activeChatRun`.
- Finishes the active trace run as `aborted` with detail `User stopped the active Hermes run.`

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
- Handles custom `event: hermes.tool.progress` by parsing JSON and calling `onToolProgress` with an emoji/label string when possible.
- Handles standard stream data by forwarding `delta.content` chunks, usage metadata, and errors.
- Treats legacy inline backtick tool progress patterns as tool progress rather than chat content.
- On `[DONE]`, finishes when content exists, otherwise surfaces a captured error or probes a non-streaming request for a clearer error.
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
- Forwards meaningful stdout chunks to `onChunk`.
- For stderr, ignores empty warning-only output, forwards error-looking text as chunks, and buffers other stderr for non-zero exit reporting.
- Calls `onDone(capturedSessionId)` when exit code is zero or output was produced.
- Calls `onError(...)` when the process exits non-zero without output.
- Returns a `ChatHandle` whose `abort()` sends `SIGTERM`, then sends `SIGKILL` after 3 seconds if needed.

## Trace lifecycle summary

For schema details, see [Trace schema contract](../contracts/trace-schema.md).

The chat path currently records:

- run creation and user message through `createTraceRun(...)`;
- session continuity evidence through `session.resumed` when a resume id is supplied;
- prior-message counts through `message.history.loaded` when renderer history is sent;
- first agent delta;
- final agent delta when available;
- tool progress events;
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

For chat, IPC, and trace changes, run:

```bash
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/trace-store.test.ts
npm run typecheck
```

If the change touches local/remote/SSH routing, also review [Connection modes](connection-modes.md). For docs-only edits, manually verify file paths and links.

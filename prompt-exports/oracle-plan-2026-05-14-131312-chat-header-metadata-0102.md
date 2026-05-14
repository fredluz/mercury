## Final Prompt
<taskname="Chat Header Metadata"/>
<task>
Implement Mercury chat header metadata/title improvements:
1. Show the current profile name in the chat header as the agent identity, instead of model/provider identity.
2. After a chat begins, replace the default "New Chat" / session-id header with a concise model-generated title.
3. Replace the raw header token count with percent of context used.
Keep Electron security boundaries intact: renderer must go through preload/IPCs, not direct main/node access. Add/update i18n strings for visible text. Include focused tests where practical.
</task>

<architecture>
Renderer chat state is split between `Layout` and `useChatController`:
- `src/renderer/src/screens/Layout/Layout.tsx` owns `activeProfile`, `messages`, `currentSessionId`, new chat resets, and session resume. It passes `profile` and `sessionId` into `Chat`.
- `src/renderer/src/screens/Chat/Chat.tsx` wires `useChatController` output into `ChatHeader`, transcript, composer, slash menu, and model picker.
- `src/renderer/src/screens/Chat/hooks/useChatController.ts` owns live message sending, live Hermes session id (`hermesSessionId`), accumulated `usage`, model config/listing state, and local command execution. `onChatDone` is where a real session id arrives after streaming.
- `src/renderer/src/screens/Chat/components/ChatHeader.tsx` currently renders `New Chat` or `Session {{last6}}`, and shows raw total token count plus optional cost. It already receives `profile`, `sessionId`, `usage`, `messages`, `fastMode`, and callbacks.
- `src/renderer/src/assets/styles/chat.css` contains header/title/token styles.

Session/title persistence crosses preload and main:
- `src/main/session-cache.ts` maintains `CachedSession` and has a local first-message heuristic `generateTitle()` plus `updateSessionTitle(sessionId,title)`, but `updateSessionTitle` currently updates only the desktop JSON cache entry if it already exists.
- `src/main/ipc/sessions.ts` registers `update-session-title`, cache/list/search IPC, and profile IPC.
- `src/preload/api/models.ts` exposes `updateSessionTitle`, `listCachedSessions`, `syncSessionCache`, model CRUD/listing, and credential APIs.
- `src/preload/index.d.ts` must mirror any preload surface changes; `tests/preload-api-surface.test.ts` checks implementation/type parity and channel naming.
- `src/renderer/src/screens/Sessions/Sessions.tsx` reads cached/synced sessions and displays cached titles, so title changes should remain coherent there.

Chat/model execution and usage:
- `src/main/ipc/chat.ts` handles `send-message`, creates trace runs, forwards stream chunks, usage, trace events, and `chat-done` session id to the renderer.
- `src/main/hermes/gateway.ts` chooses API vs CLI send path.
- `src/main/hermes/chat-api.ts` sends OpenAI-style chat completion requests and maps `parsed.usage` into `promptTokens`, `completionTokens`, `totalTokens`, optional `cost`, and rate-limit fields.
- `src/main/hermes/types.ts`, `src/preload/api/chat.ts`, and `src/preload/index.d.ts` define the usage callback shape.
- `src/main/models.ts` and `src/main/default-models.ts` define saved/default model records. Discovered records currently have `id`, `name`, `provider`, `model`, `baseUrl`, `createdAt`; no context-window/max-token field exists.
- `src/main/config.ts` provides profile-aware model config and config/env access.
</architecture>

<selected_context>
package.json: scripts and test commands (`test`, `typecheck:*`) plus dependencies.

src/renderer/src/screens/Chat/components/ChatHeader.tsx: current header rendering, title fallback, raw token counter, cost tooltip, fast-mode button.
src/renderer/src/screens/Chat/Chat.tsx: passes `sessionId`, `profile`, `usage`, `messages`, and callbacks from controller/Layout into header and other chat UI.
src/renderer/src/screens/Chat/hooks/useChatController.ts: core live chat controller; session id is set from `onChatDone`, usage is accumulated from `onChatUsage`, sends messages through `window.hermesAPI.sendMessage`, handles `/new`/clear/abort/model selection.
src/renderer/src/screens/Chat/types.ts: `ChatUsage`, `ChatController`, `ModelGroup`, `ChatMessage` type contracts.
src/renderer/src/screens/Chat/chatCommands.ts: local slash command usage display currently reports raw tokens; may need shape alignment if `ChatUsage` changes.
src/renderer/src/screens/Chat/chat.constants.ts: command metadata, including `/usage`.
src/renderer/src/screens/Chat/components/ModelPicker.tsx: model display/listing UI fed by controller; included because context percentage may depend on current model/listed model metadata.
src/renderer/src/screens/Layout/Layout.tsx: active profile/session ownership, new chat reset, session resume, Chat mounting.
src/renderer/src/screens/Sessions/Sessions.tsx: cached sessions list/search UI and title display.
src/renderer/src/assets/styles/chat.css: chat header/title/token counter CSS.

src/main/ipc/chat.ts: `send-message` IPC, stream forwarding, usage forwarding, `chat-done` session id forwarding.
src/main/ipc/sessions.ts: session/profile IPC registration, `update-session-title`, local vs SSH cache/search/session branches.
src/main/ipc/models.ts: `list-models` IPC and model CRUD channels.
src/main/session-cache.ts: cached session schema, heuristic title generation, cache sync, `updateSessionTitle` cache mutation.
src/main/sessions.ts: read-only SQLite session/message/search access; session rows include DB `title` but no updater exists here.
src/main/config.ts: profile-aware config/env/model config helpers.
src/main/models.ts: saved model persistence shape with no context-window field.
src/main/default-models.ts: default model seed shape with no context-window field.
src/main/hermes.ts: compatibility barrel exporting chat/gateway services.
src/main/hermes/chat-api.ts: API chat completion request and usage extraction.
src/main/hermes/gateway.ts: `sendMessage` abstraction and gateway lifecycle.
src/main/hermes/connection.ts: API URL/auth helpers for local/remote/SSH modes.
src/main/hermes/types.ts: chat callback/usage type.

src/preload/api/chat.ts: renderer-facing chat methods/events.
src/preload/api/models.ts: renderer-facing session cache/title and model APIs.
src/preload/api/index.ts: composes split preload fragments.
src/preload/index.ts: contextBridge exposure.
src/preload/index.d.ts: global `window.hermesAPI` contract; keep in sync with preload changes.

src/shared/i18n/locales/en/chat.ts, es/chat.ts, pt-BR/chat.ts, zh-CN/chat.ts: chat-visible strings including `title`, `sessionTitle`, `noUsageData`, fast mode text, command labels.

tests/session-cache-sync.test.ts: cache sync regression tests and mocks; useful if title cache persistence behavior changes.
tests/preload-api-surface.test.ts: verifies every preload method has type declaration and every invoke/on channel is kebab-case.
</selected_context>

<relationships>
- `Layout.activeProfile` → `Chat.profile` → `ChatHeader.profile` and `useChatController(profile)`.
- `Layout.currentSessionId` → `Chat.sessionId` → `ChatHeader` title fallback; live `useChatController.hermesSessionId` is separate and currently only used by `ChatComposer`/send resume.
- `useChatController.handleSend()` → `window.hermesAPI.sendMessage()` → preload `chatApi.sendMessage()` → main `registerChatIpc/send-message` → `sendMessage()` → `sendMessageViaApi()` or CLI.
- Main chat IPC `onDone(sessionId)` → renderer `onChatDone` → `setHermesSessionId(sessionId)`; `Layout.currentSessionId` is not currently updated by `onSessionStarted` because `Chat` receives but does not pass `onSessionStarted` from `Layout`.
- Main chat IPC `onUsage(usage)` → preload `onChatUsage` → `useChatController.setUsage()` accumulates prompt/completion/total/cost → `ChatHeader` raw token display and `/usage` local command.
- `ChatHeader` title currently uses only `sessionId` prop and i18n keys `chat.title` / `chat.sessionTitle`.
- `Sessions` view title display comes from `listCachedSessions()` then `syncSessionCache()`; cache sync can derive heuristic titles from first user message when DB `sessions.title` is missing.
- `window.hermesAPI.updateSessionTitle()` → preload `modelsApi.updateSessionTitle()` → `ipc/sessions.ts` → `session-cache.updateSessionTitle()`; current main function does not update the SQLite `sessions.title` row.
- `useChatController.loadModelConfig()` reads `getModelConfig(profile)` and `listModels()`, groups saved models into `ModelGroup`; saved/default models currently do not carry context-window values.
- Any new preload method must be added to a preload fragment, `src/preload/index.d.ts`, and will be caught by `tests/preload-api-surface.test.ts` if mismatched.
</relationships>

<ambiguities>
- No existing model context-window/max-token field was found in saved model records, default model records, `ChatUsage`, or streamed usage events. Percent context used will need a source for max context or an explicit fallback policy.
- The request says "model-made title". Existing `session-cache.generateTitle()` is heuristic/local from the first user message, not model-generated.
- Current `updateSessionTitle()` only mutates an existing cache entry and not the SQLite `sessions.title`; a freshly started session may not yet be present in cache when the renderer tries to update it.
- The header receives `sessionId` from `Layout.currentSessionId`, but new live chat session ids are stored in `useChatController.hermesSessionId`. That mismatch matters for when the header can switch from "New Chat" to a generated title.
</ambiguities>

## Selection
- Files: 40 total (35 full, 5 codemap)
- Total tokens: 48299 (Auto view)
- Token breakdown: full 47064, codemap 1235

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 192 tokens (full)
│   │   │   ├── connection.ts — 1 052 tokens (full)
│   │   │   ├── gateway.ts — 1 533 tokens (full)
│   │   │   └── types.ts — 184 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 2 653 tokens (full)
│   │   │   ├── models.ts — 312 tokens (full)
│   │   │   └── sessions.ts — 1 704 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── default-models.ts — 456 tokens (full)
│   │   ├── hermes.ts — 120 tokens (full)
│   │   ├── models.ts — 599 tokens (full)
│   │   ├── session-cache.ts — 1 407 tokens (full)
│   │   └── sessions.ts — 1 099 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── chat.ts — 770 tokens (full)
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   └── models.ts — 1 128 tokens (full)
│   │   ├── index.d.ts — 3 397 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   └── styles/
│   │       │       └── chat.css — 2 599 tokens (full)
│   │       └── screens/
│   │           ├── Chat/
│   │           │   ├── components/
│   │           │   │   ├── ChatHeader.tsx — 659 tokens (full)
│   │           │   │   └── ModelPicker.tsx — 747 tokens (full)
│   │           │   ├── hooks/
│   │           │   │   └── useChatController.ts — 4 543 tokens (full)
│   │           │   ├── Chat.tsx — 1 231 tokens (full)
│   │           │   ├── chat.constants.ts — 669 tokens (full)
│   │           │   ├── chatCommands.ts — 1 457 tokens (full)
│   │           │   └── types.ts — 697 tokens (full)
│   │           ├── Layout/
│   │           │   └── Layout.tsx — 2 805 tokens (full)
│   │           └── Sessions/
│   │               └── Sessions.tsx — 2 659 tokens (full)
│   └── shared/
│       └── i18n/
│           └── locales/
│               ├── en/
│               │   └── chat.ts — 579 tokens (full)
│               ├── es/
│               │   └── chat.ts — 688 tokens (full)
│               ├── pt-BR/
│               │   └── chat.ts — 649 tokens (full)
│               └── zh-CN/
│                   └── chat.ts — 568 tokens (full)
├── tests/
│   ├── preload-api-surface.test.ts — 2 049 tokens (full)
│   └── session-cache-sync.test.ts — 1 641 tokens (full)
└── package.json — 771 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── install/
    │   │   └── paths.ts — 672 tokens (auto)
    │   └── ipc/
    │       └── types.ts — 44 tokens (auto)
    ├── renderer/
    │   └── src/
    │       └── screens/
    │           └── Models/
    │               └── Models.tsx — 90 tokens (auto)
    └── shared/
        ├── i18n/
        │   └── types.ts — 43 tokens (auto)
        └── traces.ts — 386 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `chat-header-metadata-E14E90` | **Mode**: plan

### Response
## 1. Summary

Implement this as a targeted metadata/title enhancement, not a broad chat refactor. The renderer will continue to own live chat UI state, but `Layout` will additionally own the current session title. `useChatController` will resolve live session IDs, request a model-made title through a new preload IPC, and compute context-window percentage from usage plus model metadata. `ChatHeader` will stop showing raw token totals, show the active profile as the agent identity, and display either a generated title, a title-pending state, or an untitled fallback. Main-process title generation/persistence will remain behind preload/IPCs and will update the session DB/cache where available.

## 2. Current-state analysis

### Renderer ownership and flow

- `Layout.tsx` owns:
  - `activeProfile`
  - `messages`
  - `currentSessionId`
  - new chat/profile reset behavior
  - session resume from `Sessions`
- `Chat.tsx` passes `profile`, `sessionId`, `messages`, and `setMessages` into `useChatController`, then renders `ChatHeader`.
- `useChatController.ts` owns:
  - live input/loading state
  - internal `hermesSessionId`
  - accumulated `usage`
  - model picker config/listing state
  - chat streaming IPC listeners
  - send/abort/clear handlers
- `ChatHeader.tsx` currently derives title from only `sessionId`:
  - no session: `chat.title` / “New Chat”
  - session: `chat.sessionTitle` / “Session abc123”
  - raw usage: `usage.totalTokens.toLocaleString() tokens`, optional cost

Blocking issue: live chat session IDs are set only inside `useChatController.hermesSessionId`; `Layout.currentSessionId` is not updated when a new streamed chat completes. The header therefore cannot reliably switch from “New Chat” to live session metadata unless session/title state is lifted back to `Layout`.

### Title/cache persistence flow

- `session-cache.ts` has a private heuristic `generateTitle()` used during cache sync.
- `updateSessionTitle(sessionId, title)` only mutates an existing JSON cache entry.
- It does not:
  - update SQLite `sessions.title`
  - insert/update a freshly completed session that is not yet in cache
  - update SSH-backed session data
- `Sessions.tsx` displays cached/synced titles, so generated titles must be persisted or its mounted state will remain stale.

### Usage/model flow

- Main `chat-api.ts` forwards usage as:
  - `promptTokens`
  - `completionTokens`
  - `totalTokens`
  - optional `cost`
  - optional rate-limit fields
- Renderer accumulates those values in `ChatUsage`.
- No saved/default model has a context-window field.
- `ModelPicker` and `useChatController.loadModelConfig()` already load the active model and saved model list; this is the right extension point for context-window metadata.

### Security constraints

Renderer must not read SQLite/cache files or call Node/http directly. New title generation and persistence must be exposed only through `window.hermesAPI` via preload and `ipcMain.handle(...)`.

## 3. Design

### Targeted change rationale

Use a targeted change with small internal helper extraction because the existing chat stack is already split correctly:

- keep chat transport in main
- keep UI state in renderer
- add one title-generation IPC
- add optional model context metadata
- lift only session title/session ID callbacks to `Layout`

Do not replace the chat controller architecture or create a parallel chat transport path.

---

### Header UI contract

Modify `ChatHeader` to receive display-ready metadata instead of raw usage.

Before:

```ts
sessionId: string | null;
usage: ChatUsage | null;
profile?: string;
```

After:

```ts
sessionId: string | null;
sessionTitle: string | null;
titlePending: boolean;
contextUsage: ChatContextUsage | null;
profile?: string;
```

Add renderer type:

```ts
interface ChatContextUsage {
  usedTokens: number;          // latest request total tokens, not cumulative
  contextWindow: number;
  percent: number;
  source: "explicit" | "known-model" | "family" | "fallback";
  model: string;
}
```

Title resolution order in `ChatHeader`:

1. `sessionTitle` if non-empty.
2. `chat.generatingTitle` if `titlePending`.
3. `chat.title` if `messages.length === 0`.
4. `chat.untitledChat` for active chats without a title.

Do not show session-id fallback in active chat header anymore.

Header metadata line:

- Always show active profile as agent identity:
  - default profile: localized `chat.defaultAgent`
  - custom profile: exact profile name
  - rendered through `chat.agentIdentity`
- Show context badge only after usage exists:
  - visible text: localized `chat.contextUsed`, e.g. `3% context`
  - no visible raw token count
  - tooltip may include used/window token details for explanation

Context percent formatting:

- use latest response/request footprint, not cumulative session usage
- `percent = usedTokens / contextWindow * 100`
- display:
  - `"<1%"` when `0 < percent < 1`
  - `"100%+"` when `percent >= 100`
  - otherwise rounded whole percent, e.g. `"12%"`

Cost is removed from the header. `/usage` can continue showing raw cumulative usage and cost.

---

### Live session title ownership

Add `currentSessionTitle` to `Layout.tsx`.

State reset rules:

- `handleNewChat`: clear messages, session ID, and title.
- `handleSelectProfile`: clear messages, session ID, and title.
- `handleResumeSession`: set messages, `currentSessionId`, and the known cached/search title.
- generated title callback: update `currentSessionTitle`.

Change `Sessions` resume callback:

```ts
onResumeSession: (sessionId: string, title?: string | null) => void;
```

`Sessions.tsx` should pass the card/search result title when resuming.

Add callbacks from `Chat` to `Layout`:

```ts
onSessionResolved?: (sessionId: string) => void;
onSessionTitleChange?: (title: string) => void;
```

`useChatController` should:

- accept `sessionId` and `sessionTitle`
- sync internal `hermesSessionId` when `sessionId` changes
- call `onSessionResolved(sessionId)` when `chat-done` or `sendMessage()` result provides a session ID
- request a title only once per new conversation after the first eligible non-local, non-slash user message completes

Stale title guard:

- maintain a monotonically increasing `titleRequestSeqRef`
- increment it on clear/new/profile/session reset
- before applying a returned title, verify the request sequence still matches and the conversation has not been cleared/replaced

---

### Title generation and persistence IPC

Add a new shared type module, preferably `src/shared/chat-metadata.ts`, containing:

```ts
type ChatTitleRole = "user" | "agent" | "assistant";

interface ChatTitleMessage {
  role: ChatTitleRole;
  content: string;
}

interface GenerateChatTitleRequest {
  profile?: string;
  sessionId?: string;
  messages: ChatTitleMessage[];
}
```

Add preload API in `src/preload/api/chat.ts`:

```ts
generateChatTitle(request: GenerateChatTitleRequest): Promise<string>
```

IPC channel:

```txt
generate-chat-title
```

Main handler in `src/main/ipc/chat.ts`:

1. Validate request shape.
2. Reuse/extract the existing chat backend preflight:
   - start local gateway if needed
   - ensure SSH tunnel if needed
   - repair SSH gateway/tunnel/API key if needed
3. Call main title resolver.
4. Persist title if `sessionId` exists.
5. Return sanitized title.

Main title resolver: add `src/main/hermes/title.ts`.

Behavior:

1. Prefer an existing persisted `sessions.title` when available.
2. Otherwise generate via non-streaming OpenAI-style chat completion using current profile model config.
3. Send a short title-only prompt.
4. Use `store: false` and metadata/header marking the request as internal title generation.
5. Sanitize result:
   - strip quotes/markdown
   - remove leading `Title:`
   - collapse whitespace/newlines
   - max 60 chars at word boundary
   - no trailing period
6. If generation fails or returns empty, fall back to exported heuristic title generation from `session-cache.ts`.

The model title request must not use `sendMessage()` or `activeChatRun`; it must not emit chat chunks or abort the active chat.

---

### Session title persistence

Enhance local persistence in `session-cache.ts`.

Change `updateSessionTitle` behavior:

- write SQLite `sessions.title` when `state.db` exists and the row exists
- update JSON cache when the session exists
- if cache does not contain the session but SQLite row exists, insert a `CachedSession` entry from the DB row with the new title
- return a boolean indicating whether DB or cache was updated

Also update `syncSessionCache()`:

- when an existing cached session appears in DB rows, update:
  - `messageCount`
  - `model`
  - `title` if DB `title` is non-empty

Add connection-aware helper, e.g. `src/main/session-titles.ts`:

```ts
readSessionTitleForCurrentConnection(sessionId): Promise<string | null>;
updateSessionTitleForCurrentConnection(sessionId, title): Promise<boolean>;
```

Connection behavior:

- local: use local SQLite/cache helpers
- SSH: add `sshReadSessionTitle` and `sshUpdateSessionTitle` in `ssh-remote.ts`, reusing the same transport/command pattern as `sshListCachedSessions`
- pure remote HTTP: return title for header only; no local persistence because Sessions is disabled in remote-only mode

---

### Context-window percent

Add context-window metadata without breaking existing model files.

#### Shared context helper

In `src/shared/chat-metadata.ts`, add:

```ts
interface ContextWindowInfo {
  tokens: number;
  source: "explicit" | "known-model" | "family" | "fallback";
}

inferContextWindow(provider: string, model: string, explicit?: number | null): ContextWindowInfo;
calculateContextUsage(usedTokens: number, contextWindow: number): number;
```

Initial exact/default mappings:

- Claude Sonnet 4: `200_000`
- GPT-4.1: `1_047_576`
- GPT-4o family: `128_000`
- DeepSeek fallback/default models: `128_000`
- unknown fallback: `128_000`, source `fallback`

#### Model schema

Update:

- `DefaultModel.contextWindow: number`
- `SavedModel.contextWindow?: number`

Existing `models.json` remains valid. New code should infer missing context windows when reading old records.

Renderer changes:

- `ModelGroup.models[]` gains `contextWindow?: number`
- `useChatController.loadModelConfig()` computes current context info from active provider/model and saved model metadata
- `selectModel()` accepts optional context window from the selected model
- custom model selection uses inferred fallback

Usage state changes:

Keep existing cumulative fields, add latest fields:

```ts
interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;

  lastPromptTokens?: number;
  lastCompletionTokens?: number;
  lastTotalTokens?: number;

  contextWindow?: number;
  contextWindowSource?: ContextWindowInfo["source"];
  contextModel?: string;
}
```

On `onChatUsage`:

- continue accumulating existing fields
- store latest event fields separately
- snapshot current model/context window at usage time
- derive `ChatContextUsage` for the header from `lastTotalTokens`

This avoids changing old `/usage` behavior while making the header percent reflect the latest context footprint instead of cumulative billing tokens.

---

### i18n additions

Add these keys to all `chat.ts` locale files:

| Key | en |
|---|---|
| `defaultAgent` | `Default` |
| `agentIdentity` | `Agent: {{profile}}` |
| `generatingTitle` | `Generating title…` |
| `untitledChat` | `Untitled chat` |
| `contextUsed` | `{{percent}} context` |
| `contextTooltip` | `{{used}} of {{limit}} tokens used in {{model}}'s context window.` |
| `contextTooltipEstimated` | `Estimated: {{used}} of {{limit}} tokens used in {{model}}'s context window.` |

Use equivalent localized strings in `es`, `pt-BR`, and `zh-CN`.

## 4. File-by-file impact

### `src/shared/chat-metadata.ts` — new

- Add shared title request types.
- Add context-window inference and usage percent helpers.
- Used by main, preload declarations, and renderer.

### `src/main/default-models.ts`

- Add `contextWindow` to `DefaultModel`.
- Populate context windows for seeded defaults.

### `src/main/models.ts`

- Add optional `contextWindow` to `SavedModel`.
- Normalize old saved models by inferring missing context windows.
- Seed defaults with context windows.
- Ensure `listModels()` returns context metadata.

### `src/main/session-cache.ts`

- Export the heuristic title generator for fallback use.
- Update `syncSessionCache()` to refresh existing cached titles from DB titles.
- Change `updateSessionTitle()` to update SQLite and JSON cache, including cache insertion when possible.
- Return success boolean.

### `src/main/sessions.ts`

- Add read-only helper to get `sessions.title` by session ID, or keep this in `session-cache.ts` if implementation prefers avoiding another DB helper.

### `src/main/session-titles.ts` — new

- Add connection-aware read/update wrappers.
- Local calls into `sessions.ts` / `session-cache.ts`.
- SSH delegates to new `ssh-remote.ts` helpers.
- Remote-only returns no persistence.

### `src/main/ssh-remote.ts`

- Add `sshReadSessionTitle`.
- Add `sshUpdateSessionTitle`.
- Mirror the existing `sshListCachedSessions` transport pattern.

### `src/main/hermes/title.ts` — new

- Add model title resolver.
- Performs non-streaming title request.
- Sanitizes model output.
- Falls back to heuristic title.

### `src/main/ipc/chat.ts`

- Extract existing chat backend preflight into a local helper used by both `send-message` and `generate-chat-title`.
- Register `generate-chat-title`.
- Validate renderer request.
- Call title resolver and persistence helper.

### `src/main/ipc/sessions.ts`

- Update `update-session-title` to use connection-aware persistence.
- Return boolean from IPC.

### `src/preload/api/chat.ts`

- Add `generateChatTitle`.
- Import/use shared request type.

### `src/preload/api/models.ts`

- Update `listModels()` return type to include `contextWindow?: number`.
- Update `updateSessionTitle()` return type to `Promise<boolean>` if adopting the main boolean result.

### `src/preload/index.d.ts`

- Add `generateChatTitle`.
- Add context window to model return types.
- Update `updateSessionTitle` return type if changed.

### `src/renderer/src/screens/Layout/Layout.tsx`

- Add `currentSessionTitle`.
- Reset title on new chat/profile change.
- Set title on session resume.
- Pass `sessionTitle`, `onSessionResolved`, and `onSessionTitleChange` to `Chat`.
- Add a refresh token for mounted `Sessions` after title changes.

### `src/renderer/src/screens/Sessions/Sessions.tsx`

- Change `onResumeSession` prop to include optional title.
- Pass cached/search title when resuming.
- Accept optional `refreshToken` and reload sessions when it changes.

### `src/renderer/src/screens/Chat/Chat.tsx`

- Pass new title/context props into `ChatHeader`.
- Pass `sessionId`, `sessionTitle`, and callbacks into `useChatController`.

### `src/renderer/src/screens/Chat/types.ts`

- Add `ChatContextUsage`.
- Extend `ChatUsage` with latest/context fields.
- Add controller return value:
  - `contextUsage`
  - `titleGenerationPending`

### `src/renderer/src/screens/Chat/hooks/useChatController.ts`

- Accept title/session callback args.
- Sync `sessionId` into `hermesSessionId`.
- Track current context-window info and refs.
- Store latest usage fields.
- Add guarded title generation after first eligible completed message.
- Call `window.hermesAPI.generateChatTitle`.
- Avoid applying stale title results after clear/new/profile changes.

### `src/renderer/src/screens/Chat/components/ChatHeader.tsx`

- Replace raw token/cost display with profile identity and context percent.
- Use generated title/title pending/untitled fallback.
- Remove dependency on raw `usage`.

### `src/renderer/src/screens/Chat/components/ModelPicker.tsx`

- Extend model option data with optional `contextWindow`.
- Pass context window to `selectModel`.

### `src/renderer/src/screens/Chat/chatCommands.ts`

- No required behavior change.
- Ensure added `ChatUsage` fields do not affect existing `/usage` output.

### `src/renderer/src/assets/styles/chat.css`

- Add/adjust:
  - `.chat-header-left`
  - `.chat-header-title` ellipsis
  - `.chat-header-meta`
  - `.chat-agent-identity`
  - `.chat-context-counter`
- Remove or stop using raw `.chat-token-counter` for visible token totals.

### Locale files

Update:

- `src/shared/i18n/locales/en/chat.ts`
- `src/shared/i18n/locales/es/chat.ts`
- `src/shared/i18n/locales/pt-BR/chat.ts`
- `src/shared/i18n/locales/zh-CN/chat.ts`

Add the new chat metadata/title/context strings.

### Tests

Modify/add:

- `tests/preload-api-surface.test.ts`
  - assert `generateChatTitle` exists in preload and type declarations
- `tests/session-cache-sync.test.ts`
  - verify `updateSessionTitle` updates SQLite title
  - verify it updates/inserts JSON cache entry
  - verify `syncSessionCache()` refreshes existing cached title from DB title
- Add focused context helper test, e.g. `tests/chat-metadata.test.ts`
  - known model context inference
  - fallback context inference
  - percent calculation
- Add `ChatHeader` renderer test if practical
  - renders profile identity
  - renders generated title
  - renders context percent instead of raw `tokens`

## 5. Risks and migration

- `models.json` schema change is additive. Old records without `contextWindow` are inferred at read time. Old app versions will ignore the extra field.
- SQLite `sessions.title` already exists in current queries; if a user has an older DB without that column, title update must catch and degrade to JSON cache/header-only.
- Title generation adds one extra model call per new conversation. Limit to first eligible message, use a short timeout, and fallback silently.
- Verify whether Hermes gateway honors `store: false` or internal metadata for title requests. If it creates extra visible sessions, prefer existing DB title plus heuristic fallback until a no-persist backend path exists.
- Pure remote HTTP mode cannot persist titles locally; header state still updates, and Sessions is already disabled there.
- SSH persistence requires mirroring existing `ssh-remote.ts` patterns; validate against the actual helper shape before implementation.

## Orchestration status

- [x] Item 1 — shared/main/preload metadata foundations. Focused verification passed: `tests/chat-metadata.test.ts`, `tests/hermes-title.test.ts`, `tests/session-cache-sync.test.ts`, and `tests/preload-api-surface.test.ts`.
- [x] Item 2 — renderer chat state/header UI integration. Header now shows generated/pending/untitled title state, profile identity, context percentage, and restored Mercury avatar/mark updates.
- [x] Item 3 — final typecheck/test sweep and fixups. Delegated validation passed: `npm run typecheck` and `npm test`.

## 6. Implementation order

1. Add `src/shared/chat-metadata.ts` with title request types and context-window helpers, plus helper tests.
2. Add `contextWindow` to default/saved model handling and preload model return types.
3. Enhance local session title persistence in `session-cache.ts`; add/update session-cache tests.
4. Add connection-aware session title helpers, including SSH read/update if supported by existing `ssh-remote.ts` patterns.
5. Add main title resolver and `generate-chat-title` IPC. Update preload API and `index.d.ts` atomically.
6. Update `Layout` and `Sessions` to own/pass session titles and refresh mounted session lists.
7. Update `useChatController` for live session resolution, guarded title generation, latest usage/context tracking.
8. Update `Chat`, `ChatHeader`, `ModelPicker`, renderer types, CSS, and i18n strings.
9. Update preload API surface tests and add the focused header test if practical.
10. Run:
    - `npm run typecheck`
    - `npm test`
    - targeted manual check: new chat → generated title appears → header shows active profile → context badge shows percent, not raw token count.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "chat-header-metadata-E14E90", new_chat: false)
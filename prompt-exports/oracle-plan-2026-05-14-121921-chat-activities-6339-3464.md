## Final Prompt
<taskname="Chat Activities"/>
<task>
Plan and implement the chat transcript UX fix: Hermes tool/action calls must not render as ordinary assistant text bubbles and must not overwrite or append to assistant prose. During a run, show tool/action activity as separate RepoPrompt-style pills/groups that accumulate and can expand for details. Assistant messages remain distinct natural-language bubbles. Preserve existing chat, approval, usage, abort, session resume, and Trace Lab behavior.
</task>

<architecture>
Mercury is an Electron/React app. Chat streaming crosses: `src/main/hermes/chat-api.ts` or `chat-cli.ts` -> `src/main/hermes/gateway.ts` -> `src/main/ipc/chat.ts` -> `src/preload/api/chat.ts` -> `src/renderer/src/screens/Chat/hooks/useChatController.ts` -> `Chat.tsx`/`MessageRow.tsx`.

Current renderer model is text-only: `ChatMessage` has `{ id, role: "user" | "agent", content }`. `useChatController` appends every `chat-chunk` to the last agent message or creates a new agent message. `Chat.tsx` renders only `visibleMessages` as `MessageRow`, plus `ChatLoading`/`.chat-tool-progress-inline` for the single latest `toolProgress` string.

Main already normalizes structured activity for Trace Lab: `normalizeHermesStreamEvent()` and `normalizeCliProgressLine()` produce `TraceEventType` values including `tool.started`, `tool.progress`, `tool.completed`, `tool.failed`, `delegation.*`, `artifact.created`, `approval.*`, and `transport.error`. `src/main/ipc/chat.ts` records those via `recordTraceEvent()`, but currently does not forward the full structured events to the renderer. It only sends `chat-tool-progress` as a plain string from `onToolProgress`.

Trace Lab provides useful reference UI/data vocabulary: `TraceEvent`, `EVENT_LABELS`, `EVENT_ICONS`, `TraceEventRow`, and event status styling in `trace-lab-events.css`. Do not couple Chat to Trace Lab state in a way that breaks trace storage; reuse types/helpers or duplicate a small renderer-specific view model if cleaner.
</architecture>

<selected_context>
src/renderer/src/screens/Chat/types.ts: ChatMessage/ChatController shape; likely needs activity types/state in addition to text messages.
src/renderer/src/screens/Chat/hooks/useChatController.ts: Streaming state, IPC listeners, send/quick-ask/approve/deny history construction, `toolProgress` overwrite behavior, `visibleMessages`, scroll behavior.
src/renderer/src/screens/Chat/Chat.tsx: Transcript layout; currently maps text messages to MessageRow and shows latest tool progress as loading/inline text.
src/renderer/src/screens/Chat/components/MessageRow.tsx: Assistant/user bubble rendering and approval bar tied to last agent text.
src/renderer/src/screens/Chat/components/ChatLoading.tsx: Current typing indicator becomes an agent bubble containing a tool progress string.
src/renderer/src/screens/Chat/components/*, chat.constants.ts, chatCommands.ts: Surrounding chat controls and local slash command behavior.
src/renderer/src/assets/styles/chat.css, chat-composer.css, chat-rich-content.css: Chat layout, bubbles, typing/progress styles, approval/code styling; likely edit surface for activity pills/groups.
src/renderer/src/components/AgentMarkdown.tsx: Assistant markdown renderer; keep natural-language content in this path only.
src/main/ipc/chat.ts: Central run lifecycle; currently records trace events but only emits `chat-chunk`, `chat-tool-progress`, `chat-usage`, `chat-error`, `chat-done`. Add live structured activity emission here if chosen.
src/main/hermes/chat-api.ts: API SSE parser; custom `hermes.tool.progress` events call `onTraceEvent` and `onToolProgress`; legacy backtick tool progress is filtered only when an entire content delta matches ``emoji label``.
src/main/hermes/chat-cli.ts: CLI stdout parser; calls `normalizeCliProgressLine(t)` but still pushes the line into `cb.onChunk(output)`, so tool/action/status text from CLI can become assistant content.
src/main/hermes/trace-events.ts and src/shared/traces.ts: Structured event normalization, sanitization, event type definitions. Use these to avoid inventing another raw tool protocol.
src/main/hermes/types.ts, gateway.ts, hermes.ts: Chat callback contracts and API-vs-CLI dispatch path.
src/preload/api/chat.ts, src/preload/index.d.ts, src/preload/api/index.ts, src/preload/index.ts: Renderer API surface. If adding `onChatTraceEvent`/similar, update implementation and typings; tests enforce method parity.
src/main/trace-store.ts and src/main/ipc/trace.ts: Trace run persistence and listing. Useful for understanding what is already stored separately from chat messages.
src/renderer/src/screens/Layout/Layout.tsx: Owns `messages`, resets them on new chat/profile change, resumes sessions from DB messages. If activity becomes separate state, decide whether it belongs here or remains internal to Chat controller.
src/main/sessions.ts, src/main/ipc/sessions.ts, src/main/session-cache.ts, src/renderer/src/screens/Sessions/Sessions.tsx: Session resume/persistence path. DB resume currently loads only user/assistant messages; `SessionMessage` includes `tool` in main type but query filters it out.
src/renderer/src/screens/TraceLab/* and trace-lab styles: Reference for event labels/icons/status and expandable event detail patterns.
src/shared/i18n/locales/{en,es,pt-BR,zh-CN}/chat.ts: Chat translation namespace; add labels for activity summary/details if UI text is localized.
tests/hermes-trace-events.test.ts: Existing normalization tests; extend if filtering or classification changes.
tests/preload-api-surface.test.ts and tests/ipc-handlers.test.ts: Contract tests for preload/main IPC surface; update if new channels/listeners are added.
package.json: Scripts: `typecheck:web`, `typecheck:node`, `typecheck`, `test`, `lint`.
</selected_context>

<relationships>
- `chat-api.ts` custom SSE event -> `normalizeHermesStreamEvent()` -> `cb.onTraceEvent()` -> `ipc/chat.ts` records Trace Lab event, but renderer does not see it live today.
- `chat-api.ts` legacy backtick progress -> `cb.onToolProgress(string)` -> `ipc/chat.ts` sends `chat-tool-progress` -> renderer overwrites one `toolProgress` string.
- `chat-cli.ts` stdout line -> `normalizeCliProgressLine()` emits trace events, then same line is still included in `cb.onChunk(output)`, so CLI tool/status/action lines can render as assistant bubbles.
- `useChatController` `onChatChunk` -> append to last agent message. Any tool/status chunk that reaches this listener contaminates assistant content and history.
- `handleSend`/`handleQuickAsk`/approve/deny history sends `messages.map(...)`; if `ChatMessage` becomes a union, filter history to user/agent text only so activity items are not sent back to the model.
- `Layout.handleResumeSession()` maps DB `assistant` to renderer `agent`; persisted sessions currently do not hydrate activity events into the transcript.
- Trace Lab reads persisted `TraceRun.events`; chat activity should be additive to transcript UX without removing trace recording.
</relationships>

<implementation_notes>
Consider adding a renderer-visible structured event channel rather than relying on `chat-tool-progress` strings. A pragmatic shape is to expose `onChatTraceEvent(callback: (event: TraceEvent) => void)` or a smaller `ChatActivityEvent` derived from `TraceEvent`. `ipc/chat.ts` can emit sanitized trace events at the same time it records them. Keep `chat-tool-progress` only for backward compatibility or replace internal usage with the structured stream.

For renderer state, prefer separating activities from text messages rather than making tool calls look like assistant messages. Options:
- Add a separate `activities`/`runs` state in `useChatController`, reset on new send/new chat/profile change, append events during the active run, and render an `ActivityGroup` between/under messages.
- Or make transcript items a discriminated union, but ensure history/session persistence filters to text messages only.

The activity UI should accumulate repeated calls and summarize by category/tool name, e.g. `Ran commands 7`, `Read File x5`, `Tool progress x3`, with status dots/icons and expandable details. Use `TraceEvent.type`, `title`, `detail`, and `metadata.toolName` where present; group `tool.*`, `delegation.*`, `artifact.created`, `approval.*`, and `transport.error` separately from assistant prose. Failed/error statuses should remain visually distinct.

Prevent legacy contamination at the source too. In `chat-cli.ts`, after a line normalizes to tool/delegation activity, do not include that line in `cb.onChunk` unless it is genuine assistant prose. In `chat-api.ts`, the legacy backtick filter is narrow; preserve assistant content but route recognized standalone tool/status fragments to activity instead of `onChunk`.

Persistence implication: saved/resumed sessions currently show only DB user/assistant messages. Do not store activity as assistant message content. If hydration from Trace Lab is desired, it would require joining trace runs to sessions; that is likely outside the minimal fix unless explicitly requested.
</implementation_notes>

<ambiguities>
The user asked for RepoPrompt-style pills/groups but did not specify exact grouping rules. Use current event metadata where possible (`metadata.toolName`, event type/status), and fall back to normalized labels/titles.

It is not clear whether historical resumed sessions should display old tool activity. Current code and DB query do not support this directly; safest scope is live-run activity display plus preventing future tool/status chunks from polluting assistant messages.
</ambiguities>

<validation>
Recommended checks after implementation: `npm run typecheck:web`; if IPC/preload/main callback types change, also run `npm run typecheck:node`, `npm test -- preload-api-surface.test.ts ipc-handlers.test.ts hermes-trace-events.test.ts`, or full `npm test` if feasible.
</validation>

<orchestrator_progress>
- [x] Implemented live-run activity pills/groups via sub-agent `Implement chat transcript activity UX`.
- [x] Added structured `chat-trace-event` IPC/preload channel.
- [x] Kept `ChatMessage` prose-only and rendered tool/action activity separately through `ChatActivityGroup`.
- [x] Removed tool progress from loading/inline assistant-like UI.
- [x] Filtered legacy API/CLI standalone activity lines before they reach `chat-chunk`.
- [x] Builder reported `npm run typecheck:node`, `npm run typecheck:web`, and `npm test -- preload-api-surface.test.ts hermes-trace-events.test.ts` passed.
- [x] Orchestrator spot-checked the focused diff and key renderer/main integration points.
</orchestrator_progress>

## Selection
- Files: 54 total (51 full, 3 codemap)
- Total tokens: 64798 (Auto view)
- Token breakdown: full 64039, codemap 759

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 176 tokens (full)
│   │   │   ├── chat-cli.ts — 1 741 tokens (full)
│   │   │   ├── gateway.ts — 1 533 tokens (full)
│   │   │   ├── trace-events.ts — 2 269 tokens (full)
│   │   │   └── types.ts — 184 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 2 394 tokens (full)
│   │   │   ├── sessions.ts — 789 tokens (full)
│   │   │   └── trace.ts — 167 tokens (full)
│   │   ├── hermes.ts — 120 tokens (full)
│   │   ├── session-cache.ts — 1 407 tokens (full)
│   │   ├── sessions.ts — 1 099 tokens (full)
│   │   └── trace-store.ts — 2 288 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── chat.ts — 681 tokens (full)
│   │   │   └── index.ts — 109 tokens (full)
│   │   ├── index.d.ts — 3 373 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── icons/
│   │       │   │   └── index.tsx — 182 tokens (full)
│   │       │   ├── styles/
│   │       │   │   ├── chat-composer.css — 1 557 tokens (full)
│   │       │   │   ├── chat-rich-content.css — 949 tokens (full)
│   │       │   │   ├── chat.css — 1 581 tokens (full)
│   │       │   │   ├── trace-lab-events.css — 1 878 tokens (full)
│   │       │   │   └── trace-lab.css — 2 180 tokens (full)
│   │       │   └── main.css — 284 tokens (full)
│   │       ├── components/
│   │       │   └── AgentMarkdown.tsx — 1 307 tokens (full)
│   │       └── screens/
│   │           ├── Chat/
│   │           │   ├── components/
│   │           │   │   ├── ChatComposer.tsx — 419 tokens (full)
│   │           │   │   ├── ChatEmpty.tsx — 460 tokens (full)
│   │           │   │   ├── ChatHeader.tsx — 659 tokens (full)
│   │           │   │   ├── ChatLoading.tsx — 176 tokens (full)
│   │           │   │   ├── MessageRow.tsx — 431 tokens (full)
│   │           │   │   ├── ModelPicker.tsx — 747 tokens (full)
│   │           │   │   └── SlashMenu.tsx — 323 tokens (full)
│   │           │   ├── hooks/
│   │           │   │   └── useChatController.ts — 3 706 tokens (full)
│   │           │   ├── Chat.tsx — 1 054 tokens (full)
│   │           │   ├── chat.constants.ts — 669 tokens (full)
│   │           │   ├── chatCommands.ts — 1 457 tokens (full)
│   │           │   └── types.ts — 585 tokens (full)
│   │           ├── Layout/
│   │           │   └── Layout.tsx — 2 800 tokens (full)
│   │           ├── Sessions/
│   │           │   └── Sessions.tsx — 2 659 tokens (full)
│   │           └── TraceLab/
│   │               ├── components/
│   │               │   └── TraceLabComponents.tsx — 1 959 tokens (full)
│   │               ├── TraceLab.tsx — 4 122 tokens (full)
│   │               ├── trace-lab.helpers.ts — 3 145 tokens (full)
│   │               └── trace-lab.types.ts — 817 tokens (full)
│   └── shared/
│       ├── i18n/
│       │   └── locales/
│       │       ├── en/
│       │       │   └── chat.ts — 579 tokens (full)
│       │       ├── es/
│       │       │   └── chat.ts — 688 tokens (full)
│       │       ├── pt-BR/
│       │       │   └── chat.ts — 649 tokens (full)
│       │       └── zh-CN/
│       │           └── chat.ts — 568 tokens (full)
│       └── traces.ts — 417 tokens (full)
├── tests/
│   ├── hermes-trace-events.test.ts — 595 tokens (full)
│   ├── ipc-handlers.test.ts — 1 231 tokens (full)
│   └── preload-api-surface.test.ts — 2 013 tokens (full)
└── package.json — 736 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── install/
    │   │   └── paths.ts — 672 tokens (auto)
    │   └── ipc/
    │       └── types.ts — 44 tokens (auto)
    └── shared/
        └── i18n/
            └── types.ts — 43 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `chat-activities-633948` | **Mode**: plan

### Response
## 1. **Summary**

Implement this as a targeted, additive chat-streaming fix rather than a broad transcript refactor. Keep `ChatMessage` text-only for user/assistant prose, add a separate live structured activity stream from main → preload → renderer, and render those events as accumulated expandable activity groups anchored to the user message that started the run. Also filter legacy CLI/API tool-status text before it reaches `chat-chunk`, so tool/action activity cannot append to or overwrite assistant prose. Trace Lab persistence, usage, approval buttons, abort handling, and session resume remain intact.

---

## 2. **Current-state analysis**

### End-to-end chat flow today

1. **Hermes transport**
   - `src/main/hermes/chat-api.ts`
     - Parses API SSE responses.
     - Sends natural-language deltas through `cb.onChunk`.
     - Sends custom Hermes events through `cb.onTraceEvent`.
     - Sends plain progress strings through `cb.onToolProgress`.
     - Has a narrow legacy filter for deltas matching exactly `` `emoji label` ``.
   - `src/main/hermes/chat-cli.ts`
     - Parses CLI stdout.
     - Calls `normalizeCliProgressLine(t)` for trace events.
     - Still pushes the same line into `cb.onChunk`, so CLI tool/status lines can become assistant text.

2. **Gateway dispatch**
   - `src/main/hermes/gateway.ts`
     - Chooses API vs CLI.
     - Passes callbacks through unchanged.

3. **Main IPC**
   - `src/main/ipc/chat.ts`
     - Creates a `TraceRun` with `createTraceRun`.
     - Records structured events with `recordTraceEvent`.
     - Emits only:
       - `chat-chunk`
       - `chat-tool-progress`
       - `chat-usage`
       - `chat-error`
       - `chat-done`
     - Does **not** forward full structured trace events to the renderer.

4. **Preload**
   - `src/preload/api/chat.ts`
     - Exposes `onChatChunk`, `onChatToolProgress`, `onChatUsage`, `onChatError`, `onChatDone`.
     - No structured activity listener exists.

5. **Renderer**
   - `src/renderer/src/screens/Chat/hooks/useChatController.ts`
     - Maintains `messages: ChatMessage[]`.
     - On `chat-chunk`, appends to the last `agent` message or creates a new agent message.
     - On `chat-tool-progress`, overwrites one `toolProgress` string.
   - `Chat.tsx`
     - Renders text messages as `MessageRow`.
     - Renders `toolProgress` either inside `ChatLoading` as an agent bubble or inline as `.chat-tool-progress-inline`.
   - Result: tool/action/status output can visually merge with assistant prose.

### Existing reusable pieces

- `src/shared/traces.ts`
  - Existing `TraceEvent`, `TraceEventType`, and `TraceUsage` should be reused.
- `src/main/hermes/trace-events.ts`
  - Existing normalization already maps Hermes activity into `tool.*`, `delegation.*`, `artifact.created`, `approval.*`, `transport.error`.
- `src/main/trace-store.ts`
  - Already sanitizes metadata before persistence.
- Trace Lab event vocabulary is useful as reference, but Chat should not depend on Trace Lab component state.

### Blocking issue

The renderer currently only receives plain text chunks and one latest progress string. It has no durable structured activity model, so any tool/status output that reaches `chat-chunk` becomes assistant prose.

---

## 3. **Design**

### A. Add a live structured chat activity event channel

Use existing `TraceEvent` as the renderer-visible event shape.

#### Main behavior

In `src/main/ipc/chat.ts`, whenever a trace event is recorded for live chat, emit it to the renderer if it is chat activity:

Activity event types:

```ts
tool.*
delegation.*
artifact.created
approval.*
transport.error
```

Non-activity event types stay Trace Lab only:

```ts
run.*
message.*
session.resumed
message.history.loaded
usage.recorded
slash.local
skill.*
```

#### Trace store signature change

Change `recordTraceEvent` from fire-and-forget to returning the sanitized persisted event:

```ts
// before
recordTraceEvent(...): void

// after
recordTraceEvent(...): TraceEvent | null
```

Callers that ignore the return value remain valid. `ipc/chat.ts` should emit the returned sanitized event, not the raw callback event.

#### New preload API

Add:

```ts
onChatTraceEvent(callback: (event: TraceEvent) => void): () => void
```

IPC channel name:

```ts
chat-trace-event
```

Keep `onChatToolProgress` for backward compatibility, but the Chat screen should no longer render it directly.

---

### B. Prevent legacy tool/status text from entering assistant chunks

#### API path: `src/main/hermes/chat-api.ts`

Replace the current single-regex check with line-level splitting for standalone legacy progress fragments.

Behavior:

- If a delta line is a standalone legacy tool/progress marker, route it to `cb.onToolProgress`.
- If a delta contains both prose and standalone progress lines, send only prose to `cb.onChunk`.
- Do not classify inline code or ordinary prose as activity.

Add helper(s) in `src/main/hermes/trace-events.ts` for testability, for example:

```ts
splitLegacyToolProgressContent(text): {
  prose: string;
  progressLabels: string[];
}
```

#### CLI path: `src/main/hermes/chat-cli.ts`

After `normalizeCliProgressLine(t)` emits tool/delegation/artifact events:

- Emit trace events as today.
- Suppress the original stdout line from `cb.onChunk` when it is clearly a standalone activity/status line.
- Keep genuine assistant prose, even if it mentions tools.

This fixes the primary CLI contamination path.

---

### C. Renderer state model: keep messages text-only, add anchored activity groups

Do **not** make tool calls part of `ChatMessage`.

Keep:

```ts
interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
}
```

Add renderer-only activity state:

```ts
type ChatActivityGroupStatus =
  | "running"
  | "completed"
  | "failed"
  | "aborted";

interface ChatActivityGroup {
  id: string;
  runId?: string;
  anchorMessageId: string;
  status: ChatActivityGroupStatus;
  startedAt: number;
  updatedAt: number;
  expanded: boolean;
  events: TraceEvent[];
}
```

Lifecycle:

- When `handleSend`, `handleQuickAsk`, `handleApprove`, or `handleDeny` starts a backend run:
  - Create the user message.
  - Create an empty `ChatActivityGroup` anchored to that user message.
  - Store the group id in a ref so IPC callbacks can append immediately.
- On first `chat-trace-event`:
  - Attach `event.runId` to the active group if missing.
  - Append the event if not already present.
- On `chat-done`:
  - Mark active group `completed`.
  - Remove it if it has no events.
- On `chat-error`:
  - Mark active group `failed`.
- On abort:
  - Mark active group `aborted`.
- On clear/new chat/profile reset:
  - Clear activity groups.

Out-of-order behavior:

- If an event arrives with a known `runId`, append to that group.
- If no matching group exists, append to the current active group.
- Deduplicate by `TraceEvent.id`.

---

### D. Activity grouping and summary UI

Add a new Chat component:

```txt
src/renderer/src/screens/Chat/components/ChatActivityGroup.tsx
```

It renders:

- A compact activity group container, not an assistant bubble.
- Summary pills such as:
  - `Read File ×5`
  - `Run Shell ×2`
  - `Delegation ×1`
  - `Created image`
  - `Transport error`
- Status styling:
  - running
  - completed
  - failed
  - waiting/approval
  - aborted
- Expand/collapse button.
- Expanded detail list with event time, type, title, detail, and compact sanitized metadata.

Add helper module:

```txt
src/renderer/src/screens/Chat/chatActivity.ts
```

Responsibilities:

- `isChatActivityEvent(event)`
- `summarizeActivityEvents(events)`
- `activityStatusForEvent(event)`
- `activityLabelForEvent(event)`
- `formatActivityMetadata(metadata)`

Grouping rule:

```ts
tool.*          -> metadata.toolName/tool/title
delegation.*    -> delegation key
artifact.created -> metadata.artifactType
approval.*      -> approval
transport.error -> transport
```

Status precedence:

```txt
failed/error > waiting approval > running/progress > completed/resolved > info
```

---

### E. Chat transcript rendering

In `Chat.tsx`:

- Render each `MessageRow` as today.
- Immediately after each text message, render activity groups whose `anchorMessageId` matches that message id.
- Remove:
  - `ChatLoading toolProgress={...}`
  - `.chat-tool-progress-inline`
- `ChatLoading` becomes typing dots only.

This keeps transcript order:

```txt
User bubble
Activity group, if any
Assistant prose bubble
```

Assistant markdown remains rendered only through `AgentMarkdown`.

Approval behavior remains tied to the last assistant text bubble via `APPROVAL_RE`.

---

### F. Persistence and session resume

No persistence schema changes.

- Activity groups are live renderer state only.
- Trace Lab continues to read persisted `TraceRun.events`.
- Resumed sessions continue to load only DB user/assistant messages through `Layout.handleResumeSession`.
- Historical tool activity hydration is explicitly out of scope for this fix.

---

## 4. **File-by-file impact**

### `src/main/trace-store.ts`

- Change `recordTraceEvent` return type to `TraceEvent | null`.
- Return the event from `appendEvent`.
- Preserve all existing storage, sanitization, caps, and sorting behavior.

### `src/main/ipc/chat.ts`

- Add helper to determine whether a `TraceEventType` should be emitted as live chat activity.
- Add helper to send `chat-trace-event`.
- In `onTraceEvent`, record then emit activity events.
- In `onToolProgress`, synthesize/record/emit a `tool.progress` event only when it was not already represented by a structured event.
- In `onError` and send-catch paths, emit recorded `transport.error`.
- Keep `chat-tool-progress` emission for compatibility.
- Preserve `chat-chunk`, `chat-done`, `chat-error`, `chat-usage`, abort, and Trace Lab recording behavior.

### `src/main/hermes/chat-api.ts`

- Route standalone legacy tool/progress content to `onToolProgress`.
- Send only natural-language prose to `onChunk`.
- Preserve usage extraction, session id handling, probing, abort, and custom SSE event handling.

### `src/main/hermes/chat-cli.ts`

- Suppress standalone CLI tool/delegation/status lines from `onChunk`.
- Continue emitting normalized trace events.
- Preserve genuine assistant prose output.

### `src/main/hermes/trace-events.ts`

- Add testable helper(s) for legacy activity/prose splitting and/or CLI activity-line suppression.
- Keep existing normalization outputs and sanitization behavior.

### `src/preload/api/chat.ts`

- Add `onChatTraceEvent`.
- Use channel `chat-trace-event`.

### `src/preload/index.d.ts`

- Add `onChatTraceEvent(callback: (event: TraceEvent) => void): () => void`.

### `src/renderer/src/screens/Chat/types.ts`

- Add `ChatActivityGroup` and status types.
- Add `activityGroups` and `toggleActivityGroup` to `ChatController`.
- Remove `toolProgress` from `ChatController` if no longer consumed.

### `src/renderer/src/screens/Chat/hooks/useChatController.ts`

- Add activity group state and refs.
- Subscribe to `window.hermesAPI.onChatTraceEvent`.
- Create activity groups when backend runs start.
- Append/dedupe structured events.
- Mark groups completed/failed/aborted.
- Reset groups on clear/new chat/messages emptied.
- Stop using `toolProgress` for rendering.

### `src/renderer/src/screens/Chat/Chat.tsx`

- Render `ChatActivityGroup` after its anchor message.
- Render `ChatLoading` without progress text.
- Remove inline progress rendering.

### `src/renderer/src/screens/Chat/components/ChatLoading.tsx`

- Remove `toolProgress` prop.
- Always render typing indicator only.

### New: `src/renderer/src/screens/Chat/components/ChatActivityGroup.tsx`

- Expandable activity group UI.
- Summary pills and details.

### New: `src/renderer/src/screens/Chat/chatActivity.ts`

- Renderer activity filtering, grouping, labels, statuses, metadata formatting.

### `src/renderer/src/assets/styles/chat-rich-content.css`

- Add `.chat-activity-*` styles.
- Ensure activity groups do not reuse `.chat-bubble-agent`.

### `src/shared/i18n/locales/{en,es,pt-BR,zh-CN}/chat.ts`

Add localized labels for:

- activity title
- show/hide details
- running/completed/failed/aborted
- event count
- details/metadata fallback labels

### `tests/hermes-trace-events.test.ts`

- Add coverage for:
  - legacy standalone progress split out of prose
  - prose preserved when mentioning tools naturally
  - CLI image/tool progress still normalizes to activity

### `tests/preload-api-surface.test.ts`

- Add `onChatTraceEvent` to expected chat API methods.

### Optional new renderer helper test

Add a small test for `chatActivity.ts` summarization:

- repeated tool events become one pill with count
- failed status wins over completed/progress
- artifact and transport events group separately

---

## 5. **Risks and migration**

No data migration is required.

Key risks:

- **Duplicate activity events** from `onTraceEvent` plus `onToolProgress`; mitigate with existing `skipNextLegacyToolTrace` logic and renderer dedupe by event id.
- **Over-suppressing CLI prose**; mitigate with strict standalone activity-line detection and tests.
- **Historical sessions missing activity groups**; accepted because current DB resume path only hydrates user/assistant messages and Trace Lab already owns historical activity review.

Rollback is safe because persisted trace schema is unchanged.

---

## 6. **Implementation order**

1. Update `trace-store.recordTraceEvent` to return the sanitized event.
2. Add `chat-trace-event` emission in `src/main/ipc/chat.ts`.
3. Add preload API and typings for `onChatTraceEvent`.
4. Add/test legacy activity filtering helpers in `trace-events.ts`.
5. Apply API and CLI source filtering so tool/status lines do not reach `onChunk`.
6. Add renderer activity types and `chatActivity.ts` helpers.
7. Add `ChatActivityGroup.tsx` and CSS.
8. Integrate activity state into `useChatController`.
9. Update `Chat.tsx` and `ChatLoading.tsx` to remove progress-as-bubble rendering.
10. Add i18n keys in all chat locale files.
11. Update tests.
12. Validate with:
    - `npm run typecheck:node`
    - `npm run typecheck:web`
    - `npm test -- preload-api-surface.test.ts hermes-trace-events.test.ts`
    - full `npm test` if feasible.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "chat-activities-633948", new_chat: false)
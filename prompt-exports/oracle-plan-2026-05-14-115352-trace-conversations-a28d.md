## Final Prompt
<taskname="Trace Conversations"/>
<task>
Update Mercury Trace Lab so a full conversation/session is the primary dashboard unit. The Recent activity sidebar should show one conversation-level item for runs that belong to the same conversation/session, with expand/collapse access to constituent agent runs/messages. The selected conversation details should put Event Timeline at the top, remove the "Agent Run Map" / "What Hermes did" section entirely, and move the skill/evolution summaries to the bottom. Preserve trace evidence, structured event rendering, metadata inspector behavior, status/usage visibility, and existing trace persistence semantics unless a schema change is truly needed.
</task>

<architecture>
Mercury Trace Lab is renderer-led over existing trace data:
- `TraceRun` is the persisted unit from `src/shared/traces.ts`; it already has optional `sessionId`, `status`, timestamps, usage, message preview, and `events`.
- `src/main/ipc/chat.ts` creates one `TraceRun` per send-message call. It records `session.resumed` when a resumed session id is supplied, records history metadata, and calls `finishTraceRun(..., sessionId)` on completion. Failed/aborted/running/local/old runs may not have `sessionId`.
- `src/main/trace-store.ts` persists runs sorted by `updatedAt` and derives `SkillTrainingRun` rows from `skill.*` events with `linkedRunId` pointing back to a run id.
- `src/renderer/src/screens/TraceLab/TraceLab.tsx` currently lists individual runs in Recent activity and selects a single run. It renders request preview, `RunMap`, `SkillTraceSummary`, facts, timeline, and a right-side event inspector plus global skill training panel.
- `TraceLabComponents.tsx` owns `RunMap`, `SkillTraceSummary`, `TraceEventRow`, and `EventInspector`. `EventInspector` is the main structured event/metadata display to preserve.
- CSS is split across `trace-lab.css` (layout/sidebar/detail), `trace-lab-map.css` (run map plus skill summary/facts), and `trace-lab-events.css` (timeline/inspector/skill training panel/responsive rules). `main.css` imports all three.
</architecture>

<selected_context>
`src/renderer/src/screens/TraceLab/TraceLab.tsx`: main dashboard state and layout; current filtering/search over `TraceRun[]`, individual run selection, Recent activity rows, detail ordering, inspector, and skill panel.
`src/renderer/src/screens/TraceLab/components/TraceLabComponents.tsx`: presentational components; remove or stop using `RunMap`; keep/adapt `SkillTraceSummary`, `TraceEventRow`, `EventInspector`, `Metric`, `Fact`, `EmptyState`.
`src/renderer/src/screens/TraceLab/trace-lab.helpers.ts`: current `buildRunMap`, event explanations, run search/filter helpers, formatting. Likely place for conversation grouping/search helpers if kept near Trace Lab.
`src/renderer/src/screens/TraceLab/trace-lab.types.ts`: event labels/icons, `RunMapStep`, `RunFilter`; remove stale run-map type/imports if no longer used and add conversation UI types if appropriate.
`src/renderer/src/assets/styles/trace-lab.css`: sidebar/list/detail/workbench styles; likely needs conversation row, nested run row, expand/collapse, and detail ordering adjustments.
`src/renderer/src/assets/styles/trace-lab-map.css`: currently contains `.trace-run-map` and `.trace-map-*` styles plus `.trace-skill-summary` and `.trace-facts`; remove run-map-only styles but preserve/adapt skill summary/facts styles.
`src/renderer/src/assets/styles/trace-lab-events.css`: timeline, inspector, skill training panel, responsive rules; contains responsive references to `.trace-map-grid`/`.trace-map-arrow` that become stale when the run map is removed.
`src/renderer/src/assets/main.css`: CSS import manifest; only change if files are split/removed.
`src/shared/traces.ts`: canonical `TraceRun`, `TraceEvent`, `SkillTrainingRun` schema. Use existing `sessionId` if deriving conversation groups; note optionality.
`src/main/trace-store.ts`: persistence behavior, sort order, skill derivation linked by run id.
`src/main/ipc/chat.ts`: chat-to-trace lifecycle; where `sessionId`, `session.resumed`, and `message.history.loaded` evidence originates.
`src/renderer/src/screens/Chat/hooks/useChatController.ts`: renderer chat session lifecycle; stores `hermesSessionId`, sends it as `resumeSessionId`, includes prior messages as history.
`src/preload/index.d.ts`: renderer `window.hermesAPI` types used by Trace Lab tests/mocks: `listTraceRuns`, `listSkillTrainingRuns`, `openExternal`, etc.
`tests/trace-store.test.ts`: current trace-store test style and behavior for skill links/local traces; useful if data assumptions change.
`src/renderer/src/components/I18nProvider.test.tsx`, `src/renderer/src/test/setup.ts`, `vitest.config.ts`: renderer test setup/patterns if adding a focused Trace Lab component/helper test.
`docs/contracts/trace-schema.md`: current docs still say Trace Lab builds a run map; update if UI contract changes.
`docs/subsystems/chat-and-tracing.md`: session/resume/history tracing docs and verification guidance.
`package.json`: available scripts: `npm run test`, `npm run typecheck`, etc.
</selected_context>

<relationships>
- Chat send path: `useChatController.handleSend()` / quick ask / approve / deny -> `window.hermesAPI.sendMessage(message, profile, hermesSessionId, history)` -> `src/main/ipc/chat.ts` -> one persisted `TraceRun` per message.
- Conversation continuity: first completed run receives a `sessionId` from Hermes; later sends pass that as `resumeSessionId`, causing `session.resumed` and `message.history.loaded` events. Multiple `TraceRun`s with the same `sessionId` are the likely constituent runs for one conversation.
- Trace Lab data flow: `window.hermesAPI.listTraceRuns()` + `listSkillTrainingRuns()` -> `TraceLab.tsx` state -> filtering/search/selection -> `TraceEventRow` and `EventInspector` display event evidence.
- Skill links: `SkillTrainingRun.linkedRunId` points to a run, not a conversation. Conversation-level skill summaries need to collect skill runs whose `linkedRunId` is any constituent run id.
- Current run map removal touches JSX (`RunMap` import/render/component), helpers (`buildRunMap` and `RunMapStep` if unused), CSS (`.trace-run-map`, `.trace-map-*`, responsive references), and docs (`trace-schema.md` presentation contract).
</relationships>

<implementation_boundaries>
- Keep the change focused on Trace Lab presentation and derived grouping logic. Avoid backend persistence changes unless the existing optional `sessionId` cannot support the requested grouping.
- Recent activity should operate on conversation groups, not raw runs, while still allowing constituent runs/messages to be expanded and selected/inspected.
- The selected details should surface timeline evidence first. Decide whether the conversation timeline is a merged chronological list across all constituent runs, grouped-by-run sections, or a selected-run timeline within a conversation; make that behavior clear and keep per-event selection working with `EventInspector`.
- Preserve search/filter semantics across the grouped view: query/status/skill filters should consider all runs/events in a conversation, not only the conversation header.
- Preserve visible facts such as started/updated/tokens/cost/status, but aggregate or label them at conversation level so users do not mistake one message run for the whole session.
- Move `SkillTraceSummary`/skill-evolution content below the timeline/details area; keep the right inspector focused on selected structured event metadata.
</implementation_boundaries>

<verification>
Recommended focused checks after implementation:
- Add or update a helper/component test for grouping multiple `TraceRun`s sharing a `sessionId`, fallback handling for runs without `sessionId`, filter/search behavior, and skill links across constituent runs.
- Run `npm run test -- src/renderer/src/screens/TraceLab/<new-or-updated-test>.test.tsx tests/trace-store.test.ts` if tests are added/affected.
- Run `npm run typecheck` because removing `RunMap` should also remove stale imports/types/icons and CSS/docs references should not hide TypeScript drift.
</verification>

<ambiguities>
- `TraceRun.sessionId` is optional. Completed runs with a returned Hermes session id can be grouped directly, but failed/aborted/running/local slash command/old-store runs may have no session id. The UI needs a deterministic fallback, likely treating each no-session run as its own conversation unless a `session.resumed` event metadata provides a usable id.
- The request says “full conversation/session” and “individual agent runs/messages grouped inside it.” Existing persisted data has runs and events, not separate message records inside Trace Lab. The implementation should derive conversation groups from runs/events without inventing hidden message data.
- “skill/skeletal evolution” appears to refer to the current Skill Auto-Evolution / Skill Evaluation sections. Both are selected because there are two skill surfaces: `SkillTraceSummary` in the main detail and the right-side `skill-training-panel`.
</ambiguities>

## Selection
- Files: 24 total (20 full, 4 codemap)
- Total tokens: 36067 (Auto view)
- Token breakdown: full 34639, codemap 1428

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── contracts/
│   │   └── trace-schema.md — 3 067 tokens (full)
│   └── subsystems/
│       └── chat-and-tracing.md — 2 599 tokens (full)
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   └── chat.ts — 2 394 tokens (full)
│   │   └── trace-store.ts — 2 288 tokens (full)
│   ├── preload/
│   │   └── index.d.ts — 3 373 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── styles/
│   │       │   │   ├── trace-lab-events.css — 1 865 tokens (full)
│   │       │   │   ├── trace-lab-map.css — 1 183 tokens (full)
│   │       │   │   └── trace-lab.css — 1 771 tokens (full)
│   │       │   └── main.css — 284 tokens (full)
│   │       ├── components/
│   │       │   └── I18nProvider.test.tsx — 516 tokens (full)
│   │       ├── screens/
│   │       │   ├── Chat/
│   │       │   │   └── hooks/
│   │       │   │       └── useChatController.ts — 3 706 tokens (full)
│   │       │   └── TraceLab/
│   │       │       ├── components/
│   │       │       │   └── TraceLabComponents.tsx — 2 290 tokens (full)
│   │       │       ├── TraceLab.tsx — 3 180 tokens (full)
│   │       │       ├── trace-lab.helpers.ts — 3 061 tokens (full)
│   │       │       └── trace-lab.types.ts — 703 tokens (full)
│   │       └── test/
│   │           └── setup.ts — 43 tokens (full)
│   └── shared/
│       └── traces.ts — 417 tokens (full)
├── tests/
│   └── trace-store.test.ts — 1 074 tokens (full)
├── package.json — 699 tokens (full)
└── vitest.config.ts — 126 tokens (full)

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
    │           └── Chat/
    │               └── types.ts — 669 tokens (auto)
    └── shared/
        └── i18n/
            └── types.ts — 43 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `trace-conversations-B1792A` | **Mode**: plan

### Response
## 1. **Summary**

Update Trace Lab with a targeted renderer-only refactor: keep `TraceRun` as the persisted backend unit, but derive conversation/session groups in the renderer and make those groups the primary dashboard item. The Recent activity sidebar will list conversations with expandable constituent runs/messages; the detail pane will render a merged conversation Event Timeline first, remove the Agent Run Map entirely, preserve `EventInspector` metadata behavior, aggregate status/usage at conversation level, and move skill/evolution content to the bottom. No trace schema or persistence change is needed.

## 2. **Current-state analysis**

- `src/main/ipc/chat.ts` creates one `TraceRun` per `send-message`.
  - First completed run receives `sessionId` from Hermes via `finishTraceRun(..., sessionId)`.
  - Later messages pass `resumeSessionId`; main records `session.resumed` and `message.history.loaded`.
  - Failed/aborted/running resumed runs may have no `run.sessionId`, but may still have a `session.resumed` event with metadata/detail containing the session id.

- `src/main/trace-store.ts` persists `TraceRun[]` to `<HERMES_HOME>/desktop-traces.json`.
  - Store version remains `1`.
  - Runs are sorted by `updatedAt`.
  - `SkillTrainingRun` is derived from `skill.*` events and links back via `linkedRunId`.

- `TraceLab.tsx` currently:
  - Loads `listTraceRuns()` and `listSkillTrainingRuns()`.
  - Filters/searches raw `TraceRun[]`.
  - Selects a single `TraceRun` and single event id.
  - Renders run-level detail: request preview, `RunMap`, skill summary, facts, event timeline.
  - Renders `EventInspector` for the selected run/event plus a global skill-training panel in the inspector sidebar.

- `TraceLabComponents.tsx` owns:
  - `RunMap`, which must be removed/stopped using.
  - `TraceEventRow`, which can be extended to show parent run context in a conversation timeline.
  - `EventInspector`, which should remain behaviorally unchanged.
  - `SkillTraceSummary`, which should be reused at the bottom of the detail pane.

- Blocking assumptions in current code:
  - Selection is run-centric: `selectedRunId` + `selectedEventId`.
  - Timeline events only come from one run.
  - Search/filter counts and sidebar rows are run-level.
  - `buildRunMap` and `.trace-map-*` CSS are now stale for the requested UI.

## 3. **Design**

### A. Conversation grouping model

Implement grouping in `src/renderer/src/screens/TraceLab/trace-lab.helpers.ts`, with UI-only types in `trace-lab.types.ts`.

Add renderer-only types:

```ts
type TraceConversation = {
  key: string;              // "session:<id>" or "run:<id>"
  sessionId?: string;
  title: string;
  profileLabel: string;
  status: TraceRun["status"];
  startedAt: number;
  updatedAt: number;
  messagePreview: string;
  latestMessagePreview: string;
  runCount: number;
  eventCount: number;
  usage: TraceUsage;
  runs: TraceRun[];         // chronological by startedAt
  hasSkillSignals: boolean;
  hasNeedsAttention: boolean;
};

type ConversationTimelineItem = {
  key: string;              // `${run.id}:${event.id}`
  run: TraceRun;
  runIndex: number;         // chronological 1-based index
  event: TraceEvent;
  contextLabel: string;
};
```

Grouping key algorithm:

1. Prefer `run.sessionId` if present.
2. Else inspect first `session.resumed` event:
   - Prefer `event.metadata?.sessionId` if it is a non-empty string.
   - Else use `event.detail` if non-empty.
3. Else fallback to `run:<run.id>`.

This groups completed runs, resumed failed/aborted/running runs, and isolates local/old/no-session runs deterministically.

Conversation aggregation:

- `runs`: sorted ascending by `startedAt`, then `updatedAt`.
- `updatedAt`: max run `updatedAt`.
- `startedAt`: min run `startedAt`.
- `status`:
  1. `running` if any run is running.
  2. `failed` if any run failed.
  3. `aborted` if any run aborted.
  4. Otherwise `completed`.
- `usage`: sum prompt/completion/total tokens; sum `cost` only if at least one run has cost.
- `hasNeedsAttention`: true for failed/aborted runs or `tool.failed`, `delegation.failed`, `transport.error`.
- `hasSkillSignals`: true when any event type starts with `skill.`.
- `title`: first chronological run title, fallback to `Session <short id>` or `Trace conversation`.
- `latestMessagePreview`: latest chronological run message preview.
- Conversations sorted by `updatedAt` descending.

Add helpers:

```ts
buildTraceConversations(runs: TraceRun[]): TraceConversation[]
buildConversationTimeline(conversation: TraceConversation): ConversationTimelineItem[]
traceConversationMatchesSearch(conversation: TraceConversation, query: string): boolean
traceConversationMatchesFilter(conversation: TraceConversation, filter: RunFilter): boolean
```

Keep existing `traceRunMatchesSearch` / `traceRunMatchesFilter` only if reused internally or by tests; otherwise remove after migration.

### B. TraceLab state and data flow

Replace run-centric state in `TraceLab.tsx`:

Before:

```ts
selectedRunId: string | null
selectedEventId: string | null
```

After:

```ts
selectedConversationKey: string | null
selectedEventRef: { runId: string; eventId: string } | null
expandedConversationKeys: Set<string>
```

Data flow:

1. `load()` still reads:
   - `window.hermesAPI.listTraceRuns()`
   - `window.hermesAPI.listSkillTrainingRuns()`
2. `useMemo` derives `conversations = buildTraceConversations(runs)`.
3. Search/filter applies to conversations, not raw runs.
4. Selected conversation:
   - If current selected key exists in filtered conversations, use it.
   - Else fallback to first filtered conversation.
   - Else fallback to first conversation.
5. Timeline:
   - `buildConversationTimeline(selectedConversation)` returns merged chronological events across all constituent runs.
6. Selected event:
   - Find by composite `{ runId, eventId }`.
   - Fallback to first timeline event.
7. `EventInspector` receives the parent run from the selected timeline item.

Selection behavior:

- Clicking a conversation header:
  - sets `selectedConversationKey`
  - selects first event in that conversation
  - expands the conversation if it has multiple runs
- Clicking a nested run/message:
  - selects its parent conversation
  - selects that run’s first event
- Clicking a timeline event:
  - sets `selectedEventRef`
- Clicking a skill signal:
  - finds the linked run by `SkillTrainingRun.linkedRunId`
  - selects the parent conversation
  - selects the skill event id using `{ runId: linkedRun.id, eventId: skillRun.id }`
  - clears search and resets filter to `"all"` if needed

### C. Sidebar: conversation-first Recent activity

Replace raw `.trace-run-row` list with conversation items.

Each conversation row should show:

- aggregated status dot/pill
- conversation title
- profile label
- latest message preview
- updated time
- run count, e.g. `3 runs`
- optional session badge when `sessionId` exists

Expanded content:

- Render nested constituent run/message rows.
- Each nested row shows:
  - run index, e.g. `Run 2`
  - run status
  - run title or message preview
  - updated time
  - token total if available
- Highlight nested row when its run owns the selected event.

Filter/search semantics:

- Query matches conversation title/profile/status/session, all constituent run fields, all event title/detail/type, and JSON-stringified metadata.
- `"completed"` means the aggregate conversation status is completed.
- `"needs-attention"` means aggregate needs-attention is true.
- `"skills"` means any constituent run has `skill.*` events.

### D. Detail pane ordering

New detail order:

1. Conversation title/header
2. **Event Timeline** — first substantive section
3. Conversation facts
4. Conversation messages/runs summary
5. Skill/evolution summary at the bottom

Remove entirely:

- `<RunMap run={selectedRun} />`
- “Agent Run Map”
- “What Hermes did”
- `.trace-run-map`
- `.trace-map-*` UI

Conversation facts:

- Started: min started time
- Updated: max updated time
- Agent runs: `conversation.runCount`
- Tokens: aggregate total tokens
- Cost: aggregate cost or `n/a`

Update `.trace-facts` CSS to support 4–5 items using auto-fit rather than fixed `repeat(4, ...)`.

### E. Timeline and inspector

Keep `EventInspector` behavior unchanged.

Modify `TraceEventRow` additively:

Before:

```ts
TraceEventRow({
  event,
  selected,
  onSelect,
})
```

After:

```ts
TraceEventRow({
  event,
  selected,
  onSelect,
  contextLabel?, // optional
})
```

Use `contextLabel` in conversation timeline, e.g.:

```text
Run 2 · default · Generate image assets
```

The row still uses `EVENT_ICONS`, `EVENT_LABELS`, event detail, and event timestamp exactly as today.

### F. Skill/evolution summaries

Move skill UI out of the right inspector.

- Keep the right aside focused on selected event metadata only.
- Render `SkillTraceSummary` at the bottom of the selected conversation detail.
- Scope it to the selected conversation:

```ts
selectedConversationSkillRuns =
  skillRuns.filter(skill => selectedRunIds.has(skill.linkedRunId))
```

If there are no linked skill events, show the existing empty copy.

Top metrics should become conversation-oriented:

- Conversations: `conversations.length`
- Completed: completed conversations
- Needs attention: conversations with aggregate attention
- Skill reviews: `skillRuns.length`

## 4. **File-by-file impact**

### `src/renderer/src/screens/TraceLab/trace-lab.types.ts`

Change:

- Remove `RunMapStep`.
- Add `TraceConversation`, `ConversationTimelineItem`, and any small supporting aliases.
- Keep `EVENT_LABELS`, `EVENT_ICONS`, `RunFilter`, `RUN_FILTERS`.

Why:

- Conversation grouping is renderer UI state, not shared trace schema.

Dependencies:

- Used by `trace-lab.helpers.ts` and `TraceLab.tsx`.

---

### `src/renderer/src/screens/TraceLab/trace-lab.helpers.ts`

Change:

- Remove `buildRunMap` and private `pickLifecycleEvent` if no longer used.
- Remove lucide icon imports that only supported run map.
- Add conversation grouping helpers:
  - `buildTraceConversations`
  - `buildConversationTimeline`
  - `traceConversationMatchesSearch`
  - `traceConversationMatchesFilter`
- Keep `explainEvent`, `formatSkillScore`, `safeStringify`, `formatTime`.

Why:

- Preserve event explanation/metadata behavior while changing the dashboard unit from run to conversation.

Dependencies:

- `TraceLab.tsx` consumes new helpers.
- New helper tests should target this file.

---

### `src/renderer/src/screens/TraceLab/components/TraceLabComponents.tsx`

Change:

- Remove `RunMap` component export.
- Remove imports used only by `RunMap`, especially `ArrowRight` and `buildRunMap`.
- Add optional `contextLabel` prop to `TraceEventRow`.
- Keep `EventInspector`, artifact handling, metadata rendering, `SkillTraceSummary`, `Metric`, `Fact`, `EmptyState`.

Why:

- Run map is explicitly removed; event rows need conversation/run context.

Dependencies:

- `TraceLab.tsx` call sites must pass `contextLabel` for conversation timeline.

---

### `src/renderer/src/screens/TraceLab/TraceLab.tsx`

Change:

- Replace raw run selection with conversation selection.
- Derive conversations via `buildTraceConversations(runs)`.
- Filter/search conversations.
- Render conversation rows in Recent activity.
- Add expand/collapse nested run/message rows.
- Render merged conversation timeline at top of detail pane.
- Remove `RunMap` import/render.
- Move `SkillTraceSummary` to bottom.
- Remove right-side `skill-training-panel`.

Why:

- This is the main presentation refactor requested by the task.

Dependencies:

- Requires new helpers/types and updated `TraceEventRow`.

---

### `src/renderer/src/assets/styles/trace-lab.css`

Change:

- Replace/adapt sidebar styles for:
  - `.trace-conversation-item`
  - `.trace-conversation-row`
  - `.trace-conversation-toggle`
  - `.trace-run-children`
  - `.trace-run-child-row`
- Update list count/empty copy to conversation wording.
- Add styles for conversation message summary if rendered below facts.
- Keep status dot/pill styles reusable.
- Update facts grid if moved here or leave in `trace-lab-map.css`.

Why:

- Sidebar now renders grouped conversation rows with nested constituent runs.

Dependencies:

- Must align class names from `TraceLab.tsx`.

---

### `src/renderer/src/assets/styles/trace-lab-map.css`

Change:

- Remove run-map-only selectors:
  - `.trace-run-map`
  - `.trace-map-status`
  - `.trace-map-grid`
  - `.trace-map-step*`
  - `.trace-map-arrow`
- Preserve/adapt:
  - `.trace-skill-summary`
  - `.trace-skill-links`
  - `.trace-section-title`
  - `.trace-facts`
  - `.trace-fact`
- Change `.trace-facts` to responsive auto-fit.

Why:

- File still contains useful detail/skill styles, but run map CSS must not remain as dead UI styling.

Dependencies:

- `main.css` can remain unchanged if the file is kept.

---

### `src/renderer/src/assets/styles/trace-lab-events.css`

Change:

- Add optional context label styles for `TraceEventRow`.
- Remove responsive references to `.trace-map-grid` and `.trace-map-arrow`.
- Keep inspector, metadata, artifact, timeline, skill-row styles as needed.
- Remove or relocate `.skill-training-panel` styles if that panel is deleted; keep skill-row styles only if reused in bottom skill section.

Why:

- Timeline remains; run map responsive rules become stale.

Dependencies:

- Must match updated `TraceEventRow` markup.

---

### `src/renderer/src/assets/main.css`

Change:

- Prefer no change.
- Only change if `trace-lab-map.css` is renamed; avoid renaming for this targeted change.

Why:

- Keeping import order stable minimizes unrelated cascade risk.

---

### `docs/contracts/trace-schema.md`

Change:

- Update “Trace Lab presentation contract”.
- Remove claims that Trace Lab builds an Agent Run Map.
- Document renderer-derived conversation grouping:
  - `run.sessionId`
  - fallback `session.resumed` metadata/detail
  - fallback one run per no-session conversation
- Document merged conversation Event Timeline and bottom skill summary.
- State no schema migration is required.

Why:

- Current docs would be inaccurate after run map removal.

---

### `docs/subsystems/chat-and-tracing.md`

Change:

- Add/update a subsection explaining:
  - persistence remains one `TraceRun` per send-message
  - Trace Lab groups those runs into conversations at render time
  - incomplete resumed runs can group via `session.resumed`
- Update any Trace Lab wording that implies run-level dashboard only.

Why:

- Chat/session lifecycle is the source of conversation grouping.

---

### `src/renderer/src/screens/TraceLab/trace-lab.helpers.test.ts` new

Add focused tests for pure grouping logic:

- groups multiple runs sharing `sessionId`
- groups resumed failed/aborted run using `session.resumed` metadata when `run.sessionId` is absent
- keeps no-session runs isolated
- aggregates usage/status correctly
- filters/searches across nested events and metadata
- returns timeline items with parent run context

Why:

- Most behavior is deterministic helper logic and can be tested without Electron.

## 5. **Risks and migration**

- No persistence/schema migration.
- Old stores without `sessionId` remain readable; each no-session run becomes its own conversation.
- Running first messages without a session id may initially appear as a one-run conversation, then move under `session:<id>` after refresh/completion. This is acceptable because the source snapshot changes only once Hermes returns a session id.
- Event ids should be treated as run-scoped for UI selection; use composite `runId:eventId` keys to avoid imported-store collisions.

## 6. **Implementation order**

1. Add conversation types and helper functions while keeping existing run-map code temporarily.
2. Add helper tests for grouping, aggregation, search/filter, and timeline flattening.
3. Refactor `TraceLab.tsx` to use conversations, merged timeline, grouped sidebar, and conversation-scoped skills.
4. Extend `TraceEventRow` with optional context labels.
5. Remove `RunMap`, `buildRunMap`, `RunMapStep`, and stale icon imports.
6. Clean CSS: sidebar grouping styles, remove `.trace-map-*`, update responsive rules.
7. Update docs in `trace-schema.md` and `chat-and-tracing.md`.
8. Verify with:
   - `npm run test -- src/renderer/src/screens/TraceLab/trace-lab.helpers.test.ts tests/trace-store.test.ts`
   - `npm run typecheck`


> 💡 Continue this plan conversation with ask_oracle(chat_id: "trace-conversations-B1792A", new_chat: false)
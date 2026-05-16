## Final Prompt
<taskname="Trace Via Sessions"/>
<task>
Refactor Mercury so Trace Lab is accessed through the Sessions list/detail flow instead of a standalone sidebar destination. Remove the `Trace Lab` sidebar nav item, add a Sessions-level affordance to open traces for a selected session/conversation, and reuse the existing Trace Lab timeline/detail/inspector UI without duplicating Trace Lab's internal Recent activity conversation list when launched from a session. Preserve the Electron/React/TypeScript architecture and add focused regression coverage for routing, session trace opening, and Trace Lab filtering/preselection behavior.
</task>

<architecture>
- Renderer app shell: `src/renderer/src/App.tsx` renders `Layout`; `src/renderer/src/main.tsx` imports `assets/main.css`, which imports layout, sessions, trace-lab, trace-lab-map, and trace-lab-events CSS.
- Navigation/router: `src/renderer/src/screens/Layout/Layout.tsx` owns `View`, `NAV_ITEMS`, `visitedViews`, `goTo()`, active profile/session/chat state, and currently imports/renders `<TraceLab />` as the `traces` pane. `NAV_ITEMS` currently includes `{ view: "traces", icon: Activity, labelKey: "navigation.traces" }`.
- Sessions UI: `src/renderer/src/screens/Sessions/Sessions.tsx` loads cached sessions via `listCachedSessions(50)`, refreshes with `syncSessionCache()`, searches with `searchSessions(query)`, groups rows by date, and invokes `onResumeSession(sessionId, title, profile)` for cached and search rows. It currently has no trace action/secondary affordance.
- Trace Lab UI: `src/renderer/src/screens/TraceLab/TraceLab.tsx` is a monolithic stateful screen. It loads `listTraceRuns()` and `listSkillTrainingRuns()`, builds grouped conversations with `buildTraceConversations(runs)`, owns query/filter/selected conversation/selected event state, renders metrics/header, the left `trace-run-list` Recent activity panel, the center `trace-detail`, and the right `trace-inspector`.
- Trace Lab presentational pieces: `TraceLabComponents.tsx` provides `Metric`, `Fact`, `TraceEventRow`, `EventInspector`, `SkillTraceSummary`, and `EmptyState`. These are reusable for a session-scoped detail surface if TraceLab is split or given props.
- Trace grouping helpers: `trace-lab.helpers.ts` derives conversation identity by preferring `TraceRun.sessionId`, then `session.resumed` event metadata/detail, then `run:<id>`. `buildConversationTimeline()` merges events chronologically across grouped runs. Search/filter helpers operate over conversations and nested run/event metadata.
- Trace schema/store: `src/shared/traces.ts` defines `TraceRun`/`TraceEvent`/`SkillTrainingRun`. `src/main/trace-store.ts` persists runs to `<HERMES_HOME>/desktop-traces.json`; `src/main/ipc/trace.ts` exposes `list-trace-runs`, `get-trace-run`, `list-skill-training-runs`, and `record-local-chat-trace`; preload exposes these in `src/preload/api/navigation.ts` and `src/preload/index.d.ts`.
- Trace creation path: `src/main/ipc/chat.ts` creates trace runs for chat sends, records `session.resumed` when a resume id is supplied, finishes runs with `sessionId` on completion, and emits live trace events. `src/main/hermes/trace-events.ts` normalizes tool/delegation/artifact/approval events.
- i18n: navigation labels live in `src/shared/i18n/locales/*/navigation.ts`; Sessions labels live in `src/shared/i18n/locales/*/sessions.ts`; `src/shared/i18n/index.ts` bundles all locale modules. Removing the sidebar destination may allow removing `navigation.traces`, while Sessions trace buttons likely need new `sessions.*` keys in every locale.
- Styling: `layout.css` controls sidebar nav, `sessions.css` controls session cards/search/empty states, and `trace-lab*.css` controls the three-pane Trace Lab layout. A session-launched trace detail may need styles for a Sessions detail/action affordance and a Trace Lab variant that hides the left list.
</architecture>

<selected_context>
- `src/renderer/src/screens/Layout/Layout.tsx`: current sidebar/router, `View` union, `NAV_ITEMS`, `visitedViews`, standalone `traces` pane, Sessions callbacks, and chat/session state.
- `src/renderer/src/screens/Sessions/Sessions.tsx`: current row/card/search rendering and `onResumeSession(sessionId, title, profile)` contract; primary edit target for adding an open-traces affordance.
- `src/renderer/src/screens/Sessions/Sessions.test.tsx`: existing renderer tests for session/profile row click behavior; good place to add tests that trace actions do not accidentally resume chat and pass session/profile/title correctly.
- `src/renderer/src/screens/TraceLab/TraceLab.tsx`: current all-in-one Trace Lab screen with loading, grouping, filtering, left conversation list, detail timeline, inspector, metrics, refresh, and skill summary state.
- `src/renderer/src/screens/TraceLab/components/TraceLabComponents.tsx`: reusable event/detail/inspector/fact/metric/empty-state components.
- `src/renderer/src/screens/TraceLab/trace-lab.helpers.ts` and `.test.ts`: conversation grouping by session/resume event, search/filter behavior, and timeline construction coverage; likely targets for session-id/profile filtering helpers.
- `src/renderer/src/screens/TraceLab/trace-lab.types.ts`: `TraceConversation`, timeline item, event labels/icons, and run filters.
- `src/renderer/src/assets/styles/layout.css`, `sessions.css`, `trace-lab.css`, `trace-lab-map.css`, `trace-lab-events.css`, `main.css`, `assets/icons/index.tsx`: full styling/import/icon context for removing nav, adding row actions, and adapting Trace Lab detail layout.
- `src/shared/traces.ts`, `src/main/trace-store.ts`, `src/main/ipc/trace.ts`, `src/preload/api/navigation.ts`, `src/preload/index.d.ts`: trace data contract and IPC/preload APIs; use if adding filtered trace API, otherwise existing client-side `listTraceRuns()` can support selection filtering.
- `src/main/ipc/chat.ts`, `src/main/hermes/trace-events.ts`: trace run creation and session identity evidence. Useful for understanding why `TraceRun.sessionId` or `session.resumed` metadata is the bridge from Sessions rows to Trace Lab conversations.
- `src/main/ipc/sessions.ts`, `src/main/session-cache.ts`, `src/main/sessions.ts`, `src/main/session-db.ts`, `src/preload/api/models.ts`: Sessions cache/search/list APIs and row shape/profile metadata that Sessions currently displays and should pass into trace opening if needed.
- `src/shared/i18n/locales/*/navigation.ts`, `src/shared/i18n/locales/*/sessions.ts`, `src/shared/i18n/index.ts`, `src/shared/i18n/config.ts`, `src/shared/i18n/types.ts`, renderer i18n provider/hooks: localization surface for nav removal and Sessions trace-action copy.
- `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`, `tests/trace-store.test.ts`, `tests/chat-ipc-lifecycle.test.ts`: existing contract tests to update only if API/channel/schema behavior changes; trace-store/chat lifecycle tests document current trace identity behavior.
- `docs/contracts/trace-schema.md`, `docs/subsystems/chat-and-tracing.md`, `docs/trace-lab-visual-direction.md`: durable trace schema/presentation docs, including the current contract that Trace Lab groups runs into conversation rows and keeps legacy traces without session ids valid.
- `package.json`, `vitest.config.ts`, `src/renderer/src/test/setup.ts`: scripts and jsdom/Vitest setup.
</selected_context>

<relationships>
- Current standalone route: `Layout.NAV_ITEMS` contains `traces` -> sidebar `goTo("traces")` -> `visitedViews.has("traces")` renders `<TraceLab />` as a full pane.
- Desired entry path: Sessions row/action should call a new Layout-level trace-opening handler with `{ sessionId, title, profile? }` -> Layout should navigate to a Trace Lab detail surface or a Sessions-hosted detail state -> Trace Lab should preselect/filter the matching conversation and hide/avoid its internal `trace-run-list` list when session-launched.
- Existing resume path must remain intact: `Sessions` primary row click -> `onResumeSession(sessionId, title, profile)` -> `Layout.handleResumeSession()` -> `getSessionMessages(sessionId, profile)` -> Chat. A trace action should be a secondary action and should avoid triggering the resume click.
- Trace identity bridge: `Sessions` rows know `id/sessionId` and optional `profile`; Trace Lab groups trace runs by `TraceRun.sessionId` or `session.resumed` metadata. Profile is available on each `TraceRun.profile` and in conversation `profileLabel`, but `buildTraceConversations()` currently keys only by session id/run id, not profile.
- Trace detail data flow today: `TraceLab.load()` -> `window.hermesAPI.listTraceRuns()` + `listSkillTrainingRuns()` -> `buildTraceConversations(runs)` -> `selectedConversation` -> `buildConversationTimeline(selectedConversation)` -> `TraceEventRow`/`EventInspector`/`SkillTraceSummary`.
- CSS relationship: current `.trace-workbench` assumes three columns: left run list, center detail, right inspector. Hiding the internal list for a selected session likely needs a variant class or extracted detail component with a two-column/detail-only layout.
- i18n relationship: sidebar label uses `navigation.traces`; Sessions currently uses `sessions.*` keys. New visible Sessions actions should use locale keys in all four locale folders.
</relationships>

<implementation_intent>
- Remove Trace Lab from the sidebar nav and standalone `traces` route surface. Clean up the `View` union/import/icon/i18n only as far as the app no longer needs a sidebar destination; do not break trace IPC or trace data persistence.
- Add a clear Sessions-level affordance to open traces for a row. Keep chat resume as the primary row behavior unless deliberately changed, and prevent secondary action clicks from bubbling into resume.
- Reuse existing Trace Lab detail/timeline/inspector components. Prefer extracting reusable detail/list pieces or adding explicit props over duplicating Trace Lab rendering logic.
- When opened from Sessions, scope/preselect Trace Lab by the selected session id (and profile/title if needed) and hide the internal Recent activity/conversation list so Sessions remains the conversation list.
- Preserve existing Trace Lab functionality that is still reachable through Sessions. For traces without a session id, decide whether they remain visible via a fallback Sessions affordance or only through session-linked rows; document/test the chosen behavior.
- Avoid unnecessary main/preload API changes unless client-side filtering is insufficient. If adding filtered trace APIs, update `src/main/ipc/trace.ts`, `src/preload/api/navigation.ts`, `src/preload/index.d.ts`, and the IPC/preload consistency tests together.
</implementation_intent>

<verification_targets>
- Renderer unit tests: extend `Sessions.test.tsx` or add focused tests to assert the trace action passes the correct session id/profile/title and does not call `onResumeSession`.
- Trace Lab helper/component tests: add coverage for finding/preselecting/filtering a conversation by session id (and profile if the implementation treats profile as part of trace identity), including `session.resumed` fallback grouping.
- Layout/routing test if practical: verify the sidebar no longer renders `Trace Lab` and a Sessions trace action opens the trace detail surface.
- Contract tests: run/update `tests/ipc-handlers.test.ts` and `tests/preload-api-surface.test.ts` only if IPC/preload trace APIs change.
- Suggested commands: `npm run test -- src/renderer/src/screens/Sessions/Sessions.test.tsx src/renderer/src/screens/TraceLab/trace-lab.helpers.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts`, then `npm run typecheck`.
</verification_targets>

<git_state>
- Worktree was dirty during discovery. Modified tracked files included `package.json`, `package-lock.json`, `src/main/index.ts`, `src/main/ipc/system.ts`, `src/preload/api/app.ts`, `src/preload/index.d.ts`, `src/renderer/src/assets/styles/layout.css`, `src/renderer/src/screens/Layout/Layout.tsx`, common locale files, `tests/ipc-handlers.test.ts`, and `tests/preload-api-surface.test.ts`.
- Untracked files/directories included `src/main/perf/`, `src/renderer/src/perf.ts`, `src/shared/perf.ts`, `tests/perf-telemetry.test.ts`, and two `prompt-exports/oracle-plan-*` files.
- Treat these as user/existing changes. Do not revert unrelated perf telemetry or locale/common changes while implementing the Trace Lab/Sessions refactor.
</git_state>

<ambiguities>
- Product semantics for traces without a `sessionId` are not fully specified. Existing Trace Lab shows them as `run:<id>` conversations; removing standalone Trace Lab may make those traces unreachable unless Sessions gets a fallback/global trace entry.
- It is unclear whether profile should disambiguate trace conversations with the same session id across profiles. Sessions rows are profile-aware, but Trace Lab grouping currently keys only by session id.
- The desired exact placement of the trace affordance in Sessions is not specified. Keep it compact and consistent with existing session cards; avoid making the whole row ambiguous between resume and trace opening.
</ambiguities>

## Selection
- Files: 62 total (57 full, 5 codemap)
- Total tokens: 75322 (Auto view)
- Token breakdown: full 73763, codemap 1559

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── contracts/
│   │   └── trace-schema.md — 3 405 tokens (full)
│   ├── subsystems/
│   │   └── chat-and-tracing.md — 5 323 tokens (full)
│   └── trace-lab-visual-direction.md — 486 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   └── trace-events.ts — 2 616 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 3 631 tokens (full)
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   ├── sessions.ts — 2 134 tokens (full)
│   │   │   └── trace.ts — 167 tokens (full)
│   │   ├── session-cache.ts — 3 485 tokens (full)
│   │   ├── session-db.ts — 520 tokens (full)
│   │   ├── sessions.ts — 1 648 tokens (full)
│   │   └── trace-store.ts — 2 299 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   ├── models.ts — 1 229 tokens (full)
│   │   │   └── navigation.ts — 660 tokens (full)
│   │   └── index.d.ts — 3 655 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── icons/
│   │       │   │   └── index.tsx — 182 tokens (full)
│   │       │   ├── styles/
│   │       │   │   ├── layout.css — 1 025 tokens (full)
│   │       │   │   ├── sessions.css — 1 128 tokens (full)
│   │       │   │   ├── trace-lab-events.css — 1 878 tokens (full)
│   │       │   │   ├── trace-lab-map.css — 511 tokens (full)
│   │       │   │   └── trace-lab.css — 2 180 tokens (full)
│   │       │   └── main.css — 284 tokens (full)
│   │       ├── components/
│   │       │   ├── I18nContext.ts — 70 tokens (full)
│   │       │   ├── I18nProvider.tsx — 490 tokens (full)
│   │       │   └── useI18n.ts — 143 tokens (full)
│   │       ├── screens/
│   │       │   ├── Chat/
│   │       │   │   ├── Chat.tsx — 1 369 tokens (full)
│   │       │   │   └── types.ts — 851 tokens (full)
│   │       │   ├── Layout/
│   │       │   │   └── Layout.tsx — 3 572 tokens (full)
│   │       │   ├── Sessions/
│   │       │   │   ├── Sessions.test.tsx — 746 tokens (full)
│   │       │   │   └── Sessions.tsx — 2 945 tokens (full)
│   │       │   └── TraceLab/
│   │       │       ├── components/
│   │       │       │   └── TraceLabComponents.tsx — 1 959 tokens (full)
│   │       │       ├── TraceLab.tsx — 4 122 tokens (full)
│   │       │       ├── trace-lab.helpers.test.ts — 1 397 tokens (full)
│   │       │       ├── trace-lab.helpers.ts — 3 145 tokens (full)
│   │       │       └── trace-lab.types.ts — 817 tokens (full)
│   │       ├── test/
│   │       │   └── setup.ts — 43 tokens (full)
│   │       ├── App.tsx — 1 305 tokens (full)
│   │       └── main.tsx — 88 tokens (full)
│   └── shared/
│       ├── i18n/
│       │   ├── locales/
│       │   │   ├── en/
│       │   │   │   ├── navigation.ts — 81 tokens (full)
│       │   │   │   └── sessions.ts — 121 tokens (full)
│       │   │   ├── es/
│       │   │   │   ├── navigation.ts — 88 tokens (full)
│       │   │   │   └── sessions.ts — 131 tokens (full)
│       │   │   ├── pt-BR/
│       │   │   │   ├── navigation.ts — 87 tokens (full)
│       │   │   │   └── sessions.ts — 129 tokens (full)
│       │   │   └── zh-CN/
│       │   │       ├── navigation.ts — 80 tokens (full)
│       │   │       └── sessions.ts — 116 tokens (full)
│       │   ├── config.ts — 69 tokens (full)
│       │   ├── index.ts — 1 938 tokens (full)
│       │   └── types.ts — 35 tokens (full)
│       └── traces.ts — 417 tokens (full)
├── tests/
│   ├── chat-ipc-lifecycle.test.ts — 2 850 tokens (full)
│   ├── ipc-handlers.test.ts — 1 380 tokens (full)
│   ├── preload-api-surface.test.ts — 2 389 tokens (full)
│   └── trace-store.test.ts — 1 074 tokens (full)
├── package.json — 784 tokens (full)
└── vitest.config.ts — 126 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── hermes/
    │   │   └── types.ts — 174 tokens (auto)
    │   ├── install/
    │   │   └── paths.ts — 672 tokens (auto)
    │   └── ipc/
    │       └── types.ts — 44 tokens (auto)
    └── shared/
        ├── chat-metadata.ts — 466 tokens (auto)
        └── perf.ts — 203 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `trace-via-sessions-F057E8` | **Mode**: plan

### Response
## 1. **Summary**

Refactor Trace Lab from a standalone sidebar destination into a Sessions-launched trace surface. Remove the `Trace Lab` nav item, add per-session trace actions plus a Sessions-level “all trace activity” fallback, and update `TraceLab` to support a session-scoped mode that preselects/filter traces by session/profile while hiding its internal Recent activity list. This is best handled as a targeted renderer refactor plus helper/test/doc updates; no main/preload IPC or persistence changes are needed because `listTraceRuns()` already provides enough data for client-side filtering.

## 2. **Current-state analysis**

- `Layout.tsx` owns the app’s view routing via `View`, `NAV_ITEMS`, `visitedViews`, and `goTo()`. It currently exposes Trace Lab as a standalone sidebar route: `view: "traces"` renders `<TraceLab />`.
- `Sessions.tsx` is currently only a list/search/resume surface:
  - cached rows come from `listCachedSessions(50)` then `syncSessionCache()`;
  - search rows come from `searchSessions(query)`;
  - clicking a row calls `onResumeSession(sessionId, title, profile)`.
- `TraceLab.tsx` is monolithic:
  - loads all runs and skill runs from preload trace APIs;
  - groups runs with `buildTraceConversations(runs)`;
  - owns query/filter/selection state;
  - renders metrics, the left Recent activity list, the center timeline/detail, and the right inspector.
- Trace identity currently bridges Sessions to traces through:
  - `TraceRun.sessionId` on completed runs;
  - `session.resumed` event metadata/detail for resumed failed/aborted/running runs;
  - `run:<id>` fallback for non-session traces.
- Blocking issue: `buildTraceConversations()` groups only by session id, but Sessions rows are profile-aware. The refactor should disambiguate same `sessionId` across profiles in Trace Lab grouping.
- Reusable code:
  - keep existing trace IPC/preload APIs unchanged;
  - reuse `TraceLabComponents.tsx`;
  - extend `trace-lab.helpers.ts` instead of duplicating trace filtering logic in `Sessions`.

## 3. **Design**

### A. Layout routing

Modify `src/renderer/src/screens/Layout/Layout.tsx`.

#### View model

Remove `"traces"` from sidebar routing and add an internal, non-sidebar view:

```ts
type View =
  | "chat"
  | "sessions"
  | "traceDetail"
  | "agents"
  | ...;
```

Add local trace launch state:

```ts
type TraceLaunchState =
  | { mode: "all" }
  | {
      mode: "session";
      target: {
        sessionId: string;
        title?: string | null;
        profile?: string | null;
      };
    };
```

#### Navigation behavior

- Remove `{ view: "traces", icon: Activity, labelKey: "navigation.traces" }` from `NAV_ITEMS`.
- Keep the Sessions nav item visually active while `view === "traceDetail"`:

```ts
const navActive = view === v || (view === "traceDetail" && v === "sessions");
```

#### New handlers

Add:

```ts
handleOpenSessionTrace(sessionId, title, profile)
handleOpenAllTraces()
handleBackToSessions()
```

Behavior:

- `handleOpenSessionTrace` stores `{ mode: "session", target }` and calls `goTo("traceDetail")`.
- `handleOpenAllTraces` stores `{ mode: "all" }` and calls `goTo("traceDetail")`.
- `handleBackToSessions` calls `goTo("sessions")`.

#### Rendering

Add a hidden/internal pane:

```tsx
{visitedViews.has("traceDetail") && (
  <div style={paneStyle("traceDetail")}>
    <TraceLab
      mode={traceLaunch?.mode ?? "all"}
      sessionTarget={traceLaunch?.mode === "session" ? traceLaunch.target : null}
      onBackToSessions={handleBackToSessions}
    />
  </div>
)}
```

Pass new props into `Sessions`:

```tsx
<Sessions
  onResumeSession={handleResumeSession}
  onOpenSessionTrace={handleOpenSessionTrace}
  onOpenTraceActivity={handleOpenAllTraces}
  ...
/>
```

### B. Sessions trace affordance

Modify `src/renderer/src/screens/Sessions/Sessions.tsx`.

#### Props

Extend `SessionsProps`:

```ts
onOpenSessionTrace: (
  sessionId: string,
  title?: string | null,
  profile?: string,
) => void;
onOpenTraceActivity?: () => void;
```

#### Header affordance

In `.sessions-header-top`, render a secondary button before or beside “New Chat”:

- label: `t("sessions.traceActivity")`
- calls `onOpenTraceActivity`
- only render if prop exists.

#### Row affordance

Add a compact secondary action on both cached rows and search rows:

- visible label: `t("sessions.viewTraces")`
- icon: `Activity`
- callback:
  - cached: `onOpenSessionTrace(s.id, s.title, s.profile)`
  - search: `onOpenSessionTrace(r.sessionId, r.title, r.profile)`

Do **not** nest this button inside the existing row `<button>`. Refactor card markup to avoid invalid nested buttons:

- wrapper: `<div className="sessions-card ...">`
- primary resume button: `<button className="sessions-card-primary">...</button>`
- secondary trace button: `<button className="sessions-card-trace">...</button>`

The trace button must not call `onResumeSession`. Since it is no longer inside the primary button, no bubbling guard is required, but adding `event.stopPropagation()` is acceptable defensively.

### C. Trace Lab session-scoped mode

Modify `src/renderer/src/screens/TraceLab/TraceLab.tsx`.

#### Props

Add:

```ts
interface TraceLabProps {
  mode?: "all" | "session";
  sessionTarget?: {
    sessionId: string;
    title?: string | null;
    profile?: string | null;
  } | null;
  onBackToSessions?: () => void;
}
```

Default `mode` to `"all"`.

#### Data flow

Keep existing loading:

```ts
listTraceRuns()
listSkillTrainingRuns()
```

No new IPC required.

Derive conversations:

```ts
const conversations = buildTraceConversations(runs);

const scopedConversations =
  mode === "session" && sessionTarget
    ? filterTraceConversationsForSessionTarget(conversations, sessionTarget)
    : conversations;
```

Rules:

- In `"all"` mode:
  - keep existing query/filter/Recent activity behavior.
- In `"session"` mode:
  - ignore global query/filter controls;
  - hide the internal `trace-run-list`;
  - select the first matching scoped conversation;
  - show an empty state if none match.

#### Preselection lifecycle

When `mode`, `sessionTarget.sessionId`, `sessionTarget.profile`, or loaded conversations change:

- find first matching conversation;
- set `selectedConversationKey`;
- set `selectedEventRef` to the first event in that conversation timeline;
- clear both to `null` if no trace exists.

This prevents stale selected events when opening a second session after a first one.

#### Rendering

Add root variant class:

```tsx
<div className={`trace-lab ${isSessionMode ? "trace-lab--session" : ""}`}>
```

In session mode:

- header eyebrow: “Session Trace”
- title: `sessionTarget.title || selectedConversation?.title || short session id`
- show Back to Sessions button if `onBackToSessions` exists
- show Refresh button
- metrics should be scoped to the selected/matching session conversations
- workbench uses a two-column layout:
  - center detail/timeline/facts/skill summary
  - right inspector
- do not render `<aside className="trace-run-list">`.

In all mode:

- keep the existing Trace Lab header/list/detail/inspector behavior.
- optionally show Back to Sessions if launched from Sessions “Trace Activity”.

### D. Trace grouping and filtering helpers

Modify `src/renderer/src/screens/TraceLab/trace-lab.types.ts`.

Add to `TraceConversation`:

```ts
profiles: string[];
primaryProfile: string;
```

Add target type:

```ts
export type TraceSessionTarget = {
  sessionId: string;
  title?: string | null;
  profile?: string | null;
};
```

Modify `src/renderer/src/screens/TraceLab/trace-lab.helpers.ts`.

#### Profile-aware conversation identity

Change session-backed grouping from session-only to profile + session:

```ts
session:<normalizedProfile>:<sessionId>
```

Keep no-session fallback as:

```ts
run:<runId>
```

Rationale: Sessions already distinguishes duplicate session ids by profile; Trace Lab must not merge traces from different profile databases.

#### New helpers

Add:

```ts
normalizeTraceProfile(profile?: string | null): string;
traceConversationMatchesSessionTarget(
  conversation: TraceConversation,
  target: TraceSessionTarget,
): boolean;
filterTraceConversationsForSessionTarget(
  conversations: TraceConversation[],
  target: TraceSessionTarget,
): TraceConversation[];
```

Behavior:

- trim `target.sessionId`; empty target matches nothing.
- if `target.profile` is provided, require normalized profile match.
- if no profile is provided, match all conversations with that session id and return newest first.
- `session.resumed` metadata/detail must continue to count as session identity.

### E. Styling

Modify `src/renderer/src/assets/styles/sessions.css`.

Add styles for:

- `.sessions-header-actions`
- `.sessions-card` as a wrapper
- `.sessions-card-primary`
- `.sessions-card-trace`
- active state applied to wrapper: `.sessions-card--active`
- preserve existing visual spacing/tags/snippet styles.

Modify `src/renderer/src/assets/styles/trace-lab.css` and responsive rules.

Add:

```css
.trace-workbench--session {
  grid-template-columns: minmax(0, 1fr) minmax(310px, 380px);
}

.trace-lab--session .trace-run-list {
  display: none;
}
```

Add responsive override so the session variant stacks to one column under the same breakpoint as existing Trace Lab.

### F. i18n

Modify all locale files:

- `src/shared/i18n/locales/en/sessions.ts`
- `src/shared/i18n/locales/es/sessions.ts`
- `src/shared/i18n/locales/pt-BR/sessions.ts`
- `src/shared/i18n/locales/zh-CN/sessions.ts`

Add keys:

```ts
traceActivity
viewTraces
viewTracesAria
backToSessions
noSessionTraces
noSessionTracesHint
```

Remove `traces` from all `navigation.ts` locale files because it is no longer used by sidebar nav.

### G. Tests

#### Sessions tests

Extend `src/renderer/src/screens/Sessions/Sessions.test.tsx`.

Add coverage:

1. Cached row trace action:
   - clicking trace action calls `onOpenSessionTrace("session-shared", "Work session", "work")`;
   - does not call `onResumeSession`.
2. Search row trace action:
   - calls `onOpenSessionTrace("search-hit", "Search hit", "research")`;
   - does not resume.
3. Header trace activity button:
   - calls `onOpenTraceActivity`.

Update existing renders to pass `onOpenSessionTrace`.

#### Trace helper tests

Update `trace-lab.helpers.test.ts`.

Changes:

- update expected conversation keys from `session:<id>` to `session:<profile>:<id>`.
- add test for same session id in different profiles staying separate.
- add test that `filterTraceConversationsForSessionTarget()` matches:
  - direct `TraceRun.sessionId`;
  - `session.resumed` metadata fallback;
  - profile-specific target.

#### Layout routing test

Add `src/renderer/src/screens/Layout/Layout.test.tsx`.

Mock child screens to keep the test focused.

Assert:

- sidebar does not render the Trace Lab nav item;
- Sessions nav remains active when trace detail is open;
- mocked Sessions `onOpenSessionTrace` opens mocked `TraceLab` with `mode="session"` and correct target;
- mocked Sessions `onOpenTraceActivity` opens mocked `TraceLab` with `mode="all"`.

#### Optional TraceLab component test

Add `src/renderer/src/screens/TraceLab/TraceLab.test.tsx` if practical.

Mock `window.hermesAPI.listTraceRuns()` and `listSkillTrainingRuns()`.

Assert session mode:

- hides `aria-label="Trace conversations"`;
- renders only matching session/profile timeline evidence;
- shows empty state for a session with no traces.

## 4. **File-by-file impact**

### `src/renderer/src/screens/Layout/Layout.tsx`

- Remove `Activity` sidebar import/use.
- Remove `"traces"` from `View`.
- Add `"traceDetail"` internal view.
- Remove Trace Lab nav item.
- Add `traceLaunch` state and trace-opening handlers.
- Pass trace callbacks to `Sessions`.
- Render `<TraceLab />` only in `traceDetail` pane.
- Mark Sessions nav active while trace detail is open.

Depends on: TraceLab props, Sessions props.

### `src/renderer/src/screens/Sessions/Sessions.tsx`

- Extend props.
- Import `Activity`.
- Refactor session/search card markup to wrapper + primary button + secondary trace button.
- Add header “Trace Activity” button.
- Ensure trace action does not trigger resume.

Depends on: sessions CSS and locale keys.

### `src/renderer/src/screens/Sessions/Sessions.test.tsx`

- Update render props.
- Add trace action regression tests.

Depends on: Sessions component changes.

### `src/renderer/src/screens/TraceLab/TraceLab.tsx`

- Add props for mode/session target/back callback.
- Derive scoped conversations.
- Add preselection effect.
- Hide Recent activity list in session mode.
- Render scoped empty state.
- Add back button and session-scoped header/metrics.

Depends on: helper/type additions and CSS variant.

### `src/renderer/src/screens/TraceLab/trace-lab.types.ts`

- Add `TraceSessionTarget`.
- Add `profiles` and `primaryProfile` fields to `TraceConversation`.

Depends on: helper changes.

### `src/renderer/src/screens/TraceLab/trace-lab.helpers.ts`

- Make session grouping profile-aware.
- Populate new profile fields.
- Add target filtering helpers.

No persistence change.

### `src/renderer/src/screens/TraceLab/trace-lab.helpers.test.ts`

- Update expected keys.
- Add profile/session target filtering tests.

### `src/renderer/src/assets/styles/sessions.css`

- Add header action group styles.
- Convert `.sessions-card` to wrapper-compatible styles.
- Add `.sessions-card-primary` and `.sessions-card-trace`.

### `src/renderer/src/assets/styles/trace-lab.css`

- Add session variant and two-column workbench layout.
- Add responsive overrides.

### `src/shared/i18n/locales/*/sessions.ts`

- Add trace action/back/empty-state strings.

### `src/shared/i18n/locales/*/navigation.ts`

- Remove `traces`.

### `docs/contracts/trace-schema.md`

- Update Trace Lab presentation contract:
  - access via Sessions;
  - session grouping is profile + session id;
  - no schema migration.

### `docs/subsystems/chat-and-tracing.md`

- Update Trace Lab section:
  - no standalone sidebar route;
  - Sessions row opens session-scoped Trace Lab;
  - Sessions Trace Activity fallback opens all traces.

### `docs/trace-lab-visual-direction.md`

- Update implemented surface notes to mention Sessions-launched trace detail and hidden Recent activity list in session mode.

## 5. **Risks and migration**

- No stored trace schema migration is needed. The profile-aware grouping key is renderer-derived only.
- Existing persisted traces remain valid.
- Same-session-id traces across different profiles will now display as separate conversations instead of one merged conversation.
- Orphan/no-session traces remain reachable through the Sessions-level “Trace Activity” fallback, not through individual session rows.
- Avoid touching unrelated dirty worktree changes, especially perf telemetry and existing locale/common edits.

## 6. **Implementation order**

1. Update Trace Lab types/helpers and helper tests.
2. Update `TraceLab.tsx` to support `mode="session"` while preserving default all-mode behavior.
3. Add Trace Lab session variant CSS.
4. Refactor `Sessions.tsx` card/header affordances and update `sessions.css`.
5. Add locale keys and remove unused `navigation.traces`.
6. Update `Layout.tsx` routing: remove sidebar Trace Lab, add internal `traceDetail`, wire Sessions trace callbacks.
7. Add/update renderer tests for Sessions and Layout routing.
8. Update docs.
9. Run focused verification:

```bash
npm run test -- src/renderer/src/screens/Sessions/Sessions.test.tsx src/renderer/src/screens/TraceLab/trace-lab.helpers.test.ts src/renderer/src/screens/Layout/Layout.test.tsx
npm run typecheck
```

If no IPC/preload files change, `tests/ipc-handlers.test.ts` and `tests/preload-api-surface.test.ts` should not require updates.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "trace-via-sessions-F057E8", new_chat: false)
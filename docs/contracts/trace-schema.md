# Trace Schema Contract

This document describes Mercury's current trace/run schema, trace-store persistence behavior, structured chat events, local slash-command tracing, and skill-training derivation. It is grounded in `src/shared/traces.ts`, `src/main/trace-store.ts`, `src/main/ipc/chat.ts`, `src/main/hermes/trace-events.ts`, and `tests/trace-store.test.ts`.

## Source anchors

- Shared schema: `src/shared/traces.ts`
- Persistence and derivation: `src/main/trace-store.ts`
- Structured stream normalization: `src/main/hermes/trace-events.ts`
- Chat trace writes: `src/main/ipc/chat.ts`
- Trace IPC reads and local trace writes: `src/main/ipc/trace.ts`
- Renderer Trace Lab presentation: `src/renderer/src/screens/TraceLab/*`
- Contract test: `tests/trace-store.test.ts`

## Event types

`TraceEventType` allows these exact string values:

### Run and message lifecycle

- `run.started` — run was created for a user-visible goal.
- `message.user` — original user message preview.
- `message.agent.delta` — bounded agent response preview, including local responses.
- `message.history.loaded` — prior chat history was supplied to the request. Metadata describes counts, not raw message content.
- `session.resumed` — request resumed an existing Hermes session. Metadata may include `sessionId`.
- `slash.local` — renderer-handled slash command was recorded through the local trace API.
- `usage.recorded` — token/cost usage was accumulated on the run.
- `run.completed`, `run.failed`, `run.aborted` — terminal lifecycle events.

### Tool, delegation, approval, artifact, and transport events

- `tool.progress` — generic tool progress when no richer lifecycle status is available.
- `tool.started`, `tool.completed`, `tool.failed` — structured tool lifecycle events normalized from Hermes stream/CLI progress.
- `delegation.started`, `delegation.completed`, `delegation.failed` — delegated sub-agent work, normalized from tool progress whose label/name indicates delegation.
- `artifact.created` — generated artifact reference detected from Hermes stream metadata or response text. Metadata commonly includes `artifactType`, `source`, and either `url` or `path`.
- `approval.requested`, `approval.resolved` — approval checkpoints emitted by Hermes stream events.
- `transport.error` — chat transport/API/CLI failure evidence, distinct from tool failures.

### Skill events

- `skill.used`
- `skill.eval`
- `skill.promoted`
- `skill.rejected`

Only events whose type starts with `skill.` are converted into `SkillTrainingRun` entries by `listSkillTrainingRuns()`.

Unknown future event strings are not part of the TypeScript contract; Trace Lab falls back to generic labels only for defensive rendering of old stores or external edits.

## Shared interfaces

### `LocalChatTraceRequest`

Renderer-only chat commands that do not call Hermes can still create a trace through `recordLocalChatTrace(request)`.

Fields:

- `command: string` — local slash command or local prompt text to anchor the trace.
- `profile?: string` — profile label; defaults to `default` in the store.
- `responsePreview?: string` — optional local response preview recorded as `message.agent.delta`.
- `metadata?: Record<string, unknown>` — sanitized before persistence. Typical values include command name/category; secrets are redacted or dropped.

`createLocalChatTrace()` records `run.started`, `message.user`, `slash.local`, optional `message.agent.delta`, and terminal `run.completed` with detail `Handled locally in Mercury.`

### `TraceUsage`

Fields:

- `promptTokens: number`
- `completionTokens: number`
- `totalTokens: number`
- `cost?: number`
- `rateLimitRemaining?: number`
- `rateLimitReset?: number`

`recordTraceUsage()` accumulates token and cost totals onto the run's existing `usage` value. It replaces `rateLimitRemaining` and `rateLimitReset` with the latest provided values.

### `TraceEvent`

Fields:

- `id: string`
- `runId: string`
- `type: TraceEventType`
- `timestamp: number`
- `title: string`
- `detail?: string`
- `metadata?: Record<string, unknown>`

Events are created with `randomUUID()` ids and `Date.now()` timestamps in `src/main/trace-store.ts`.

### `TraceRun`

Fields:

- `id: string`
- `title: string`
- `profile: string`
- `status: "running" | "completed" | "failed" | "aborted"`
- `startedAt: number`
- `updatedAt: number`
- `sessionId?: string`
- `messagePreview: string`
- `events: TraceEvent[]`
- `usage?: TraceUsage`

`createTraceRun(message, profile)` sets `profile` to the provided profile or `default`. It compacts `message` into a run title capped to 72 characters and a message preview capped to the default compaction length.

### `SkillTrainingRun`

Fields:

- `id: string`
- `skillName: string`
- `status: "candidate" | "evaluating" | "needs-review" | "promoted" | "rejected"`
- `score?: number`
- `linkedRunId?: string`
- `summary: string`
- `updatedAt: number`

Skill-training runs are derived views over trace events, not a separate persisted top-level collection.

## Persistence file

`src/main/trace-store.ts` persists trace runs to:

```text
<HERMES_HOME>/desktop-traces.json
```

Store shape remains version 1; the richer event contract is additive and does not require migration:

```ts
interface TraceStoreData {
  version: 1;
  runs: TraceRun[];
}
```

Current persistence behavior:

- Missing, invalid, or unreadable stores are treated as `{ version: 1, runs: [] }`.
- Writes create the parent directory with `mkdirSync(dirname(STORE_PATH), { recursive: true })`.
- Writes sort runs by `updatedAt` descending.
- The persisted run list is capped to `MAX_RUNS = 200`.
- Per run, `message.agent.delta` events are capped to `MAX_AGENT_DELTA_EVENTS_PER_RUN = 80`; once the cap is reached, additional agent-delta writes update `run.updatedAt` but do not append a new event.
- Event titles/details and metadata are sanitized before persistence. Metadata keys matching API key/token/authorization/secret/password/credential patterns are dropped, and long strings/objects are compacted.

## Run lifecycle functions

### `createTraceRun(message, profile?)`

Creates a running `TraceRun`, prepends it to the store, and records two initial events:

1. `run.started` with title `Run started`, detail set to the message preview, and metadata `{ profile: run.profile }`.
2. `message.user` with title `User message` and detail set to the message preview.

### `recordTraceEvent(runId, type, title, detail?, metadata?)`

Reads the store, appends a sanitized event to the matching run, updates that run's `updatedAt`, and writes the store back. If the run does not exist, nothing is persisted.

### `createLocalChatTrace(request)`

Creates and completes a trace for renderer-handled local commands. It is exposed to the renderer through `window.hermesAPI.recordLocalChatTrace(...)` and IPC channel `record-local-chat-trace`.

### `recordTraceUsage(runId, usage)`

Finds the run, accumulates `usage` totals, records a `usage.recorded` event with the usage object as metadata, and writes the store. If the run does not exist, nothing is persisted.

### `finishTraceRun(runId, status, sessionId?, detail?)`

Finishes only runs that still have `status === "running"`. It sets the final status, optionally stores `sessionId`, appends one terminal event, and writes the store.

Terminal event mapping:

- `completed` -> `run.completed` with title `Run completed`
- `aborted` -> `run.aborted` with title `Run aborted`
- `failed` -> `run.failed` with title `Run failed`

### `listTraceRuns()` and `getTraceRun(runId)`

- `listTraceRuns()` returns runs sorted by `updatedAt` descending.
- `getTraceRun(runId)` returns the matching run or `null`.

### `listSkillTrainingRuns()`

Builds skill-training rows from all events whose `type` starts with `skill.` and sorts them by `updatedAt` descending.

Derived fields:

- `id`: event id
- `skillName`: `String(event.metadata?.skillName || event.title || "Unknown skill")`
- `status`: derived by `skillStatusFromEvent(event.type, event.metadata)`
- `score`: parsed/clamped by `skillScoreFromEvent(event.metadata?.score)`
- `linkedRunId`: parent trace run id
- `summary`: `event.detail || run.title`
- `updatedAt`: event timestamp

## Structured chat trace writes

`src/main/ipc/chat.ts` writes trace data during `send-message`:

- Creates a trace run before dispatching the chat request.
- Records `session.resumed` when a `resumeSessionId` is supplied.
- Records `message.history.loaded` when non-empty history is supplied; only role/count metadata is persisted.
- On structured Hermes trace callbacks, records tool/delegation/approval/artifact/transport events.
- On tool progress, continues to emit `chat-tool-progress` for renderer UI compatibility and records a legacy `tool.progress` fallback when needed.
- On the first non-empty agent chunk, records `message.agent.delta` with title `Agent response started` and a bounded preview.
- On completion with a non-empty full response, records `message.agent.delta` with title `Agent response completed` and a bounded preview.
- On completion, scans the final response for image/artifact references and records `artifact.created` when detected.
- On completion, finishes the run as `completed` with the session id and detail `Hermes returned a completed response.`
- On transport/model/API/CLI error, records `transport.error` and finishes the run as `failed`.
- On user abort, finishes the run as `aborted` with detail `User stopped the active Hermes run.`
- If a new message supersedes an active chat, aborts the previous handle and finishes the previous trace run as `aborted` with detail `Superseded by a new Hermes message.`
- On usage, calls `recordTraceUsage()` and emits `chat-usage`.

`src/main/hermes/trace-events.ts` is responsible for normalizing stream/CLI progress and response artifact references into trace callback events. It also sanitizes metadata before events reach the store.

## Trace Lab presentation contract

Trace Lab renders the richer contract in `src/renderer/src/screens/TraceLab/*`:

- `trace-lab.types.ts` owns labels and icons for every current event type.
- `trace-lab.helpers.ts` builds the run map. Ask and Answer always render; Context, Approval, Tool Calls, Delegation, Files Edited, Artifacts, and Skill Notes appear only when matching events exist.
- Search includes run fields, event title/detail/type, and JSON-stringified metadata.
- `EventInspector` explains each structured event type, renders metadata values safely, and shows an artifact card for `artifact.created` events.
- Artifact cards do not auto-load remote URLs. They display the reference and use the existing `window.hermesAPI.openExternal(...)` shell API when the metadata provides an `http(s)://`, `file://`, or absolute local path reference.

## Skill status and score derivation

`skillStatusFromEvent(...)` maps status as follows:

1. If `metadata.status` or `metadata.reviewStatus` stringifies to `needs-review`, status is `needs-review`.
2. `skill.promoted` maps to `promoted`.
3. `skill.rejected` maps to `rejected`.
4. `skill.eval` maps to `evaluating`.
5. Other `skill.*` events map to `candidate`.

`skillScoreFromEvent(...)` accepts numeric values or values coercible with `Number(...)`. Non-finite values become `undefined`; finite scores are clamped to `[0, 1]`.

## Contract tests

`tests/trace-store.test.ts` verifies skill derivation and focused trace persistence behavior, including the additive structured event/local trace contract. Run it when changing trace schemas, trace persistence, trace event writes, or Trace Lab assumptions:

```bash
npm run test -- tests/trace-store.test.ts
npm run typecheck
```

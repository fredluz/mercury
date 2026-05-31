# Hermes API Hardening Docs Validation, 2026-05-29

Scope: validate only the new "Planned evolution" sections in:

- `docs/subsystems/connection-modes.md`
- `docs/subsystems/chat-and-tracing.md`
- `docs/subsystems/storage-and-profiles.md`

Sources checked: the approved spec, `docs/investigations/hermes-api-server-surface-2026-05-29.md`, the real `src/` implementation, and the two referenced investigations.

Status update — 2026-05-31: this validation is historical. Its "current chat execution" and readiness claims reflected the 2026-05-29 implementation. The final Hermes gateway/runtime fixes moved chat to `/v1/runs`, readiness/capability checks to authenticated `/v1/capabilities`, kept `/api/sessions` as required runtime surface, rejected `/v1/chat/completions`/runs-only compatibility fallback, refreshed pid-file-only gateways, generated persisted per-profile `API_SERVER_KEY` values, and forced API env after profile env merge.

## Findings

### 1. Empty-toolset YAML is described as current, but source now writes `[]`

1. Claim location: `docs/subsystems/chat-and-tracing.md:441`, section "Planned evolution: runs-based execution and error remediation".
2. What the doc says: empty-toolset toggles serialize as bare YAML keys that parse as `null`, and Mercury should rewrite config as `[]`.
3. What the code/report actually shows: the NoneType investigation records the old hardening gap at `docs/investigations/send-message-nonetype-not-iterable-2026-05-29.md:30-35` and `:66-70`, but current code has already changed. Local `platformToolsetSection()` returns `  ${platform}: []` when empty (`src/main/tools.ts:165-167`), and SSH writes `cli: []` / `api_server: []` when empty (`src/main/ssh/config.ts:77-80`).
4. Verdict: WRONG.
5. Suggested fix: change the current-state wording to say this was a documented prior hardening gap in the investigation, but current source already serializes empty toolsets as `[]`. If the remediation engine should still detect legacy configs on disk, say "legacy bare-key configs" instead of "toggles serialized as bare YAML keys."

### 2. `activeChatRun` is attributed to the main process generally, but the implementation lives in the shared chat service

1. Claim location: `docs/subsystems/chat-and-tracing.md:405` and `:424`, section "Planned evolution: runs-based execution and error remediation".
2. What the doc says: the main process tracks exactly one `activeChatRun`.
3. What the code/report actually shows: this is behaviorally accurate, but `activeChatRun` is in `src/main/services/chat-service.ts:72`, not `src/main/ipc/chat.ts`. IPC delegates `send-message` to `runChatMessage(...)` (`src/main/ipc/chat.ts:49-100`) and exposes shutdown abort through `abortActiveChatRun(...)` (`src/main/ipc/chat.ts:37-39`).
4. Verdict: IMPRECISE.
5. Suggested fix: name `src/main/services/chat-service.ts` as the owner and describe `src/main/ipc/chat.ts` as the IPC adapter.

### 3. "Malformed header" overstates when `updateSessionProfile(...)` is skipped

1. Claim location: `docs/subsystems/storage-and-profiles.md:351`, section "Planned evolution: explicit session lifecycle via the Sessions API".
2. What the doc says: when the `x-hermes-session-id` header is missing or malformed, `updateSessionProfile(...)` is skipped entirely.
3. What the code/report actually shows: current `readHermesSessionIdHeader()` accepts string and array-shaped headers (`src/main/hermes/chat-api.ts:145-164`), and tests cover both string and array capture (`tests/chat-role-runtime.test.ts:171-210`). `updateSessionProfile(...)` is skipped only when the completed service callback has no truthy `sessionId` (`src/main/services/chat-service.ts:342-358`), which can result from a missing, empty, unsupported, or all-empty array header.
4. Verdict: IMPRECISE.
5. Suggested fix: replace "missing or malformed" with "missing, empty, unsupported, or otherwise unresolved after header parsing."

### 4. Current session identity is more nuanced for resumed chats

1. Claim location: `docs/subsystems/storage-and-profiles.md:351` and `docs/subsystems/chat-and-tracing.md:405`.
2. What the doc says: session identity arrives only as the `x-hermes-session-id` response header on the first send.
3. What the code/report actually shows: for brand-new chats, that is accurate. For resumed chats, `sendMessageViaVerifiedApi()` initializes `sessionId` from `_resumeSessionId` (`src/main/hermes/chat-api.ts:218`) and completion can return that even without a new header (`src/main/hermes/chat-api.ts:239-247`). The current gap remains that the request body does not send an explicit session id upstream (`src/main/hermes/chat-api.ts:207-211`), matching the persistence investigation's root cause (`docs/investigations/agent-new-chat-persistence-2026-05-26.md:105-113`).
4. Verdict: IMPRECISE.
5. Suggested fix: say "for brand-new chats, Mercury learns the durable session id from the response header; resumed chats carry a local `resumeSessionId` fallback, but the API request does not bind it explicitly."

### 5. Session "resume" is not an explicit API endpoint in the surface report

1. Claim location: `docs/subsystems/storage-and-profiles.md:355`, section "Planned evolution: explicit session lifecycle via the Sessions API".
2. What the doc says: "Explicit create/resume at new-chat time" through the session resource API.
3. What the code/report actually shows: the API report supports create (`POST /api/sessions`, `docs/investigations/hermes-api-server-surface-2026-05-29.md:715-748`), read/resume-by-id (`GET /api/sessions/{session_id}`, `:750-768`), history (`GET /api/sessions/{session_id}/messages`, `:822-840`), fork (`POST /api/sessions/{session_id}/fork`, `:842-874`), update title/end_reason (`PATCH /api/sessions/{session_id}`, `:770-800`), and delete (`DELETE /api/sessions/{session_id}`, `:802-820`). There is no separate `POST /api/sessions/{id}/resume` endpoint.
4. Verdict: UNDERSPECIFIED.
5. Suggested fix: define resume as "load or validate an existing session via `GET /api/sessions/{session_id}` and bind subsequent `/v1/runs` with `session_id`." Avoid implying a dedicated resume endpoint.

### 6. "Rename" should be tied to `PATCH title`, not a named rename endpoint

1. Claim location: `docs/subsystems/storage-and-profiles.md:356`, section "Planned evolution: explicit session lifecycle via the Sessions API".
2. What the doc says: server-side list/history/fork/rename/delete go through the session resource API.
3. What the code/report actually shows: the API report supports session title update through `PATCH /api/sessions/{session_id}` with `title` and `end_reason` only (`docs/investigations/hermes-api-server-surface-2026-05-29.md:770-800`). It does not expose a `/rename` endpoint.
4. Verdict: IMPRECISE.
5. Suggested fix: write "title update (`PATCH /api/sessions/{session_id}`)" instead of "rename", or parenthesize rename as the UI concept.

### 7. Run event stream shape should mention unnamed SSE `data:` events

1. Claim location: `docs/subsystems/chat-and-tracing.md:409-420`, section "Runs replace the chat-completions stream".
2. What the doc says: subscribe to `GET /v1/runs/{run_id}/events` SSE and map events named `message.delta`, `tool.started`, `tool.completed`, `reasoning.available`, `approval.request`, `approval.responded`, `run.completed`, `run.failed`, and `run.cancelled`.
3. What the code/report actually shows: the event names are supported, but the SSE stream uses default unnamed `data:` events whose JSON payload has an `event` field (`docs/investigations/hermes-api-server-surface-2026-05-29.md:1067-1093`). This differs from the session chat stream, which uses explicit `event:` lines (`:938-973`).
4. Verdict: UNDERSPECIFIED.
5. Suggested fix: add one sentence: "The runs SSE stream uses unnamed SSE messages; parse `JSON.parse(data).event`, not the SSE `event:` field."

## Validated accurate claims

- Current chat execution is a single OpenAI-style `POST /v1/chat/completions` stream in `sendMessageViaApi(...)`: request body is `{ model, messages, stream: true }` at `src/main/hermes/chat-api.ts:207-211`, sent to `/v1/chat/completions` at `src/main/hermes/chat-api.ts:374-383`.
- Abort is global today: each `runChatMessage(...)` starts by aborting the current run (`src/main/services/chat-service.ts:174-182`), `abortCurrentRun(...)` clears the single `activeChatRun` (`src/main/services/chat-service.ts:109-120`), and the API transport aborts one `AbortController` (`src/main/hermes/chat-api.ts:475-478`).
- Streaming errors are currently undifferentiated and can trigger a non-streaming re-probe: SSE errors, non-200 responses, request errors, empty streams, and probe fallback all converge through `finish(...)` / `cb.onError(...)` (`src/main/hermes/chat-api.ts:239-247`, `:250-298`, `:319-328`, `:393-407`, `:443-454`). The API report confirms streaming chat can omit the provider error and runs expose cleaner `run.failed.error` (`docs/investigations/hermes-api-server-surface-2026-05-29.md:488-490`, `:1402-1417`).
- Readiness/revalidation uses the one-token chat-completions probe and does not call `/v1/capabilities` or `/v1/models`: `system-service.ts` calls `probeChatCompletionViaApi(...)` (`src/main/services/system-service.ts:27-45`), and that probe posts to `/v1/chat/completions` with `max_tokens: 1` (`src/main/hermes/chat-api.ts:78-133`).
- Codex auth recovery is a string-match heuristic requiring manual retry today: `detectCodexAuthRecovery(...)` checks provider `openai-codex` and refresh-token substrings (`src/shared/codex-auth-recovery.ts:35-75`), and the current doc states users retry manually after reauthentication (`docs/subsystems/chat-and-tracing.md:213`).
- `GET /v1/capabilities` exists with `features.run_submission`, `session_resources`, `run_events_sse`, `run_stop`, `run_approval_response`, and session header names, plus the documented 401 `invalid_api_key` envelope (`docs/investigations/hermes-api-server-surface-2026-05-29.md:46-59`, `:189-263`).
- Structured runs are supported as described: `POST /v1/runs` returns `run_id` with 202 and accepts `session_id` (`docs/investigations/hermes-api-server-surface-2026-05-29.md:987-1035`); `GET /v1/runs/{run_id}/events` emits the named lifecycle events with clean `run.failed.error` (`:1067-1111`); `GET /v1/runs/{run_id}` exposes status and terminal `error` (`:1037-1065`).
- Run approval and stop endpoints are supported: `POST /v1/runs/{run_id}/approval` accepts `once | session | always | deny` plus aliases and `all` / `resolve_all` (`docs/investigations/hermes-api-server-surface-2026-05-29.md:1113-1151`), and `POST /v1/runs/{run_id}/stop` returns `status: "stopping"` (`:1153-1174`).
- The 10 concurrent run cap and 429 behavior are supported: `Max concurrent runs: 10` and 429 `rate_limit_exceeded` are documented at `docs/investigations/hermes-api-server-surface-2026-05-29.md:1013-1033`.
- Runs can bind a `session_id`, and the session resource API supports create/list/history/fork/title update/delete via the endpoints cited above.

## Overall Verdict

The planned sections are directionally aligned with the approved spec and the authoritative Hermes API report. The API endpoint names and run lifecycle are mostly correct. The fixes needed are localized: update drift around empty-toolset serialization, tighten session/header wording, and spell out exact session/runs API shapes where an implementing agent could otherwise infer the wrong endpoint or SSE parser.

Summary: 7 findings (1 wrong, 4 imprecise, 2 underspecified)

Overall verdict: NEEDS-FIXES

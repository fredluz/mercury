# IPC and Preload Contract

This document describes Mercury's current renderer-to-main contract. It is an evergreen reference for `window.hermesAPI`, preload API fragments, IPC channel ownership, event channels, and required update rules.

## Source anchors

- Preload exposure: `src/preload/index.ts`
- Preload fragments: `src/preload/api/index.ts`, `src/preload/api/*.ts`
- Chat preload fragment: `src/preload/api/chat.ts`
- Renderer-facing types: `src/preload/index.d.ts`
- IPC composition: `src/main/ipc/index.ts`
- Chat IPC handlers and event senders: `src/main/ipc/chat.ts`
- IPC modules: `src/main/ipc/*.ts`
- Main updater/menu handlers: `src/main/index.ts`
- Performance telemetry helpers: `src/main/perf/telemetry.ts`, `src/renderer/src/perf.ts`, `src/shared/perf.ts`
- Renderer entrypoints that consume the contract: `src/renderer/src/App.tsx`, `src/renderer/src/screens/Layout/Layout.tsx`, `src/renderer/src/screens/Chat/hooks/useChatController.ts`
- Contract tests: `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`, `tests/chat-ipc-lifecycle.test.ts`

## Contract shape

The renderer-facing contract is `window.hermesAPI`.

Implementation is split across three layers:

1. `src/preload/api/*.ts` defines grouped API fragments that call `ipcRenderer.invoke(...)` for request/response channels and `ipcRenderer.on(...)` for event listeners.
2. `src/preload/api/index.ts` composes the fragments into one `hermesAPI` object.
3. `src/preload/index.ts` exposes `hermesAPI` to the renderer with `contextBridge.exposeInMainWorld("hermesAPI", hermesAPI)` when context isolation is enabled.

The type contract lives in `src/preload/index.d.ts` as `interface HermesAPI` and `window.hermesAPI` declarations. Renderer code should treat that interface as the stable API surface.

## Preload fragments

Current fragments in `src/preload/api/index.ts` are:

| Fragment | File | Main areas |
| --- | --- | --- |
| `installApi` | `src/preload/api/install.ts` | install checks, installer progress, Hermes version/doctor/update, OpenClaw migration, locale |
| `configApi` | `src/preload/api/config.ts` | env/config/model config, connection mode, remote/SSH tests, SSH tunnel controls |
| `chatApi` | `src/preload/api/chat.ts` | send/abort chat, generated chat titles, local trace recording, chat stream listeners, and live activity trace events |
| `navigationApi` | `src/preload/api/navigation.ts` | traces, gateway/platform toggles, sessions, profiles |
| `knowledgeApi` | `src/preload/api/knowledge.ts` | memory, user profile, soul, tools, skills, Markdown skill import |
| `modelsApi` | `src/preload/api/models.ts` | session cache/search, credential pool, models, Claw3D |
| `appApi` | `src/preload/api/app.ts` | updates, menu events, cron jobs, shell, backup/import, dump/log/system helpers, local perf telemetry |

## IPC composition and handler ownership

`src/main/ipc/index.ts` registers domain modules through `registerIpcHandlers(context)`:

| Main IPC module | Responsibility |
| --- | --- |
| `src/main/ipc/install.ts` | installation, verification, Hermes version/doctor/update, OpenClaw migration, install progress events |
| `src/main/ipc/config.ts` | profile-aware env/config/model settings, locale, connection mode, remote/SSH tests, SSH tunnel controls |
| `src/main/ipc/chat.ts` | `send-message`, `generate-chat-title`, `abort-chat`, chat stream events, active-chat abort handling, title persistence, trace run writes, and live chat activity events |
| `src/main/ipc/trace.ts` | trace run reads, skill-training run reads, and local chat trace writes |
| `src/main/ipc/gateway.ts` | gateway lifecycle and platform toggles |
| `src/main/ipc/sessions.ts` | sessions, profiles, session cache sync, session search |
| `src/main/ipc/knowledge.ts` | memory, user profile, soul, tools, skills, skill Markdown import |
| `src/main/ipc/models.ts` | credential pool and model CRUD |
| `src/main/ipc/claw3d.ts` | Claw3D status/setup/config/start/stop/logs and setup progress events |
| `src/main/ipc/cron.ts` | cron job listing and lifecycle actions |
| `src/main/ipc/system.ts` | external URLs, backup/import, debug dump, MCP servers, memory providers, logs, local perf telemetry |

`src/main/index.ts` also registers updater/version invoke handlers in `setupUpdater()` and sends native menu/update events to the renderer.

## Channel categories

### Request/response invoke channels

Most preload methods use `ipcRenderer.invoke("kebab-case-channel", ...)` and are handled by `ipcMain.handle("kebab-case-channel", ...)` in the main process.

Examples by domain:

- Install/version/update: `check-install`, `verify-install`, `start-install`, `get-hermes-version`, `refresh-hermes-version`, `run-hermes-doctor`, `run-hermes-update`, `check-openclaw`, `run-claw-migrate`, `get-locale`, `set-locale`, `get-app-version`, `check-for-updates`, `download-update`, `install-update`.
- Config/connection: `get-env`, `set-env`, `get-config`, `set-config`, `get-hermes-home`, `get-model-config`, `set-model-config`, `is-remote-mode`, `is-remote-only-mode`, `get-connection-config`, `set-connection-config`, `set-ssh-config`, `test-remote-connection`, `test-ssh-connection`, `is-ssh-tunnel-active`, `start-ssh-tunnel`, `stop-ssh-tunnel`.
- Chat: `send-message`, `generate-chat-title`, `abort-chat`.
- Trace Lab: `list-trace-runs`, `get-trace-run`, `list-skill-training-runs`, `record-local-chat-trace`.
- Gateway/platform: `start-gateway`, `stop-gateway`, `gateway-status`, `get-platform-enabled`, `set-platform-enabled`.
- Sessions/profiles/cache/search: `list-sessions`, `get-session-messages`, `list-profiles`, `create-profile`, `delete-profile`, `set-active-profile`, `list-cached-sessions`, `sync-session-cache`, `update-session-title`, `search-sessions`.
- Knowledge/skills: `read-memory`, `add-memory-entry`, `update-memory-entry`, `remove-memory-entry`, `write-user-profile`, `read-soul`, `write-soul`, `reset-soul`, `get-toolsets`, `set-toolset-enabled`, `list-installed-skills`, `list-bundled-skills`, `get-skill-content`, `install-skill`, `uninstall-skill`, `import-skill-markdown`.
- Models/credentials: `get-credential-pool`, `set-credential-pool`, `list-models`, `add-model`, `remove-model`, `update-model`.
- Claw3D: `claw3d-status`, `claw3d-setup`, `claw3d-get-port`, `claw3d-set-port`, `claw3d-get-ws-url`, `claw3d-set-ws-url`, `claw3d-start-all`, `claw3d-stop-all`, `claw3d-get-logs`, `claw3d-start-dev`, `claw3d-stop-dev`, `claw3d-start-adapter`, `claw3d-stop-adapter`.
- Cron/system/perf: `list-cron-jobs`, `create-cron-job`, `remove-cron-job`, `pause-cron-job`, `resume-cron-job`, `trigger-cron-job`, `open-external`, `run-hermes-backup`, `run-hermes-import`, `run-hermes-dump`, `discover-memory-providers`, `list-mcp-servers`, `read-logs`, `get-perf-telemetry-config`, `record-perf-event`.

### Chat preload API

`window.hermesAPI` exposes these chat methods from `src/preload/api/chat.ts` and `src/preload/index.d.ts`:

| Preload method | IPC channel | Notes |
| --- | --- | --- |
| `sendMessage(message, profile?, resumeSessionId?, history?)` | `send-message` | Starts or resumes a Hermes chat run and streams renderer events while the returned promise settles with `{ response, sessionId? }`. |
| `abortChat()` | `abort-chat` | Aborts the active run, if any, and finalizes the active trace as aborted. |
| `generateChatTitle(request)` | `generate-chat-title` | Validates and normalizes a `GenerateChatTitleRequest`, prepares the chat backend, generates or falls back to a sanitized title, and persists it with `updateSessionTitle(sessionId, title, profile)` when a session id is supplied. |
| `recordLocalChatTrace(request)` | `record-local-chat-trace` | Records local slash-command telemetry without calling Hermes. |
| `onChatChunk(callback)` | `chat-chunk` | Streams assistant text chunks. |
| `onChatDone(callback)` | `chat-done` | Reports terminal success/abort and the resolved session id when available. |
| `onChatToolProgress(callback)` | `chat-tool-progress` | Legacy progress-label compatibility channel. Structured activity should prefer `onChatTraceEvent`. |
| `onChatTraceEvent(callback)` | `chat-trace-event` | Streams persisted live activity `TraceEvent`s for tool, delegation, artifact, approval, and transport-error events. |
| `onChatUsage(callback)` | `chat-usage` | Streams token/cost/rate-limit usage updates. |
| `onChatError(callback)` | `chat-error` | Streams visible chat errors. |

Every listener API returns a cleanup function that removes its `ipcRenderer` listener. Renderer code should register these listeners once per component lifecycle and call all returned cleanups on unmount.

`generateChatTitle(request)` uses `GenerateChatTitleRequest` from `src/shared/chat-metadata.ts`:

- `profile?: string`
- `sessionId?: string`
- `messages: Array<{ role: "user" | "agent" | "assistant"; content: string }>`

The main handler rejects invalid request shapes before normalization. Title generation is best-effort from the renderer perspective: `useChatController` keeps the conversation usable when IPC/model title generation fails.

### Trace Lab local trace API

`window.hermesAPI.recordLocalChatTrace(request)` is the renderer-visible API for chat actions that are handled locally and never call the Hermes backend. It invokes `record-local-chat-trace` in `src/main/ipc/trace.ts` and returns the completed `TraceRun`.

Request type: `LocalChatTraceRequest` from `src/shared/traces.ts`.

Fields:

- `command: string` — local slash command or command-like prompt.
- `profile?: string` — optional profile name.
- `responsePreview?: string` — optional renderer-generated response preview.
- `metadata?: Record<string, unknown>` — optional sanitized metadata.

The handler creates a normal trace run, records `slash.local`, optionally records a local `message.agent.delta`, and immediately finishes the run as `completed`. Renderer code should treat this as best-effort telemetry and should not block local command UX on trace failures.

### Local performance telemetry API

`window.hermesAPI` exposes two local diagnostics methods from `src/preload/api/app.ts` and `src/preload/index.d.ts`:

| Preload method | IPC channel | Notes |
| --- | --- | --- |
| `getPerfTelemetryConfig()` | `get-perf-telemetry-config` | Returns whether local telemetry is enabled and the optional run id/sample config. It is enabled only by `MERCURY_PERF_DIAG=1` or sessions-only `MERCURY_SESSIONS_DIAG=1`. |
| `recordPerfEvent(event)` | `record-perf-event` | Sends sanitized renderer timing marks/measures to the main telemetry writer. It returns `false` when telemetry is disabled or the event shape is invalid. |

These channels are local-only diagnostics, not external analytics. Renderer callers should use `src/renderer/src/perf.ts` rather than calling `recordPerfEvent` directly. Event metadata must be limited to timings, counts, lengths, route/screen names, and booleans; do not include prompt text, assistant text, raw SSH commands, credentials, tokens, URLs with secrets, file contents, or stderr/stdout. Main-side sanitization in `src/main/perf/telemetry.ts` is a safety net, not permission to send sensitive fields.

### Main-to-renderer event channels

Current event channels exposed through preload listeners include:

- Chat streaming: `chat-chunk`, `chat-done`, `chat-tool-progress`, `chat-trace-event`, `chat-usage`, `chat-error`.
- Installer/update/migration progress: `install-progress`.
- Auto-update state: `update-available`, `update-download-progress`, `update-downloaded`.
- Native menu actions: `menu-new-chat`, `menu-search-sessions`.
- Claw3D setup progress: `claw3d-setup-progress`.

`chat-trace-event` is sent only for live activity event types accepted by `src/main/ipc/chat.ts`: `tool.*`, `delegation.*`, `artifact.created`, `approval.*`, and `transport.error`. The persisted `TraceEvent` object is sent after the main process records it, so renderer activity cards can share ids, run ids, timestamps, titles, details, and metadata with Trace Lab.

`chat-tool-progress` remains exposed for older renderer/UI compatibility and compact progress labels. New structured transports should emit trace callbacks (`onTraceEvent`) so the renderer receives `chat-trace-event`; the main process suppresses duplicate legacy `tool.progress` records when a structured tool/delegation event immediately precedes a legacy progress label.

`src/main/index.ts` also sends `update-error` from updater error handling. At the time of this document, no preload listener is exposed for that channel in `src/preload/api/app.ts` or `src/preload/index.d.ts`; do not assume renderer code handles it unless the contract is expanded.

## Local, remote, and SSH notes

Connection-mode behavior is distributed across IPC handlers and main services:

- `src/main/ipc/config.ts` exposes `is-remote-mode`, `is-remote-only-mode`, `get-connection-config`, remote connection tests, SSH connection tests, and tunnel start/stop controls.
- Several handlers branch on `getConnectionConfig()`:
  - `config.ts` uses SSH implementations for remote env/config/model/Hermes-home reads and writes when mode is `ssh`.
  - `install.ts` uses SSH implementations for Hermes version/doctor/update when mode is `ssh`.
  - `knowledge.ts` uses SSH implementations for memory/soul/tools/skills when mode is `ssh`, rejects manual Markdown skill import in pure `remote` mode, and returns a gateway restart warning after successful local/SSH skill import when the gateway is running.
  - `chat.ts` ensures SSH tunnel/gateway readiness for SSH chat and lazy-starts the local gateway when not remote and not already running.
- `src/renderer/src/screens/Layout/Layout.tsx` uses `window.hermesAPI.isRemoteOnlyMode()` to gate filesystem-backed screens in pure remote HTTP mode. The source comment notes that SSH tunnel mode has full access and is not treated as remote-only by that renderer check.

Future subsystem detail belongs in the planned connection-mode and storage/profile docs linked from `docs/index.md`.

## Change rules

When adding, renaming, or removing a renderer-visible capability, update all affected layers together:

1. **Preload implementation** — add/update the method in the correct `src/preload/api/*.ts` fragment or add a new fragment and spread it from `src/preload/api/index.ts`.
2. **Type contract** — update `interface HermesAPI` in `src/preload/index.d.ts` with the exact method name, arguments, and return type used by renderer code.
3. **Main handler** — add/update the matching `ipcMain.handle(...)` in the correct `src/main/ipc/*.ts` module, or in `src/main/index.ts` for updater/version channels currently owned there.
4. **IPC composition** — if a new IPC module is added, export its `register*Ipc` function and call it from `src/main/ipc/index.ts`.
5. **Event listeners** — for `ipcRenderer.on(...)` APIs, expose a cleanup-returning preload method and document the main sender (`event.sender.send(...)` or `mainWindow.webContents.send(...)`).
6. **Tests** — update and run the parity tests described in [Contract tests](../testing/contract-tests.md).
7. **Docs** — update this document and any relevant architecture/subsystem docs in the same change.

Do not add renderer code that imports main-process modules directly. Renderer access should go through `window.hermesAPI`.

## Verification guidance

For IPC/preload changes, run:

```bash
npm run test -- tests/perf-telemetry.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/chat-ipc-lifecycle.test.ts
npm run typecheck
```

For broader changes that touch storage, trace, skill import, or session cache behavior, also run the relevant contract tests listed in [Contract tests](../testing/contract-tests.md). For docs-only edits to this file, manually verify all referenced file paths and links.

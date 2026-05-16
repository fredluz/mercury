## Final Prompt
<taskname="Perf Telemetry"/>
<task>
Add practical performance benchmarks and local/opt-in telemetry scaffolding to Mercury, building on the prior rewrite evaluation. This is an implementation-planning task for sub-agents: produce a concrete, batchable sub-agent work plan that can lead to code changes for benchmarks/telemetry, not just another rewrite analysis. Avoid invasive external analytics; prefer local dev artifacts, env-flagged instrumentation, deterministic benchmark scripts/tests, and docs that distinguish measured evidence from inference.

Target missing measurements from the evaluation: cold start wall-clock, main/renderer startup timing, memory/RSS, chat stream render latency/jank, trace-store stress/write cost, large session DB/search scale, SSH/remote latency, and build/bundle size refresh.
</task>

<architecture>
Mercury is an Electron/Vite/React desktop wrapper around Hermes. Main process startup is in `src/main/index.ts`; IPC registration is composed by `src/main/ipc/index.ts`; preload exposes `window.hermesAPI` through `src/preload/api/*` and `src/preload/index.d.ts`; renderer boot flows through `src/renderer/src/main.tsx`, `App.tsx`, `Layout.tsx`, then screen components.

Existing performance evidence lives in `docs/performance-audit.md`. Existing benchmark/telemetry precedent is strongest in `scripts/e2e-sessions-latency.mjs` and `tests/sessions-local-latency.bench.test.ts`: both use local artifacts under `prompt-exports/sessions-latency-runs/`, isolated `HERMES_HOME` data, `performance.now()`, summary stats, and opt-in env flags. `src/main/ipc/sessions.ts` already has opt-in NDJSON diagnostics via `MERCURY_SESSIONS_DIAG` and `MERCURY_SESSIONS_DIAG_FILE`.

Potential implementation areas:
- Startup/process telemetry: `src/main/index.ts`, `src/preload/api/app.ts`, `src/preload/index.d.ts`, `src/renderer/src/App.tsx`, `Layout.tsx`.
- IPC timing: existing pattern in `src/main/ipc/sessions.ts`; broader IPC composition in `src/main/ipc/index.ts`; app/system handlers in `src/main/ipc/system.ts` if a dev-only telemetry read/export API is added.
- Chat stream/runtime telemetry: `src/main/ipc/chat.ts` -> `src/main/hermes.ts` -> `src/main/hermes/gateway.ts` -> `chat-api.ts` or `chat-cli.ts`; renderer handling in `useChatController.ts`, `Chat.tsx`, `MessageRow.tsx`, `AgentMarkdown.tsx`.
- Trace persistence stress: `src/main/trace-store.ts` rewrites capped `desktop-traces.json` for create/event/usage/finish; tests in `tests/trace-store.test.ts`.
- Sessions scale: `src/main/session-cache.ts`, `src/main/sessions.ts`, `src/main/session-db.ts`, `src/main/ipc/sessions.ts`; existing benchmark and tests selected.
- SSH/remote latency: `src/main/ssh-tunnel.ts`, `ssh-remote.ts`, and `src/main/ssh/{runtime,sessions-profiles,transport}.ts`.
</architecture>

<selected_context>
`package.json`, `electron.vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`: scripts, build/test tooling, Electron/Vite/React/TypeScript versions, better-sqlite3 externalization.
`docs/performance-audit.md`: prior measured baseline and explicit missing measurements; use as the baseline to update, not as live current truth.
`docs/contracts/ipc-preload.md`, `docs/testing/contract-tests.md`: IPC/preload change rules and required contract-test/docs-update expectations.
`scripts/e2e-sessions-latency.mjs`: Playwright Electron harness with isolated homes, NDJSON diagnostics, summary statistics, and local artifact output.
`tests/sessions-local-latency.bench.test.ts`: opt-in Vitest benchmark (`MERCURY_SESSIONS_BENCH=1`) for local list/sync/search baselines.
`src/main/index.ts`: Electron lifecycle, `BrowserWindow`, ready-to-show, renderer crash/load logging, IPC registration, updater, SSH auto-start, shutdown cleanup.
`src/main/ipc/{index,types,chat,sessions,trace,gateway,config,system}.ts`: IPC composition plus performance-relevant handlers; sessions IPC contains the current diagnostic wrapper pattern.
`src/main/hermes.ts` and `src/main/hermes/*` selected: chat dispatch via API/CLI, gateway process/health state, connection/SSH URL/auth, stream and trace-event normalization.
`src/main/{trace-store,session-cache,session-db,sessions,config,profiles,ssh-remote,ssh-tunnel,install/paths,installer,utils}.ts` plus `src/main/ssh/*`: persistence, session DB/cache, config/profile paths, local/SSH/remote behaviors needed for benchmark coverage.
`src/preload/index.ts`, `src/preload/index.d.ts`, `src/preload/api/{index,app,chat,config,install,navigation,models}.ts`: renderer API bridge and typings; update these if telemetry becomes renderer-visible.
`src/renderer/src/{main,App}.tsx`, `Layout.tsx`, Chat hook/screen/types/activity/commands, `MessageRow.tsx`, `AgentMarkdown.tsx`, `Sessions.tsx`: startup routing, tab mounting, chat streaming/rendering, session search debounce/UI path.
`src/shared/traces.ts`: trace contracts used by chat/trace-store/tests.
`tests/{ipc-handlers,preload-api-surface,chat-ipc-lifecycle,hermes-trace-events,trace-store,sessions-profile-db}.test.ts` and `src/renderer/src/screens/Sessions/Sessions.test.tsx`: existing contract and regression test patterns relevant to adding telemetry without breaking IPC/preload/chat/session behavior.
</selected_context>

<relationships>
- Existing sessions benchmark: `scripts/e2e-sessions-latency.mjs` launches built Electron with `MERCURY_SESSIONS_DIAG=1` -> renderer Sessions UI -> `window.hermesAPI.searchSessions/listCachedSessions/syncSessionCache` -> `ipc/sessions.ts` diagnostic records -> JSON summary artifact.
- Startup path: Electron `app.whenReady()` -> `registerIpcHandlers()` -> `createWindow()` -> `ready-to-show`; renderer `main.tsx` -> `App.runInstallCheck()` -> `Layout` default Chat pane.
- IPC/preload contract: main `ipcMain.handle(...)` additions must be mirrored in preload fragment(s), `src/preload/index.d.ts`, and parity tests.
- Chat path: `useChatController.handleSend()` -> `window.hermesAPI.sendMessage()` -> preload `chatApi` -> `ipc/chat.ts` -> Hermes API/CLI callbacks -> renderer `chat-chunk`, `chat-done`, `chat-trace-event`, `chat-usage` listeners.
- Trace path: `ipc/chat.ts` and `ipc/trace.ts` call `trace-store.ts`; each trace event currently reads and rewrites `desktop-traces.json`.
- Session path: `Sessions.tsx` 300ms debounce -> preload `models/navigation` APIs -> `ipc/sessions.ts` -> `session-cache.ts`/`sessions.ts`/SQLite; existing evidence showed UI debounce dominated current search samples.
- SSH path: startup/chat/config/session IPC may call `ssh-tunnel.ts`, `ssh-remote.ts`, and `ssh/*`; SSH latency should be measured separately from local Node/SQLite costs.
</relationships>

<subagent_plan_requirements>
Produce a concise implementation plan split into sub-agent tracks. Suggested tracks:
1. Electron startup/build telemetry: cold start wall-clock, ready-to-show, renderer boot marks, memory/RSS snapshot, build/bundle refresh artifact.
2. IPC/runtime telemetry: reusable opt-in timing helper modeled after sessions diagnostics, applied carefully to chat/session/gateway/system paths without changing behavior.
3. Chat/renderer jank benchmark: local/dev harness for stream chunk rendering, input-to-first-token/first-render/complete timing, and long markdown/code rendering cost where feasible.
4. Persistence/data-scale benchmarks: trace-store stress benchmark and larger session DB/search/cache benchmarks, with artifacts and threshold-free summaries unless a regression threshold is already defensible.
5. SSH/remote latency benchmark: isolate connection/tunnel/session/chat readiness timings and label external-network dependency clearly.
6. Contracts/docs/verifier: package scripts, docs update, contract tests, and artifact schema expectations.

For each track, specify candidate files to edit, expected artifacts/env flags, tests to add/update, verification commands, risks, and what should remain explicitly opt-in/local-only.
</subagent_plan_requirements>

<ambiguities>
No live profiling, memory RSS, cold-start timing, or current bundle-size refresh has been run in this discovery pass. Some broader e2e Trace Lab scripts exist but are not selected; `docs/testing/contract-tests.md` summarizes their role. The selected prior performance audit is dated 2026-05-13 and notes some asset measurements may be stale after later brand changes. Treat existing sessions latency artifacts as precedent for harness shape, not as sufficient coverage for the new measurements.
</ambiguities>

## Selection
- Files: 72 total (70 full, 2 codemap)
- Total tokens: 106580 (Auto view)
- Token breakdown: full 106071, codemap 509

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── contracts/
│   │   └── ipc-preload.md — 3 786 tokens (full)
│   ├── testing/
│   │   └── contract-tests.md — 4 871 tokens (full)
│   └── performance-audit.md — 3 308 tokens (full)
├── scripts/
│   └── e2e-sessions-latency.mjs — 3 953 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 192 tokens (full)
│   │   │   ├── chat-cli.ts — 1 793 tokens (full)
│   │   │   ├── connection.ts — 1 052 tokens (full)
│   │   │   ├── gateway.ts — 1 533 tokens (full)
│   │   │   ├── trace-events.ts — 2 616 tokens (full)
│   │   │   └── types.ts — 184 tokens (full)
│   │   ├── install/
│   │   │   └── paths.ts — 2 378 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 3 631 tokens (full)
│   │   │   ├── config.ts — 1 651 tokens (full)
│   │   │   ├── gateway.ts — 509 tokens (full)
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   ├── sessions.ts — 2 134 tokens (full)
│   │   │   ├── system.ts — 431 tokens (full)
│   │   │   ├── trace.ts — 167 tokens (full)
│   │   │   └── types.ts — 35 tokens (full)
│   │   ├── ssh/
│   │   │   ├── runtime.ts — 2 791 tokens (full)
│   │   │   ├── sessions-profiles.ts — 2 828 tokens (full)
│   │   │   └── transport.ts — 1 159 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── hermes.ts — 120 tokens (full)
│   │   ├── index.ts — 2 153 tokens (full)
│   │   ├── installer.ts — 207 tokens (full)
│   │   ├── profiles.ts — 1 806 tokens (full)
│   │   ├── session-cache.ts — 3 485 tokens (full)
│   │   ├── session-db.ts — 520 tokens (full)
│   │   ├── sessions.ts — 1 648 tokens (full)
│   │   ├── ssh-remote.ts — 336 tokens (full)
│   │   ├── ssh-tunnel.ts — 1 661 tokens (full)
│   │   ├── trace-store.ts — 2 299 tokens (full)
│   │   └── utils.ts — 378 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── app.ts — 1 266 tokens (full)
│   │   │   ├── chat.ts — 825 tokens (full)
│   │   │   ├── config.ts — 748 tokens (full)
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   ├── install.ts — 521 tokens (full)
│   │   │   ├── models.ts — 1 229 tokens (full)
│   │   │   └── navigation.ts — 660 tokens (full)
│   │   ├── index.d.ts — 3 545 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── components/
│   │       │   └── AgentMarkdown.tsx — 1 307 tokens (full)
│   │       ├── screens/
│   │       │   ├── Chat/
│   │       │   │   ├── components/
│   │       │   │   │   └── MessageRow.tsx — 444 tokens (full)
│   │       │   │   ├── hooks/
│   │       │   │   │   └── useChatController.ts — 6 998 tokens (full)
│   │       │   │   ├── Chat.tsx — 1 369 tokens (full)
│   │       │   │   ├── chat.constants.ts — 669 tokens (full)
│   │       │   │   ├── chatActivity.ts — 1 461 tokens (full)
│   │       │   │   ├── chatCommands.ts — 1 457 tokens (full)
│   │       │   │   └── types.ts — 851 tokens (full)
│   │       │   ├── Layout/
│   │       │   │   └── Layout.tsx — 3 259 tokens (full)
│   │       │   └── Sessions/
│   │       │       ├── Sessions.test.tsx — 746 tokens (full)
│   │       │       └── Sessions.tsx — 2 945 tokens (full)
│   │       ├── App.tsx — 1 305 tokens (full)
│   │       └── main.tsx — 88 tokens (full)
│   └── shared/
│       └── traces.ts — 417 tokens (full)
├── tests/
│   ├── chat-ipc-lifecycle.test.ts — 2 850 tokens (full)
│   ├── hermes-trace-events.test.ts — 891 tokens (full)
│   ├── ipc-handlers.test.ts — 1 365 tokens (full)
│   ├── preload-api-surface.test.ts — 2 312 tokens (full)
│   ├── sessions-local-latency.bench.test.ts — 1 757 tokens (full)
│   ├── sessions-profile-db.test.ts — 1 160 tokens (full)
│   └── trace-store.test.ts — 1 074 tokens (full)
├── electron.vite.config.ts — 121 tokens (full)
├── package.json — 784 tokens (full)
├── tsconfig.json — 28 tokens (full)
├── tsconfig.node.json — 70 tokens (full)
├── tsconfig.web.json — 110 tokens (full)
└── vitest.config.ts — 126 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    └── shared/
        ├── i18n/
        │   └── types.ts — 43 tokens (auto)
        └── chat-metadata.ts — 466 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `perf-telemetry-2A0AF9` | **Mode**: plan

### Response
# Summary

Add a targeted, opt-in performance telemetry and benchmark scaffold rather than refactoring runtime architecture. The plan introduces local NDJSON/JSON artifacts, renderer-to-main perf marks through preload, deterministic Electron/Vitest benchmark harnesses, synthetic chat streaming for UI jank measurement, trace/session scale benches, SSH/remote latency scripts, and documentation that separates measured artifacts from hypotheses. No external analytics, no default-on telemetry, and no application persistence schema changes.

# Current-state analysis

Mercury’s performance evidence is currently mostly manual and partial:

- **Startup path**: `src/main/index.ts` eagerly imports many main-process subsystems, waits for `app.whenReady()`, registers IPC via `registerIpcHandlers()`, creates `BrowserWindow`, then renderer boots through `main.tsx` → `App.tsx` install check → `Layout.tsx` default Chat pane. There are no startup marks, no ready-to-show decomposition, and no RSS snapshots.
- **IPC/preload contract**: Renderer access goes through `window.hermesAPI`, composed in `src/preload/api/index.ts` and typed in `src/preload/index.d.ts`. Any new renderer-visible telemetry API must be mirrored in main IPC, preload, types, tests, and docs.
- **Existing telemetry precedent**: `src/main/ipc/sessions.ts` has opt-in NDJSON diagnostics using `MERCURY_SESSIONS_DIAG` and `MERCURY_SESSIONS_DIAG_FILE`. `scripts/e2e-sessions-latency.mjs` and `tests/sessions-local-latency.bench.test.ts` already write local artifacts under `prompt-exports/sessions-latency-runs/`.
- **Chat stream path**: `useChatController.handleSend()` calls `window.hermesAPI.sendMessage()`, which invokes `src/main/ipc/chat.ts`, then Hermes API/CLI. Main sends `chat-chunk`, `chat-done`, `chat-error`, `chat-trace-event`, and usage events back to renderer. There is no deterministic stream renderer benchmark.
- **Trace persistence**: `src/main/trace-store.ts` synchronously reads and rewrites `desktop-traces.json` for run creation, event append, usage, and finish. It caps runs/events but has no write-cost benchmark.
- **Session scale**: local sessions use `better-sqlite3`, `session-cache.ts`, `sessions.ts`, and profile-aware DB discovery. Existing benchmarks cover tiny datasets by default, not large DB/search scale.
- **SSH/remote**: SSH latency is hidden inside `ssh-tunnel.ts`, `ssh/transport.ts`, and `ssh/*` runtime functions. No isolated timing distinguishes tunnel setup, SSH command latency, gateway readiness, and remote IPC overhead.
- **Build/bundle evidence**: `docs/performance-audit.md` contains manual 2026-05-13 measurements and notes stale asset numbers. There is no repeatable bundle snapshot script.

Hard constraints:

- Telemetry must be **local-only and opt-in**.
- Runtime behavior must be unchanged when flags are unset.
- Telemetry must redact secrets and avoid logging message contents.
- Existing session diagnostic schema must remain compatible with `scripts/e2e-sessions-latency.mjs`.
- IPC additions must satisfy `tests/ipc-handlers.test.ts` and `tests/preload-api-surface.test.ts`.

# Design

## Overall approach

Use a **targeted instrumentation foundation plus benchmark scripts/tests**. Do not lazy-load or optimize app code in this work. The goal is evidence collection, not performance remediation.

Introduce one small telemetry helper and a small renderer perf helper, then add scoped marks/spans to the specific missing-measurement areas.

---

## Track 0 — Shared local telemetry foundation

**Sub-agent objective:** create the reusable telemetry substrate all other tracks depend on.

### New components

#### `src/shared/perf.ts`

Shared type-only contract used by main, preload, and renderer.

Shape:

```ts
type PerfScope =
  | "startup"
  | "ipc"
  | "chat-render"
  | "trace-store"
  | "ssh"
  | "build"
  | "benchmark";

interface RendererPerfEvent {
  scope: PerfScope;
  name: string;
  phase?: "mark" | "measure" | "summary";
  nowMs?: number;
  timeOriginMs?: number;
  durationMs?: number;
  meta?: Record<string, unknown>;
}

interface PerfTelemetryConfig {
  enabled: boolean;
  runId?: string;
  sampleEvery?: number;
}
```

No message content or API keys should be accepted intentionally; main-side sanitization is still required.

#### `src/main/perf/telemetry.ts`

Main-process telemetry service.

Responsibilities:

- Determine enablement from:
  - `MERCURY_PERF_DIAG=1`
  - existing `MERCURY_SESSIONS_DIAG=1` for session-specific compatibility.
- Resolve output file:
  - generic: `MERCURY_PERF_DIAG_FILE`
  - session legacy: `MERCURY_SESSIONS_DIAG_FILE`
  - fallback: `${tmpdir()}/mercury-perf-diag.ndjson`
- Append sanitized NDJSON records synchronously.
- Provide best-effort timing wrappers that never swallow operation errors.

Key interfaces:

```ts
isPerfTelemetryEnabled(scope?: string): boolean
getPerfTelemetryConfig(): PerfTelemetryConfig
recordPerfEvent(event: RendererPerfEvent | MainPerfEvent): boolean
withPerfSpan<T>(scope, name, meta, run): Promise<T>
withPerfSpanSync<T>(scope, name, meta, run): T
recordMemorySnapshot(scope, name, meta?): void
```

Error handling:

- Telemetry write failures are swallowed.
- Emit at most one console warning per process for telemetry write failure.
- Operation errors still propagate normally after logging failed spans.

Sanitization:

- Drop keys matching `/api[_-]?key|token|authorization|secret|password|credential/i`.
- Cap strings to ~2 KB.
- Convert nested objects/arrays to capped JSON strings.
- For SSH commands, log only a classified command kind and command length, never raw command text.

#### `src/renderer/src/perf.ts`

Renderer helper used by startup/chat components.

Responsibilities:

- Cache `window.hermesAPI.getPerfTelemetryConfig()`.
- Buffer early startup marks in memory until config resolves.
- Drop queued marks when telemetry is disabled.
- Stamp records with `performance.now()` and `performance.timeOrigin`.

This avoids IPC noise in normal production runs.

### IPC/preload API additions

Additive methods on `window.hermesAPI`:

```ts
getPerfTelemetryConfig(): Promise<PerfTelemetryConfig>
recordPerfEvent(event: RendererPerfEvent): Promise<boolean>
```

Main channels:

- `get-perf-telemetry-config`
- `record-perf-event`

Implementation owner: `src/main/ipc/system.ts`, because this is local app/system diagnostics.

### Required tests

- New `tests/perf-telemetry.test.ts`
  - disabled by default returns false/no write.
  - enabled writes valid NDJSON.
  - secrets are redacted.
  - failing wrapped function still throws after failed span is recorded.
- Update:
  - `tests/ipc-handlers.test.ts`
  - `tests/preload-api-surface.test.ts`

---

## Track 1 — Electron startup and build telemetry

**Sub-agent objective:** measure cold/warm launch wall-clock, main/renderer startup marks, ready-to-show, memory/RSS, and bundle size.

### Runtime instrumentation

Modify `src/main/index.ts` to record opt-in marks:

- `main.module.evaluated`
- `app.whenReady.resolved`
- `menu.built`
- `ipc.register.start`
- `ipc.register.end`
- `window.create.start`
- `window.load.requested`
- `window.dom-ready`
- `window.did-finish-load`
- `window.ready-to-show`
- `startup.memory.snapshot`

Also record memory snapshots using:

- `process.memoryUsage().rss`
- `process.memoryUsage().heapUsed`
- `process.resourceUsage()` where available
- summarized `app.getAppMetrics()` once the window exists.

Modify renderer startup files:

- `src/renderer/src/main.tsx`
  - mark `renderer.entry`
  - mark `renderer.root.render.requested`
- `src/renderer/src/App.tsx`
  - mark install check start/end and selected screen.
- `src/renderer/src/screens/Layout/Layout.tsx`
  - mark `layout.mounted`
  - mark route changes.

Clock handling:

- Renderer events include `timeOriginMs` and `nowMs`.
- Main stores both received time and renderer-derived epoch time.

### New script: `scripts/e2e-startup-perf.mjs`

Behavior:

- Requires built app at `out/main/index.js`; package script can run build first.
- Creates isolated synthetic `HERMES_HOME` with fake installed Hermes, valid `.env`, `config.yaml`, and `desktop.json`.
- Launches Electron with:
  - `MERCURY_PERF_DIAG=1`
  - `MERCURY_PERF_RUN_ID=<runId>`
  - `MERCURY_PERF_DIAG_FILE=prompt-exports/perf-runs/<runId>.ndjson`
- Measures external wall-clock:
  - launch start → first window
  - launch start → DOM content loaded
  - launch start → `.chat-container` visible
- Repeats with `--samples`, default `5`.
- Writes `prompt-exports/perf-runs/<runId>.json`.

Summary metrics:

- `launchToFirstWindowMs`
- `launchToDomContentLoadedMs`
- `launchToChatVisibleMs`
- `mainReadyToShowMs`
- `rendererEntryToLayoutMountedMs`
- RSS/heap snapshots by phase.

### New script: `scripts/perf-build-snapshot.mjs`

Behavior:

- Reads `out/**` after build.
- Captures:
  - top emitted files by raw/gzip size
  - totals by extension
  - initial renderer JS/CSS referenced by `out/renderer/index.html`
  - dynamic import references in renderer chunks
  - main/preload/renderer bundle sizes.
- Writes `prompt-exports/perf-runs/<runId>-build-bundle.json`.

Package scripts:

```json
"perf:startup": "npm run build && node scripts/e2e-startup-perf.mjs",
"perf:build": "npm run build && node scripts/perf-build-snapshot.mjs"
```

### Verification

```bash
npm run typecheck
npm run test -- tests/perf-telemetry.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run perf:build
npm run perf:startup
```

---

## Track 2 — IPC/runtime telemetry

**Sub-agent objective:** add scoped timing to performance-sensitive IPC/runtime paths without changing behavior.

### Sessions IPC

Modify `src/main/ipc/sessions.ts`:

- Keep existing `MERCURY_SESSIONS_DIAG` behavior and record shape.
- Internally reuse `src/main/perf/telemetry.ts` where possible.
- Preserve fields expected by `scripts/e2e-sessions-latency.mjs`:
  - `scope: "sessions-ipc"`
  - `channel`
  - `totalMs`
  - `configMs`
  - `implMs`
  - `ok`
  - `resultCount`
  - `ts`

### Chat IPC

Modify `src/main/ipc/chat.ts` to record opt-in spans/marks:

- `send-message.invoke`
- `chat.backend.prepare`
- `chat.trace.create`
- `chat.transport.start`
- `chat.first_chunk`
- `chat.done`
- `chat.error`
- `chat.abort`
- `generate-chat-title`

Metadata should include only:

- mode
- profile presence/name
- message length
- history count
- resume session presence
- trace enabled/created boolean.

Do not record prompt or response text.

### Gateway/system IPC

Modify:

- `src/main/ipc/gateway.ts`
  - `start-gateway`
  - `stop-gateway`
  - `gateway-status`
- `src/main/ipc/system.ts`
  - `run-hermes-dump`
  - `discover-memory-providers`
  - `read-logs`
  - new perf config/event handlers.

### Trace-store public functions

Modify `src/main/trace-store.ts` to record opt-in costs for:

- `createTraceRun`
- `recordTraceEvent`
- `recordTraceUsage`
- `finishTraceRun`
- `listTraceRuns`
- internal `writeStore`

For `writeStore`, include:

- run count
- event count
- serialized byte length
- write duration.

### Verification

```bash
npm run test -- tests/chat-ipc-lifecycle.test.ts tests/trace-store.test.ts tests/ipc-handlers.test.ts
npm run typecheck
```

Risk: telemetry writes can distort timings when enabled. Document that measurements include instrumentation overhead and should be compared with the same flags/settings.

---

## Track 3 — Chat stream render latency and jank benchmark

**Sub-agent objective:** create deterministic chat-stream UI measurements without requiring real model credentials.

### Synthetic chat stream

Add `src/main/hermes/synthetic-chat.ts`.

Enable only when:

```bash
MERCURY_CHAT_SYNTHETIC_STREAM=1
```

Options:

- `MERCURY_CHAT_SYNTHETIC_CHUNKS`, default `80`
- `MERCURY_CHAT_SYNTHETIC_INTERVAL_MS`, default `8`
- `MERCURY_CHAT_SYNTHETIC_PAYLOAD`, one of:
  - `plain`
  - `markdown`
  - `code`

Behavior:

- Produces deterministic chunks through the existing `ChatCallbacks`.
- Returns a normal `ChatHandle` with abort support.
- Emits `onDone("synthetic-session-...")` unless aborted.
- Does not call network, gateway, SSH, or Hermes CLI.

Modify:

- `src/main/hermes/gateway.ts`
  - return synthetic handle when enabled.
- `src/main/ipc/chat.ts`
  - skip `prepareChatBackend()` when synthetic stream is enabled.

Default behavior when env is unset is unchanged.

### Renderer chat marks

Modify `src/renderer/src/screens/Chat/hooks/useChatController.ts` to record:

- `chat.send.intent`
- `chat.send.ipc.resolved`
- `chat.chunk.first_callback`
- `chat.done.callback`
- `chat.error.callback`
- optional sampled chunk callback counts.

Metadata:

- message length
- history count
- chunk length
- run sequence
- no content.

### New script: `scripts/e2e-chat-render-latency.mjs`

Behavior:

- Builds on Playwright Electron harness style from `e2e-sessions-latency.mjs`.
- Launches built app with isolated synthetic `HERMES_HOME`.
- Sets synthetic chat env flags and generic perf diagnostics.
- Uses Playwright to:
  - install `MutationObserver` on `.chat-messages`
  - install `PerformanceObserver` for `longtask` if available
  - send a prompt
  - wait for final assistant response.
- Measures:
  - input submit → first agent DOM text
  - input submit → stream complete
  - first chunk callback → first agent DOM text when telemetry records exist
  - long task count/total/max
  - DOM mutation count
  - final rendered text length.

Artifacts:

- `prompt-exports/perf-runs/<runId>-chat-render.ndjson`
- `prompt-exports/perf-runs/<runId>-chat-render.json`

Package script:

```json
"perf:chat-render": "npm run build && node scripts/e2e-chat-render-latency.mjs"
```

### Required tests

New `tests/chat-synthetic-stream.test.ts`:

- synthetic stream produces configured chunk count.
- abort stops stream and does not call real transport.
- env unset leaves normal gateway path untouched.

Also run existing chat lifecycle tests.

---

## Track 4 — Persistence and data-scale benchmarks

**Sub-agent objective:** measure trace-store rewrite cost and large session DB/search/cache scale.

### Trace-store stress benchmark

Add `tests/trace-store-stress.bench.test.ts`, skipped unless:

```bash
MERCURY_TRACE_STORE_BENCH=1
```

Scenarios:

1. Single run, many events.
2. 200+ runs to exercise store cap.
3. `message.agent.delta` above `MAX_AGENT_DELTA_EVENTS_PER_RUN`.
4. Usage recording plus finish.

Metrics:

- create run ms
- per-event append ms summary
- writeStore ms summary from telemetry when enabled
- final file size
- final run count
- final event count
- listTraceRuns ms.

Artifact:

- `prompt-exports/perf-runs/<runId>-trace-store.json`

Package script:

```json
"perf:trace-store": "MERCURY_TRACE_STORE_BENCH=1 vitest run tests/trace-store-stress.bench.test.ts"
```

### Session scale

Modify `tests/sessions-local-latency.bench.test.ts`:

- Keep current small scenario.
- Add env-controlled scale scenario:
  - `MERCURY_SESSIONS_BENCH_SESSIONS`, default `1000`
  - `MERCURY_SESSIONS_BENCH_MESSAGES`, default `8`
  - `MERCURY_SESSIONS_BENCH_LARGE_MESSAGES=1`
- Seed DB inside transactions for large datasets.
- Record DB size and seed time.
- Keep threshold-free summaries.

Modify `scripts/e2e-sessions-latency.mjs` minimally:

- Add `dbSizeBytes` and `seedMs` to synthetic artifact.
- Add `debounceMs: 300` to clarify UI search includes renderer debounce.

Package scripts:

```json
"perf:sessions:bench": "MERCURY_SESSIONS_BENCH=1 vitest run tests/sessions-local-latency.bench.test.ts",
"perf:sessions:e2e": "npm run build && node scripts/e2e-sessions-latency.mjs --sessions=1000 --messages-per-session=8 --mount-samples=3 --search-samples=5"
```

### Verification

```bash
npm run test -- tests/trace-store.test.ts tests/sessions-profile-db.test.ts
npm run perf:trace-store
npm run perf:sessions:bench
npm run perf:sessions:e2e
```

---

## Track 5 — SSH/remote latency benchmark

**Sub-agent objective:** isolate external-network-dependent SSH/remote timings and label dependency noise clearly.

### Runtime instrumentation

Modify `src/main/ssh-tunnel.ts`:

- record spans for:
  - free port selection
  - ssh process spawn
  - port readiness
  - `/health` readiness
  - stop tunnel.

Modify `src/main/ssh/transport.ts`:

- record `ssh.exec` duration when telemetry is enabled.
- Metadata:
  - host redacted or hashed
  - port
  - command kind
  - timeoutMs
  - stdin present boolean
  - ok/error category.
- Never log raw command or stderr.

### New script: `scripts/e2e-ssh-remote-latency.mjs`

Modes:

- `--mode=remote`
- `--mode=ssh`
- `--case=current-config`
- explicit config flags for CI/dev machines.

Remote mode measurements:

- `testRemoteConnection`
- `gatewayStatus`
- `getModelConfig`
- optional `sendMessage` if `--chat-prompt` is supplied.

SSH mode measurements:

- `testSshConnection`
- `startSshTunnel`
- `isSshTunnelActive`
- `gatewayStatus`
- `listProfiles`
- `listCachedSessions`
- `searchSessions`
- optional chat readiness.

Dependency handling:

- Missing host/URL/credentials exits with artifact status `SKIPPED`, not a failed benchmark.
- Network/auth failures produce `DEPENDENCY` result category.
- Harness failures still produce `FAIL`.

Artifact:

- `prompt-exports/perf-runs/<runId>-ssh-remote.json`
- optional NDJSON telemetry file.

Package script:

```json
"perf:ssh-remote": "npm run build && node scripts/e2e-ssh-remote-latency.mjs --case=current-config"
```

---

## Track 6 — Contracts, docs, and verifier

**Sub-agent objective:** make the scaffold discoverable, contract-safe, and auditable.

### Docs

Add `docs/testing/performance-benchmarks.md`.

Include:

- All perf scripts.
- Required build state.
- Env flags.
- Artifact locations.
- Which results are deterministic/local vs external-network-dependent.
- “Measured evidence” vs “Inference/hypothesis” language.
- Guidance that prompt contents/secrets must not be logged.

Update `docs/performance-audit.md`:

- Add a 2026-05-16 section listing the new benchmark commands.
- State that previous bundle numbers are historical until refreshed by `npm run perf:build`.
- Reference artifact paths rather than embedding stale measurements.

Update `docs/contracts/ipc-preload.md`:

- Document `getPerfTelemetryConfig` and `recordPerfEvent`.
- State they are dev/local opt-in and not external analytics.

Update `docs/testing/contract-tests.md`:

- Add `tests/perf-telemetry.test.ts`.
- Add opt-in benchmark tests.
- Mention when to run perf scripts.

### Package scripts

Modify `package.json` only; no dependency changes.

Add:

- `perf:build`
- `perf:startup`
- `perf:chat-render`
- `perf:sessions:bench`
- `perf:sessions:e2e`
- `perf:trace-store`
- `perf:ssh-remote`

### Verification bundle

Final source verification:

```bash
npm run typecheck
npm run test
npm run check:docs
npm run check:loc
npm run perf:build
npm run perf:startup
npm run perf:chat-render
```

Opt-in heavier/external:

```bash
npm run perf:sessions:bench
npm run perf:sessions:e2e
npm run perf:trace-store
npm run perf:ssh-remote
```

# File-by-file impact

| File | Change | Why | Depends on |
|---|---|---|---|
| `src/shared/perf.ts` | Add shared perf event/config types. | Type-safe preload/main/renderer contract. | None |
| `src/main/perf/telemetry.ts` | Add opt-in telemetry writer, sanitization, timing helpers. | Shared local instrumentation foundation. | `src/shared/perf.ts` |
| `src/renderer/src/perf.ts` | Add renderer perf helper with early mark buffer. | Capture renderer startup/chat marks without default IPC noise. | Preload perf API |
| `src/main/ipc/system.ts` | Add `get-perf-telemetry-config`, `record-perf-event`; time selected system handlers. | Renderer telemetry bridge and system IPC timings. | telemetry helper |
| `src/preload/api/app.ts` | Expose `getPerfTelemetryConfig`, `recordPerfEvent`. | Renderer-visible API. | system IPC |
| `src/preload/index.d.ts` | Add HermesAPI method declarations and perf types. | Contract typing. | shared perf types |
| `src/main/index.ts` | Add startup and memory marks. | Cold-start decomposition. | telemetry helper |
| `src/renderer/src/main.tsx` | Mark renderer entry/root render. | Renderer boot timing. | renderer perf helper |
| `src/renderer/src/App.tsx` | Mark install check and screen decisions. | Startup route timing. | renderer perf helper |
| `src/renderer/src/screens/Layout/Layout.tsx` | Mark layout mount and route changes. | Main UI readiness timing. | renderer perf helper |
| `src/main/ipc/sessions.ts` | Preserve existing diagnostics, optionally reuse telemetry helper, add scale metadata compatibility. | Existing benchmark continuity. | telemetry helper |
| `src/main/ipc/chat.ts` | Add chat spans; skip backend in synthetic mode. | Runtime/chat latency and deterministic render bench. | telemetry helper, synthetic chat |
| `src/main/hermes/synthetic-chat.ts` | Add env-gated synthetic stream implementation. | Deterministic chat render benchmark. | Hermes chat callback types |
| `src/main/hermes/gateway.ts` | Route to synthetic stream when enabled. | Avoid real Hermes/network in benchmark. | synthetic chat |
| `src/main/ipc/gateway.ts` | Add opt-in gateway IPC timings. | Gateway readiness evidence. | telemetry helper |
| `src/main/trace-store.ts` | Add opt-in write/public function timings. | Trace-store stress evidence. | telemetry helper |
| `src/main/ssh-tunnel.ts` | Add opt-in tunnel setup timing. | SSH latency decomposition. | telemetry helper |
| `src/main/ssh/transport.ts` | Add opt-in `ssh.exec` timing with redaction. | Remote latency evidence. | telemetry helper |
| `scripts/e2e-startup-perf.mjs` | New Electron startup harness. | Cold start, memory, startup marks artifact. | built app |
| `scripts/perf-build-snapshot.mjs` | New bundle snapshot script. | Repeatable bundle evidence. | built `out/` |
| `scripts/e2e-chat-render-latency.mjs` | New synthetic chat render/jank harness. | Chat UI latency/jank evidence. | synthetic chat |
| `scripts/e2e-ssh-remote-latency.mjs` | New external dependency latency harness. | SSH/remote evidence. | built app/config |
| `scripts/e2e-sessions-latency.mjs` | Add seed/db-size/debounce metadata only. | Stronger session-scale artifacts. | None |
| `tests/perf-telemetry.test.ts` | New helper tests. | Redaction/enablement safety. | telemetry helper |
| `tests/chat-synthetic-stream.test.ts` | New synthetic stream tests. | Guard env-gated stream behavior. | synthetic chat |
| `tests/trace-store-stress.bench.test.ts` | New opt-in bench. | Trace write-cost measurement. | trace-store |
| `tests/sessions-local-latency.bench.test.ts` | Add scale env scenario and DB size/seed timing. | Large session DB/search coverage. | None |
| `tests/ipc-handlers.test.ts` | Add perf channels to expected new APIs if needed. | IPC parity. | system/preload changes |
| `tests/preload-api-surface.test.ts` | Add perf API surface assertions. | Preload contract. | preload changes |
| `docs/testing/performance-benchmarks.md` | New benchmark guide. | Discoverability and measured/inferred distinction. | all tracks |
| `docs/performance-audit.md` | Add benchmark scaffold section. | Keep audit evergreen. | scripts |
| `docs/contracts/ipc-preload.md` | Document perf preload API. | Contract docs. | IPC/preload changes |
| `docs/testing/contract-tests.md` | Document new tests/benches. | Test map freshness. | tests |
| `package.json` | Add perf scripts. | Standard verifier entrypoints. | scripts |

# Risks and migration

- **No persistence migration**: `desktop-traces.json`, session cache, and app config schemas are unchanged.
- **Additive IPC only**: new perf APIs do not break existing preload consumers.
- **Telemetry overhead**: when enabled, synchronous NDJSON appends can affect timings. Artifacts must compare runs with the same flags.
- **Secret leakage risk**: mitigated by main-side sanitization and strict metadata design. Do not log prompts, responses, raw SSH commands, env values, or stderr.
- **External benchmark noise**: SSH/remote scripts must mark network/auth dependency failures separately from harness failures.
- **Synthetic chat risk**: only active under `MERCURY_CHAT_SYNTHETIC_STREAM=1`; tests must verify default path is unchanged.

# Implementation order

1. **Atomic foundation batch**
   - Add `src/shared/perf.ts`, `src/main/perf/telemetry.ts`, system IPC handlers, preload methods, `index.d.ts`, renderer helper, and parity/doc test updates.
   - Run IPC/preload/perf helper tests.

2. **Startup/build batch**
   - Add startup marks in main/renderer.
   - Add startup and build snapshot scripts.
   - Add package scripts and initial docs section.

3. **IPC/runtime batch**
   - Instrument sessions/chat/gateway/system/trace-store paths.
   - Preserve existing session diagnostic output.
   - Run chat lifecycle, trace-store, sessions/profile tests.

4. **Chat render benchmark batch**
   - Add synthetic chat stream.
   - Add renderer chat marks.
   - Add Playwright chat render/jank harness and tests.

5. **Persistence/session scale batch**
   - Add trace-store stress benchmark.
   - Extend session local bench and e2e artifact metadata.

6. **SSH/remote batch**
   - Instrument SSH tunnel/transport.
   - Add SSH/remote latency harness with dependency-status artifacts.

7. **Final docs/verifier batch**
   - Complete `performance-benchmarks.md`, IPC contract docs, contract-test docs, and performance audit update.
   - Run full typecheck/test/docs guard plus local perf scripts that do not require external credentials.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "perf-telemetry-2A0AF9", new_chat: false)
---

## Orchestrator Coordination Log

- [x] Foundation batch completed by session `AC6EF45D-A45D-4B85-A38C-34CA6E833D85`.
  - Changed telemetry foundation/contract/test files only.
  - Targeted validation passed: `npx vitest run tests/perf-telemetry.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts` (3 files, 203 tests).
  - Typecheck passed: `npm run typecheck`.
  - Noted pre-existing unrelated edits in `package.json`, `package-lock.json`, `src/main/index.ts`, `Layout.tsx`, layout CSS, and i18n common locale files; avoid those unless explicitly coordinated.

- [x] Persistence/data-scale batch completed by session `62214C3E-8AB6-4236-AEFE-056448E63255`.
  - Added opt-in trace-store stress benchmark and sessions scale benchmark metadata.
  - Targeted normal validation passed: `npx vitest run tests/trace-store.test.ts tests/trace-store-stress.bench.test.ts tests/sessions-local-latency.bench.test.ts && npm run typecheck:node && node --check scripts/e2e-sessions-latency.mjs`.
  - Smoke opt-in benchmarks passed for trace-store and sessions scale with small sample env vars.
  - Full `npm run typecheck` remains blocked by unrelated concurrent renderer/TraceLab edits, not this batch.

- [x] Chat render benchmark batch completed by session `04E64FC8-E939-4E6D-9BCE-E916F26E37EA`.
  - Added env-gated synthetic chat stream, renderer chat perf marks, chat render E2E script, and tests.
  - Validation passed: `npx vitest run tests/chat-synthetic-stream.test.ts tests/chat-ipc-lifecycle.test.ts src/renderer/src/screens/Chat/hooks/useChatController.test.tsx && npm run typecheck:node && npm run typecheck:web && node --check scripts/e2e-chat-render-latency.mjs`.

- [x] SSH/remote latency batch completed by session `39F24FEE-8258-4B41-A0E9-DC965CCE3C3B`.
  - Added SSH/tunnel telemetry and SSH/remote benchmark harness.
  - Validation passed: `node --check scripts/e2e-ssh-remote-latency.mjs && npx vitest run tests/ssh-remote.test.ts tests/perf-telemetry.test.ts && npm run typecheck:node && node scripts/e2e-ssh-remote-latency.mjs --case=explicit --mode=ssh --run-id=ssh-remote-skip-smoke`.
  - Repo advanced concurrently to local commits during this batch; current uncommitted SSH batch diff is isolated to `scripts/e2e-ssh-remote-latency.mjs`, `src/main/ssh-tunnel.ts`, and smoke artifact.

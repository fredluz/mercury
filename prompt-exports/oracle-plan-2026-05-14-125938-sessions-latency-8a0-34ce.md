## Final Prompt
<taskname="Sessions Latency"/>
<task>
Design the setup for diagnosing Mercury Sessions screen search/list latency before optimizing. The user reports that searching Sessions is slow even with about five sessions, and a screenshot shows the Sessions page spinner. Produce an actionable measurement plan that explains where time is going across initial Sessions load and search, with concrete metrics, sampling procedure, outlier handling, first-pass optimization candidates ranked by evidence/risk, and a scoreboard scaffold at `prompt-exports/optimize-sessions-search-runs.md`. Do not implement optimizations yet; prefer instrumentation in tests/support scripts, with minimal production hooks only if they are necessary to measure real Electron IPC/UI behavior.
</task>

<architecture>
- Renderer entry: `src/renderer/src/screens/Sessions/Sessions.tsx` owns Sessions state. On mount, `loadSessions()` sets `loading`, awaits `window.hermesAPI.listCachedSessions(50)`, clears spinner early only if cached results exist, then awaits `window.hermesAPI.syncSessionCache()` and replaces sessions. Search uses a 300 ms debounce in a `useEffect`; non-empty query sets `isSearching`, then awaits `window.hermesAPI.searchSessions(searchQuery)` before clearing the search spinner.
- Navigation wrapper: `src/renderer/src/screens/Layout/Layout.tsx` lazy-mounts the Sessions pane on first visit, keeps it mounted afterward, and `onMenuSearchSessions()` only switches to the Sessions view. Resuming a session calls `getSessionMessages()` and returns to Chat, but that is not part of search latency unless the user clicks a result.
- Preload bridge: `src/preload/api/models.ts` exposes `listCachedSessions`, `syncSessionCache`, and `searchSessions` via `ipcRenderer.invoke(...)`; `src/preload/api/navigation.ts` exposes legacy `listSessions`/`getSessionMessages`; `src/preload/api/app.ts` exposes menu events; `src/preload/api/index.ts`, `src/preload/index.ts`, and `src/preload/index.d.ts` define composition and typings.
- IPC routing: `src/main/ipc/sessions.ts` branches every Sessions/cache/search handler through `getConnectionConfig()`. Local mode calls `src/main/session-cache.ts` and `src/main/sessions.ts`; SSH mode calls `sshListCachedSessions()`/`sshSearchSessions()` through `src/main/ssh-remote.ts`.
- Local storage: `src/main/session-cache.ts` reads/writes `<HERMES_HOME>/desktop/sessions.json`, syncs from SQLite `<HERMES_HOME>/state.db`, and does per-new-session title lookup from `messages` if `sessions.title` is missing. `src/main/sessions.ts::searchSessions()` uses `messages_fts` if present, sanitizes query terms, joins to `messages` and `sessions`, orders by FTS rank, and returns snippets.
- SSH storage: `src/main/ssh/runtime.ts::sshListCachedSessions()` calls `sshListSessions()` rather than a remote JSON cache. `src/main/ssh/sessions-profiles.ts::sshListSessions()` and `sshSearchSessions()` spawn remote Python via `src/main/ssh/transport.ts`; SSH search uses `LIKE '%query%'` over messages joined to sessions, so process/network latency plus full scans can dominate even for few sessions if messages are large or SSH setup is cold.
- Existing perf context: `tests/session-cache-sync.test.ts` includes an issue #16 perf guard for 1500-session resync under 500 ms. `docs/performance-audit.md` notes session-cache is already more optimized than trace-store and lists lazy main-process imports as a possible future optimization. No dedicated Sessions list/search benchmark exists.
</architecture>

<selected_context>
`src/renderer/src/screens/Sessions/Sessions.tsx`: exact UI state machine for mount spinner, cached/sync calls, search debounce, and search spinner; primary place for renderer input-to-results measurement if needed.
`src/renderer/src/assets/styles/sessions.css`: spinner/list/search-result selectors used by Playwright/e2e measurement (`.sessions-loading`, `.sessions-searchbar-input`, `.sessions-list`, result cards).
`src/renderer/src/screens/Layout/Layout.tsx`: first-visit mount behavior, route switching, menu search shortcut, and remote-only gating around Sessions.
`src/preload/api/models.ts`: preload methods for `listCachedSessions`, `syncSessionCache`, `searchSessions`; useful for wrapper timing if instrumentation is placed at preload boundary.
`src/preload/api/navigation.ts`: legacy Sessions methods (`listSessions`, `getSessionMessages`) and IPC patterns.
`src/preload/api/app.ts`: menu event listener for `menu-search-sessions`; confirms shortcut only navigates to Sessions.
`src/preload/api/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`: API composition and surface typings; update only if adding temporary/diagnostic API hooks.
`src/main/ipc/sessions.ts`: central IPC branch and best place to measure per-handler durations (`list-cached-sessions`, `sync-session-cache`, `search-sessions`) across local vs SSH.
`src/main/ipc/index.ts`: IPC registration wiring and contract-test context.
`src/main/config.ts`: `getConnectionConfig()` does synchronous desktop config reads before each handler branch; include it in timing attribution even if likely small.
`src/main/session-cache.ts`: local cached list and sync implementation, including synchronous JSON reads/writes, SQLite reads, incremental sync window, title generation, and per-new-session message lookup.
`src/main/sessions.ts`: local SQLite session list/search/messages; search uses FTS5 table if present and returns empty on missing FTS/catch.
`src/main/ssh-remote.ts`: SSH compatibility barrel mapping IPC imports to domain implementations.
`src/main/ssh/runtime.ts`: `sshListCachedSessions()` implementation used by both `list-cached-sessions` and `sync-session-cache` in SSH mode.
`src/main/ssh/sessions-profiles.ts`: remote Python implementations for listing and searching sessions; search uses `LIKE '%query%'` and returns first 200 chars of snippet.
`src/main/ssh/transport.ts`: `sshExec()`/`sshPython()` spawn behavior, ControlMaster options, and timeout defaults; key for explaining cold vs warm SSH variance.
`src/main/install/paths.ts`, `src/main/installer.ts`, `src/main/utils.ts`: `HERMES_HOME` resolution, profile/home helpers, and safe writes used by tests/scripts and local cache code.
`tests/session-cache-sync.test.ts`: existing DB seeding/mocking pattern and current session-cache perf guard; can be extended or mirrored for local timing harness.
`tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`: contract checks to run if any diagnostic IPC/preload surface is added.
`src/renderer/src/components/I18nProvider.test.tsx`, `I18nProvider.tsx`, `I18nContext.ts`, `useI18n.ts`, `src/renderer/src/test/setup.ts`, `vitest.config.ts`: renderer test setup and i18n wrapper/mocking patterns for any component-level measurement/test.
`scripts/e2e-flow-sweep.mjs`: existing Playwright/Electron script that visits Sessions and fills search; not a benchmark, but good scaffold for a real UI timing script after build.
`docs/performance-audit.md`: prior perf audit, baseline commands, and note that there is no Sessions-specific benchmark yet.
`docs/subsystems/storage-and-profiles.md`: documented local/SSH Sessions storage behavior and IPC mapping.
`docs/subsystems/connection-modes.md`: local/remote/SSH behavior, including remote-only gating and SSH tunnel/command model.
`package.json`: available scripts (`npm run test`, `typecheck:node`, `typecheck:web`, `build`, e2e script).
`prompt-exports/`: existing prompt export directory; target scoreboard file does not currently exist and should be created by the next model if executing the plan.
</selected_context>

<relationships>
- Initial load path: `Layout.goTo("sessions")` -> first mount of `Sessions` -> `loadSessions()` -> preload `listCachedSessions(50)` -> IPC `list-cached-sessions` -> `getConnectionConfig()` -> local `listCachedSessions()` OR SSH `sshListCachedSessions()` -> then `syncSessionCache()` -> IPC `sync-session-cache` -> local `syncSessionCache()` OR SSH `sshListCachedSessions(conn.ssh, 50)`.
- Search path: search input `onChange` -> `searchQuery` state -> 300 ms debounce -> preload `searchSessions(query)` -> IPC `search-sessions` -> `getConnectionConfig()` -> local `searchSessions()` with FTS5 OR SSH `sshSearchSessions()` with spawned SSH/Python and `LIKE '%query%'`.
- Spinner mapping: mount spinner is `loading`; search spinner is `isSearching`. A screenshot of `.sessions-loading` alone does not distinguish initial mount/sync from active search without instrumentation or user flow context.
- SSH variance source: `sshSearchSessions()` and `sshListCachedSessions()` both call `sshPython()` -> `sshExec()` -> `spawn("ssh", ...)`; SSH ControlMaster may make warm calls faster, while cold calls can include connection setup despite only a few sessions.
- Local cache variance source: `syncSessionCache()` reads cache JSON, opens SQLite, queries rows since `lastSync - 300`, may perform one `SELECT content FROM messages... LIMIT 1` per new untitled session, sorts all cached sessions, then rewrites JSON.
</relationships>

<diagnosis_plan_requirements>
Return a plan, not an optimization patch. Include:
1. Instrumentation strategy: prefer a benchmark/support script or tests that time existing public boundaries. Suggested layers: renderer mount-to-first-list (`performance.now()` around navigation/fill in Playwright), preload/IPC duration around `listCachedSessions`, `syncSessionCache`, and `searchSessions`, local function timings for `syncSessionCache()` and `searchSessions()`, and SSH function timings around `sshListCachedSessions()`/`sshSearchSessions()` including cold vs warm call distinction. Production hooks should be temporary/minimal and behind an obvious diagnostic flag only if real Electron IPC timing cannot be measured otherwise.
2. Baseline procedure: specify representative local and SSH cases, search query, warmup, sample count, median/p95/min/max/stddev or MAD, and how to separate the fixed 300 ms debounce from IPC/search execution time. Include guidance to collect enough samples (e.g. 20-30 after warmup for stable paths, more if SSH variance is high) and to report outliers rather than silently discard them unless a clear environmental cause exists.
3. Stop criterion: identify the dominant component with defensible median/p95 and variance. Required metrics/units: Sessions mount-to-first-render latency in ms; `sync-session-cache` duration in ms; `search-sessions` IPC duration in ms for a representative query; optional renderer input-to-results latency in ms.
4. First-pass optimization candidates, ranked but not implemented: e.g. avoid duplicate SSH list calls on mount, make search stale-result safe and avoid visible spinner until debounce fires/has threshold, replace SSH `LIKE '%query%'` with FTS or cached search if measured dominant, avoid sync blocking first paint, cache `getConnectionConfig()` or lazy-load heavy modules only if measured meaningful, avoid per-new-session title queries if local sync dominates.
5. Scoreboard scaffold at `prompt-exports/optimize-sessions-search-runs.md`: include a markdown table template for environment, mode, dataset size, query, warm/cold, samples, mount ms median/p95, list cache ms median/p95, sync ms median/p95, search IPC ms median/p95, renderer input-to-results ms median/p95, notes, and conclusion. Also include a section for raw sample links/log snippets and a ranked bottleneck summary.
</diagnosis_plan_requirements>

<verification>
Recommended checks after adding instrumentation/support files:
- `npm run test -- tests/session-cache-sync.test.ts`
- `npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts` if IPC/preload surface changes.
- `npm run typecheck:web` for renderer/test additions.
- `npm run typecheck:node` for main-process scripts or IPC instrumentation.
- `npm run build` then adapt/run `node scripts/e2e-flow-sweep.mjs` or a new Sessions timing script if real Electron UI timing is needed.
</verification>

<ambiguities>
- The screenshot spinner could be the initial `loading` spinner or the search `isSearching` spinner; the CSS class is shared, so instrumentation should tag the state path explicitly.
- The user's connection mode is unknown. SSH mode has much stronger bottleneck candidates than local mode because both list/sync and search spawn remote Python over SSH.
- “About five sessions” does not bound message count, content size, FTS availability, cache state, cold SSH connection setup, or whether the session cache file exists. Baseline must record these dataset/environment facts.
- The requested scoreboard file does not exist in the current tree; create it only when executing the plan, and avoid staging/overwriting unrelated concurrent changes. Git status shows many unrelated modified/untracked files in the workspace.
</ambiguities>

## Selection
- Files: 39 total (35 full, 4 codemap)
- Total tokens: 48895 (Auto view)
- Token breakdown: full 47982, codemap 913

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── subsystems/
│   │   ├── connection-modes.md — 2 499 tokens (full)
│   │   └── storage-and-profiles.md — 2 783 tokens (full)
│   └── performance-audit.md — 3 209 tokens (full)
├── scripts/
│   └── e2e-flow-sweep.mjs — 2 973 tokens (full)
├── src/
│   ├── main/
│   │   ├── install/
│   │   │   └── paths.ts — 2 378 tokens (full)
│   │   ├── ipc/
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   └── sessions.ts — 789 tokens (full)
│   │   ├── ssh/
│   │   │   ├── runtime.ts — 2 774 tokens (full)
│   │   │   ├── sessions-profiles.ts — 2 197 tokens (full)
│   │   │   └── transport.ts — 1 159 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── installer.ts — 207 tokens (full)
│   │   ├── session-cache.ts — 1 407 tokens (full)
│   │   ├── sessions.ts — 1 099 tokens (full)
│   │   ├── ssh-remote.ts — 336 tokens (full)
│   │   └── utils.ts — 378 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── app.ts — 1 266 tokens (full)
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   ├── models.ts — 1 128 tokens (full)
│   │   │   └── navigation.ts — 638 tokens (full)
│   │   ├── index.d.ts — 3 397 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   └── renderer/
│       └── src/
│           ├── assets/
│           │   └── styles/
│           │       └── sessions.css — 1 128 tokens (full)
│           ├── components/
│           │   ├── I18nContext.ts — 70 tokens (full)
│           │   ├── I18nProvider.test.tsx — 516 tokens (full)
│           │   ├── I18nProvider.tsx — 490 tokens (full)
│           │   └── useI18n.ts — 143 tokens (full)
│           ├── screens/
│           │   ├── Layout/
│           │   │   └── Layout.tsx — 2 800 tokens (full)
│           │   └── Sessions/
│           │       └── Sessions.tsx — 2 659 tokens (full)
│           └── test/
│               └── setup.ts — 43 tokens (full)
├── tests/
│   ├── ipc-handlers.test.ts — 1 231 tokens (full)
│   ├── preload-api-surface.test.ts — 2 049 tokens (full)
│   └── session-cache-sync.test.ts — 1 641 tokens (full)
├── package.json — 771 tokens (full)
└── vitest.config.ts — 126 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── ipc/
    │   │   └── types.ts — 44 tokens (auto)
    │   └── ssh-tunnel.ts — 440 tokens (auto)
    └── shared/
        ├── i18n/
        │   └── types.ts — 43 tokens (auto)
        └── traces.ts — 386 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `sessions-latency-8A05BF` | **Mode**: plan

### Response
## 1. Summary

Use a targeted diagnostic setup before optimizing Sessions latency. The plan measures the existing path at three layers: local function benchmarks, real Electron UI timings, and minimal env-gated IPC timing in `src/main/ipc/sessions.ts` to attribute `listCachedSessions`, `syncSessionCache`, and `searchSessions` time across local and SSH modes. No search/list optimizations should be implemented yet. The goal is to distinguish fixed UI debounce/spinner behavior, cache sync cost, local SQLite/FTS cost, SSH process/network cost, and first-mount rendering cost with repeatable samples and a scoreboard at `prompt-exports/optimize-sessions-search-runs.md`.

## 2. Current-state analysis

### Initial Sessions load path

`src/renderer/src/screens/Layout/Layout.tsx` lazy-mounts `Sessions` only on first visit:

```text
Layout.goTo("sessions")
→ visitedViews gains "sessions"
→ <Sessions /> mounts
→ Sessions.loadSessions()
```

`src/renderer/src/screens/Sessions/Sessions.tsx::loadSessions()` currently:

1. Sets `loading = true`.
2. Awaits `window.hermesAPI.listCachedSessions(50)`.
3. If cached sessions exist, updates `sessions` and clears `loading` early.
4. Awaits `window.hermesAPI.syncSessionCache()`.
5. Replaces `sessions` with `synced.slice(0, 50)` and clears `loading`.

Implication:

- If cache is empty, the visible spinner remains until `syncSessionCache()` completes.
- In SSH mode, both `list-cached-sessions` and `sync-session-cache` route to `sshListCachedSessions(...)`, so first mount can do two remote SSH/Python list calls.
- The screenshot spinner could represent initial `loading`, not search `isSearching`.

### Search path

`Sessions.tsx` search effect:

```text
input onChange
→ searchQuery state update
→ effect sets isSearching = true immediately
→ waits 300 ms debounce
→ window.hermesAPI.searchSessions(searchQuery)
→ setSearchResults(...)
→ isSearching = false
```

Implications:

- The search spinner is shown during the fixed 300 ms debounce even if the actual search takes only a few milliseconds.
- In-flight searches are not request-id guarded; a slow old query can overwrite a newer query.
- Current measurement must separate:
  - input-to-results latency, which includes debounce;
  - `search-sessions` IPC duration, which excludes debounce.

### IPC and storage routing

`src/preload/api/models.ts` exposes:

- `listCachedSessions(limit?, offset?)`
- `syncSessionCache()`
- `searchSessions(query, limit?)`

All call `ipcRenderer.invoke(...)`.

`src/main/ipc/sessions.ts` handles those IPC channels and calls `getConnectionConfig()` for each handler.

Local mode:

```text
list-cached-sessions → src/main/session-cache.ts::listCachedSessions()
sync-session-cache → src/main/session-cache.ts::syncSessionCache()
search-sessions → src/main/sessions.ts::searchSessions()
```

SSH mode:

```text
list-cached-sessions → sshListCachedSessions()
sync-session-cache → sshListCachedSessions(conn.ssh, 50)
search-sessions → sshSearchSessions()
```

### Local latency sources

`src/main/session-cache.ts::syncSessionCache()`:

- reads `<HERMES_HOME>/desktop/sessions.json`;
- opens `<HERMES_HOME>/state.db`;
- queries sessions newer than `lastSync - 300`;
- for new untitled sessions, performs one first-user-message lookup per session;
- sorts all cached sessions;
- rewrites the JSON cache.

`src/main/sessions.ts::searchSessions()`:

- requires `messages_fts`;
- sanitizes query terms for FTS5;
- joins `messages_fts`, `messages`, and `sessions`;
- orders by FTS rank;
- catches failures and returns `[]`.

A missing FTS table appears as a fast empty search, so every run must record whether `messages_fts` exists.

### SSH latency sources

`src/main/ssh/runtime.ts::sshListCachedSessions()` calls `sshListSessions()` rather than a remote JSON cache.

`src/main/ssh/sessions-profiles.ts::sshSearchSessions()`:

- spawns SSH/Python through `sshPython()`/`sshExec()`;
- connects to remote SQLite;
- searches with `LIKE '%query%'`;
- can scan large message content even with few sessions.

SSH cold calls may include connection setup. Warm calls may benefit from `ControlMaster` and `ControlPersist`.

## 3. Design

### Diagnostic approach

Use a targeted measurement harness, not a refactor.

Implement three measurement layers:

1. **Local function benchmark**  
   New gated Vitest benchmark that imports existing `syncSessionCache()` and `searchSessions()` with a temporary mocked `HERMES_HOME`.

2. **Real Electron UI timing script**  
   New Playwright/Electron support script modeled after `scripts/e2e-flow-sweep.mjs`, measuring mount-to-render and search input-to-results.

3. **Minimal env-gated IPC diagnostics**  
   Add diagnostic-only timing in `src/main/ipc/sessions.ts` behind `MERCURY_SESSIONS_DIAG=1`. No new preload API, no new IPC channels, no renderer production behavior changes.

This is necessary because the initial mount invokes list and sync from inside the component; without main-side diagnostics, UI timing alone cannot reliably attribute spinner time to `list-cached-sessions` versus `sync-session-cache`.

### Metrics to collect

Required metrics, all in milliseconds:

| Metric | Definition |
| --- | --- |
| `mountToFirstRenderableMs` | From clicking/opening Sessions to first visible `.sessions-list`, `.sessions-card`, or `.sessions-empty` after spinner. |
| `listCachedIpcMs` | Duration of `list-cached-sessions` IPC handler. |
| `syncSessionCacheIpcMs` | Duration of `sync-session-cache` IPC handler. |
| `searchSessionsIpcMs` | Duration of `search-sessions` IPC handler for representative query. |
| `rendererInputToResultsMs` | From search input mutation to visible search results/no-results state; includes 300 ms debounce. |
| `debounceAndRenderRemainderMs` | Approximate `rendererInputToResultsMs - searchSessionsIpcMs`; if near 300 ms, perceived search slowness is mostly debounce/spinner UX. |

Also record per run:

- mode: `local`, `ssh`, or `remote`;
- cache state: missing, empty, warm;
- session count;
- message count;
- approximate message content bytes;
- `messages_fts` present: yes/no;
- query label/string for synthetic data, or query length/hash only for real user data;
- cold/warm classification;
- result count;
- timeout/error count.

### Env-gated IPC timing

Modify only `src/main/ipc/sessions.ts`.

Add an internal diagnostic helper around these handlers:

- `list-cached-sessions`
- `sync-session-cache`
- `search-sessions`

Timing boundaries:

```text
handler start
→ measure getConnectionConfig()
→ measure selected local/SSH implementation
→ log one NDJSON record if MERCURY_SESSIONS_DIAG=1
```

Log shape, conceptually:

```ts
{
  scope: "sessions-ipc",
  channel: "search-sessions",
  mode: "local" | "ssh" | "remote",
  totalMs: number,
  configMs: number,
  implMs: number,
  resultCount: number,
  queryLength?: number,
  limit?: number,
  offset?: number,
  ok: boolean,
  errorName?: string,
  ts: string
}
```

Constraints:

- Do not log raw query text by default.
- Do not change handler return values.
- Do not add public/preload APIs.
- Diagnostic logging must never throw.
- Write to `process.env.MERCURY_SESSIONS_DIAG_FILE` when set; otherwise to a temp/run artifact path chosen by the support script.

### Local function benchmark

Add `tests/sessions-local-latency.bench.test.ts`.

Behavior:

- Skip unless `MERCURY_SESSIONS_BENCH=1`.
- Use the same `vi.hoisted`/installer mock pattern as `tests/session-cache-sync.test.ts` because `HERMES_HOME` is captured at module load.
- Stub shared i18n/locale as the existing session-cache test does.
- Seed SQLite with:
  - 5 sessions, small messages, FTS present;
  - 5 sessions, large messages, FTS present;
  - warm cache and empty cache cases;
  - optional larger comparison dataset, e.g. 500 or 1500 sessions, to compare against the existing issue #16 guard.
- Time direct calls to:
  - `listCachedSessions(50)`;
  - `syncSessionCache()`;
  - `searchSessions(query, 20)`.
- Do not add failing performance thresholds yet; assert only sanity conditions such as non-negative durations and expected result counts.

Output:

- Console summary.
- Raw JSON under `prompt-exports/sessions-latency-runs/<run-id>-local-functions.json`.

### Real Electron timing script

Add `scripts/e2e-sessions-latency.mjs`.

Default command shape:

```bash
npm run build
node scripts/e2e-sessions-latency.mjs --case=synthetic-local --cache=warm --mount-samples=10 --search-samples=30
```

Recommended npm alias:

```json
"diagnose:sessions": "node scripts/e2e-sessions-latency.mjs"
```

Script responsibilities:

1. Create an isolated temporary `HERMES_HOME`.
2. Seed `state.db`, `messages`, and `messages_fts`.
3. Optionally pre-seed or remove `desktop/sessions.json` depending on `--cache=warm|empty`.
4. Launch Electron against `out/main/index.js`.
5. Set:
   - `HERMES_HOME=<temp>`;
   - `MERCURY_SESSIONS_DIAG=1`;
   - `MERCURY_SESSIONS_DIAG_FILE=<artifact.ndjson>`.
6. Measure mount:
   - click the second sidebar nav item or otherwise navigate to Sessions;
   - record time until Sessions shows list/empty state instead of `.sessions-loading`.
7. Measure search:
   - clear input;
   - fill representative query, e.g. `latencyneedle`;
   - record time until matching result/no-results state is visible.
8. Read IPC diagnostic NDJSON and correlate handler durations.
9. Write raw samples and summary JSON under `prompt-exports/sessions-latency-runs/`.

Use CSS selectors from `sessions.css`/`Sessions.tsx`:

- `.sessions-container`
- `.sessions-loading`
- `.sessions-searchbar-input`
- `.sessions-list`
- `.sessions-card`
- `.sessions-result-snippet`
- `.sessions-empty`

### Sampling procedure

#### Local synthetic

Run four baseline rows:

1. Local, 5 sessions, empty cache, FTS present.
2. Local, 5 sessions, warm cache, FTS present.
3. Local, 5 sessions, large messages, warm cache, FTS present.
4. Local, copied real user `state.db` into temp home, cache copied as-is if available.

Samples:

- local function benchmark: 5 warmups, then 30 measured samples;
- UI mount: 10–15 app launches per cache state, because `Layout` keeps Sessions mounted after first visit;
- UI search: 5 warmups, then 30 measured samples in one app session.

#### SSH

Run separately from local:

1. SSH cold first list/search after fresh app launch.
2. SSH warm list/search after one or more warmup calls.
3. If variance is high, increase to 50 measured search samples.

Classify cold and warm separately. Do not mix first SSH connection setup into warm p95.

#### Debounce separation

For every search row, report both:

- `searchSessionsIpcMs`;
- `rendererInputToResultsMs`.

Interpretation:

- If IPC median is low but input-to-results median is ~300–350 ms, the spinner is mostly the intentional debounce plus immediate `isSearching = true`.
- If IPC p95 is high, investigate local FTS/sync or SSH search path depending on mode.

### Outlier handling

- Never silently discard samples.
- Keep raw sample JSON/NDJSON for every run.
- Report min, median, p95, max, and MAD or stddev.
- Separate known classes instead of deleting:
  - SSH cold connection;
  - timeout;
  - app launch failure;
  - machine sleep/wake;
  - missing FTS;
  - cache empty versus warm.
- Exclude a sample from the warm summary only when there is a clear environmental cause, and still list it in raw samples and notes.

### Stop criterion

Stop diagnosing and choose an optimization only when the scoreboard shows a defensible dominant component:

- one component explains at least ~50–60% of median end-to-end latency, or
- one component explains the p95 tail, or
- the fixed 300 ms debounce explains most visible search latency while IPC/search is consistently low.

Required before stopping:

- at least one local synthetic row;
- one row matching the user’s actual mode if known;
- mount-to-first-render;
- `sync-session-cache` duration;
- `search-sessions` IPC duration;
- renderer input-to-results for search.

### First-pass optimization candidates, ranked by evidence/risk

Do not implement these until the scoreboard identifies the bottleneck.

| Rank | Candidate | Evidence needed | Risk |
| ---: | --- | --- | --- |
| 1 | Avoid duplicate SSH list calls on Sessions mount. In SSH mode, `list-cached-sessions` and `sync-session-cache` both call `sshListCachedSessions()`. | SSH mount shows two similar expensive list calls. | Low/medium; must preserve initial list freshness. |
| 2 | Stop showing search spinner during the 300 ms debounce; show spinner only once the IPC request starts or after a short threshold. | `searchSessionsIpcMs` low, `rendererInputToResultsMs` ≈ 300–350 ms, user perceives spinner as slowness. | Low; UX-only if carefully tested. |
| 3 | Make search requests stale-result safe with a request id/abort guard. | Overlapping search samples or old results overwriting newer input. | Low; correctness improvement. |
| 4 | Do not block first visible Sessions paint on `syncSessionCache()` when cache is empty; render a non-blocking syncing state. | `sync-session-cache` dominates mount spinner. | Medium; avoid misleading empty-state flash. |
| 5 | Improve SSH search: remote FTS, cached search, or API-side search instead of per-query SSH/Python plus `LIKE '%query%'`. | SSH `search-sessions` dominates median/p95. | Higher; remote compatibility and migration concerns. |
| 6 | Batch title generation in local `syncSessionCache()` instead of one query per new untitled session. | Local sync dominated by many new untitled sessions/title lookups. | Medium; title behavior must remain stable. |
| 7 | Cache `getConnectionConfig()` or avoid repeated desktop config reads in hot IPC handlers. | `configMs` is a meaningful fraction, e.g. >5–10 ms or high p95. | Low, but likely not the bottleneck. |
| 8 | Lazy-load main session/search modules. | App startup, not Sessions search, is shown as dominant. | Medium; not justified unless measured. |

## 4. Scoreboard scaffold

Create `prompt-exports/optimize-sessions-search-runs.md` with this scaffold:

```md
# Optimize Sessions Search Runs

Purpose: diagnose Mercury Sessions list/search latency before implementing optimizations.

## Stop criterion

Choose an optimization only after one component explains the dominant median or p95 latency for the relevant mode/cache state.

## Summary runs

| Run ID | Date | Commit | Environment | Mode | Dataset size | Query | Cache | FTS | Warm/cold | Samples | Mount ms median/p95 | List cache ms median/p95 | Sync ms median/p95 | Search IPC ms median/p95 | Renderer input-to-results ms median/p95 | Notes | Conclusion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| TBD | TBD | TBD | OS/Node/Electron | local/ssh | sessions/messages/content MB | query label | empty/warm | yes/no | cold/warm | 30 | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## Raw sample artifacts

| Run ID | Artifact | Contents | Notes |
| --- | --- | --- | --- |
| TBD | `prompt-exports/sessions-latency-runs/<run-id>.json` | UI samples and summary stats | TBD |
| TBD | `prompt-exports/sessions-latency-runs/<run-id>.ndjson` | IPC diagnostic samples | TBD |

## Ranked bottleneck summary

| Rank | Bottleneck | Evidence | Affected mode/cache state | Candidate optimization | Decision |
| ---: | --- | --- | --- | --- | --- |
| 1 | TBD | TBD | TBD | TBD | measure more / optimize / reject |

## Outliers and exclusions

| Run ID | Sample | Reason | Included in raw? | Included in warm summary? |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | yes | yes/no |

## Notes

- Search input-to-results includes the fixed 300 ms debounce in `Sessions.tsx`.
- `search-sessions` IPC duration excludes debounce.
- SSH cold and warm samples must be reported separately.
- Real-user runs should avoid storing raw message content or sensitive query text.
```

## 5. File-by-file impact

### `prompt-exports/optimize-sessions-search-runs.md`

- Add new scoreboard scaffold above.
- Purpose: central place to compare local/SSH/cache/search runs.
- Depends on no code changes.

### `src/main/ipc/sessions.ts`

- Add env-gated diagnostic timing around:
  - `list-cached-sessions`;
  - `sync-session-cache`;
  - `search-sessions`.
- Keep existing IPC channel names and return types unchanged.
- Record `getConnectionConfig()` time separately from implementation time.
- Do not log raw query text by default.
- Dependency: needed by the Electron timing script to attribute first-mount spinner time.

### `tests/sessions-local-latency.bench.test.ts`

- Add gated Vitest benchmark.
- Reuse the mocking pattern from `tests/session-cache-sync.test.ts`.
- Import and time existing `listCachedSessions`, `syncSessionCache`, and `searchSessions`.
- Skip unless `MERCURY_SESSIONS_BENCH=1`.
- Dependency: none on production diagnostics.

### `scripts/e2e-sessions-latency.mjs`

- Add Playwright/Electron timing script based on `scripts/e2e-flow-sweep.mjs`.
- Seed local synthetic datasets and launch built Electron.
- Collect DOM timing and IPC diagnostic artifacts.
- Support local synthetic, copied local home, and SSH/real-config modes.
- Dependency: for full attribution, expects `MERCURY_SESSIONS_DIAG` support in `src/main/ipc/sessions.ts`.

### `package.json`

- Add optional script:
  - `diagnose:sessions`: `node scripts/e2e-sessions-latency.mjs`
- No dependency changes required.

## 6. Risks and migration

- No persistence schema changes.
- No public preload or IPC API changes.
- Diagnostic logs may reveal timing and query length; avoid raw query/message content for real-user runs.
- Env-gated IPC timing adds minimal dormant code; keep it behind `MERCURY_SESSIONS_DIAG=1` and remove later if the team wants no permanent diagnostics.
- Synthetic benchmarks must not become brittle CI performance gates until stable thresholds are known.

## 7. Implementation order

1. Add `prompt-exports/optimize-sessions-search-runs.md`.
2. Add env-gated IPC timing in `src/main/ipc/sessions.ts`.
3. Run:
   ```bash
   npm run typecheck:node
   npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
   ```
4. Add `tests/sessions-local-latency.bench.test.ts`.
5. Verify default tests still skip the benchmark:
   ```bash
   npm run test -- tests/session-cache-sync.test.ts
   ```
6. Run benchmark explicitly:
   ```bash
   MERCURY_SESSIONS_BENCH=1 npm run test -- tests/sessions-local-latency.bench.test.ts
   ```
7. Add `scripts/e2e-sessions-latency.mjs` and optional `package.json` script.
8. Build and run local synthetic UI timing:
   ```bash
   npm run build
   npm run diagnose:sessions -- --case=synthetic-local --cache=empty
   npm run diagnose:sessions -- --case=synthetic-local --cache=warm
   ```
9. If the user is in SSH mode, run SSH cold/warm measurements and record separate scoreboard rows.
10. Update `prompt-exports/optimize-sessions-search-runs.md` with summary rows, raw artifact links, outliers, and the ranked bottleneck conclusion.
11. Only after the scoreboard identifies the dominant component, choose one optimization candidate for a separate implementation plan.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "sessions-latency-8A05BF", new_chat: false)
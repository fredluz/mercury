# Performance Benchmarks

Mercury performance checks are local, opt-in diagnostics. They write JSON/NDJSON artifacts under `prompt-exports/` and must not send analytics externally.

## Safety contract

- Runtime telemetry is disabled unless `MERCURY_PERF_DIAG=1` (or the legacy sessions-only `MERCURY_SESSIONS_DIAG=1`) is set.
- Renderer marks go through `src/renderer/src/perf.ts` and the preload `recordPerfEvent` bridge; renderer code should send timing, counts, lengths, screen/view names, and booleans only.
- Do not log prompt text, response text, raw SSH commands, tokens, API keys, authorization headers, config file contents, environment values, or stderr/stdout that may contain secrets.
- Compare perf results only between runs with similar flags and hardware. Telemetry writes add overhead when enabled.

## Required build state

Electron E2E perf scripts launch `out/main/index.js`. Use package scripts when possible because they build first:

```bash
npm run perf:build
npm run perf:startup
npm run perf:chat-render
npm run perf:sessions:e2e
npm run perf:ssh-remote
```

If running scripts directly, build first:

```bash
npm run build
node scripts/e2e-startup-perf.mjs
```

## Commands and artifacts

| Command | What it measures | Default artifact | Determinism |
| --- | --- | --- | --- |
| `npm run perf:build` | Built `out/**` raw/gzip sizes, totals by extension, initial renderer assets, renderer dynamic imports | `prompt-exports/perf-runs/<runId>-build-bundle.json` | Local deterministic after a build |
| `npm run perf:startup` | Electron launch to first window, DOM content loaded, Chat visible, main/renderer startup marks, memory snapshots | `prompt-exports/perf-runs/<runId>.json` plus per-sample NDJSON | Local deterministic, affected by machine load |
| `npm run perf:chat-render` | Synthetic chat stream render latency, long tasks, DOM mutations, first-render timing | `prompt-exports/perf-runs/<runId>-chat-render.json` plus NDJSON | Local deterministic synthetic stream |
| `npm run perf:sessions:bench` | Local session DB/cache benchmark through Vitest when `MERCURY_SESSIONS_BENCH=1` | `prompt-exports/sessions-latency-runs/` | Local deterministic seeded data |
| `npm run perf:sessions:e2e` | Built-app Sessions UI mount/search timings, including 300ms UI debounce | `prompt-exports/sessions-latency-runs/` | Local deterministic seeded data |
| `npm run perf:trace-store` | Trace-store write/list stress benchmark when `MERCURY_TRACE_STORE_BENCH=1` | `prompt-exports/perf-runs/<runId>-trace-store.json` | Local deterministic seeded data |
| `npm run perf:ssh-remote` | SSH/remote connection/tunnel/API latency with dependency status labels | `prompt-exports/perf-runs/<runId>-ssh-remote.json` | External-network-dependent |

## Environment flags

### Generic startup/runtime telemetry

- `MERCURY_PERF_DIAG=1` — enables generic local telemetry.
- `MERCURY_PERF_DIAG_FILE=/path/to/file.ndjson` — telemetry output file.
- `MERCURY_PERF_RUN_ID=<id>` — copied into telemetry records.
- `MERCURY_PERF_SAMPLE_EVERY=<n>` — optional sampling config surfaced to renderer helpers.

### Sessions compatibility

- `MERCURY_SESSIONS_DIAG=1` — enables legacy sessions IPC diagnostics.
- `MERCURY_SESSIONS_DIAG_FILE=/path/to/file.ndjson` — sessions diagnostic file.
- `MERCURY_SESSIONS_BENCH=1` — enables the sessions Vitest benchmark.
- `MERCURY_SESSIONS_BENCH_SESSIONS`, `MERCURY_SESSIONS_BENCH_MESSAGES`, `MERCURY_SESSIONS_BENCH_LARGE_MESSAGES=1` — scale seeded session data.

### Chat render benchmark

- `MERCURY_CHAT_SYNTHETIC_STREAM=1` — routes chat through the deterministic synthetic stream.
- `MERCURY_CHAT_SYNTHETIC_CHUNKS`, `MERCURY_CHAT_SYNTHETIC_INTERVAL_MS`, `MERCURY_CHAT_SYNTHETIC_PAYLOAD` — control synthetic stream shape.

### Trace-store benchmark

- `MERCURY_TRACE_STORE_BENCH=1` — enables the trace-store stress benchmark.

## Measured evidence vs inference

When updating `docs/performance-audit.md` or reporting perf results:

- Label a value as **measured** only when it comes from a current artifact or command output.
- Label likely causes as **inference** unless a benchmark isolates that cause.
- Prefer linking or naming artifact paths over pasting large raw data.
- Keep historical results dated; do not treat a previous build snapshot as current after asset, dependency, or bundler changes.

## Verification bundle

For changes to telemetry, startup scripts, package scripts, or docs:

```bash
node --check scripts/e2e-startup-perf.mjs
node --check scripts/perf-build-snapshot.mjs
npm run test -- tests/perf-telemetry.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run typecheck
npm run check:docs
```

Run `npm run perf:build` and `npm run perf:startup` when practical. Skip or mark `perf:ssh-remote` as dependency-bound when SSH/remote credentials or network access are unavailable.

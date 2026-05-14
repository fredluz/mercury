# Optimize Sessions Search Runs

Purpose: diagnose Mercury Sessions list/search latency before implementing optimizations.

## Stop criterion

Choose an optimization only after one component explains the dominant median or p95 latency for the relevant mode/cache state. Search input-to-results includes the fixed 300 ms debounce in `Sessions.tsx`; `search-sessions` IPC duration excludes debounce.

## Summary runs

| Run ID | Date | Commit | Environment | Mode | Dataset size | Query | Cache | FTS | Warm/cold | Samples | Mount ms median/p95 | List cache ms median/p95 | Sync ms median/p95 | Search IPC ms median/p95 | Renderer input-to-results ms median/p95 | Notes | Conclusion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| local-functions-1778761239463 | 2026-05-14 | 2ee2ec5 | macOS Darwin 25.2 arm64; Node 26.0.0 | local function | 5 sessions / 30 messages / small+large synthetic | latencyneedle | empty initial + warm | yes | warm after 5 warmups | 30 | n/a | 0.014 / 0.019 | 0.128 / 0.460 (empty initial 0.792 single) | 0.128 / 0.140 small; 0.263 / 0.320 large | n/a | Function-only baseline; direct local storage/search is sub-ms. | Local functions do not explain perceived slowness. |
| ui-2026-05-14T12-18-46-284Z-synthetic-local-warm | 2026-05-14 | 2ee2ec5 | macOS Darwin 25.2 arm64; Electron 39.8.5 | local UI/IPC | 5 sessions / 30 messages / small synthetic | latencyneedle | warm | yes | warm cache; fresh app per mount; waits for sync diagnostic | 5 mount / 10 search | 298.4 / 330.4 | 0.265 / 0.461 | 3.062 / 48.550 | 0.835 / 2.095 | 332.1 / 344.7 | Search renderer waits for actual `search-sessions` diagnostic; sync p95 has one 48.6ms outlier. | Dominant search component is fixed debounce + renderer scheduling, not IPC/search. |
| ui-2026-05-14T12-19-03-976Z-synthetic-local-empty | 2026-05-14 | 2ee2ec5 | macOS Darwin 25.2 arm64; Electron 39.8.5 | local UI/IPC | 5 sessions / 30 messages / small synthetic | latencyneedle | empty | yes | empty cache; fresh app per mount; waits for sync diagnostic | 5 mount / 5 search | 302.1 / 312.3 | 0.186 / 0.250 | 2.548 / 3.563 | 1.003 / 1.308 | 328.8 / 331.1 | Clean empty-cache run; sync remains low. | Empty-cache sync is not dominant for 5 local sessions. |
| ui-2026-05-14T12-23-46-293Z-current-config-warm | 2026-05-14 | 2ee2ec5 | macOS Darwin 25.2 arm64; Electron 39.8.5 | local UI/IPC current config | current user home; resultCount 20 for measured searches | redacted length 1 / sha256_12 ca978112ca1b | current | unknown | active search after Sessions content visible; 2 warmups then 10 measured | 10 measured search | n/a | 0.170 single | 109.816 single | 17.594 / 22.514 measured only (warmups excluded) | 353.3 / 361.0 | Visible spinner path is active search, not mount/loading. Search IPC is ~18ms median vs ~353ms visible. | Current app is local mode; visible search latency is dominated by debounce/renderer, not backend/search. |

## Raw sample artifacts

| Run ID | Artifact | Contents | Notes |
| --- | --- | --- | --- |
| local-functions-1778761239463 | `prompt-exports/sessions-latency-runs/local-functions-1778761239463.json` | Function samples and summary stats | Current final function baseline after restoring Node ABI. |
| ui-2026-05-14T12-18-46-284Z-synthetic-local-warm | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-18-46-284Z-synthetic-local-warm.json` | UI samples and summary stats | Final warm-cache UI baseline after review fixes. |
| ui-2026-05-14T12-18-46-284Z-synthetic-local-warm | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-18-46-284Z-synthetic-local-warm-*.ndjson` | IPC diagnostic samples | One file per mount plus search file. |
| ui-2026-05-14T12-19-03-976Z-synthetic-local-empty | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-19-03-976Z-synthetic-local-empty.json` | UI samples and summary stats | Final empty-cache UI baseline after review fixes. |
| ui-2026-05-14T12-19-03-976Z-synthetic-local-empty | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-19-03-976Z-synthetic-local-empty-*.ndjson` | IPC diagnostic samples | One file per mount plus search file. |
| ui-2026-05-14T12-23-46-293Z-current-config-warm | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-23-46-293Z-current-config-warm.json` | Current-config UI search samples and summary stats | Query redacted; renderer has 10 measured samples after 2 warmups. |
| ui-2026-05-14T12-23-46-293Z-current-config-warm | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-23-46-293Z-current-config-warm-search.ndjson` | Current-config IPC diagnostic samples | Includes 2 warmup + 10 measured search IPC rows; measured scoreboard excludes first 2 search rows. |
| ui-2026-05-14T12-08-26-236Z-synthetic-local-warm | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-08-26-236Z-synthetic-local-warm.json` | Earlier UI samples | Superseded: renderer search timing race made input-to-results invalid. |
| ui-2026-05-14T12-10-10-001Z-synthetic-local-warm | `prompt-exports/sessions-latency-runs/ui-2026-05-14T12-10-10-001Z-synthetic-local-warm.json` | Debug UI samples | Superseded: captured native ABI mismatch error before `npm run postinstall`. |

## Ranked bottleneck summary

| Rank | Bottleneck | Evidence | Affected mode/cache state | Candidate optimization | Decision |
| ---: | --- | --- | --- | --- | --- |
| 1 | Fixed 300ms debounce / renderer wait for search | Warm UI: renderer input-to-results 332.1ms median / 344.7ms p95 while `search-sessions` IPC is 0.835ms median / 2.095ms p95. Empty UI confirms 328.8ms median / 331.1ms p95 with IPC 1.003ms / 1.308ms. | local warm+empty, 5-session synthetic | Do not show spinner during debounce; optionally lower/defer debounce and add stale-result guard. | clear enough for local synthetic search UX; confirm user mode if SSH suspected. |
| 2 | First Sessions mount/render work, not cache/search IPC | Warm mount 298.4ms median while list cache is 0.265ms and sync is 3.062ms median. Empty mount 302.1ms median with sync 2.548ms median. | local warm+empty, 5-session synthetic | Profile renderer mount/render separately if initial page spinner remains the reported issue. | measure more only if the screenshot was initial mount, not search. |
| 3 | Local sync/search implementation | Function and IPC timings are sub-ms to low-ms; sync p95 11.2ms one warm outlier, empty p95 3.3ms. | local synthetic | No local DB/search optimization yet. | reject as dominant for 5-session local baseline. |

## Outliers and exclusions

| Run ID | Sample | Reason | Included in raw? | Included in warm summary? |
| --- | --- | --- | --- | --- |
| ui-2026-05-14T12-18-46-284Z-synthetic-local-warm | sync sample max 48.550ms | Single sync p95/max outlier in warm UI IPC; still far below renderer search median and not mount-dominant. | yes | yes |
| ui-2026-05-14T12-08-26-236Z-synthetic-local-warm | renderer search min 11.076ms and only 7 search IPC samples | Harness race checked completion before debounce; superseded by `ui-2026-05-14T12-12-38-235Z-synthetic-local-warm`. | yes | no |
| ui-2026-05-14T12-10-10-001Z-synthetic-local-warm | sync/search IPC errors | `better-sqlite3` was compiled for Node ABI 147 while Electron required ABI 140; fixed for Electron run with `npm run postinstall`, then restored Node/Vitest with `npm rebuild better-sqlite3`. | yes | no |

## Notes

- Search input-to-results includes the fixed 300 ms debounce in `Sessions.tsx`.
- `search-sessions` IPC duration excludes debounce.
- `list-cached-sessions`, `sync-session-cache`, and `search-sessions` IPC rows are emitted only when `MERCURY_SESSIONS_DIAG=1`.
- SSH cold and warm samples must be reported separately.
- Real-user runs should avoid storing raw message content or sensitive query text.

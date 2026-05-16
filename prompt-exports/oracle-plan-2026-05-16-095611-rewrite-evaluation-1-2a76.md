## Final Prompt
<taskname="Rewrite Evaluation"/>
<task>
Evaluate Mercury's likely performance profile as an Electron/Vite React desktop wrapper around Hermes, then produce a recommendation on whether it is worth (1) rewriting the frontend as a native macOS app and (2) porting backend/runtime code to Rust or Go. This is a read-only evaluation/report task: do not implement code. Separate measured evidence from inference, identify missing measurements, and favor targeted optimization recommendations over broad rewrites unless the selected evidence clearly supports a rewrite.

Also build a concise sub-agent work plan for the evaluation. Suggested tracks: Electron/frontend performance, Hermes/runtime/backend performance, evidence/measurement audit, and strategic rewrite tradeoff synthesis.
</task>

<architecture>
Mercury is an Electron desktop app with four boundaries:
- Main process: `src/main/index.ts` owns Electron lifecycle, BrowserWindow, menu/updater, startup/shutdown cleanup, SSH auto-start, and IPC registration.
- IPC/domain services: `src/main/ipc/*` exposes chat, config, sessions, gateway, install, models, knowledge, trace, and system handlers; many handlers import main-process subsystems eagerly.
- Hermes integration: `src/main/hermes/*` dispatches chat to API or CLI, manages local/remote/SSH connection mode, gateway process state, SSE parsing, title generation, and trace-event normalization.
- Renderer/preload: `src/preload/*` exposes `window.hermesAPI`; `src/renderer/src/App.tsx`, `Layout.tsx`, Chat, Sessions, and Gateway are the main UI/performance surfaces.

Important measured baseline from `docs/performance-audit.md`: production build passed; renderer initial app chunk about 1442.7 KiB (278.5 KiB gzip), deferred syntax-highlighter chunk about 2400.4 KiB (639.1 KiB gzip), main bundle about 304 KiB (75.9 KiB gzip), preload about 12.5 KiB (2.5 KiB gzip), bundled `.ttf` assets about 12 MiB. Web TypeScript target was the larger compile cost. Audit observed non-default renderer screens are statically imported in `Layout.tsx`, while syntax highlighting is already lazy-loaded in `AgentMarkdown.tsx`.

Important latency evidence from `prompt-exports/optimize-sessions-search-runs.md` and artifacts: direct local list/sync/search functions are sub-ms to low-ms; current-config UI search shows renderer input-to-results median about 353ms while `search-sessions` IPC median is about 17.6ms, dominated by the fixed 300ms debounce/renderer path rather than backend search. Current-config sync had one 109ms sample; synthetic function and UI runs do not support a Rust/Go port for Sessions as the first move.
</architecture>

<selected_context>
`.agents/skills/electron-pro/SKILL.md`: Electron performance/security decision framework; useful for native-vs-Electron tradeoffs.
`package.json`, `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`: dependency stack, scripts, Electron/Vite/React/TypeScript versions, better-sqlite3 externalization.
`docs/architecture/overview.md`: evergreen process-boundary and startup/shutdown map.
`docs/performance-audit.md`: key measured bundle/typecheck/build data and existing quick-win hypotheses.
`prompt-exports/optimize-sessions-search-runs.md` and selected latency JSON/NDJSON: sessions search/list/sync measurements and bottleneck conclusions.
`src/main/index.ts`: app startup, BrowserWindow options (`sandbox:false`, `webviewTag:true`), menu/updater, eager imports, SSH launch path, cleanup.
`src/main/ipc/*.ts` selected: IPC composition plus chat/sessions/config/gateway/install/knowledge/models/trace/system handlers for eager import and runtime boundary analysis.
`src/main/hermes/*`: API vs CLI dispatch, gateway child process management, connection modes, SSE parsing, usage/session-id/title behavior.
`src/main/session-cache.ts`, `sessions.ts`, `session-db.ts`: SQLite/cache/session search/list behavior and profile-aware DB paths.
`src/main/trace-store.ts`: JSON trace persistence; full read-modify-write per event is a plausible hot path only if trace volume grows.
`src/main/config.ts`, `profiles.ts`, `memory.ts`, `skills.ts`, `models.ts`, `tools.ts`, `install/paths.ts`, `utils.ts`: filesystem/config/profile/model/memory helpers used by IPC and startup.
`src/main/ssh-tunnel.ts`, `ssh-remote.ts`, `src/main/ssh/{runtime,sessions-profiles,transport}.ts`: SSH mode execution, tunnel, remote session/profile operations.
`src/preload/*`: renderer API bridge and typings for IPC surface size/shape.
`src/renderer/src/App.tsx`: splash/install/setup/main routing and lazy verify behavior.
`src/renderer/src/screens/Layout/Layout.tsx`: static imports of many screens, visited-view mount behavior, remote gating, menu/update handling.
`src/renderer/src/screens/Chat/*` selected: chat controller, streaming listeners, local slash commands, activity grouping, message flow.
`src/renderer/src/components/AgentMarkdown.tsx`: markdown rendering and deferred syntax highlighter import.
`src/renderer/src/screens/Sessions/Sessions.tsx`: fixed 300ms search debounce and list/sync/search UI flow.
`src/renderer/src/screens/Gateway/Gateway.tsx`: env/status/platform load plus 10s gateway polling.
`src/shared/{chat-metadata,traces,skills}.ts`, `src/shared/i18n/*`: shared contracts; `i18n/index.ts` eagerly imports all locale namespaces.
`tests/sessions-local-latency.bench.test.ts`: benchmark harness that generated local function latency artifacts.
</selected_context>

<relationships>
- App boot: `src/main/index.ts` -> `registerIpcHandlers()` -> selected IPC modules -> imported main services.
- Renderer boot: `main.tsx` -> `App.tsx` -> `Layout.tsx`; `Layout.tsx` statically imports Chat/Sessions/Gateway plus additional screens not all selected here.
- Chat path: `useChatController.handleSend()` -> `window.hermesAPI.sendMessage()` -> preload `chatApi` -> `ipc/chat.ts` -> `hermes/gateway.ts` -> `chat-api.ts` or `chat-cli.ts` -> renderer stream events and `trace-store.ts`.
- Sessions search path: `Sessions.tsx` 300ms debounce -> `window.hermesAPI.searchSessions()` -> preload navigation API -> `ipc/sessions.ts` -> `sessions.ts` FTS search + cache profile attachment.
- Session cache path: `ipc/sessions.ts` -> `session-cache.ts` -> `session-db.ts` -> profile-specific `state.db` files.
- SSH path: `App.tsx`/`main/index.ts`/`ipc/chat.ts` -> `ssh-tunnel.ts` + `ssh-remote.ts` -> `ssh/runtime.ts`/`ssh/sessions-profiles.ts`/`ssh/transport.ts`.
- Trace path: `ipc/chat.ts` records run/event/usage -> `trace-store.ts` rewrites capped `desktop-traces.json`; TraceLab consumes trace runs through preload/IPC.
</relationships>

<evaluation_guidance>
Use the selected evidence to answer both rewrite questions pragmatically:
- Native macOS frontend: compare expected gains from native UI against measured Electron costs and known simpler fixes: route-level code splitting, preserving lazy syntax highlighter, reducing bundled font/image assets, profiling renderer mount/render, and tightening IPC polling/debounce UX.
- Rust/Go backend/runtime: identify which code is actual computation vs orchestration around Hermes/Python, HTTP streaming, child processes, SQLite, JSON trace persistence, and SSH. Recommend porting only if measured CPU-bound or IO-bound Node paths dominate; current selected evidence points instead to targeted Node/TS fixes and better measurement.
- Include what data is missing: cold start wall-clock, memory RSS, renderer parse/eval flamegraph, large real trace-store event workloads, large real session DB search, SSH/remote latency, package size after current brand asset changes, and CPU profiles for main/renderer.
- Suggested sub-agents: Electron/frontend auditor, Hermes runtime/backend auditor, measurement/evidence auditor, and strategy synthesis reviewer. Each should cite selected files and produce findings, risks, missing measurements, and recommendation confidence.
</evaluation_guidance>

<ambiguities>
The selected code and docs are current enough for a report, but some measurements are from 2026-05-13/14 and asset sizes may have changed after the logo/brand rollout noted in `docs/performance-audit.md`. No live profiling data, memory RSS, or cold-start timings are selected. The upstream Hermes Python source is not selected; use Mercury's integration code and the selected docs/artifacts to reason about wrapper/runtime tradeoffs rather than Hermes internals.
</ambiguities>

## Selection
- Files: 83 total (81 full, 2 codemap)
- Total tokens: 109177 (Auto view)
- Token breakdown: full 109043, codemap 134

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── .agents/
│   └── skills/
│       └── electron-pro/
│           └── SKILL.md — 1 215 tokens (full)
├── docs/
│   ├── architecture/
│   │   └── overview.md — 2 552 tokens (full)
│   └── performance-audit.md — 3 308 tokens (full)
├── prompt-exports/
│   ├── sessions-latency-runs/
│   │   ├── local-functions-1778761239463.json — 1 347 tokens (full)
│   │   ├── ui-2026-05-14T12-23-46-293Z-current-config-warm-search.ndjson — 840 tokens (full)
│   │   └── ui-2026-05-14T12-23-46-293Z-current-config-warm.json — 1 189 tokens (full)
│   └── optimize-sessions-search-runs.md — 2 048 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 192 tokens (full)
│   │   │   ├── chat-cli.ts — 1 793 tokens (full)
│   │   │   ├── connection.ts — 1 052 tokens (full)
│   │   │   ├── gateway.ts — 1 533 tokens (full)
│   │   │   ├── title.ts — 979 tokens (full)
│   │   │   ├── trace-events.ts — 2 616 tokens (full)
│   │   │   └── types.ts — 184 tokens (full)
│   │   ├── install/
│   │   │   └── paths.ts — 2 378 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 3 631 tokens (full)
│   │   │   ├── config.ts — 1 651 tokens (full)
│   │   │   ├── gateway.ts — 509 tokens (full)
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   ├── install.ts — 832 tokens (full)
│   │   │   ├── knowledge.ts — 1 605 tokens (full)
│   │   │   ├── models.ts — 339 tokens (full)
│   │   │   ├── sessions.ts — 2 134 tokens (full)
│   │   │   ├── system.ts — 431 tokens (full)
│   │   │   └── trace.ts — 167 tokens (full)
│   │   ├── ssh/
│   │   │   ├── runtime.ts — 2 791 tokens (full)
│   │   │   ├── sessions-profiles.ts — 2 828 tokens (full)
│   │   │   └── transport.ts — 1 159 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── index.ts — 2 112 tokens (full)
│   │   ├── installer.ts — 207 tokens (full)
│   │   ├── memory.ts — 1 495 tokens (full)
│   │   ├── models.ts — 826 tokens (full)
│   │   ├── profiles.ts — 1 806 tokens (full)
│   │   ├── session-cache.ts — 3 485 tokens (full)
│   │   ├── session-db.ts — 520 tokens (full)
│   │   ├── sessions.ts — 1 648 tokens (full)
│   │   ├── skills.ts — 1 999 tokens (full)
│   │   ├── ssh-remote.ts — 336 tokens (full)
│   │   ├── ssh-tunnel.ts — 1 661 tokens (full)
│   │   ├── tools.ts — 2 034 tokens (full)
│   │   ├── trace-store.ts — 2 299 tokens (full)
│   │   └── utils.ts — 378 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── app.ts — 1 266 tokens (full)
│   │   │   ├── chat.ts — 825 tokens (full)
│   │   │   ├── config.ts — 748 tokens (full)
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   ├── install.ts — 521 tokens (full)
│   │   │   ├── knowledge.ts — 797 tokens (full)
│   │   │   ├── models.ts — 1 229 tokens (full)
│   │   │   └── navigation.ts — 660 tokens (full)
│   │   ├── index.d.ts — 3 545 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── components/
│   │       │   ├── AgentMarkdown.tsx — 1 307 tokens (full)
│   │       │   ├── I18nProvider.tsx — 490 tokens (full)
│   │       │   ├── RemoteNotice.tsx — 138 tokens (full)
│   │       │   └── useI18n.ts — 143 tokens (full)
│   │       ├── screens/
│   │       │   ├── Chat/
│   │       │   │   ├── hooks/
│   │       │   │   │   └── useChatController.ts — 6 998 tokens (full)
│   │       │   │   ├── Chat.tsx — 1 369 tokens (full)
│   │       │   │   ├── chat.constants.ts — 669 tokens (full)
│   │       │   │   ├── chatActivity.ts — 1 461 tokens (full)
│   │       │   │   ├── chatCommands.ts — 1 457 tokens (full)
│   │       │   │   └── types.ts — 851 tokens (full)
│   │       │   ├── Gateway/
│   │       │   │   └── Gateway.tsx — 2 383 tokens (full)
│   │       │   ├── Layout/
│   │       │   │   └── Layout.tsx — 3 259 tokens (full)
│   │       │   └── Sessions/
│   │       │       └── Sessions.tsx — 2 945 tokens (full)
│   │       ├── App.tsx — 1 305 tokens (full)
│   │       └── main.tsx — 88 tokens (full)
│   └── shared/
│       ├── i18n/
│       │   ├── config.ts — 69 tokens (full)
│       │   ├── index.ts — 1 938 tokens (full)
│       │   └── types.ts — 35 tokens (full)
│       ├── chat-metadata.ts — 1 139 tokens (full)
│       ├── skills.ts — 188 tokens (full)
│       └── traces.ts — 417 tokens (full)
├── tests/
│   └── sessions-local-latency.bench.test.ts — 1 757 tokens (full)
├── electron.vite.config.ts — 121 tokens (full)
├── package.json — 784 tokens (full)
├── tsconfig.json — 28 tokens (full)
├── tsconfig.node.json — 70 tokens (full)
├── tsconfig.web.json — 110 tokens (full)
└── vitest.config.ts — 126 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   └── ipc/
    │       └── types.ts — 44 tokens (auto)
    └── renderer/
        └── src/
            └── screens/
                └── Models/
                    └── Models.tsx — 90 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `rewrite-evaluation-193F43` | **Mode**: plan


> 💡 Continue this plan conversation with ask_oracle(chat_id: "rewrite-evaluation-193F43", new_chat: false)
---

## Orchestrator Coordination Log

- [x] Workstream 1 — Electron/frontend vs native macOS evaluation completed by session `89EF43FB-C41A-47AC-BDE2-C0981BA1C44D`.
- [x] Workstream 2 — Backend/runtime Rust-Go tradeoff evaluation completed by session `2BE14C11-5C89-4FBE-9E4F-1120FADEF606`.
- [x] Workstream 3 — Performance evidence audit completed by session `6655849F-82F8-4E4B-8B2E-83A99CC9B762`.
- [x] Spot-checked load-bearing bundle/session/trace-store claims against source docs/code before final rollup.

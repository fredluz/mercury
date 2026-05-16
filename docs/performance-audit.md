# Mercury Performance Audit

Date: 2026-05-13  
Scope: audit/documentation only for Work item 4. No source-code optimizations were made.

## 2026-05-16 benchmark scaffold update

Startup/build/chat/session/trace/SSH measurement entrypoints now live in [Performance benchmarks](testing/performance-benchmarks.md). Use those commands for current evidence instead of relying on the historical inline Node snippets below.

Current local commands:

```bash
npm run perf:build
npm run perf:startup
npm run perf:chat-render
npm run perf:sessions:bench
npm run perf:sessions:e2e
npm run perf:trace-store
npm run perf:ssh-remote
```

Artifacts are written under `prompt-exports/perf-runs/` and `prompt-exports/sessions-latency-runs/`. `perf:ssh-remote` depends on reachable external SSH/remote services and may report skipped/dependency status instead of a local performance value.

The bundle numbers in the 2026-05-13 baseline are historical until refreshed with `npm run perf:build`. Startup timings should be treated as measured only when backed by a current `npm run perf:startup` artifact; hypotheses about import cost or route weight remain inference unless isolated by a benchmark.

## Baseline environment

- Node: `v26.0.0`
- npm: `11.12.1`
- TypeScript: `5.9.3`
- Build tool observed during `npm run build`: Vite `7.3.1` via `electron-vite`
- Git status before doc creation: clean tracked tree; `prompt-exports/` untracked

## Commands run

```bash
node -v && npx tsc --version && npm -v
/usr/bin/time -p npx tsc --noEmit -p tsconfig.node.json --composite false --extendedDiagnostics
/usr/bin/time -p npx tsc --noEmit -p tsconfig.web.json --composite false --extendedDiagnostics
/usr/bin/time -p npm run build
node - <<'NODE'
const fs=require('fs'); const path=require('path'); const zlib=require('zlib');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>{const p=path.join(dir,d.name); return d.isDirectory()?walk(p):[p]})}
const files=walk('out').map(p=>{const b=fs.readFileSync(p); return {p, size:b.length, gzip:zlib.gzipSync(b).length}}).sort((a,b)=>b.size-a.size);
console.log('Top emitted files:');
for (const f of files.slice(0,25)) console.log(`${(f.size/1024).toFixed(1)} KB gzip ${(f.gzip/1024).toFixed(1)} KB ${f.p}`);
const groups={};
for (const f of files){const ext=path.extname(f.p)||'(none)'; groups[ext]=(groups[ext]||0)+f.size}
console.log('\nTotals by extension:');
for (const [ext,size] of Object.entries(groups).sort((a,b)=>b[1]-a[1])) console.log(`${ext}: ${(size/1024).toFixed(1)} KB`);
NODE
cat out/renderer/index.html
for f in out/renderer/assets/index-*.js; do echo "$f"; grep -o 'import("./[^\"]*' "$f" | head -20 || true; done
```

## Baseline measurements

### TypeScript diagnostics

| Target | Result | TSC total | Wall time | Files | TS LOC | Types | Instantiations | Memory | Check time |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `tsconfig.node.json` | pass | 1.90s | 2.94s | 431 | 12,562 | 15,864 | 7,043 | 208,658K | 0.55s |
| `tsconfig.web.json` | pass | 4.92s | 5.91s | 488 | 13,607 | 31,171 | 51,966 | 261,458K | 3.22s |

Observation: the web target is the main TypeScript cost. Instantiations are much higher in the renderer target, likely from React/component and markdown/highlighter types rather than main-process code.

### Production build

`npm run build` passed.

- Total wall time: 15.11s
- Main build: `out/main/index.js` 311.26 kB reported by Vite; measured 304.0 KiB, gzip 75.9 KiB
- Preload build: `out/preload/index.js` 12.81 kB reported by Vite; measured 12.5 KiB, gzip 2.5 KiB
- Renderer build: 2,881 modules transformed; built in 5.25s

Top emitted files by measured size:

| File | Size | gzip | Notes |
| --- | ---: | ---: | --- |
| `out/renderer/assets/index-BaMQrRfW.js` | 2400.4 KiB | 639.1 KiB | Lazy syntax-highlighter-related chunk imported from app chunk when code highlighting is needed |
| `out/renderer/assets/index-CgjHTpTd.js` | 1442.7 KiB | 278.5 KiB | Initial renderer app chunk referenced by `index.html` |
| `out/main/index.js` | 304.0 KiB | 75.9 KiB | Single main-process bundle |
| `out/renderer/assets/index-CtnxvIB8.css` | 99.4 KiB | 14.1 KiB | Global CSS |
| `out/preload/index.js` | 12.5 KiB | 2.5 KiB | Preload bridge |

Asset totals by extension:

| Extension | Total size |
| --- | ---: |
| `.ttf` | 12,035.5 KiB |
| `.js` | 4,348.2 KiB |
| `.png` | 2,567.2 KiB |
| `.css` | 99.4 KiB |
| `.html` | 0.5 KiB |

Asset observations:

- Six bundled Google Sans `.ttf` files contribute about 12.0 MiB uncompressed.
- `splash-D-LT1PSI.png` is about 2.0 MiB; `icon-DmaHCIN7.png` is about 0.5 MiB.
- Post-audit note (2026-05-14): the Mercury logo rollout replaced the app splash/icon derivatives with assets generated from `brand/source/mercury-logo-source.png` via `scripts/generate-brand-assets.mjs`; re-measure emitted asset sizes before acting on the historical splash/icon numbers above.
- The initial HTML references only `index-CgjHTpTd.js` and CSS. The larger `index-BaMQrRfW.js` chunk is dynamically imported from the app chunk and appears tied to `react-syntax-highlighter` language/style loading.

## Baseline code observations

### Main process startup

`src/main/index.ts` eagerly imports nearly all main-process subsystems at module load, including installer, Hermes gateway/session helpers, SSH tunnel, Claw3D, config, sessions, session cache, models, profiles, memory, soul, tools, skills, cronjobs, trace store, and locale-related modules.

Current implications:

- IPC handlers can be registered synchronously, but the code currently pays import/initialization cost for optional areas before any matching IPC call.
- `better-sqlite3` is externalized in `electron.vite.config.ts`, but modules that import it, such as `session-cache.ts`, are still eagerly imported by `main/index.ts`.
- Claw3D is an optional/soon-to-be-retired surface but still contributes eager main-process import cost until Work item 5 removes or lazy-loads it.

### Renderer initial route behavior

`src/renderer/src/screens/Layout/Layout.tsx` keeps `Chat` mounted for the default route and uses `visitedViews` to delay mounting other panes until first visit. However, it statically imports every screen component up front:

- `Sessions`
- `TraceLab`
- `Agents`
- `Settings`
- `Skills`
- `Soul`
- `Memory`
- `Tools`
- `Gateway`
- `Office`
- `Models`
- `Providers`
- `Schedules`

Current implication: lazy mounting reduces runtime work after startup, but it does not reduce initial renderer parse/evaluation or initial bundle weight for those statically imported screens.

### Markdown and syntax highlighting

`AgentMarkdown` already lazy-loads `react-syntax-highlighter` and the one-dark style when a code block mounts. Build output confirms a large deferred chunk for this path. Chat imports `AgentMarkdown`, so markdown rendering itself remains in the initial app chunk, while syntax-highlighter internals are deferred.

### I18n loading

`src/shared/i18n/index.ts` eagerly imports all locale namespaces for all four locales, including `office`, into a single `resources` object. This makes all translations available synchronously but adds all locale data to every process/bundle that imports shared i18n.

### Polling and IPC patterns

- `Gateway.tsx` loads env, gateway status, and platform flags on mount/profile change, then polls `gatewayStatus()` every 10s while the component remains mounted.
- `Office.tsx` polls Claw3D status every 5s only when the Office tab is visible and ready. Work item 1/5 should remove this cost with the Office feature.
- `Memory.tsx` performs four IPC reads in parallel on mount/profile change: memory, memory provider config, provider discovery, and env.
- `Skills.tsx` loads installed and bundled skills in parallel on mount/profile change.
- `Layout.tsx` calls `isRemoteOnlyMode()` on every tab switch.

### Persistence patterns

`trace-store.ts` performs full JSON read-modify-write operations for trace run creation, every trace event, usage recording, and run finish. It caps stored runs to 200 and caps agent delta events per run to 80, but high-frequency trace writes still rewrite the entire JSON file.

`session-cache.ts` is comparatively more optimized: it keeps a local sessions cache and uses a `Map` to avoid O(N²) sync behavior.

`config.ts` uses a short in-memory TTL cache for repeated profile env/config reads.

## Prioritized quick wins

### P0 — Coordinate with active workstreams before code changes

Do not apply performance edits to `Layout.tsx`, `Agents.tsx`, `src/main/index.ts`, preload, e2e, README, or tests until the Office removal and manual skill import agents have landed or coordinated their changes. These files are active merge-conflict surfaces.

### P1 — Code-split non-default renderer screens

Keep `Chat` eager as the default route, but convert non-default screens in `Layout.tsx` to `React.lazy` plus one shared `Suspense` fallback. Preserve `visitedViews` so first-visited panes stay mounted after loading.

Expected effect: lower initial renderer chunk parse/evaluation cost by moving non-chat screens out of `index-CgjHTpTd.js`.

Highest-value candidates after Office removal/profile workspace changes:

1. `TraceLab`
2. `Sessions`
3. `Agents` profile workspace and embedded Skills/Memory/Soul tabs
4. `Settings`, `Models`, `Providers`, `Schedules`, `Gateway`, `Tools`

### P2 — Lazy-load heavy optional main-process modules inside IPC handlers

Keep IPC registration synchronous, but replace top-level imports with dynamic imports where the handler is not needed during app boot.

First candidates:

1. `session-cache` / `sessions` handlers that touch SQLite or session JSON
2. `memory` and `skills` handlers used by non-default screens
3. Claw3D handlers if they remain after visible Office removal; otherwise remove them in Work item 5

Avoid lazy-loading install/boot status paths until measured, because startup screens depend on them.

### P3 — Remove Office/Claw3D from visible and hidden paths via Work items 1 and 5

The Office screen currently adds a renderer screen, i18n namespace, CSS, Claw3D polling path, and main-process imports. Work item 1 should remove the visible renderer/i18n/CSS route. Work item 5 should then remove backend/preload Claw3D imports and IPC handlers.

Expected effect: smaller renderer app chunk, fewer i18n resources, no Office polling path, less eager main-process import cost.

### P4 — Reduce renderer asset weight

The bundled fonts dominate emitted assets at about 12.0 MiB. Quick follow-up options:

- Subset Google Sans files to required glyph ranges.
- Drop unused weights/styles if design allows.
- Prefer `woff2` over raw `.ttf` for renderer assets.
- Recompress or downscale generated brand image assets if visual quality remains acceptable; current logo derivatives are generated by `npm run brand:generate`.

Expected effect: smaller app package and faster cold asset loading. This may not materially change JS parse time.

### P5 — Keep syntax highlighting deferred and avoid pulling it into route chunks

`AgentMarkdown` already lazy-loads `react-syntax-highlighter`; preserve this. When code-splitting screens, verify the highlighter remains a deferred chunk and does not move back into the initial app chunk.

### P6 — Add stale async guards for profile-switching screens

`Memory.tsx` and `Skills.tsx` can issue multi-IPC loads on profile changes. Add request-id or cancellation guards when those files are next edited so late results from an old profile do not overwrite the current profile state.

Expected effect: correctness and perceived responsiveness during fast profile switching, not necessarily smaller bundles.

### P7 — Batch or debounce trace-store writes if tracing becomes hot

If trace event volume grows, consider batching trace JSON writes or moving trace persistence to SQLite/append-log style storage. Keep the current caps, but avoid one full JSON rewrite per small event on high-frequency paths.

## Verification commands for future optimization PRs

Run before and after each performance change and paste results back into this document or a follow-up audit note.

```bash
# TypeScript diagnostics
/usr/bin/time -p npx tsc --noEmit -p tsconfig.node.json --composite false --extendedDiagnostics
/usr/bin/time -p npx tsc --noEmit -p tsconfig.web.json --composite false --extendedDiagnostics

# Full validation
npm run typecheck
npm run test
npm run build

# Bundle/chunk size snapshot after build
node - <<'NODE'
const fs=require('fs'); const path=require('path'); const zlib=require('zlib');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>{const p=path.join(dir,d.name); return d.isDirectory()?walk(p):[p]})}
const files=walk('out').map(p=>{const b=fs.readFileSync(p); return {p, size:b.length, gzip:zlib.gzipSync(b).length}}).sort((a,b)=>b.size-a.size);
for (const f of files.slice(0,25)) console.log(`${(f.size/1024).toFixed(1)} KB gzip ${(f.gzip/1024).toFixed(1)} KB ${f.p}`);
NODE

# Confirm initial renderer entry and deferred chunks
cat out/renderer/index.html
for f in out/renderer/assets/index-*.js; do
  echo "$f"
  grep -o 'import("./[^\"]*' "$f" | head -20 || true
done
```

Manual smoke after code-splitting or lazy main-process imports:

```bash
npm run dev
```

Validate:

- App opens to Chat.
- Chat can send/abort a message.
- Each sidebar/profile route opens once, then switches back without remount regressions.
- Sessions, Skills, Memory, Gateway, Settings, and profile switching still call their IPC paths successfully.
- Remote-only mode still shows the appropriate restricted-screen notices.

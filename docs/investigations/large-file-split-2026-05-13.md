# Investigation: Large Files Split Plan

## Summary
Mercury has 15 tracked source/source-like files above 500 LOC, plus generated metadata/build artifacts that should be excluded from refactor work. The highest-value split path is: mechanical CSS sharding, IPC/preload contract extraction, SSH/service domain splits, constants sharding, then renderer screen component/hook extraction.

## Symptoms
- Several source/test files may exceed the target maximum of 500 LOC.
- Generated/dependency metadata should be ranked if encountered, but excluded from refactor recommendations.

## Background / Prior Research
No external research required; this investigation is based on repository structure and source/test contents.

## Investigator Findings
<!-- Pair investigator will append structured analysis here. -->

### Pair Validation - 2026-05-13

#### Scope and LOC validation
**Conclusion:** The Context Builder ranking is accurate for source/test/source-like files in scope. No additional source or test files over 500 LOC were found. Generated/dependency/build outputs are over threshold but should not drive refactor work.

**Validated over-threshold source/source-like ranking:**

| Rank | File | LOC | Classification | Recommendation status |
|---:|---|---:|---|---|
| 1 | `src/renderer/src/assets/main.css` | 5,410 | source-like CSS / vendor-like global stylesheet | Split recommended |
| 2 | `src/main/index.ts` | 1,325 | source | Split recommended |
| 3 | `src/main/ssh-remote.ts` | 1,220 | source | Split recommended |
| 4 | `src/renderer/src/screens/Chat/Chat.tsx` | 1,175 | source | Split recommended |
| 5 | `src/main/installer.ts` | 1,073 | source | Split recommended |
| 6 | `src/renderer/src/screens/Settings/Settings.tsx` | 938 | source | Split recommended |
| 7 | `src/main/hermes.ts` | 847 | source | Split recommended |
| 8 | `src/renderer/src/screens/TraceLab/TraceLab.tsx` | 835 | source | Split recommended |
| 9 | `src/renderer/src/constants.ts` | 802 | source | Split recommended |
| 10 | `src/preload/index.ts` | 707 | source | Split recommended |
| 11 | `src/renderer/src/screens/Schedules/Schedules.tsx` | 634 | source | Split recommended |
| 12 | `src/main/claw3d.ts` | 633 | source | Split recommended |
| 13 | `src/renderer/src/screens/Memory/Memory.tsx` | 611 | source | Split recommended |
| 14 | `src/renderer/src/screens/Skills/Skills.tsx` | 542 | source | Split recommended |
| 15 | `src/main/skills.ts` | 512 | source | Split recommended, small cut |

**Generated/dependency/build metadata encountered:** `package-lock.json` is 13,823 LOC and should be ranked as generated/dependency metadata but excluded from refactor recommendations. Build outputs under `out/` also exceed 500 LOC (`out/renderer/assets/index-*.js`, `out/main/index.js`, `out/renderer/assets/index-*.css`) and should be excluded as generated artifacts.

**Tests:** Existing checked test files are below 500 LOC. Important guardrail tests for splitting IPC/preload are `tests/ipc-handlers.test.ts:12-61` (main handler vs preload invoke parity) and `tests/preload-api-surface.test.ts:13-63`, `tests/preload-api-surface.test.ts:198-216` (preload API/type and channel naming consistency).

#### IPC and preload split seams
**Evidence:** `src/main/index.ts` has a compact app/window/menu shell plus a very large `setupIPC()` function spanning `src/main/index.ts:250-1099`; the menu/updater code starts after that at `src/main/index.ts:1105` and `src/main/index.ts:1209`. The preload bridge is similarly one large object from `src/preload/index.ts:10-693`, with final exposure at `src/preload/index.ts:695-707`.

**Natural IPC modules:**
- `ipc/install.ts`: installation/update/OpenClaw handlers at `src/main/index.ts:251-327`, backed by preload methods at `src/preload/index.ts:11-67`.
- `ipc/config.ts`: locale/config/model/connection/SSH handlers at `src/main/index.ts:326-523`, backed by `src/preload/index.ts:69-151`.
- `ipc/chat.ts`: chat send/abort and trace recording at `src/main/index.ts:524-684`, backed by chat streaming APIs at `src/preload/index.ts:153-223`.
- `ipc/trace.ts`: trace lab handlers at `src/main/index.ts:686-690`, backed by `src/preload/index.ts:225-232`.
- `ipc/gateway.ts`: gateway/platform handlers at `src/main/index.ts:693-735`, backed by `src/preload/index.ts:235-247`.
- `ipc/sessions-profiles.ts`: sessions/profiles/session cache/search at `src/main/index.ts:741-953`, backed by `src/preload/index.ts:250-433`.
- `ipc/memory-soul-tools-skills.ts` or separate domain modules: memory/soul/tools/skills handlers at `src/main/index.ts:779-923`, backed by `src/preload/index.ts:308-387`.
- `ipc/models-claw-cron-maintenance.ts` or narrower modules: credential pool/models at `src/main/index.ts:955-984`, Claw3D at `src/main/index.ts:987-1026`, cron at `src/main/index.ts:1030-1058`, and shell/backup/dump/MCP/memory-provider/log handlers at `src/main/index.ts:1061-1099`.

**Preload coupling conclusion:** Split preload in lockstep by API group while preserving one public `window.hermesAPI` shape. Keep `src/preload/index.d.ts` aligned because it defines `HermesAPI` and global `window.hermesAPI` coupling (`src/preload/index.d.ts:24`, `src/preload/index.d.ts:476-481`). The parity tests above should catch channel/API drift after extraction.

#### Main-process service split seams
**`src/main/ssh-remote.ts` (1,220 LOC):** This is the highest-value main-process split after the IPC hub. It already has comment-delimited domains and many remote implementations that mirror IPC groups.
- `src/main/ssh/transport.ts`: SSH transport and file helpers, `buildExecArgs`, `sshExec`, `sshPython`, `sanitizeSshError`, `sshReadFile`, `sshWriteFile`, `sshFileExists` at `src/main/ssh-remote.ts:32-147`.
- `src/main/ssh/skills.ts`: remote skill list/content/install/import/browse at `src/main/ssh-remote.ts:149-307`; current IPC boundary is `src/main/index.ts:858-919`.
- `src/main/ssh/memory-soul.ts`: memory CRUD, user profile, soul paths/default at `src/main/ssh-remote.ts:317-504`; current IPC boundary is `src/main/index.ts:779-841`.
- `src/main/ssh/config.ts`: toolsets, env/config/model helpers at `src/main/ssh-remote.ts:506-723`; current IPC boundaries include `src/main/index.ts:326-427` and `src/main/index.ts:841-858`.
- `src/main/ssh/sessions-profiles.ts`: sessions/search/profiles at `src/main/ssh-remote.ts:725-944`; current IPC boundary is `src/main/index.ts:741-779`, `src/main/index.ts:925-953`.
- `src/main/ssh/runtime.ts`: gateway, remote API key, version/logs/platform/update/dump/providers/models at `src/main/ssh-remote.ts:958-1220`; current IPC boundaries include `src/main/index.ts:693-735`, `src/main/index.ts:1066-1099`.

**`src/main/installer.ts` (1,073 LOC):** Split by operational concern.
- `src/main/install/paths.ts` or `runtime.ts`: constants, enhanced PATH, install status/auth/version checks at `src/main/installer.ts:21-266`.
- `src/main/install/executor.ts`: OpenClaw migrate/update/install flows, stage markers, shell profile, Windows installer wrapper at `src/main/installer.ts:305-739`.
- `src/main/install/maintenance.ts`: backup/import/dump at `src/main/installer.ts:742-875`.
- `src/main/install/introspection.ts`: memory provider discovery, MCP server listing, log reader at `src/main/installer.ts:877-1073`.

**`src/main/hermes.ts` (847 LOC):** Split by chat transport and gateway lifecycle.
- `src/main/hermes/connection.ts`: API URL, remote-mode flags, SSH auth header, tunnel ensure at `src/main/hermes.ts:25-109`.
- `src/main/hermes/chat-api.ts`: HTTP/SSE chat path, custom event parsing, usage/tool progress, stream probing at `src/main/hermes.ts:177-452`.
- `src/main/hermes/chat-cli.ts`: CLI fallback spawn/env/key handling at `src/main/hermes.ts:453-639`.
- `src/main/hermes/gateway.ts`: lazy init, health polling, start/stop/status/restart and pid handling at `src/main/hermes.ts:671-847`.

**`src/main/claw3d.ts` (633 LOC):** Split into `src/main/claw3d/config.ts` for persisted port/ws-url/settings and status helpers (`src/main/claw3d.ts:32-233`), `src/main/claw3d/setup.ts` for npm/provisioning (`src/main/claw3d.ts:234-420`), and `src/main/claw3d/runtime.ts` for process/PID/log control (`src/main/claw3d.ts:421-633`).

**`src/main/skills.ts` (512 LOC):** Only barely over threshold; extract `src/main/skills/importer.ts` for frontmatter/import preparation and markdown import (`src/main/skills.ts:44-218`, `src/main/skills.ts:453-512`), leaving catalog/search/install functions under 500 (`src/main/skills.ts:227-452`).

#### Renderer split seams
**Global CSS (`src/renderer/src/assets/main.css`, 5,410 LOC):** The file is already mostly ordered by screen and selector prefix, so the safest split is mechanical.
- Shared base/theme/fonts/app shell/components: `src/renderer/src/assets/main.css:1-482` plus layout/sidebar at `src/renderer/src/assets/main.css:796-966`.
- Install/setup: install starts at `src/renderer/src/assets/main.css:483`; setup provider styles around `src/renderer/src/assets/main.css:630-795`.
- Chat: `chat-*` and `slash-menu-*` cluster from `src/renderer/src/assets/main.css:967-1859`.
- Settings/gateway platform cards/theme options: `src/renderer/src/assets/main.css:1860-2284`.
- Agents/sessions/skills/schedules/memory/models/tools/trace clusters begin at `src/renderer/src/assets/main.css:2285`, `src/renderer/src/assets/main.css:2521`, `src/renderer/src/assets/main.css:2753`, `src/renderer/src/assets/main.css:3216`, `src/renderer/src/assets/main.css:3648`, `src/renderer/src/assets/main.css:4200`, and `src/renderer/src/assets/main.css:4518`.
- Cross-screen coupling to fix before/while splitting: `Schedules.tsx` reuses `skills-detail-overlay` (`src/renderer/src/screens/Schedules/Schedules.tsx:250`, `src/renderer/src/screens/Schedules/Schedules.tsx:434`), while that overlay is defined in the Skills CSS cluster (`src/renderer/src/assets/main.css:3018`). Extract shared modal/overlay styles first.

**`src/renderer/src/screens/Chat/Chat.tsx` (1,175 LOC):**
- Move `SLASH_COMMANDS` and `APPROVAL_RE` to `chat.constants.ts` (`src/renderer/src/screens/Chat/Chat.tsx:18-140`).
- Move `HermesAvatar`/`MessageRow` to components (`src/renderer/src/screens/Chat/Chat.tsx:124-183`).
- Extract hooks: model picker (`src/renderer/src/screens/Chat/Chat.tsx:289-318`, `src/renderer/src/screens/Chat/Chat.tsx:323-383`), chat stream listeners (`src/renderer/src/screens/Chat/Chat.tsx:385-451`), slash commands/local command execution (`src/renderer/src/screens/Chat/Chat.tsx:271-280`, `src/renderer/src/screens/Chat/Chat.tsx:354-381`, `src/renderer/src/screens/Chat/Chat.tsx:640-822`).
- Extract presentational components: header/actions/token counter (`src/renderer/src/screens/Chat/Chat.tsx:874-953`), empty suggestions (`src/renderer/src/screens/Chat/Chat.tsx:958-1023`), model dropdown (`src/renderer/src/screens/Chat/Chat.tsx:1096-1166`).

**`src/renderer/src/screens/Settings/Settings.tsx` (938 LOC):**
- Helpers: cache readers at `src/renderer/src/screens/Settings/Settings.tsx:16-31`, parsed version helper at `src/renderer/src/screens/Settings/Settings.tsx:379-390`.
- Hooks: load/config state at `src/renderer/src/screens/Settings/Settings.tsx:34-178`, migration/update/backup/log handlers at `src/renderer/src/screens/Settings/Settings.tsx:180-377`.
- Components: engine section starts at `src/renderer/src/screens/Settings/Settings.tsx:393`, connection section at `src/renderer/src/screens/Settings/Settings.tsx:512`, migration banner at `src/renderer/src/screens/Settings/Settings.tsx:657`, appearance at `src/renderer/src/screens/Settings/Settings.tsx:706`, network/data/log sections at `src/renderer/src/screens/Settings/Settings.tsx:750`, `src/renderer/src/screens/Settings/Settings.tsx:814`, and `src/renderer/src/screens/Settings/Settings.tsx:869`.

**`src/renderer/src/screens/TraceLab/TraceLab.tsx` (835 LOC):** Already has presentational helpers (`SkillTraceSummary`, `RunMap`, `Metric`, `Fact`, `TraceEventRow`, `EventInspector`) starting at `src/renderer/src/screens/TraceLab/TraceLab.tsx:429`. Extract them to components, and move domain helpers/selectors (`buildRunMap`, `explainEvent`, filters, formatting) from `src/renderer/src/screens/TraceLab/TraceLab.tsx:621-828` to `trace-lab.helpers.ts` / `trace-lab.selectors.ts`. Root load/filter state at `src/renderer/src/screens/TraceLab/TraceLab.tsx:83-157` can become `useTraceRuns`.

**`src/renderer/src/constants.ts` (802 LOC):** This file mixes unrelated domains. Split into `constants/providers.ts` (`src/renderer/src/constants.ts:16-236`), `constants/theme.ts` (`src/renderer/src/constants.ts:240-246`), `constants/settings-sections.ts` (`src/renderer/src/constants.ts:250-434`), `constants/gateway.ts` (`src/renderer/src/constants.ts:438-788`), `constants/install.ts` (`src/renderer/src/constants.ts:792-793`), and `constants/i18n.ts` for `tk` (`src/renderer/src/constants.ts:796-802`). Keep a barrel export temporarily to reduce import churn.

**Other renderer screens:**
- `Schedules.tsx` (634 LOC): extract `DELIVER_TARGETS` (`src/renderer/src/screens/Schedules/Schedules.tsx:13-30`), schedule builder/actions (`src/renderer/src/screens/Schedules/Schedules.tsx:129-234`), create/delete modals (`src/renderer/src/screens/Schedules/Schedules.tsx:248-492`), and list/card rendering (`src/renderer/src/screens/Schedules/Schedules.tsx:530-625`).
- `Memory.tsx` (611 LOC): extract `timeAgo` and `CapacityBar` (`src/renderer/src/screens/Memory/Memory.tsx:30-67`), `useMemoryData` around loading/mutations (`src/renderer/src/screens/Memory/Memory.tsx:122-192`), and tab panels for entries/profile/providers (`src/renderer/src/screens/Memory/Memory.tsx:283-609`).
- `Skills.tsx` (542 LOC): extract `useSkillsCatalog` for data/actions (`src/renderer/src/screens/Skills/Skills.tsx:52-151`), detail/import modals (`src/renderer/src/screens/Skills/Skills.tsx:198-368`), and grid/tabs/search (`src/renderer/src/screens/Skills/Skills.tsx:391-539`).

#### Prioritized split plan
1. **Split CSS first**: create modular CSS entry imports (`base.css`, `layout.css`, `chat.css`, `settings.css`, `skills.css`, etc.) and extract shared modal/overlay styles before moving screen CSS. This eliminates the largest outlier and is mostly mechanical.
2. **Split main IPC + preload together**: extract `setupIPC()` handler groups from `src/main/index.ts` and preload API groups from `src/preload/index.ts` in the same batches, using the existing parity tests as guardrails.
3. **Split `src/main/ssh-remote.ts` by domain**: do this before or alongside IPC extraction because current IPC handlers import many SSH functions by domain.
4. **Split `src/main/installer.ts` and `src/main/hermes.ts`**: these are service-level files with clear transport/execution/runtime seams and high LOC payoff.
5. **Split largest renderer screens**: `Chat.tsx`, `Settings.tsx`, `TraceLab.tsx` in that order, extracting constants/hooks/helpers before JSX sections.
6. **Split `constants.ts`**: use a barrel to avoid broad import churn; this unblocks smaller screen splits that depend on provider/gateway/settings constants.
7. **Finish remaining >500 files**: `Schedules.tsx`, `claw3d.ts`, `Memory.tsx`, `Skills.tsx`, and the small `src/main/skills.ts` importer extraction.

**Final conclusion:** A logical split plan can bring every source/test/source-like file below 500 LOC without behavior changes. The safest ordering is mechanical CSS + contract-tested IPC/preload first, then domain service splits, then renderer component/hook extractions. Generated metadata (`package-lock.json`) and build outputs should stay ranked for visibility but excluded from refactor recommendations.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** The largest files cluster around renderer screens, main-process services, and tests; logical extraction seams can reduce each source/test file under 500 LOC.
**Findings:** Context Builder identified 15 source/source-like files above 500 LOC. `package-lock.json` is 13,823 LOC but is generated/dependency metadata and excluded from refactor recommendations per user constraints. Checked tests are currently below 500 LOC.
**Evidence:** Initial ranking: `src/renderer/src/assets/main.css` 5,410; `src/main/index.ts` 1,325; `src/main/ssh-remote.ts` 1,220; `src/renderer/src/screens/Chat/Chat.tsx` 1,175; `src/main/installer.ts` 1,073; `src/renderer/src/screens/Settings/Settings.tsx` 938; `src/main/hermes.ts` 847; `src/renderer/src/screens/TraceLab/TraceLab.tsx` 835; `src/renderer/src/constants.ts` 802; `src/preload/index.ts` 707; `src/renderer/src/screens/Schedules/Schedules.tsx` 634; `src/main/claw3d.ts` 633; `src/renderer/src/screens/Memory/Memory.tsx` 611; `src/renderer/src/screens/Skills/Skills.tsx` 542; `src/main/skills.ts` 512.
**Conclusion:** Confirmed broad large-file problem; pair validation and Oracle synthesis completed.

### Phase 3/4 - Pair Validation and Oracle Synthesis
**Hypothesis:** The Context Builder ranking and initial split seams are accurate, but prioritization needs validation against coupling and guardrail tests.
**Findings:** Pair validation confirmed no missing tracked source/test/source-like files over 500 LOC, confirmed tests are below threshold, and identified the strongest seams in CSS, IPC/preload, SSH remote domains, main-process services, renderer screens, and constants. Oracle agreed with the strategy and recommended moving the pure `constants.ts` split before renderer screen extraction to reduce import churn.
**Evidence:** See `## Investigator Findings` above; spot checks confirmed the exact LOC ranking and representative line-reference seams.
**Conclusion:** Confirmed; final recommendations fold in the Oracle ordering adjustment.

## Root Cause
Large files grew because early convenience boundaries became long-term architecture boundaries:

- One global renderer stylesheet (`src/renderer/src/assets/main.css`) accumulated all design tokens, shared primitives, layout, and screen-specific selectors.
- One Electron main-process IPC hub (`src/main/index.ts`) accumulated nearly every channel registration in `setupIPC()` while `src/preload/index.ts` mirrored it as one large bridge object.
- Renderer screens remained single-file containers that combine data loading, local state machines, event handlers, helpers, and JSX.
- Main-process service files accumulated multiple operational concerns such as paths, process orchestration, parsing, install/update flows, gateway lifecycle, local mode, and SSH mode.
- Remote SSH support mirrors many local domains in one large `src/main/ssh-remote.ts` file instead of domain-specific remote modules.

## Recommendations
1. **Split CSS first**: turn `src/renderer/src/assets/main.css` into ordered imports for tokens/base, app shell, shared primitives, and per-screen/feature styles. Extract shared modal/overlay styles before screen CSS because `Schedules.tsx` currently reuses `.skills-detail-overlay` from the Skills CSS cluster.
2. **Split IPC + preload + preload types as one contract workstream**: extract `src/main/index.ts` `setupIPC()` channel groups and matching `src/preload/index.ts` API groups together while preserving `window.hermesAPI`. Update parity tests to scan the split modules or introduce a shared channel manifest.
3. **Split `src/main/ssh-remote.ts` by mirrored domain**: centralize SSH transport/core helpers first, then split skills, memory/soul, config/env/model, sessions/profiles, and runtime/gateway/logs/diagnostics/models modules.
4. **Split main-process services**: prioritize `src/main/installer.ts` and `src/main/hermes.ts`, then `src/main/claw3d.ts` and the small `src/main/skills.ts` importer extraction. Use compatibility barrels to reduce import churn.
5. **Split `src/renderer/src/constants.ts` before renderer screens**: shard providers, local presets, theme, settings sections, gateway sections/platforms, install constants, and `tk()` while preserving translation key names.
6. **Split largest renderer screens**: extract hooks/utilities first, then presentational components for `Chat.tsx`, `Settings.tsx`, and `TraceLab.tsx`; finish with `Schedules.tsx`, `Memory.tsx`, and `Skills.tsx`.
7. **Keep generated metadata visible but out of scope**: rank `package-lock.json` and build outputs for visibility, but exclude them from refactor recommendations.

## Preventive Measures
- Add a CI LOC guard for tracked source/test/source-like files, excluding lockfiles, generated metadata, and build output.
- Warn when files approach 400 LOC and fail once they exceed 500 LOC.
- Require new renderer screens to use feature folders with `components/`, `hooks/`, `utils/`, and optional local styles from the start.
- Keep IPC channels grouped by feature and backed by a contract manifest or tests that scan split IPC/preload modules.
- Keep CSS organized as tokens, shared primitives, app shell, and one screen/feature stylesheet per selector prefix.
- Split tests once they approach 400 LOC, especially after source extraction creates new focused test surfaces.

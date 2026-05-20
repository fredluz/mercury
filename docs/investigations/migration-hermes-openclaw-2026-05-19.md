# Investigation: Migration from Hermes and OpenClaw installations

## Summary

## Symptoms
- Users may already have Hermes installations with configuration, profiles, skills, memory, sessions, gateway/API settings, and credentials outside Mercury.
- Users may already have OpenClaw installations with agent configuration/state that should be imported or bridged into Mercury.
- Mercury needs a migration function that can detect existing installations, preview what can be migrated, perform safe copy/import steps, and avoid destructive changes.

## Background / Prior Research
- Local prior investigation: `docs/investigations/profile-tools-skills-memory-isolation-2026-05-16.md` found upstream Hermes profile isolation is based on profile-specific homes: default `HERMES_HOME` plus named profile homes under `HERMES_HOME/profiles/<name>`. It also found Mercury already has many profile-scoped storage helpers, but runtime gateway/API profile propagation has been a known weak point.

### Upstream Hermes installation layout
- Default Hermes home is `~/.hermes`, overridable with `HERMES_HOME`; the per-user install commonly stores code under `~/.hermes/hermes-agent/`, exposes `~/.local/bin/hermes`, and stores user data under `~/.hermes/`. Root installs may use `/usr/local/lib/hermes-agent` and `/usr/local/bin/hermes`.
- A Hermes home can contain `config.yaml`, `.env`, `auth.json`, `SOUL.md`, `memories/`, `skills/`, `cron/`, `sessions/`, `logs/`, and `state.db`.
- Named profiles are profile-specific homes, typically `~/.hermes/profiles/<name>`, each with its own config/env/SOUL/memory/session/skills/cron/state. Wrapper profile commands work by setting `HERMES_HOME=~/.hermes/profiles/<name>` before launching Hermes; the default profile remains `~/.hermes`.
- Session migration candidates include `state.db`, `sessions/`, and `sessions/sessions.json`; memory candidates include `memories/MEMORY.md`, `memories/USER.md`, and `SOUL.md`; skills candidates include `skills/` plus `.hub/` and `.bundled_manifest` metadata where present.
- Upstream commands relevant to migration/validation: install via the official `scripts/install.sh`, update via `hermes update [--check] [--backup] [--restart-gateway]`, and uninstall via `hermes uninstall [--full] [--yes]`.
- Migration risks: incorrect `HERMES_HOME` or wrapper/profile selection can import or run the wrong profile; `terminal.cwd` is independent of the profile home; `hermes uninstall --full` is destructive; some upstream issues mention hardcoded `Path.home()/.hermes` or profile isolation leaks, so migration should be copy/backup/preview based rather than destructive.

### Upstream OpenClaw installation layout
- Authoritative upstream appears to be `github.com/openclaw/openclaw` with docs at `docs.openclaw.ai`.
- Default state directory is `~/.openclaw/`; primary config file is `~/.openclaw/openclaw.json`. Alternate locations are supported via `OPENCLAW_STATE_DIR` and `OPENCLAW_CONFIG_PATH`; profile mode uses roots like `~/.openclaw-<profile>/`.
- OpenClaw is agent-centric rather than profile-centric. Current/normalized state can include `~/.openclaw/agents/<agentId>/sessions/`, `~/.openclaw/agents/<agentId>/agent/`, credentials under `~/.openclaw/credentials/whatsapp/<accountId>/...`, and per-agent `auth-profiles.json` under the agent directory.
- Migration candidates include sessions, agent state, auth profiles, credentials, `MEMORY.md`, `USER.md`, skills, and prompts. OpenClaw skill lookup can include `~/.openclaw/skills`, `~/.agents/skills`, workspace `.agents/skills`, workspace `skills`, bundled skills, and configured extra directories.
- Upstream OpenClaw migration/update flows emphasize stopping the gateway, backing up with tar, copying state, running `openclaw doctor`, restarting, and checking `openclaw status`; `openclaw doctor` can normalize legacy layouts such as `sessions/` to `agents/<agentId>/sessions/`.
- Migration risks: OpenClaw JSON config and agent-centric state do not map 1:1 to Hermes/Mercury profile homes; raw imports may need doctor/normalization first; credential/auth formats may not be compatible; preserving skill precedence may require references or manifests rather than naive copying.

### Git archaeology / current code context
- `HEAD` during investigation is `afeb98d` (2026-05-18), `refactor: split large runtime and chat files`. Local untracked install/migration-related files include this investigation report plus `scripts/Install Mercury.command` and `scripts/install-mac-release.sh`.
- Existing import flow: `src/main/install/maintenance.ts` shells to `hermes import <archive> [-p profile]`; `src/main/services/system-service.ts` marks runtime identity stale after successful import; `src/main/hermes/runtime/manager.ts` enforces runtime mode/profile identity constraints.

## Investigator Findings
<!-- Pair investigator appends structured analysis here: file:line refs, evidence, conclusions. -->

### Phase 2 - Mercury migration path audit (2026-05-19)

#### Hypothesis verdict
- **Confirmed with nuance.** Mercury has a generic Hermes backup/import wrapper and an OpenClaw migration shell-out, but it does **not** have a first-class migration planner/preview of its own.
- **Nuance:** upstream Hermes' `hermes claw migrate` is richer than Mercury exposes: official Hermes docs list `--dry-run`, `--source <path>`, `--overwrite`, `--migrate-secrets`, `--no-backup`, `--workspace-target`, and `--skill-conflict` for `hermes claw migrate`, and say the default apply path writes a pre-migration backup to `~/.hermes/backups/pre-migration-*.zip`. Mercury calls only `hermes claw migrate --preset full`, so Mercury hides the upstream preview/source/conflict/secrets/backup controls from Settings and CLI.
- **Eliminated hypothesis:** Hermes backup/import is not completely absent or unprofiled. Mercury's Settings and CLI backup/import path is profile-aware and import marks the selected runtime stale. The missing part is arbitrary raw Hermes-home ingestion/planning/collision handling, not archive import.
- **Eliminated hypothesis:** OpenClaw migration is not backed by Mercury-owned artifact mapping. The only current mapping logic is whatever upstream Hermes performs behind the `hermes claw migrate` subprocess.

#### Current OpenClaw path: Settings → preload → IPC → service → executor → CLI
- Settings initializes OpenClaw banner state from `localStorage` keys `hermes-openclaw-cache` and `hermes-openclaw-dismissed`, then checks OpenClaw only if the banner was not dismissed (`src/renderer/src/screens/Settings/Settings.tsx:17-24`, `src/renderer/src/screens/Settings/Settings.tsx:59-68`, `src/renderer/src/screens/Settings/Settings.tsx:156-167`). Dismissal therefore suppresses future checks until localStorage is cleared.
- The Settings migrate action subscribes to generic `install-progress`, calls `window.hermesAPI.runClawMigrate()`, and only sets `openclawFound=false` on success; it has no preview, source selector, profile target, conflict list, or backup/rollback UI (`src/renderer/src/screens/Settings/Settings.tsx:173-200`).
- The banner rendering is a simple detect/migrate/skip card (`src/renderer/src/screens/Settings/components/SettingsCoreSections.tsx:392-445`). It displays the detected path but does not inventory artifacts or explain what will be copied/archived.
- Preload exposes only `checkOpenClaw()` and `runClawMigrate()` with no arguments (`src/preload/api/install.ts:66-70`). IPC mirrors that minimal API as `check-openclaw` and `run-claw-migrate` (`src/main/ipc/install.ts:56-62`).
- The service layer delegates directly to `checkOpenClawExists()` / `runClawMigrate()` and returns `{ success, error }` (`src/main/services/install-service.ts:126-138`). There is no planner result type and no profile/source options.
- Detection is only directory existence for `~/.openclaw`, `~/.clawdbot`, and `~/.moldbot` (`src/main/install/paths.ts:284-293`). It ignores OpenClaw's `OPENCLAW_STATE_DIR`, `OPENCLAW_CONFIG_PATH`, and profile-style `~/.openclaw-<profile>/` roots noted in upstream OpenClaw docs.
- Execution requires local Hermes and then spawns `HERMES_PYTHON` with `[HERMES_SCRIPT, "claw", "migrate", "--preset", "full"]` under Mercury's `HERMES_HOME` (`src/main/install/executor.ts:12-49`). It does not pass upstream `--dry-run`, `--source`, `--overwrite`, `--skill-conflict`, `--migrate-secrets`, or `--yes`.
- No runtime stale marking or revalidation happens after successful OpenClaw migration (`src/main/services/install-service.ts:130-138`). This contrasts with Hermes import, config, knowledge, cron, and gateway mutations that call stale/revalidate helpers (`src/main/services/system-service.ts:31-37`, `src/main/services/config-service.ts:79-89`, `src/main/services/knowledge-service.ts:43-45`, `src/main/services/cron-service.ts:11-13`).

#### Hermes backup/import path
- Settings backup/import uses the active Mercury profile (`src/renderer/src/screens/Settings/Settings.tsx:262-290`). Import is a file picker limited to `.tar.gz,.tgz,.zip`; there is no “select an existing Hermes home” flow (`src/renderer/src/screens/Settings/Settings.tsx:274-284`).
- Preload and IPC are profile-aware: `runHermesBackup(profile?)` / `runHermesImport(archivePath, profile?)` (`src/preload/api/app.ts:145-153`, `src/main/ipc/system.ts:37-44`).
- Service import marks the selected profile stale after a successful restore (`src/main/services/system-service.ts:31-37`). Backup is read-only and does not mark stale (`src/main/services/system-service.ts:26-29`).
- Maintenance shells to `hermes backup` or `hermes import <archive>`, adding `-p <profile>` for non-default profiles (`src/main/install/maintenance.ts:7-42`, `src/main/install/maintenance.ts:51-89`). It always runs through the configured local `HERMES_HOME`; it does not ingest arbitrary source homes unless the user first produces an archive accepted by Hermes.
- Official Hermes CLI docs say `hermes backup` backs up configuration, skills, sessions, and data to a zip excluding the codebase, and `hermes import <zipfile>` overwrites files in the target Hermes home and warns to stop the gateway before importing. This supports using backup/import as a restore primitive, but also reinforces the need for Mercury-side preview/collision/runtime handling around it.

#### Destination mapping and profile-state evidence
- Mercury's profile destination map is simple: default profile → `HERMES_HOME`, named profile → `HERMES_HOME/profiles/<name>` (`src/main/utils.ts:22-27`).
- Config/env live in profile roots as `config.yaml` and `.env` (`src/main/config.ts:100-146`, `src/main/config.ts:291-293`). Model config edits also target that profile config (`src/main/config.ts:214-289`).
- Built-in memory files are `memories/MEMORY.md` and `memories/USER.md` (`src/main/memory.ts:33-39`, `src/main/memory.ts:118-206`). SOUL is profile-root `SOUL.md` (`src/main/soul.ts:13-31`).
- Sessions read from profile-root `state.db`; list/search can aggregate across default and named profile DBs (`src/main/session-db.ts:17-34`, `src/main/session-db.ts:36-64`, `src/main/sessions.ts:87-98`, `src/main/sessions.ts:170-181`). Desktop session cache is global under `HERMES_HOME/desktop/sessions.json` but entries are profile-keyed (`src/main/session-cache.ts:18-27`, `src/main/session-cache.ts:167-181`).
- Skills are profile-scoped under `profileHome(profile)/skills` (`src/main/skills.ts:63-112`). Markdown skill import already has profile/runtime stale behavior, which is a useful pattern for migration-import implementation (`src/main/services/knowledge-service.ts:199-217`).
- Cron jobs are profile-scoped at `profileHome(profile)/cron/jobs.json` and cron mutations mark runtime stale (`src/main/cronjobs.ts:28-30`, `src/main/services/cron-service.ts:11-13`). Logs are profile-root `logs` files according to Hermes docs and Mercury's log reader pathing (`src/main/install/introspection.ts:179-218`).
- Important collision/design caveat: the credential pool helper currently uses global `HERMES_HOME/auth.json`, not `profileHome(profile)/auth.json` (`src/main/config.ts:378-421`). Migration planning must decide whether provider credentials are global, profile-specific, copied, linked, or left for manual setup.


#### Upstream OpenClaw behavior relevant to Mercury planning
- Official OpenClaw migration docs emphasize moving the whole state directory, not just config: `openclaw.json`, per-agent `auth-profiles.json`, `credentials/`, sessions, channel state, and workspace files (`MEMORY.md`, `USER.md`, skills, prompts). They also warn that profile/state-dir mismatches make channels and sessions appear empty, and recommend `openclaw doctor`, gateway restart, and `openclaw status` after migration.
- Upstream OpenClaw supports custom state roots via profile-style `~/.openclaw-<profile>/` and `OPENCLAW_STATE_DIR`; Mercury currently does not discover either (`src/main/install/paths.ts:284-293`).
- OpenClaw's agent-centric state and Hermes/Mercury's profile-home model do not map 1:1. A Mercury planner should not blindly copy `agents/<agentId>` into a Hermes profile; it should inventory OpenClaw agents, sessions, auth profiles, credentials, workspace files, and skills, then propose a target profile mapping.

#### Test coverage gaps found
- Existing profile/session tests provide reusable fixtures for target mapping: `tests/profiles.test.ts`, `tests/sessions-profile-db.test.ts`, `tests/session-cache-sync.test.ts`, and `tests/reliable-profile-runtime-contract.test.ts`.

#### Recommended migration architecture
1. **Add a source inventory/planner module** (suggested new files: `src/main/migration/openclaw-planner.ts`, `src/main/migration/hermes-planner.ts`, shared types in `src/shared/migration.ts`). It should return a redacted plan with source roots, detected markers, profiles/agents, artifact counts, target profile proposals, collisions, skipped/archived items, backup requirements, and required restarts.
3. **Expose preview/apply APIs** through `src/main/services/install-service.ts`, `src/main/ipc/install.ts`, `src/preload/api/install.ts`, and `src/preload/index.d.ts`: e.g. `planOpenClawMigration(options)`, `applyOpenClawMigration(planId/options)`, `planHermesHomeImport(options)`, `applyHermesHomeImport(options)`.
4. **Make target profile mapping explicit.** Default OpenClaw agent → selected/default Mercury profile; additional OpenClaw agents → proposed named profiles. Existing profile collisions should default to skip or rename, not overwrite.
5. **Use upstream Hermes as an execution primitive only after planning.** When delegating OpenClaw migration, pass surfaced upstream flags (`--dry-run`, `--source`, `--skill-conflict`, `--overwrite`, `--migrate-secrets`, `--yes`) deliberately, capture/report the upstream plan, and reconcile it with Mercury's own runtime/profile state.
6. **Backups/rollback.** Require a pre-apply Hermes backup or upstream migration backup path in the plan. For raw Hermes-home imports, back up the target profile/home before copying/importing. Do not rely on UI optimism alone.
7. **Runtime/cache invalidation.** After any successful apply, call `markRuntimeStale(targetProfile, ...)`; for multi-profile applies, stale all affected profiles. Invalidate config/model caches where raw files changed, and prompt gateway restart/revalidation. Consider session-cache resync for imported `state.db`.

#### Recommended tests
- `tests/openclaw-migration-service.test.ts`: planner returns redacted inventory, collisions, target profile mapping, and backup requirement; apply marks affected runtime stale and passes intended upstream Hermes flags.
- `tests/cli-mutating-commands.test.ts`: `mercury claw migrate --source <path> --dry-run --profile <name>` or future `mercury openclaw plan/apply` parses and forwards options; unsupported domains remain explicit.
- `tests/ipc-handlers.test.ts` and `tests/preload-api-surface.test.ts`: add planner/apply channels/types, not just fire-and-forget migrate.
- `tests/hermes-home-migration.test.ts`: raw external Hermes home inventory maps config/env/SOUL/memories/skills/state.db/cron/logs/auth with collision handling and does not mutate source.
- `tests/reliable-profile-runtime-contract.test.ts`: migration apply marks exactly affected profiles stale and revalidation clears only after verified runtime identity.

#### External references used
- Hermes CLI reference: `https://hermes-agent.nousresearch.com/docs/reference/cli-commands` (`hermes backup`, `hermes import`, `hermes claw migrate`, `hermes update`).
- Hermes profiles guide/reference: `https://hermes-agent.nousresearch.com/docs/user-guide/profiles/` and `https://hermes-agent.nousresearch.com/docs/reference/profile-commands`.
- OpenClaw migration docs: `https://docs.openclaw.ai/install/migrating` and `https://docs.openclaw.ai/cli/migrate`.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** A useful migration function needs to understand both source installation layouts and Mercury's existing install/profile/import abstractions, then map each source artifact into Mercury-owned storage without breaking existing installations.
**Findings:** Report scaffold created. No repo `AGENTS.md` was found. Hermes skill and prior profile-isolation report suggest Hermes migration should focus on homes/profiles, config/env, skills, memory/SOUL, sessions, gateway state, and runtime/profile semantics.
**Evidence:** `.agents/skills/hermes-agent/SKILL.md`; `docs/investigations/profile-tools-skills-memory-isolation-2026-05-16.md`.
**Conclusion:** External layout research was needed before workspace context discovery.

### Phase 1.5 - External Layout and Git Research
**Hypothesis:** Migration design depends on source layouts that Context Builder cannot infer from current Mercury code alone.
**Findings:** Upstream Hermes homes are profile homes rooted at `HERMES_HOME`/`~/.hermes`; named profiles live under `~/.hermes/profiles/<name>`. OpenClaw is agent-centric, defaults to `~/.openclaw`, supports alternate roots/configs, and may need doctor/normalization. Git history shows current Mercury OpenClaw migration started as a Settings/CLI wrapper and current code still shells to Hermes for actual migration.
**Evidence:** Background sections above; `src/main/install/executor.ts:12-49`; `src/main/install/paths.ts:284-293`; `src/cli/mutating-commands.ts:507-535`; `docs/contracts/cli.md:1269-1301`.
**Conclusion:** Hermes archive import and OpenClaw migration should be treated as distinct products with different inventory and mapping requirements.

### Phase 2 - Context Builder Assessment
**Hypothesis:** Current workspace code has enough primitives to distinguish existing migration support from missing migration-product safety.
**Conclusion:** A pair investigation was warranted because the migration surface spans UI, IPC, CLI, services, runtime, and file-backed storage.

### Phase 3 - Pair Investigator Findings
**Hypothesis:** Mercury has generic Hermes archive import and a coarse OpenClaw shell-out, but lacks a first-class migration planner/preview.
**Conclusion:** The root issue is absence of a Mercury-owned migration domain model, not absence of every low-level primitive.

### Phase 4 - Spot Check and Oracle Synthesis
**Hypothesis:** Pair findings are accurate and final recommendations should prioritize planner/detection/profile/runtime safety over immediate source-copy implementation.
**Findings:** Direct spot checks confirmed the key evidence. Oracle agreed that migration readiness is blocked by lack of inventory/plan/apply architecture, highlighted the need to define “Hermes migration” separately from archive import, and recommended explicitly deferring SSH/remote migration scope.
**Evidence:** Spot-checked `src/main/install/executor.ts:12-49`, `src/main/install/paths.ts:284-293`, `src/main/services/install-service.ts:126-138`, `src/main/services/system-service.ts:31-37`, `src/renderer/src/screens/Settings/Settings.tsx:156-200`, `src/renderer/src/screens/Settings/components/SettingsCoreSections.tsx:392-445`, `src/preload/api/install.ts:66-70`, `src/main/ipc/install.ts:56-62`, `src/main/install/maintenance.ts:7-89`, `src/main/utils.ts:22-27`, `src/main/config.ts:378-421`, and `src/cli/mutating-commands.ts:507-535`.
**Conclusion:** Final recommendations should specify a future migration service/planner, safer detection, explicit profile mapping, deliberate upstream flag use, backup/collision policy, runtime invalidation, credential semantics, and tests.

## Root Cause
Mercury currently treats migration as scattered shell-out utilities rather than as a first-class product/domain operation.

For Hermes, Mercury clearly supports **archive backup/import**: `runHermesBackup()` and `runHermesImport()` shell to `hermes backup` and `hermes import <archive>`, add `-p <profile>` for named profiles, and successful import marks the selected runtime stale (`src/main/install/maintenance.ts:7-89`, `src/main/services/system-service.ts:31-37`). That is useful, but it is not the same as full migration from an arbitrary existing Hermes installation/home. There is no source discovery, raw home/profile inventory, adopt-vs-copy choice, collision report, or multi-profile mapping for an external Hermes root.

For OpenClaw, Mercury exposes a visible Settings/CLI migration surface, but the implementation is a thin no-argument wrapper: Settings calls `runClawMigrate()` without source/profile options (`src/renderer/src/screens/Settings/Settings.tsx:173-200`), preload/IPC expose no-argument APIs (`src/preload/api/install.ts:66-70`, `src/main/ipc/install.ts:56-62`), the service returns only success/error and does not mark runtime stale (`src/main/services/install-service.ts:126-138`), and the executor runs only `hermes claw migrate --preset full` under Mercury's `HERMES_HOME` (`src/main/install/executor.ts:12-49`). Detection is also only directory-existence checks for `~/.openclaw`, `~/.clawdbot`, and `~/.moldbot` (`src/main/install/paths.ts:284-293`).


## Eliminated / Qualified Hypotheses
- **“Hermes migration support is absent.”** Qualified. Archive backup/import exists and is profile-aware, but arbitrary Hermes-home migration/adoption does not.
- **“OpenClaw migration has no upstream safety.”** Qualified. Upstream `hermes claw migrate` appears to expose dry-run/source/conflict/backup controls, but Mercury does not surface or reconcile those controls.
- **“Runtime/profile infrastructure is generally missing.”** Eliminated for current code. Runtime stale/revalidation primitives exist; OpenClaw migration simply does not call them.
- **“OpenClaw migration is profile-aware through CLI `--profile`.”** Eliminated. CLI parses a profile in install dispatch, but `claw migrate` calls `runClawMigrateForConnection(progress)` without using it (`src/cli/mutating-commands.ts:507-535`).
- **“Remote/SSH migration is covered.”** Eliminated/Deferred. This investigation covered current local migration surfaces. SSH/remote migration should be a separate design scope.

## Recommendations
1. **Create a first-class migration domain model.** Add shared types such as `MigrationSource`, `MigrationInventory`, `MigrationPlan`, `MigrationConflict`, and `MigrationResult`, with planner modules such as `src/main/migration/openclaw-planner.ts` and `src/main/migration/hermes-planner.ts` plus shared types in `src/shared/migration.ts`.
2. **Add plan/apply APIs before adding more UI actions.** Replace or augment `checkOpenClaw()` / `runClawMigrate()` with APIs like `planOpenClawMigration(options)`, `applyOpenClawMigration(plan/options)`, `planHermesHomeImport(options)`, and `applyHermesHomeImport(plan/options)`, wired through service, IPC, preload, `index.d.ts`, CLI, and Settings UI.
4. **Define Hermes migration products separately.** Keep archive import, but separately design: adopt existing `HERMES_HOME`, copy from external Hermes home, import all profiles from another root, and merge one source profile into a target profile.
5. **Make target profile mapping explicit.** For OpenClaw, map default agent to the selected/default Mercury profile and propose additional agents as named profiles. Existing profile collisions should default to skip/rename/import-as-new, not overwrite.
6. **Surface upstream OpenClaw controls intentionally.** If using `hermes claw migrate`, expose and deliberately pass supported controls such as `--dry-run`, `--source`, `--overwrite`, `--migrate-secrets`, `--no-backup`, `--workspace-target`, and `--skill-conflict`, rather than always using only `--preset full`.
7. **Require backup and collision policy before apply.** Plans should show target collisions for config/env/auth/SOUL/memory/skills/session DB/cron/profile directories and require a backup path or explicit user acknowledgement before mutation.
8. **Invalidate runtimes and caches after every successful apply.** Mirror Hermes import behavior by marking affected profiles stale after OpenClaw/Hermes-home apply; for unknown or multi-profile mutations, mark all affected profiles stale and trigger or prompt session-cache resync/revalidation.
9. **Decide credential scoping before migrating secrets.** Most storage is profile-scoped, but the credential pool currently uses base `HERMES_HOME/auth.json` (`src/main/config.ts:378-421`). Decide whether credentials remain global, become profile-scoped, or require explicit opt-in secret migration.

## Preventive Measures
- Treat future install/migration UI claims as contract-backed: user-facing copy should only promise artifact categories that a planner can inventory and report.
- Keep migration execution non-destructive by default: preview first, back up target, require explicit overwrite/secret migration choices, and record what changed.
- Maintain tests for detection false positives, especially Mercury-created compatibility directories under external-tool roots.
- Reuse runtime stale/revalidation patterns for every code path that mutates profile-backed files.
- Avoid regex-only destructive config merges for migration; use parsed/validated config handling or delegate to upstream with explicit dry-run and conflict output.

# Skills Subsystem

This document describes Mercury's current skill listing, grouped Skills UI, draft/save batching, shared batch mutation contract, content/metadata reads, install/uninstall, Add Skill ingestion from Markdown/GitHub/npx-style commands, validation, local/SSH/pure-remote behavior, test coverage, and the future skill-groups seam. It describes current behavior only: skill groups are not implemented, and runtime restart/reload policy after skill mutations is not solved beyond the stale/restart-warning semantics named here.

## Source anchors

- Renderer orchestrator: `src/renderer/src/screens/Skills/Skills.tsx`
- Renderer presentation: `src/renderer/src/screens/Skills/components/SkillCategorySection.tsx`, `src/renderer/src/screens/Skills/components/SkillDetailPanel.tsx`, `src/renderer/src/screens/Skills/components/SkillModals.tsx`
- Renderer styling/copy: `src/renderer/src/assets/styles/skills.css`, `src/shared/i18n/locales/*/skills.ts`
- Shared skill contracts: `src/shared/skills.ts`
- Local skill listing/install helpers: `src/main/skills.ts`
- Markdown import implementation: `src/main/skills/importer.ts`
- Source import parser/fetch/import implementation: `src/main/skills/source-parser.ts`, `src/main/skills/github-source.ts`, `src/main/skills/source-service.ts`, `src/main/skills/directory-importer.ts`, `src/main/skills/http-fetch.ts`
- Knowledge IPC routing: `src/main/ipc/knowledge.ts`
- Shared knowledge service used by IPC and CLI: `src/main/services/knowledge-service.ts`
- CLI skill commands: `src/cli/read-only-commands.ts`, `src/cli/mutating-commands.ts`, [CLI contract](../contracts/cli.md)
- Preload API: `src/preload/api/knowledge.ts`, `src/preload/index.d.ts`
- SSH skill implementation: `src/main/ssh/skills.ts`
- SSH transport helpers: `src/main/ssh/transport.ts`
- Contract tests: `src/renderer/src/screens/Skills/Skills.test.tsx`, `tests/skills-mutation.test.ts`, `tests/skills-import.test.ts`, `tests/skills-source-parser.test.ts`, `tests/skills-source-github.test.ts`, `tests/knowledge-service.test.ts`, `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`
- Codex image generation skill/tool behavior: [Codex image generation](codex-image-generation.md)
- Future skill-groups investigation: `docs/investigations/skill-groups-implementation-plan-2026-06-01.md`

## Implementation ownership map

| Layer | Owner | Current responsibility |
| --- | --- | --- |
| Renderer orchestration | `Skills.tsx` | Loads installed/bundled truth, owns ephemeral pending drafts, stages row/category/detail actions, synthesizes one save batch, gates import behind pending-save, reloads and reconciles results. |
| Renderer presentation | `SkillCategorySection.tsx` | Renders grouped rows, enabled/pending counts, pending badges, Undo affordance, row Enable/Disable, category Enable all / Disable all callbacks. It does not call preload directly. |
| Renderer detail | `SkillDetailPanel.tsx` | Renders installed skill Markdown, metadata, Agents-using-skill, and detail-level Disable callback. It does not own mutation persistence. |
| Renderer modals | `SkillModals.tsx` | Renders the Add Skill modal with Paste Markdown, GitHub link, and npx/gh command tabs. Submit/preview are still orchestrated by `Skills.tsx` so pending drafts cannot be bypassed. |
| Shared types | `src/shared/skills.ts` | Defines Markdown import DTOs, source preview/import DTOs, `SkillMutationTarget`, per-item mutation result, error codes, and `SkillMutationBatchResult`. |
| Preload bridge | `src/preload/api/knowledge.ts`, `src/preload/index.d.ts` | Exposes `window.hermesAPI` methods and invokes quoted IPC channel names. |
| IPC handler | `src/main/ipc/knowledge.ts` | Binds `list-installed-skills`, `list-bundled-skills`, `get-skill-content`, `get-skill-metadata`, legacy single-target channels, `mutate-skills`, and `import-skill-markdown` to the knowledge service. |
| Service choke point | `src/main/services/knowledge-service.ts` | Routes local/SSH/pure-remote behavior, serializes skill batches per profile, wraps legacy single-target APIs, marks runtime stale once only when a batch changed at least one skill. |
| Local executor | `src/main/skills.ts` | Lists local profile/bundled skills, resolves install/uninstall targets, validates path containment, copies/removes skill directories, falls back to Hermes CLI install for legacy identifiers. |
| SSH executor | `src/main/ssh/skills.ts` | Lists remote installed/registry skills, prefixes installed paths as `REMOTE:`, reads remote content/metadata, mutates one remote batch through Python, and imports Markdown remotely. |
| CLI adapter | `src/cli/read-only-commands.ts`, `src/cli/mutating-commands.ts` | Calls shared services directly; it does not use preload or renderer code. |

## Renderer-facing API

Skills are exposed through `window.hermesAPI` methods implemented in `src/preload/api/knowledge.ts`:

- `listInstalledSkills(profile?)`
- `listBundledSkills()`
- `getSkillContent(skillPath)`
- `getSkillMetadata(skillPath)`
- `installSkill(identifier, profile?)` (legacy single-target wrapper)
- `uninstallSkill(name, profile?)` (legacy single-target wrapper)
- `mutateSkills(targets, profile?)`
- `importSkillMarkdown(request, profile?)`
- `previewSkillSource(request)`
- `importSkillSource(request, profile?)`

The renderer-facing TypeScript declarations live in `src/preload/index.d.ts`. Request/result shapes for Markdown import, source preview/import, metadata, and batch mutation come from `src/shared/skills.ts`.

The batch mutation contract is the preferred install/uninstall path:

```ts
install target:   { action: "install", name, category, directoryName }
uninstall target: { action: "uninstall", name, category, directoryName, path }
```

`SkillMutationBatchResult` preserves input order in `results`, reports `updated` as the count of successful items with `changed: true`, reports `failed` as failed item count, and uses per-target error codes such as `invalid-target`, `not-found`, `duplicate`, `ambiguous-skill`, `unsupported-remote-mode`, `command-failed`, `timeout`, `write-failed`, and `unknown`. Renderer reconciliation depends on ordered results matching ordered request targets.

## API chain

The current save chain is intentionally narrow:

```text
SkillCategorySection / SkillDetailPanel callback
→ Skills.tsx pending draft state
→ Save changes
→ window.hermesAPI.mutateSkills(targets, profile?)
→ ipcRenderer.invoke("mutate-skills", targets, profile)
→ ipcMain.handle("mutate-skills", ...)
→ mutateSkillsForProfile(targets, profile?)
→ local mutateLocalSkills(...) OR sshMutateSkills(...) OR pure-remote fail-closed result
```

Renderer code must not import main-process helpers or call local/SSH mutation functions directly. Legacy `installSkill` and `uninstallSkill` remain compatibility wrappers, but service-level callers route those wrappers through the batch mutation path.

Source ingestion uses a two-call stateless API:

```text
Add Skill source tab
→ Skills.tsx handlePreviewSkillSource()
→ window.hermesAPI.previewSkillSource({ source })
→ ipcRenderer.invoke("preview-skill-source", request)
→ previewSkillSourceForProfile(request, profile?)
→ source parser + GitHub resolver return candidates without writing files

selected candidate / single candidate
→ Skills.tsx handleImportSkillSource()
→ savePendingChanges() gate, only after preview has already succeeded
→ window.hermesAPI.importSkillSource(request, profile?)
→ ipcRenderer.invoke("import-skill-source", request, profile)
→ importSkillSourceForProfile(request, profile?)
→ fetch pinned source directory
→ importSkillDirectory(...) locally OR sshImportSkillDirectory(...) remotely OR pure-remote fail-closed
```

`previewSkillSource` is read-only and does not mark runtime stale. `importSkillSource` writes files and uses the same pending-draft save gate as Markdown import. If that save fails, import is aborted and the preview result remains visible for retry after the user fixes or discards pending changes.

## CLI skill commands

The CLI exposes the same skill capabilities for automation through `src/main/services/knowledge-service.ts`; it is not layered through preload.

| Command | Behavior |
| --- | --- |
| `mercury skills installed [--profile <name>]` | Lists installed skills for the selected profile/Agent. |
| `mercury skills bundled` | Lists bundled or registry-discovered skills using the same local/SSH behavior as IPC. |
| `mercury skills content <path>` | Reads `SKILL.md` content for an installed local or `REMOTE:` skill path. |
| `mercury skills metadata <path>` | Reads skill metadata plus scripts/references availability where supported. |
| `mercury skills install <identifier> [--profile <name>]` | Calls the legacy wrapper, which delegates to one-target batch mutation. |
| `mercury skills uninstall <name> [--profile <name>]` | Calls the legacy wrapper, which delegates to one-target batch mutation. |
| `mercury skills import --file <path> [--name ...] [--category ...] [--description ...] [--overwrite] [--profile <name>]` | Imports Markdown through the shared `SkillMarkdownImportRequest`/`SkillMarkdownImportResult` contract. |
| `mercury skills add <source-or-command> [--skill ...] [--category ...] [--name ...] [--description ...] [--overwrite] [--profile <name>]` | Imports a GitHub skill source or pasted `npx skills add ...` / `gh skill install ...` command through the shared source-import contract. |

Local, SSH, and pure remote HTTP behavior matches the IPC mode rules below. Manual Markdown import and source import return the same success/failure codes as the renderer path; gateway restart warnings are part of the service result (for example `warning: "gateway-restart-required"`) and may appear inside CLI JSON `data` rather than as a top-level CLI envelope warning.

## Renderer UI semantics

The Skills screen groups installed and browse results by `category` into collapsible sections. Each section shows an enabled count, total count, pending count, category-level bulk actions, and row actions.

The header Add Skill action opens one modal with three source tabs:

- **Paste Markdown** keeps the original `importSkillMarkdown` flow.
- **GitHub link** accepts GitHub repo, tree/blob, raw `SKILL.md`, and `owner/repo`-style sources supported by the main-process parser/resolver.
- **npx/gh command** accepts pasted installer commands as data. Mercury parses the source and optional skill selector, but never shells out to `npx`, `gh`, `git`, or another installer.

`Skills.tsx` owns all import orchestration. `SkillModals.tsx` is presentational and does not call preload directly. Source imports must be previewed before import so the renderer can show discovered candidates. If preview returns one candidate, the modal shows a ready summary and imports that candidate directly. If preview returns multiple candidates, the user must select one candidate before the Import button is enabled. The modal includes a category input backed by existing installed/bundled categories through a datalist, while still allowing free-text categories that the backend validates. In pure remote HTTP mode, the GitHub link and command tabs are hidden; Paste Markdown retains its existing behavior.

Mercury does not persist a separate skill-enabled flag. In the current implementation, newly created Mercury Agents/profiles start with no skills installed because profile creation uses upstream Hermes `--no-skills`; the Agents "copy default config/API keys" option copies credentials/config only, not `skills/`. This is current behavior, not the desired long-term product invariant.

TODO / product direction: new Agents should eventually receive skills from a `default` skill category automatically, while non-default categories remain opt-in. That future default-category seeding should still write installed skill files through the same profile-scoped skill mutation/import machinery, not a separate enabled-state flag.

Future category taxonomy note: the planned opt-in `inspector-gadget` category is for high-novelty, external-service, media/generative, game, map/search, market, smart-home, or social/browser utility skills that should remain off by default. Current planning classifies these skills as `inspector-gadget`: Bayou Comic Creator, Bayou Infographic, Bayou Article Illustrator, ASCII Video, ASCII Art, Blender Animation, Google Drive, Songwriting and AI Music, Touch Designer MCP, Minecraft Mod Pack Server, Pokemon Player, Find Nearby, GIF Search, Heartmula, Songsee, Spotify, Maps, God mode, polymarket, open hue, xitter, and x-url. New Agents should get the future `default` category by default; `inspector-gadget` remains opt-in.

In the current V1 UI, **enabled for the selected Agent** means the skill is installed in that Agent profile, and **disabled** means the skill is absent from that Agent profile. Installed files are the source of truth. The renderer overlays ephemeral pending state to show the effective state before the user saves.

### Draft/save lifecycle

`Skills.tsx` owns `pendingSkillChanges`, keyed by normalized identity and ordered by `draftSequenceRef`. Row, detail, and category components emit callbacks; they do not persist immediately.

| Trigger | Draft behavior | Persistence behavior |
| --- | --- | --- |
| Individual Enable | Stages an install target from the row's `name`, `category`, and `directoryName`. | No preload call until Save. |
| Individual Disable | Stages an uninstall target from the installed skill, including `path` when available. | No preload call until Save. |
| Detail Disable | Stages the same uninstall target as row Disable. | No preload call until Save. |
| Category Enable all | Iterates visible category rows and stages only rows whose effective state is disabled. | One pending entry per changed row; still no preload call. |
| Category Disable all / Disable enabled | Iterates visible category rows and stages only rows whose effective state is enabled. | One pending entry per changed row; still no preload call. |
| Undo pending row | Removes that row's pending entry. | Installed files are unchanged. |
| Save changes | Sorts pending changes by sequence and sends one flat `mutateSkills(targets, profile?)` call. | One batch reaches main. |
| Discard | Clears all pending entries, closes detail, shows discarded notice, and reloads installed truth. | Installed files are unchanged. |
| Refresh | Reloads installed and bundled truth. | Pending entries are rebased against refreshed truth. |
| Profile change/remount | Clears pending entries and selected detail before loading the new profile's truth. | Draft state is not persisted across profiles. |

Draft state is renderer-local and ephemeral. It is not written to `desktop.json`, profile config, `state.db`, or any other persistence file.

### Pending identity and target construction

The renderer uses normalized `category + directoryName/name` identity for pending draft allocation. `directoryName` is preferred because display `name` can come from frontmatter and can collide across directories. Separate render/action selection keys may include source/path context where needed to keep installed and bundled rows stable.

Target construction rules:

- Install targets use `action: "install"`, `name`, optional `category`, and optional `directoryName`.
- Install targets do not use `path`; the backend resolves the skill from bundled/registry identity.
- Uninstall targets use `action: "uninstall"`, `name`, optional `category`, optional `directoryName`, and installed `path` whenever the row has installed truth.
- Path-bearing uninstall targets let local and SSH executors remove the exact installed directory and avoid duplicate display-name collisions.
- If a user toggles a row back to its loaded base state before Save, the pending entry is removed instead of sending a no-op target.

### Effective rendering while drafts exist

Installed and bundled lists remain loaded truth. Effective row state is computed by overlaying pending changes:

- Installed rows normally render enabled; a pending uninstall renders them effectively disabled/pending-disable.
- Bundled rows derive base enabled state from an installed identity match; a pending install renders them effectively enabled/pending-enable.
- Category enabled counts use effective state, not just loaded installed truth.
- Pending badges and the draft bar show staged enable/disable counts.
- Browse detail opens only when the bundled row is already installed for the selected Agent and is not pending disable.
- If a selected installed detail is staged for disable, `Skills.tsx` closes the detail panel to avoid showing stale installed-file-backed content.
- Header Import and Refresh buttons are disabled while a draft save is in progress.

### Save reconciliation and partial failure semantics

`savePendingChanges()` uses the backend batch result plus a post-save installed-skill reload to decide what to clear.

Algorithm:

1. If another save is already running, return failure to the caller.
2. If there are no pending changes, return success without invoking `mutateSkills`.
3. Sort pending changes by their staging sequence.
4. Invoke `window.hermesAPI.mutateSkills(changes.map(change => change.target), profile)` exactly once.
5. Reload `listInstalledSkills(profile)` once after the batch resolves.
6. For each attempted change, read the same-index item from `result.results`.
7. Missing item means failure; keep that pending entry and show `pendingSaveMissingResult`.
8. Failed item means failure; keep that pending entry and show the per-target `item.error`.
9. Successful item whose target is not reflected in refreshed installed truth means failure; keep that pending entry and show `pendingSaveNotReflected`.
10. Successful item reflected in refreshed truth is cleared.
11. Pending entries that were created after the save snapshot are rebased against refreshed truth.
12. Pending entries not attempted by the save snapshot and already satisfied by refreshed truth are dropped by rebase.
13. If `updated > 0`, show saved-count copy.
14. If `updated === 0` and there are no failures, show no-changes-needed copy. No-op success is valid.
15. If `mutateSkills` throws, keep all pending changes because no ordered item-level result is available.
16. If the post-save installed reload throws, keep pending state and show the load failure.

The backend can return partial success (`success: false`, some successful item results, some failed item results). The renderer clears successful/reflected items and retains failed/unreflected items so the user can retry or discard only unresolved changes.

### Detail and Agents-using-skill behavior

The installed-skill detail experience is an in-screen page/panel instead of a modal. It renders `SKILL.md` Markdown on the left and metadata on the right. It loads content, metadata, and Agents-using-skill in parallel and keeps the detail usable when metadata is unavailable.

"Agents using this skill" is derived in the renderer by calling `listProfiles()` and then `listInstalledSkills(profile.name)` for each Agent. Matching prefers case-insensitive `category/directoryName` identity, falling back to display name only when a directory name is unavailable. If every profile lookup rejects, the detail shows usage as unavailable rather than blocking skill detail rendering.

## Local installed skills

`src/main/skills.ts` reads installed skills from:

```text
<profileHome>/skills/<category>/<skill-name>/SKILL.md
```

Current behavior:

- `listInstalledSkills(profile?)` walks category directories under `<profileHome>/skills`.
- A valid installed skill is a directory containing `SKILL.md`.
- Returned installed summaries include `directoryName`, the actual skill directory under the category. Display `name` can still come from frontmatter.
- Metadata is parsed from YAML frontmatter when present:
  - `name`
  - `description`
- Without frontmatter, it falls back to the first Markdown heading for name and first non-heading paragraph for description.
- Returned skills are sorted by category and then name.
- `getSkillContent(skillPath)` reads `<skillPath>/SKILL.md` and returns an empty string if missing or unreadable.
- `getSkillMetadata(skillPath)` reports immediate `scripts/` and `references/` children when available.

## Bundled and registry skills

Current local behavior:

- `listBundledSkills()` walks `<HERMES_REPO>/skills/<category>/<skill>/SKILL.md` and returns bundled skills sorted by category/name. Results include `directoryName`, the bundled skill directory.
- `searchSkills(query)` shells out to Hermes CLI: `hermes skills browse --query <query> --json`; if JSON parsing fails or command fails, it returns an empty list.

`listBundledSkills()` does not call the registry search locally; it reads bundled skills from the local Hermes repo directory.

Current SSH behavior differs: `sshListBundledSkills()` calls remote registry browsing through `hermes skills browse --query "" --json` via SSH. It does not traverse a remote bundled-skills repository directory.

## Backend batch mutation model

`mutateSkillsForProfile(targets, profile?)` in `src/main/services/knowledge-service.ts` is the cross-mode mutation choke point.

Current service rules:

- Non-array `targets` are normalized to `[]`.
- Empty batches return `{ success: true, updated: 0, failed: 0, results: [] }` without queueing, touching local/SSH helpers, or marking runtime stale.
- Pure remote HTTP mode returns ordered per-target failures and does not queue, call local helpers, call SSH helpers, or mark runtime stale.
- Local and SSH batches are serialized per normalized profile key (`profile?.trim() || "default"`) through `skillMutationQueues`.
- A previous rejected queued promise is swallowed into an empty failure-shaped result before the next task is chained, so one failed batch does not permanently poison the profile queue.
- Local mode calls `mutateLocalSkills(safeTargets, profile)`.
- SSH mode with SSH config calls `sshMutateSkills(conn.ssh, safeTargets, profile)`.
- SSH mode without SSH config falls through to local behavior by current service shape; callers should not describe that as a supported pure-remote mutation path.
- Runtime stale marking happens once after the batch only if at least one result is `success && changed`.
- Empty, all-failure, and all-no-op batches do not mark runtime stale.
- The stale marker says skills changed for the profile runtime. The current code does not prove an automatic gateway restart or skill-catalog reload happened.

Legacy wrappers:

- `installSkillForProfile(identifier, profile?)` calls `mutateSkillsForProfile([{ action: "install", name: identifier }], profile)` and converts the first item to `{ success, error? }`.
- `uninstallSkillForProfile(name, profile?)` calls `mutateSkillsForProfile([{ action: "uninstall", name }], profile)` and converts the first item to `{ success, error? }`.

## Local install and uninstall

`mutateLocalSkills(targets, profile?)` processes targets in order and returns one result per input target.

Local validation and resolution rules:

- Target must be an object with `action: "install" | "uninstall"` and a non-empty `name`.
- `category` and `directoryName`, when present, must be safe path segments: no `/`, `\\`, or NUL.
- Install collects category-scoped bundled candidates from `category + directoryName` and `category + name`; those candidates must resolve to one unique source. If no category-scoped candidate exists, name-only fallback is attempted.
- Install fails closed with `ambiguous-skill` if candidate lookup has multiple unique matches.
- Install copies a bundled skill directory to `<profileHome>/skills/<category>/<directoryName>` when the source is inside the bundled root and contains `SKILL.md`.
- Install returns success with `changed: false` when the destination already contains `SKILL.md` for that skill.
- Install returns `duplicate` when the destination exists but is not a valid skill directory.
- Install falls back to `hermes skills install <name> --yes` for legacy identifiers not found in the bundled index.
- CLI install timeout maps to `timeout`; other CLI failures map to `command-failed`.
- Uninstall path wins when present; otherwise category-scoped candidates from `category + directoryName` and `category + name` are collected and must resolve uniquely. If no category-scoped candidate exists, name-only fallback is attempted.
- Uninstall with an escaped path, unsafe symlink target, or non-skill directory fails closed with `invalid-target`.
- Ambiguous uninstall targets fail closed with `ambiguous-skill` rather than deleting a best guess.
- Successful uninstall removes the skill directory and best-effort removes an empty category directory.
- Direct filesystem writes/removals validate that source and destination paths remain inside the expected bundled-skill or profile-skill roots.

## Shared Markdown import contract

`src/shared/skills.ts` defines:

```ts
export type SkillMarkdownImportRequest = {
  markdown: string;
  name?: string;
  category?: string;
  description?: string;
  overwrite?: boolean;
};
```

Successful result:

```ts
{
  success: true;
  skill: {
    name: string;
    category: string;
    description: string;
    path: string;
  };
  warning?: "gateway-restart-required";
}
```

Failure result codes:

- `invalid-markdown`
- `invalid-name`
- `invalid-category`
- `duplicate`
- `write-failed`

`PreparedSkillMarkdownImport` contains normalized `name`, `category`, `description`, and `markdown`.

## Source import contract

`src/shared/skills.ts` defines the source preview/import DTOs used by renderer, preload, IPC, service, and CLI callers:

```ts
export type SkillSourcePreviewRequest = {
  source: string;
  skillSelector?: string;
};

export type SkillSourceImportRequest = {
  source: string;
  candidateId?: string;
  skillSelector?: string;
  name?: string;
  category?: string;
  description?: string;
  directoryName?: string;
  overwrite?: boolean;
};
```

Successful preview returns `{ success: true, source, candidates }`. Each `SkillSourceCandidate` includes:

- `candidateId`, currently stable as `github:<owner>/<repo>@<commitSha>:<path/to/SKILL.md>`;
- display metadata: `name`, `description`, `category`, `directoryName`;
- source metadata: `skillPath`, `sourceLabel`, `commitSha`, optional `treeSha`;
- validity metadata: `valid` plus optional `error`.

Successful import returns the imported `skill`, the parsed `source`, the selected/pinned `candidate`, and optional `warning: "gateway-restart-required"`. Failure codes include source/transport failures (`invalid-source`, `unsupported-source`, `fetch-failed`, `rate-limited`, `source-too-large`, `not-found`), selection failures (`multiple-candidates`), validation failures (`invalid-markdown`, `invalid-name`, `invalid-category`, `duplicate`), and write/mode failures (`write-failed`, `unsupported-remote-mode`).

`candidateId` is commit-pinned so previewing a moving branch and importing later still fetches the files from the previewed commit. Import does not trust a renderer-only candidate object; it re-resolves/fetches the pinned source directory using the `candidateId`/selector fields in the request.

## Source parser and discovery behavior

`src/main/skills/source-parser.ts` is main-process-only and pure. It parses supported source strings but never shells out. Supported forms include:

- `owner/repo` and `https://github.com/owner/repo`;
- GitHub tree/blob URLs and raw `SKILL.md` URLs;
- `npx skills add <source>`, including common `-y`, `--yes`, `-g`, `--global`, `-a/--agent`, and `--skill` forms;
- `gh skill install OWNER/REPO SKILL`.

Unsupported local paths, GitLab URLs, package names, and arbitrary commands fail with typed source errors rather than being executed.

`src/main/skills/github-source.ts` resolves GitHub refs, discovers candidate `SKILL.md` files, reads candidate frontmatter metadata, and downloads the selected skill directory. Discovery recognizes root `SKILL.md`, monorepo layouts such as `skills/<skill>/SKILL.md` and `skills/<category>/<skill>/SKILL.md`, and dotdir agent layouts such as `.agents/skills/<skill>/SKILL.md`, `.claude/skills/<skill>/SKILL.md`, and `.github/skills/<skill>/SKILL.md`. Explicit category overrides from the user win; otherwise only `skills/<category>/<skill>/SKILL.md` infers a category. Other layouts default to `custom`.

Source directory import writes all fetched files as regular files after path validation. GitHub symlink/submodule entries and unsafe relative paths are rejected; file count/size caps return `source-too-large` instead of silently truncating.

## Markdown import validation

`src/main/skills/importer.ts` currently enforces:

- Markdown must be a non-empty string.
- Markdown must be at most `200_000` characters.
- Markdown must not contain NUL bytes.
- Skill name must match `^[a-z0-9][a-z0-9_-]{1,63}$`:
  - 2-64 characters;
  - lowercase letters, numbers, underscores, or hyphens;
  - starts with a lowercase letter or number.
- Category must match `^[a-z0-9][a-z0-9_-]{0,63}$`:
  - 1-64 characters;
  - lowercase letters, numbers, underscores, or hyphens;
  - starts with a lowercase letter or number.
- Import profile must be empty, `default`, or match `^[a-z0-9][a-z0-9_-]{0,63}$`.

Name inference order:

1. Explicit `request.name` if provided and non-empty after trim.
2. Existing frontmatter `name` field.
3. First Markdown heading (`# ...`).

Description inference order:

1. Explicit `request.description` if provided and non-empty after trim.
2. Existing frontmatter `description` field.
3. First non-heading/non-frontmatter paragraph from the body, sliced to 160 characters.

Category defaults to `custom` when not provided.

## Frontmatter normalization

`prepareSkillMarkdownImport(request)` normalizes Markdown before writing:

- If the Markdown already has a frontmatter block, it replaces or appends `name` and `description` fields while preserving other frontmatter fields and the Markdown body.
- If there is no frontmatter block, it prepends:

```yaml
---
name: "<name>"
description: "<description>"
---
```

Values are quoted using `JSON.stringify(...)`.

The parser only treats a delimiter line matching a newline followed by `---` as closing frontmatter; inline dashes inside values are not a closing delimiter.

## Import interaction with pending drafts

Add Skill import does not bypass the draft/save model.

Renderer flow in `handleImportMarkdown()`:

1. Set import/save UI state and clear page/import errors.
2. If there are pending enable/disable drafts, call `savePendingChanges()` first.
3. If pending save fails through per-item failure, missing result, unreflected result, reload error, or thrown IPC error, set `skills.importPendingSaveFailed`, leave failed pending entries visible, and do not call `importSkillMarkdown`.
4. If pending save succeeds or there are no pending drafts, build `SkillMarkdownImportRequest` from modal fields.
5. Call `window.hermesAPI.importSkillMarkdown(request, profile)`.
6. If import returns `success: false`, show that import error. Previously saved pending changes remain saved.
7. If import succeeds, close/reset the modal, switch to Installed, clear pending draft state, reload installed skills, and show import success or gateway restart-warning copy.

Local `importSkillMarkdown(request, profile?)` then:

1. Validates the profile name.
2. Prepares/normalizes the import request.
3. Resolves `skillsRoot = resolve(profileHome(profile), "skills")`.
4. Resolves `skillDir = resolve(skillsRoot, category, name)`.
5. Resolves `skillFile = resolve(skillDir, "SKILL.md")`.
6. Rejects the write if the resolved skill directory escapes the profile skills root or the resolved file is not directly under the skill directory.
7. Rejects duplicates when `SKILL.md` already exists and `overwrite` is not true.
8. Creates the skill directory recursively and writes normalized Markdown.
9. Returns the written skill metadata and path.

Renderer flow in `handlePreviewSkillSource()` and `handleImportSkillSource()`:

1. User enters a GitHub link or npx/gh command and clicks Preview.
2. `handlePreviewSkillSource()` calls `window.hermesAPI.previewSkillSource({ source })` before any pending draft save is attempted.
3. Preview failure shows the typed source error and performs no writes.
4. One preview candidate is selected implicitly and summarized; multiple preview candidates are rendered as a required picker with category, directory/name, repo path, and description/error.
5. User may override `name`, `description`, and `category`; category can be chosen from existing categories or typed freely.
6. On Import, `handleImportSkillSource()` verifies preview/candidate state first.
7. If there are pending enable/disable drafts, it calls `savePendingChanges()` using the exact Markdown import gate.
8. If pending save fails, it sets `skills.importPendingSaveFailed`, leaves failed pending entries visible, and does not call `importSkillSource`.
9. If pending save succeeds or there are no pending drafts, it calls `window.hermesAPI.importSkillSource(request, profile)`.
10. Success closes/resets the modal, switches to Installed, clears pending draft state, reloads installed skills, and shows success or gateway restart-warning copy.

Local source import then:

1. Parses the source or command without shelling out.
2. Resolves a single candidate by `candidateId`, `skillSelector`, or single-preview backstop. Multiple candidates without selection return `multiple-candidates`.
3. Fetches the selected skill directory pinned to the candidate commit SHA.
4. Normalizes the selected `SKILL.md` through the same Markdown preparation code used by manual import.
5. Writes the complete fetched directory to `<profileHome>/skills/<category>/<directoryName>/`, replacing the whole directory only when `overwrite` is true.
6. Returns imported skill metadata, source metadata, candidate metadata, and optional restart warning.

## IPC routing and mode differences

`src/main/ipc/knowledge.ts` owns skill IPC handlers.

### Local mode

- `list-installed-skills` -> local `listInstalledSkills(profile)`.
- `list-bundled-skills` -> local `listBundledSkills()`.
- `get-skill-content` -> local `getSkillContent(skillPath)`.
- `get-skill-metadata` -> local `getSkillMetadata(skillPath)`.
- `install-skill` / `uninstall-skill` -> legacy wrappers around `mutateSkillsForProfile(...)`.
- `mutate-skills` -> local `mutateLocalSkills(targets, profile)` through the service queue.
- `import-skill-markdown` -> local `importSkillMarkdown(request, profile)`.
- `preview-skill-source` -> main-process source parser/GitHub preview without writing files.
- `import-skill-source` -> local `fetchSkillSourceDirectory(...)` plus `importSkillDirectory(request, profile)`.

Successful skill mutation batches mark the selected profile runtime stale once when at least one item actually changed. Empty batches, all-failure batches, and no-op batches do not mark runtime stale.

If Markdown import or source import succeeds while the local gateway is running, the IPC result adds:

```ts
warning: "gateway-restart-required"
```

The current code returns the warning; it does not restart the gateway automatically.

### SSH mode

When `getConnectionConfig().mode === "ssh"`, skill handlers use `src/main/ssh/skills.ts` through `src/main/ssh-remote.ts`.

Current SSH behavior:

- Installed skill listing is profile-aware: skills are discovered under remote `~/.hermes/skills` for default or `~/.hermes/profiles/<profile>/skills` for named profiles.
- Returned remote installed skill paths are prefixed with `REMOTE:`.
- `getSkillContent(...)` strips the `REMOTE:` prefix if present and reads remote `<path>/SKILL.md`.
- `getSkillMetadata(...)` strips the `REMOTE:` prefix if present and lists immediate children under remote `scripts/` and `references/`; SSH failures degrade to `metadataAvailable: false` instead of breaking the detail page.
- Batch install/uninstall is profile-aware and is processed by one remote `sshPython()` call per batch.
- Legacy single install/uninstall wrappers remain available, but UI/API mutation routes use `sshMutateSkills(...)` so bulk operations avoid one SSH round trip per skill.
- SSH target validation rejects invalid profile names and unsafe `category`/`directoryName` segments before mutation.
- SSH install checks whether a target is already installed before shelling out. Already-installed targets return success with `changed: false`.
- SSH install first checks existing installed skills using the same category-scoped candidate model; when it needs to invoke `hermes skills install`, the install identifier preference is `category/directoryName`, then `directoryName`, then `name`.
- SSH uninstall resolves exact `REMOTE:` or remote absolute paths first and validates containment under the remote profile skills root; otherwise category-scoped candidates from `category + directoryName` and `category + name` are collected and must resolve uniquely before name-only fallback.
- SSH ambiguity fails closed with `ambiguous-skill`.
- SSH path containment is validated before removal; paths outside the selected profile skills root return `invalid-target`.
- SSH successful uninstall removes the skill directory and best-effort removes an empty category directory.
- Markdown import is profile-aware and uses the same `prepareSkillMarkdownImport(...)` validation/normalization as local import.
- Remote Markdown import writes to `~/.hermes/skills/<category>/<name>/SKILL.md` or profile equivalent.
- Remote Markdown import rejects duplicates unless `overwrite` is true.
- Source import uses the same preview/fetch path in the main process, then sends one base64 JSON directory payload through SSH to write the selected skill directory remotely.
- Remote source import writes to `~/.hermes/skills/<category>/<directoryName>/` or profile equivalent, rejects unsafe relative paths, and replaces the whole directory only when `overwrite` is true.
- Remote import returns a `REMOTE:` path normalized from `~` to `$HOME`.

If SSH Markdown import or source import succeeds while the remote gateway is running, the IPC result adds `warning: "gateway-restart-required"`. It does not restart the remote gateway automatically.

### Pure remote HTTP mode

Manual Markdown import and source import are explicitly rejected in pure remote HTTP mode with failure code `write-failed` (or the source import mode failure equivalent) and an error explaining that import is only available in local and SSH modes because it writes to the selected profile filesystem. The renderer hides GitHub link and command tabs in pure remote mode so users are not offered a source-import dead end; the backend still fails closed if called directly.

Skill mutations also fail closed in pure remote HTTP mode:

- `install-skill`, `uninstall-skill`, and `mutate-skills` do not call local skill helpers.
- They do not call SSH helpers.
- They do not mark runtime stale.
- Valid targets return per-target failures with `unsupported-remote-mode`.
- Invalid target shapes return per-target failures with `invalid-target`.
- Result order still mirrors request order.
- Empty batches return success with no results because there is nothing to mutate.

Read-only listing/content behavior remains local/SSH-oriented unless separately productized for remote HTTP.

## Runtime freshness semantics

Skill file changes can affect a running Agent runtime, but current code only exposes limited freshness behavior:

- Changed local/SSH skill mutation batches call `markRuntimeStale(profile, "Skills changed for profile runtime.")` once after the batch.
- Changed local/SSH Markdown imports call the same stale marker.
- Successful Markdown import and source import additionally return `warning: "gateway-restart-required"` when the selected local/SSH gateway is running.
- Empty, all-failure, and all-no-op mutation batches do not mark stale.
- Preview is read-only and never marks stale.
- Pure remote HTTP failures do not mark stale.

Imported source skills are runtime-stale in the same way as manually imported Markdown skills: installed files are updated, but an already-running runtime may not see new or changed skill files until a gateway restart or new Hermes session. Do not document current skill mutation as an automatic restart or solved hot-reload path. The dated skill-groups investigation records this as future runtime-policy work.

## Future extension seam: skill groups

Skill groups are not implemented in current source. The current compatibility seam for future groups is the renderer draft accumulator plus the single `mutateSkills(targets, profile?)` save path.

Future group/default-category work should follow these constraints unless source behavior changes:

- Treat groups and the future `default` skill category as Mercury-owned activation recipes or catalog conventions, not a second per-profile enabled-state store.
- Treat `inspector-gadget` as an opt-in category: it should not be installed for new Agents by default, even when `default` category seeding exists.
- Keep actual per-Agent enabled state derived from installed files under that profile's `skills/` directory.
- Expand group enable/disable into `SkillMutationTarget[]` and feed those targets into the same pending draft/save path used by row/category actions.
- Do not persist installed `path` in group definitions; derive uninstall paths from the current profile's installed skill list when applying a group.
- Derive group on/off/partial UI from installed truth after reload.
- Reuse the same partial failure/no-op semantics as `mutateSkills`.
- Do not claim automatic runtime restart/reload for group or default-category application until runtime policy is implemented and tested.
- Desired future new-Agent behavior is `default` category installed by default and other categories opt-in; `inspector-gadget` explicitly remains off by default; current all-off creation is only the implementation baseline to replace.

See `docs/investigations/skill-groups-implementation-plan-2026-06-01.md` for the dated implementation plan and runtime-policy risks. That investigation is historical evidence; this subsystem page is the evergreen current-behavior reference.

## Contract tests

`src/renderer/src/screens/Skills/Skills.test.tsx` protects the renderer draft/save contract:

- grouped rendering and category collapse;
- staged row/category enable/disable without immediate `mutateSkills` calls;
- one flat Save batch in sequence order;
- Discard behavior and draft bar copy;
- partial save failure retention;
- thrown save error retention;
- duplicate display-name targeting by directory/path identity;
- detail metadata rendering and detail-disable staging;
- Agents-using-skill lookup;
- refresh/reload behavior that rebases pending state;
- manual Markdown import;
- source import preview/import flow, including single-candidate direct import, monorepo candidate picker, disabled import before selection, pending-save gate, pending-save abort, modal cleanup, installed reload, and restart-warning copy;
- import submission saves pending changes first and aborts import on pending-save failure.

`tests/skills-mutation.test.ts` protects local batch mutation path safety:

- install refuses symlinked profile skill categories that would escape the profile root;
- uninstall refuses symlinked profile skill categories and leaves external files intact.

`tests/skills-import.test.ts` verifies local Markdown and directory import behavior:

- writes normalized `SKILL.md` into the default profile;
- writes to a named profile skills directory;
- rejects traversal profile names;
- rejects invalid names and categories;
- rejects duplicates unless `overwrite` is enabled;
- preserves Markdown body while normalizing existing frontmatter;
- does not treat inline dashes inside frontmatter values as a closing delimiter;
- imports multi-file source directories with scripts/references/assets;
- rejects unsafe fetched relative paths;
- replaces stale source-import files on overwrite;
- checks local `getSkillMetadata()` scripts/references discovery.

`tests/skills-source-parser.test.ts` protects the pure parser for GitHub sources, raw/tree/blob URLs, `npx skills add ...`, `gh skill install ...`, flag handling, skill selectors, and unsupported/arbitrary command rejection.

`tests/skills-source-github.test.ts` protects GitHub preview/fetch behavior: root and monorepo candidates, dotdir skill layouts, tree/blob/raw URL narrowing, rate-limit failures, commit pinning, selected-directory fetches, and oversized/truncated source handling.

`tests/knowledge-service.test.ts` protects service-level mutation policy:

- local skill batches go through the service queue;
- local/SSH changed batches mark runtime stale once;
- partial failures are preserved in the returned batch result;
- all-failure and all-no-op batches do not mark stale;
- pure remote HTTP skill mutation fails closed without touching local/SSH helpers or marking stale;
- source import routes through local/SSH directory import and marks runtime stale on success;
- pure remote HTTP source import fails closed before fetch/write/runtime stale marking;
- preview does not mark runtime stale;
- SSH batches route through `sshMutateSkills`;
- toolset toggles are deliberately next-message config writes, not stale runtime mutations.

IPC/preload contract tests protect skill API availability and channel matching:

- `tests/ipc-handlers.test.ts` checks `get-skill-metadata`, `mutate-skills`, `import-skill-markdown`, `preview-skill-source`, and `import-skill-source` have both main handlers and preload invokes.
- `tests/preload-api-surface.test.ts` checks `getSkillMetadata`, `mutateSkills`, `importSkillMarkdown`, `previewSkillSource`, and `importSkillSource` exist in both preload implementation and `HermesAPI` types.
- `tests/cli-read-only-commands.test.ts` and `tests/cli-mutating-commands.test.ts` cover CLI skill command routing through shared services.

## Verification guidance

For skill changes, run targeted tests based on the touched behavior:

```bash
npm run test -- src/renderer/src/screens/Skills/Skills.test.tsx
npm run test -- tests/skills-source-parser.test.ts tests/skills-source-github.test.ts tests/skills-mutation.test.ts tests/skills-import.test.ts tests/knowledge-service.test.ts
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run test:cli
npm run typecheck
```

If changes affect SSH/local mode behavior, also review [Connection modes](connection-modes.md), [Storage and profiles](storage-and-profiles.md), and [IPC and preload contract](../contracts/ipc-preload.md). For docs-only edits, manually verify file paths and links; run `npm run check:docs` when feasible.

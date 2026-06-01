# Skills Subsystem

This document describes Mercury's current skill listing, grouped Skills UI, content, metadata, install/uninstall, manual Markdown import, validation, local/SSH/remote behavior, and gateway restart warning semantics.

## Source anchors

- Shared import contract: `src/shared/skills.ts`
- Local skill listing/install helpers: `src/main/skills.ts`
- Markdown import implementation: `src/main/skills/importer.ts`
- Knowledge IPC routing: `src/main/ipc/knowledge.ts`
- Shared knowledge service used by IPC and CLI: `src/main/services/knowledge-service.ts`
- CLI skill commands: `src/cli/read-only-commands.ts`, `src/cli/mutating-commands.ts`, [CLI contract](../contracts/cli.md)
- Preload API: `src/preload/api/knowledge.ts`, `src/preload/index.d.ts`
- SSH skill implementation: `src/main/ssh/skills.ts`
- SSH transport helpers: `src/main/ssh/transport.ts`
- Contract test: `tests/skills-import.test.ts`
- Codex image generation skill/tool behavior: [Codex image generation](codex-image-generation.md)

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

The renderer-facing TypeScript declarations live in `src/preload/index.d.ts` and use request/result types from `src/shared/skills.ts` for Markdown import, metadata, and `SkillMutationTarget` / `SkillMutationBatchResult` batch mutations. Batch mutation results preserve input order, report `updated` changed-item count, and include per-target success or failure details.

## CLI skill commands

The CLI exposes the same skill capabilities for automation through `src/main/services/knowledge-service.ts`; it is not layered through preload. Current skill commands are:

| Command | Behavior |
| --- | --- |
| `mercury skills installed [--profile <name>]` | Lists installed skills for the selected profile/Agent. |
| `mercury skills bundled` | Lists bundled or registry-discovered skills using the same local/SSH behavior as IPC. |
| `mercury skills content <path>` | Reads `SKILL.md` content for an installed/local or `REMOTE:` skill path. |
| `mercury skills metadata <path>` | Reads skill metadata plus scripts/references availability where supported. |
| `mercury skills install <identifier> [--profile <name>]` | Installs a skill into the selected profile. |
| `mercury skills uninstall <name> [--profile <name>]` | Uninstalls a skill from the selected profile. |
| `mercury skills import --file <path> [--name ...] [--category ...] [--description ...] [--overwrite] [--profile <name>]` | Imports Markdown through the shared `SkillMarkdownImportRequest`/`SkillMarkdownImportResult` contract. |

Local, SSH, and pure remote HTTP behavior matches the IPC mode rules below. Manual Markdown import returns the same success/failure codes as the renderer path; gateway restart warnings are part of the service result (for example `warning: "gateway-restart-required"`) and may appear inside CLI JSON `data` rather than as a top-level CLI envelope warning.

## Renderer UI semantics

The Skills screen groups both installed and browse results by `category` into collapsible sections. Each section shows an enabled count and category-level bulk actions.

Mercury does not persist a separate skill-enabled flag. Newly created Mercury Agents/profiles start with no skills installed; the Agents "copy default config/API keys" option copies credentials/config only, not skills. Users opt into skills from this screen after Agent creation.

In the current V1 UI, **enabled for the selected Agent** means the skill is installed in that Agent profile, and **disabled** means the skill is uninstalled from that Agent profile:

- Individual Enable -> `mutateSkills([{ action: "install", name, category, directoryName }], profile?)`.
- Individual Disable -> `mutateSkills([{ action: "uninstall", name, category, directoryName, path }], profile?)`.
- Category Enable all -> one `mutateSkills(...)` batch for currently disabled skills in that visible category.
- Category Disable all / Disable enabled -> one `mutateSkills(...)` batch for currently enabled skills in that visible category.

Bulk actions make one renderer-to-main API call, reload installed skills once after the batch completes, and surface detailed per-skill failures such as timeout, ambiguity, or unsupported-mode errors. The UI uses `category + directoryName` as skill allocation identity and includes the installed path in row/action keys so duplicate display names do not collide. If a selected detail panel's installed skill is disabled by an operation, the detail panel closes rather than showing stale content.

The installed-skill detail experience is an in-screen page/panel instead of a modal. It renders `SKILL.md` Markdown on the left and metadata on the right. Browse results can open details only when the bundled skill is already installed for the selected Agent; otherwise users are prompted to install it first.

"Agents using this skill" is derived in the renderer by calling `listProfiles()` and then `listInstalledSkills(profile.name)` for each Agent. Matching prefers case-insensitive `category/directoryName` identity, falling back to display name only when a directory name is unavailable.

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

## Bundled and registry skills

Current local behavior:

- `listBundledSkills()` walks `<HERMES_REPO>/skills/<category>/<skill>/SKILL.md` and returns bundled skills sorted by category/name. Results include `directoryName`, the bundled skill directory.
- `searchSkills(query)` shells out to Hermes CLI: `hermes skills browse --query <query> --json`; if JSON parsing fails or command fails, it returns an empty list.

`listBundledSkills()` does not call the registry search locally; it reads bundled skills from the local Hermes repo directory.

Current SSH behavior differs: `sshListBundledSkills()` calls remote registry browsing through `hermes skills browse --query "" --json` via SSH. It does not traverse a remote bundled-skills repository directory.

## Local install and uninstall

`mutateLocalSkills(targets, profile?)` is the primary mutation engine for UI/API calls. It processes targets in order and returns a `SkillMutationBatchResult` with one item result per target:

- install resolves bundled skills by exact `category + directoryName`, then `category + name`, and falls back to the Hermes CLI install path for legacy identifiers.
- uninstall prefers exact installed `path`, then `category + directoryName`, then `category + name`, then legacy name-only lookup.
- ambiguous uninstall targets fail closed with `ambiguous-skill` rather than deleting the wrong directory.
- all direct filesystem writes/removals validate that source and destination paths remain inside the expected bundled-skill or profile-skill roots.

Legacy `installSkill(identifier, profile?)` and `uninstallSkill(name, profile?)` remain for compatibility and still return `{ success: true }` or `{ success: false, error }`, but service-level callers route through the batch mutation path.

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

## Local Markdown import write behavior

`importSkillMarkdown(request, profile?)`:

1. Validates the profile name.
2. Prepares/normalizes the import request.
3. Resolves `skillsRoot = resolve(profileHome(profile), "skills")`.
4. Resolves `skillDir = resolve(skillsRoot, category, name)`.
5. Resolves `skillFile = resolve(skillDir, "SKILL.md")`.
6. Rejects the write if the resolved skill directory escapes the profile skills root or the resolved file is not directly under the skill directory.
7. Rejects duplicates when `SKILL.md` already exists and `overwrite` is not true.
8. Creates the skill directory recursively and writes normalized Markdown.
9. Returns the written skill metadata and path.

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

Successful skill mutation batches mark the selected profile runtime stale once when at least one item actually changed. Empty batches, all-failure batches, and no-op batches do not mark runtime stale.

If Markdown import succeeds while the local gateway is running, the IPC result adds:

```ts
warning: "gateway-restart-required"
```

The current code returns the warning; it does not restart the gateway automatically.

### SSH mode

When `getConnectionConfig().mode === "ssh"`, skill handlers use `src/main/ssh/skills.ts` through `src/main/ssh-remote.ts`.

Current SSH behavior:

- Installed skill listing is profile-aware: skills are discovered under remote `~/.hermes/skills` for default or `~/.hermes/profiles/<profile>/skills` for named profiles.
- Returned remote skill paths are prefixed with `REMOTE:`.
- `getSkillContent(...)` strips the `REMOTE:` prefix if present and reads remote `<path>/SKILL.md`.
- `getSkillMetadata(...)` strips the `REMOTE:` prefix if present and lists immediate children under remote `scripts/` and `references/`; SSH failures degrade to `metadataAvailable: false` instead of breaking the detail page.
- Batch install/uninstall is profile-aware in SSH mode and is processed by one remote `sshPython()` call per batch.
- Legacy single install/uninstall wrappers remain available, but UI/API mutation routes use `sshMutateSkills(...)` so bulk operations avoid one SSH round trip per skill.
- SSH uninstall resolves exact `REMOTE:` paths or `category + directoryName` before falling back to name matching, and ambiguous targets fail closed.
- Markdown import is profile-aware and uses the same `prepareSkillMarkdownImport(...)` validation/normalization as local import.
- Remote Markdown import writes to `~/.hermes/skills/<category>/<name>/SKILL.md` or profile equivalent.
- Remote Markdown import rejects duplicates unless `overwrite` is true.
- Remote import returns a `REMOTE:` path normalized from `~` to `$HOME`.

If SSH Markdown import succeeds while the remote gateway is running, the IPC result adds `warning: "gateway-restart-required"`. It does not restart the remote gateway automatically.

### Pure remote HTTP mode

Manual Markdown import is explicitly rejected in pure remote HTTP mode with failure code `write-failed` and an error explaining that import is only available in local and SSH modes because it writes to the selected profile filesystem.

Skill mutations also fail closed in pure remote HTTP mode. `install-skill`, `uninstall-skill`, and `mutate-skills` return failures with `unsupported-remote-mode` details and do not call local skill helpers or mark the runtime stale. Read-only listing/content behavior remains local/SSH-oriented unless separately productized for remote HTTP.

## Contract tests

`tests/skills-import.test.ts` currently verifies local Markdown import behavior:

- Writes normalized `SKILL.md` into the default profile.
- Writes to a named profile skills directory.
- Rejects traversal profile names.
- Rejects invalid names and categories.
- Rejects duplicates unless `overwrite` is enabled.
- Preserves Markdown body while normalizing existing frontmatter.
- Does not treat inline dashes inside frontmatter values as a closing delimiter.

IPC/preload and CLI surface tests also protect skill API availability:

- `tests/skills-import.test.ts` checks Markdown import and local `getSkillMetadata()` scripts/references discovery.
- `tests/ipc-handlers.test.ts` checks `get-skill-metadata`, `mutate-skills`, and `import-skill-markdown` have both main handlers and preload invokes.
- `tests/preload-api-surface.test.ts` checks `getSkillMetadata`, `mutateSkills`, and `importSkillMarkdown` exist in both preload implementation and `HermesAPI` types.
- `src/renderer/src/screens/Skills/Skills.test.tsx` covers grouping/collapse, individual and category batch enable/disable actions, detailed failure rendering, duplicate display-name targeting, detail metadata, Agents using a skill, and manual Markdown import.
- `tests/cli-read-only-commands.test.ts` and `tests/cli-mutating-commands.test.ts` cover CLI skill command routing through shared services.

## Verification guidance

For skill changes, run:

```bash
npm run test -- src/renderer/src/screens/Skills/Skills.test.tsx
npm run test -- tests/skills-import.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run test:cli
npm run typecheck
```

If changes affect SSH/local mode behavior, also review [Connection modes](connection-modes.md) and [Storage and profiles](storage-and-profiles.md). For docs-only edits, manually verify file paths and links.

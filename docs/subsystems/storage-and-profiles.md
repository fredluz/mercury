# Storage and Profiles

This document describes Mercury's current profile scoping, persistent files, session cache, memory/user/soul storage, model/credential files, and local/SSH/remote differences.

## Source anchors

- Profile path helpers: `src/main/utils.ts`
- Config/env/connection/model/credential persistence: `src/main/config.ts`
- Sessions and search: `src/main/sessions.ts`
- Session cache: `src/main/session-cache.ts`
- Memory/user profile: `src/main/memory.ts`
- Soul: `src/main/soul.ts`
- Models: `src/main/models.ts`
- IPC routing: `src/main/ipc/config.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/knowledge.ts`, `src/main/ipc/models.ts`, `src/main/ipc/system.ts`
- SSH implementations: `src/main/ssh/config.ts`, `src/main/ssh/sessions-profiles.ts`, `src/main/ssh/memory-soul.ts`, `src/main/ssh/runtime.ts`, `src/main/ssh/transport.ts`
- Contract test: `tests/session-cache-sync.test.ts`

## Profile scoping

Most local profile-aware files are rooted through `profileHome(profile)` from `src/main/utils.ts`.

Current behavior visible from callers:

- Default profile uses `<HERMES_HOME>`.
- Named profiles use a profile-specific home under the Hermes home. Source call sites consistently treat named profiles as separate homes for env/config/memory/soul/skills/session state.
- SSH implementations mirror this shape with remote paths under `~/.hermes` for default and `~/.hermes/profiles/<profile>` for named profiles.

## Persistent files

Current local persistent files used by the documented subsystems include:

| File | Owner/source | Purpose |
| --- | --- | --- |
| `<HERMES_HOME>/desktop.json` | `src/main/config.ts` | Desktop app connection mode, remote URL/API key, and SSH config. |
| `<profileHome>/.env` | `src/main/config.ts`, `src/main/memory.ts`, SSH config helpers | Profile environment variables/API keys. |
| `<profileHome>/config.yaml` | `src/main/config.ts`, SSH config helpers | Hermes config values such as provider/default/base URL, streaming, platform/tool settings. |
| `<HERMES_HOME>/auth.json` | `src/main/config.ts` | Credential pool under `credential_pool`. |
| `<HERMES_HOME>/models.json` | `src/main/models.ts` | Saved model library. Seeded from defaults when missing. |
| `<profileHome>/state.db` | `src/main/sessions.ts`, `src/main/session-cache.ts`, `src/main/memory.ts` | Hermes SQLite session/message database read by desktop. |
| `<HERMES_HOME>/desktop/sessions.json` | `src/main/session-cache.ts` | Desktop session cache with generated titles, row `profile` metadata, global `lastSync`, and per-profile `profileSync`. |
| `<profileHome>/memories/MEMORY.md` | `src/main/memory.ts`, `src/main/ssh/memory-soul.ts` | Memory entries separated by `\n§\n`. |
| `<profileHome>/memories/USER.md` | `src/main/memory.ts`, `src/main/ssh/memory-soul.ts` | User profile text. |
| `<profileHome>/SOUL.md` | `src/main/soul.ts`, `src/main/ssh/memory-soul.ts` | Persona/soul text. |
| `<HERMES_HOME>/desktop-traces.json` | `src/main/trace-store.ts` | Trace runs and trace events. See [Trace schema contract](../contracts/trace-schema.md). |
| `<HERMES_HOME>/gateway.pid` | `src/main/hermes/gateway.ts` | Gateway process id used for gateway status/stop. |
| `<HERMES_HOME>/logs/*.log` | installer/runtime log helpers, SSH runtime log helper | Log viewer reads allowed log files locally/remotely. |

Remote SSH equivalents generally use `~/.hermes/...` and `~/.hermes/profiles/<profile>/...` paths.

## Connection config and desktop settings

`src/main/config.ts` stores connection settings in `<HERMES_HOME>/desktop.json`.

Fields written by `setConnectionConfig(...)`:

- `connectionMode`
- `remoteUrl`
- `remoteApiKey`
- `sshConfig` only when mode is SSH

See [Connection modes](connection-modes.md) for runtime interpretation.

## Env and config files

`src/main/config.ts` reads and writes:

- `.env` key-value lines through `readEnv(...)` and `setEnvValue(...)`.
- `config.yaml` scalar values through regex-based `getConfigValue(...)` and `setConfigValue(...)`.
- model config fields from `config.yaml`:
  - `provider`
  - `default`
  - `base_url`

`setModelConfig(...)` currently also:

- disables `smart_model_routing` when it finds an adjacent `enabled: true|false` line after a `smart_model_routing` line;
- sets top-level `streaming:` to `true` when the field exists.

`src/main/ipc/config.ts` restarts local or SSH gateways for selected config changes as described in [Connection modes](connection-modes.md).

## Credential pool

`src/main/config.ts` stores credentials in `<HERMES_HOME>/auth.json` under `credential_pool`.

Shape exposed through `getCredentialPool()` and `setCredentialPool(provider, entries)`:

```ts
Record<string, Array<{ key: string; label: string }>>
```

Credential pool handlers in `src/main/ipc/models.ts` do not currently branch to SSH; they use local `auth.json`.

## Models library

`src/main/models.ts` stores saved models in:

```text
<HERMES_HOME>/models.json
```

`SavedModel` fields:

- `id`
- `name`
- `provider`
- `model`
- `baseUrl`
- `createdAt`

Current behavior:

- `listModels()` seeds `models.json` from `DEFAULT_MODELS` if the file is missing.
- `addModel(...)` returns an existing model when the same `model` and `provider` already exist.
- `removeModel(id)` removes by id and returns whether anything changed.
- `updateModel(id, fields)` updates name/provider/model/baseUrl fields for an existing id.
- `src/main/ipc/models.ts` uses SSH `sshListModels(...)` for listing in SSH mode, but add/remove/update currently call local model functions.

## Sessions and SQLite state

`src/main/sessions.ts` reads Hermes SQLite DBs through the profile-aware path contract:

```text
<profileHome>/state.db
```

That means the default profile reads `<HERMES_HOME>/state.db`, while named profiles read `<HERMES_HOME>/profiles/<profile>/state.db`.

Current local session functions:

- `listSessions(limit = 30, offset = 0, profile?)` reads `sessions`, ordered globally by `started_at DESC`, and returns summary fields with empty `preview` and a `profile` field. When `profile` is omitted, it aggregates default plus discovered named profile DBs; when supplied, it reads only that profile DB.
- `getSessionMessages(sessionId, profile?)` reads user/assistant messages from `messages`, ordered by `timestamp, id`. When `profile` is supplied it reads that profile DB only; otherwise it searches default and named profile DBs deterministically for the session id.
- `searchSessions(query, limit = 20, profile?)` requires a `messages_fts` table; it sanitizes query terms for FTS5 and returns distinct session snippets with `profile` metadata. When `profile` is omitted it searches all discovered profile DBs and combines the results.

SSH session functions in `src/main/ssh/sessions-profiles.ts` mirror this behavior against remote `~/.hermes/state.db` and `~/.hermes/profiles/<profile>/state.db`, including profile passthrough for list, message retrieval, and search.

## Session cache

`src/main/session-cache.ts` stores the desktop cache at:

```text
<HERMES_HOME>/desktop/sessions.json
```

Cache shape:

```ts
interface CacheData {
  sessions: CachedSession[];
  lastSync: number;
  profileSync?: Record<string, number>;
}
```

`CachedSession` fields:

- `id`
- `title`
- `startedAt`
- `source`
- `messageCount`
- `model`
- `profile` — normalized profile identity (`"default"` for the default DB, otherwise the named profile)

Current sync behavior:

- Reads from profile-specific local `<profileHome>/state.db` files when they exist; otherwise returns cached sessions.
- `syncSessionCache(profile?)` syncs only the requested profile when supplied, or default plus discovered named profiles when omitted.
- Tracks a global `lastSync` and per-profile `profileSync` timestamps. It fetches sessions newer than each profile's sync timestamp minus a small overlap, or all sessions for a profile on first sync/backfill.
- Backfills legacy cache rows without `profile` metadata and normalizes cache identity by `(profile, id)`, so duplicate session ids in different profiles can coexist.
- Uses maps keyed by the composite cache key to update existing sessions without O(N²) behavior.
- Generates titles from the first user message when the DB session title is missing.
- Sorts all cached sessions by `startedAt` descending.
- `listCachedSessions(limit, offset, profile?)` filters by profile only when one is supplied; otherwise it returns the global cross-profile cache.
- `updateSessionTitle(sessionId, title, profile?)` and generated-title chat IPC side effects pass profile so the profile DB row and matching cache row are updated together.
- `updateSessionProfile(sessionId, profile?)` treats profile as session identity and inserts/updates the matching cache row with profile metadata after chat completion returns a session id.

`tests/session-cache-sync.test.ts` verifies first sync, incremental updates, no duplicate sessions, append behavior, named-profile cache metadata/backfill, duplicate ids across profiles, title/profile updates, and the large-cache performance regression case.

In SSH mode, `src/main/ipc/sessions.ts` maps `list-cached-sessions` and `sync-session-cache` to `sshListCachedSessions(...)`, which derives cached-session-shaped rows with profile metadata from remote sessions rather than reading/writing the local desktop cache.

## Memory and user profile files

`src/main/memory.ts` uses:

- `<profileHome>/memories/MEMORY.md`
- `<profileHome>/memories/USER.md`

Current behavior:

- Memory entries are separated by the exact delimiter `\n§\n`.
- Memory character limit is `2200`.
- User profile character limit is `1375`.
- `readMemory(profile)` returns memory/user content, existence, last modified time for local files, parsed memory entries, character counts/limits, and session/message counts from the profile `state.db`.
- `addMemoryEntry(...)` and `updateMemoryEntry(...)` trim entry content and reject writes that would exceed the memory limit.
- `removeMemoryEntry(index)` removes an entry by parsed index.
- `writeUserProfile(content)` rejects content over the user limit.

SSH memory behavior in `src/main/ssh/memory-soul.ts` mirrors delimiter and character limits, but returns `lastModified: null` for remote memory/user files.

## Soul file

`src/main/soul.ts` uses:

```text
<profileHome>/SOUL.md
```

Current behavior:

- `readSoul(profile)` returns an empty string if the file is missing or unreadable.
- `writeSoul(content, profile)` writes the file with `safeWriteFile(...)` and returns success/failure.
- `resetSoul(profile)` writes and returns the built-in `DEFAULT_SOUL` text.

SSH soul behavior in `src/main/ssh/memory-soul.ts` uses remote `~/.hermes/SOUL.md` or profile `SOUL.md` and the same default soul text.

## Backup, import, dump, logs, and memory providers

`src/main/ipc/system.ts` exposes system/storage-adjacent operations:

- `run-hermes-backup` -> local `runHermesBackup(profile)`.
- `run-hermes-import` -> local `runHermesImport(archivePath, profile)`.
- `run-hermes-dump` -> SSH `sshRunDump(...)` in SSH mode, otherwise local `runHermesDump()`.
- `list-mcp-servers` -> local `listMcpServers(profile)`.
- `discover-memory-providers` -> SSH implementation in SSH mode, otherwise local implementation.
- `read-logs` -> SSH log reader in SSH mode, otherwise local log reader.

At the time of this doc, backup/import and MCP server listing do not branch to SSH or pure remote HTTP in this IPC module.

## Local, remote, and SSH differences

- **Local mode** reads/writes local files under `HERMES_HOME` and `profileHome(profile)`.
- **Pure remote HTTP mode** is renderer-gated for filesystem-backed screens. Main handlers without explicit remote support may still operate locally; manual Markdown skill import explicitly rejects pure remote mode because it writes to a profile filesystem.
- **SSH mode** uses SSH helpers for many env/config/session/profile/memory/soul/skill/runtime reads and writes. Remote paths are under `~/.hermes` and `~/.hermes/profiles/<profile>`. Some handlers still remain local-only, as noted above.

## Verification guidance

For storage/profile changes, run targeted tests based on the touched area:

```bash
npm run test -- tests/session-cache-sync.test.ts tests/sessions-profile-db.test.ts
npm run test -- tests/chat-ipc-lifecycle.test.ts
npm run test -- tests/skills-import.test.ts
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run typecheck
```

For trace storage changes, also run:

```bash
npm run test -- tests/trace-store.test.ts
```

For docs-only edits, manually verify links and source file references.

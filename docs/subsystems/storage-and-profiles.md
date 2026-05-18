# Storage and Profiles

This document describes Mercury's current profile scoping, persistent files, session cache, memory/user/soul storage, model/credential files, runtime identity, and local/SSH/remote differences. It intentionally distinguishes profile-scoped storage from verified profile-scoped runtime execution.

## Source anchors

- Profile path helpers: `src/main/utils.ts`
- Profile discovery and active profile marking: `src/main/profiles.ts`
- Config/env/connection/model/credential persistence: `src/main/config.ts`
- Sessions and search: `src/main/sessions.ts`
- Session cache: `src/main/session-cache.ts`
- Memory/user profile: `src/main/memory.ts`
- Soul: `src/main/soul.ts`
- Models: `src/main/models.ts`, `src/main/default-models.ts`, `src/shared/chat-metadata.ts`
- IPC routing: `src/main/ipc/config.ts`, `src/main/ipc/sessions.ts`, `src/main/ipc/knowledge.ts`, `src/main/ipc/models.ts`, `src/main/ipc/system.ts`
- Shared CLI/IPC services: `src/main/services/config-service.ts`, `src/main/services/sessions-service.ts`, `src/main/services/knowledge-service.ts`, `src/main/services/models-service.ts`, `src/main/services/system-service.ts`, `src/main/services/chat-service.ts`
- Runtime identity and diagnostics: `src/main/hermes/runtime.ts`, `src/main/hermes/types.ts`, `src/shared/runtime.ts`
- SSH implementations: `src/main/ssh/config.ts`, `src/main/ssh/sessions-profiles.ts`, `src/main/ssh/memory-soul.ts`, `src/main/ssh/runtime.ts`, `src/main/ssh/transport.ts`, `src/main/ssh-tunnel.ts`
- Contract tests: `tests/profiles.test.ts`, `tests/chat-metadata.test.ts`, `tests/session-cache-sync.test.ts`, `tests/hermes-runtime.test.ts`, `tests/cron-runtime.test.ts`, `tests/ssh-remote.test.ts`, `tests/reliable-profile-runtime-contract.test.ts`
- CLI contract and parity tests: `docs/contracts/cli.md`, `tests/cli-chat-commands.test.ts`, `tests/cli-parity.test.ts`

## Profile scoping

Most local profile-aware files are rooted through `profileHome(profile)` from `src/main/utils.ts`. In the UI, these Hermes profiles are presented as Agents; this document uses profile to refer to filesystem/runtime identity.

Current behavior visible from callers:

- Default profile uses `<HERMES_HOME>`.
- Named profiles use a profile-specific home under the Hermes home. Source call sites consistently treat named profiles as separate homes for env/config/memory/soul/skills/session state.
- `src/main/profiles.ts` always includes the default profile in `listProfiles()`.
- Named profiles are any non-dot directories directly under `<HERMES_HOME>/profiles`; they do not need `config.yaml` or `.env` to be visible in the UI.
- `<HERMES_HOME>/active_profile` is read to mark `ProfileInfo.isActive`. Missing or blank files default the active profile to `"default"`.
- SSH implementations mirror this shape with remote paths under `~/.hermes` for default and `~/.hermes/profiles/<profile>` for named profiles.

## Storage isolation vs runtime isolation

Storage isolation means Mercury reads and writes profile-specific files such as `.env`, `config.yaml`, `state.db`, memory, SOUL, skills, cron jobs, and remote SSH equivalents under the requested profile home. Runtime isolation is a stricter execution guarantee: chat, title generation, cron API calls, gateway lifecycle, SSH gateway operations, and other Hermes execution paths must resolve a runtime whose actual identity is verified for the requested profile.

Mercury enforces runtime isolation through `ProfileRuntimeManager` and the main-process runtime contract in `src/main/hermes/types.ts`:

- `ProfileRuntimeRequest` carries the requested `profile`, connection `mode`, runtime `purpose`, optional `sessionId`, and transport preference.
- `RuntimeIdentity` records requested profile, actual/verified profile, mode, transport, URL/port, PID/config/log/home evidence, auth-key fingerprint/source, verification source, command evidence, and mismatch reason when known.
- `ProfileRuntimeHandle` is the only safe handoff for API execution. Chat, title, and cron API paths must use its URL/auth and reject mismatched or unverified profiles.
- `RuntimeDiagnostic` from `src/shared/runtime.ts` is exposed through `get-runtime-diagnostic` and renderer `getRuntimeDiagnostic(profile)`. It reports selected/requested/actual profile, mode, transport, API URL/port, PID/config/auth source, verification time, stale state, mismatch, unsupported, and capability fields.

A profile-scoped file write does not prove that a running Hermes API process has loaded that profile. Profile-scoped config changes that can affect a running runtime mark the runtime stale or restart it when practical. The UI surfaces stale/mismatch/unverified states in Chat, Gateway, Settings, and the main layout instead of implying profile isolation when Mercury cannot prove it.

## Persistent files

Current local persistent files used by the documented subsystems include:

| File | Owner/source | Purpose |
| --- | --- | --- |
| `<HERMES_HOME>/desktop.json` | `src/main/config.ts` | Desktop app connection mode, remote URL/API key, and SSH config. |
| `<profileHome>/.env` | `src/main/config.ts`, `src/main/memory.ts`, SSH config helpers | Profile environment variables/API keys. |
| `<profileHome>/config.yaml` | `src/main/config.ts`, SSH config helpers | Hermes config values such as provider/default/base URL, streaming, platform/tool settings. |
| `<HERMES_HOME>/auth.json` | `src/main/config.ts` | Credential pool under `credential_pool`. |
| `<HERMES_HOME>/active_profile` | `src/main/profiles.ts` | Active profile name used by `listProfiles()` to mark `ProfileInfo.isActive`; missing/blank means `default`. |
| `<HERMES_HOME>/models.json` | `src/main/models.ts` | Saved model library, including normalized context-window metadata. Seeded from defaults when missing. |
| `<profileHome>/state.db` | `src/main/sessions.ts`, `src/main/session-cache.ts`, `src/main/memory.ts` | Hermes SQLite session/message database read by desktop. |
| `<HERMES_HOME>/desktop/sessions.json` | `src/main/session-cache.ts` | Desktop session cache with generated titles, row `profile` metadata, global `lastSync`, and per-profile `profileSync`. |
| `<profileHome>/memories/MEMORY.md` | `src/main/memory.ts`, `src/main/ssh/memory-soul.ts` | Memory entries separated by `\n§\n`. |
| `<profileHome>/memories/USER.md` | `src/main/memory.ts`, `src/main/ssh/memory-soul.ts` | User profile text. |
| `<profileHome>/SOUL.md` | `src/main/soul.ts`, `src/main/ssh/memory-soul.ts` | Persona/soul text. |
| `<HERMES_HOME>/desktop-traces.json` | `src/main/trace-store.ts` | Trace runs and trace events. See [Trace schema contract](../contracts/trace-schema.md). |
| `<profileHome>/gateway.pid` | `src/main/hermes/runtime.ts`, `src/main/ssh/runtime.ts` | Profile-specific gateway process id used for local/SSH gateway status and stop. |
| `<profileHome>/gateway.log`, `<profileHome>/logs/*.log` | installer/runtime log helpers, SSH runtime log helper | Profile-specific log viewer inputs where available; SSH log reads target the selected remote profile. |

Remote SSH equivalents generally use `~/.hermes/...` and `~/.hermes/profiles/<profile>/...` paths.

## CLI storage parity

The CLI does not introduce a separate storage root or schema. Commands run against the same `HERMES_HOME`, `desktop.json`, profile homes, session cache, memory/SOUL files, models, credentials, cron state, and trace store documented here. Profile selection follows the CLI contract: explicit `--profile` / `-p` wins, then `MERCURY_PROFILE`, then the default profile used by shared services.

`profiles` and `agents` are CLI aliases for the same profile-backed workspace identity. `mercury profiles list|create|delete|use` and `mercury agents list|create|delete|use` operate on `src/main/profiles.ts` data, including `<HERMES_HOME>/active_profile`, so the desktop Agents screen and CLI see the same workspace set.

CLI mutations use the same profile-scoped files and service side effects as IPC/preload:

- `memory add|update|remove`, `memory read`, and `user-profile write` use the selected profile's `memories/` files and SQLite session counts.
- `soul write|reset|read` uses the selected profile's `SOUL.md`.
- `tools set` updates the selected profile's tool configuration.
- `skills install|uninstall|import|installed|content|metadata` uses the same local/SSH skill roots and Markdown import contract described in [Skills subsystem](skills.md).
- `sessions cache sync`, `sessions cache list`, `sessions list|messages|search`, and `sessions title set` preserve profile metadata in the desktop session cache and profile DBs.
- `cron create|remove|pause|resume|run` uses the same cron state/runtime isolation rules as the desktop schedules surface.
- `env set`, `config set`, `model-config set`, `connection set`, and `connection ssh set` write the same `.env`, `config.yaml`, and `desktop.json` files used by the renderer settings path.

`mercury chat send` records trace/session side effects through `src/main/services/chat-service.ts`: trace runs/events/usage are persisted to `<HERMES_HOME>/desktop-traces.json`, completed session ids are associated with the requested profile in the desktop session cache, and `chat title --session` updates the same profile-aware session title storage used by the renderer. Config/import mutations that affect a running runtime mark runtime state stale or return restart warnings where the shared service does so; the CLI reports those effects in command output rather than showing renderer banners.

In SSH mode, CLI storage-facing commands route through the same SSH helpers as IPC when a service exposes an SSH branch. Models and credentials remain local for mutating operations where the IPC path is local-only. In pure remote HTTP mode, profile-bound execution remains fail-closed unless explicitly supported, and filesystem-backed mutations should not be described as remote storage writes.

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

`src/main/ipc/config.ts` restarts local or SSH gateways for selected config changes where it can safely do so and marks affected runtimes stale for changes that require revalidation. Connection-mode changes mark all known runtimes stale because the verified transport identity may no longer match the selected mode.

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
- `contextWindow?: number`

Current behavior:

- `listModels()` seeds `models.json` from `DEFAULT_MODELS` if the file is missing. Default models include explicit `contextWindow` values.
- Loaded models are normalized with `inferContextWindow(provider, model, contextWindow)`, so an explicit saved value is preserved, known provider/model pairs get known token windows, and unknown models fall back to the shared metadata default.
- `addModel(...)` returns an existing model when the same `model` and `provider` already exist; new entries store the inferred context window.
- `removeModel(id)` removes by id and returns whether anything changed.
- `updateModel(id, fields)` updates name/provider/model/baseUrl/contextWindow fields for an existing id. When provider or model changes and no explicit `contextWindow` field is supplied, the old context window is cleared and re-inferred from the new provider/model pair.
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

## Backup, import, dump, logs, MCP, and memory providers

`src/main/ipc/system.ts` exposes system/storage-adjacent operations:

- `run-hermes-backup` -> local `runHermesBackup(profile)`.
- `run-hermes-import` -> local `runHermesImport(archivePath, profile)` and marks the profile runtime stale after a successful import.
- `run-hermes-dump` -> SSH `sshRunDump(...)` in SSH mode, otherwise local `runHermesDump()`.
- `list-mcp-servers` -> SSH `sshListMcpServers(conn.ssh, profile)` in SSH mode, otherwise local `listMcpServers(profile)`.
- `discover-memory-providers` -> SSH implementation in SSH mode, otherwise local implementation.
- `read-logs` -> SSH `sshReadLogs(conn.ssh, logFile, lines, profile)` in SSH mode, otherwise local `readLogs(logFile, lines, profile)`.

Backup/import remain local filesystem operations; pure remote HTTP mode does not claim profile-isolated storage access for them.

## Local, remote, and SSH differences

- **Local mode** reads/writes local files under `HERMES_HOME` and `profileHome(profile)`. Local gateway/API state is owned by `ProfileRuntimeManager`, keyed by profile, and uses profile-specific port/PID/log/config/auth evidence. CLI fallback uses `hermes -p <profile>` for named profiles, which is treated as verified command identity.
- **Pure remote HTTP mode** is renderer-gated for filesystem-backed screens and fail-closed for profile runtime execution unless an identity can be declared or verified. Generic remote `/health` success is not enough to satisfy a selected Mercury profile, so chat/title/cron/gateway paths do not silently reuse a profile-less remote API.
- **SSH mode** uses SSH helpers for many env/config/session/profile/memory/soul/skill/runtime reads and writes. Remote paths are under `~/.hermes` and `~/.hermes/profiles/<profile>`. Gateway status/start/stop/restart/API-key/log/MCP paths accept profile and use `hermes -p <profile>` or profile-specific remote paths. SSH tunnel state is keyed by profile plus host/user/port/remote-port/local-port so a tunnel for one profile cannot satisfy another accidentally.

## Verification guidance

For storage/profile changes, run targeted tests based on the touched area:

```bash
npm run test -- tests/profiles.test.ts tests/chat-metadata.test.ts
npm run test -- tests/session-cache-sync.test.ts tests/sessions-profile-db.test.ts
npm run test -- tests/hermes-runtime.test.ts tests/cron-runtime.test.ts tests/ssh-remote.test.ts
npm run test -- tests/chat-ipc-lifecycle.test.ts tests/hermes-title.test.ts
npm run test -- tests/skills-import.test.ts
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/reliable-profile-runtime-contract.test.ts
npm run typecheck
```

For trace storage changes, also run:

```bash
npm run test -- tests/trace-store.test.ts
```

For docs-only edits, manually verify links and source file references.

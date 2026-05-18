# CLI Contract

Mercury's CLI exposes automation-friendly access to the same main-process service layer used by the Electron IPC/preload contract. It is intended for agents, scripts, CI jobs, and power users that need Mercury data, profile mutation, chat automation, install/update operations, and diagnostics without launching the Electron renderer.

This document is both a user reference and a developer contract. It describes the implemented CLI surface only. When a renderer/preload capability has no CLI command yet, this reference calls that out as reserved or deferred instead of implying support.

## Scope and source anchors

Authoritative sources:

- Package entrypoint and validation scripts: `package.json`
- CLI build config: `tsconfig.cli.json`
- CLI entrypoint and domain reservation: `src/cli/index.ts`
- Global parser: `src/cli/parser.ts`
- Runtime context/env defaults: `src/cli/context.ts`
- JSON/NDJSON/text envelopes: `src/cli/output.ts`
- Normalized errors and exit codes: `src/cli/errors.ts`
- Chat automation commands: `src/cli/chat-commands.ts`
- Read-only command dispatcher: `src/cli/read-only-commands.ts`
- Mutating command dispatcher: `src/cli/mutating-commands.ts`
- Shared non-Electron service layer: `src/main/services/*`
- Renderer parity source: `src/preload/index.d.ts` and [IPC/preload contract](ipc-preload.md)
- Trace event schema: [Trace schema contract](trace-schema.md)
- Connection-mode behavior: [Connection modes](../subsystems/connection-modes.md)
- Storage/profile behavior: [Storage and profiles](../subsystems/storage-and-profiles.md)
- CLI tests: `tests/cli-*.test.ts`, especially `tests/cli-parity.test.ts`

The CLI must stay aligned with these files. If a command changes behavior, update this document and run the validation commands at the end of this file.

## Adapter architecture

Mercury now has parallel adapters over shared main-process services:

```text
Renderer UI
  -> window.hermesAPI in src/preload/index.d.ts
  -> IPC modules in src/main/ipc/*
  -> shared services in src/main/services/*
  -> local / SSH / install / runtime / trace implementations

Node CLI
  -> package.json bin.mercury -> out/cli/index.js
  -> src/cli/index.ts
  -> parser/context/output/errors helpers
  -> chat/read-only/mutating dispatchers
  -> shared services in src/main/services/*
  -> local / SSH / install / runtime / trace implementations
```

Important architectural rules:

- The CLI is a Node entrypoint. It does **not** import the preload bridge and does **not** launch Electron.
- IPC and CLI should share service functions rather than copying domain logic into adapters.
- The CLI adapter owns command parsing, output formatting, process exit codes, streaming event shapes, and `SIGINT` handling.
- Service modules own domain behavior, profile normalization, local/SSH branching, runtime verification, stale-runtime markers, gateway restart side effects, and file persistence.
- Renderer-only surfaces such as update menu events, local slash-command trace recording, and Claw3D process controls are not automatically CLI features.

## Build and invocation

The packaged binary name is `mercury`:

```bash
mercury [global flags] <domain> [command] [args]
```

Source builds:

```bash
npm run build:cli
npm run build
```

`npm run build:cli` compiles `src/cli/**/*` with `tsconfig.cli.json` to `out/cli/index.js` and marks that file executable. `npm run build` runs typechecks, builds the CLI, and then builds the Electron app.

Development/testing notes:

- `package.json` exposes `bin.mercury` as `./out/cli/index.js`.
- The shebang in `src/cli/index.ts` makes the compiled output runnable as a Node CLI.
- Tests exercise `runCli(...)` directly with mocked stdout/stderr and temporary `HERMES_HOME` directories.
- Shared services honor `HERMES_HOME`; this is the safest way to isolate CLI tests or scripted runs from a real Mercury installation.

Example local source invocation after building:

```bash
npm run build:cli
HERMES_HOME=/tmp/mercury-sandbox ./out/cli/index.js --json sessions list
```

## Command grammar

General form:

```bash
mercury [global flags] <domain> [action] [subaction] [args] [command options]
```

Examples:

```bash
mercury --json sessions list --limit 20
mercury sessions list --json --limit 20
mercury --profile work memory read
mercury chat send --profile work --message "Summarize recent work" --ndjson
mercury -- connection set --mode local
```

Parser behavior:

- Global flags are recognized anywhere in the argv before a literal `--` terminator, including after the command path.
- Recommended style is to place global flags before the domain for readability.
- Command-specific parsers also accept `--profile` / `-p` for commands that are profile-aware.
- `--` stops global parsing; tokens after it are passed through as command path/positionals.
- Unknown flags before a domain are invalid usage.
- Unknown flags after a domain are usually command options. Unsupported command options may be ignored by simple command parsers unless the command requires a specific value.
- `--help` / `-h` prints help and exits successfully even if other command tokens are present.
- `--version` / `-v` prints the package version and exits successfully.

## Global flags

| Flag | Accepted forms | Contract |
| --- | --- | --- |
| Profile | `-p <name>`, `--profile <name>`, `--profile=<name>` | Selects a Mercury profile/agent. Also accepted command-locally by most profile-aware commands. |
| JSON output | `--json` | Emits one JSON success envelope on stdout or one JSON error envelope on stderr. Chat suppresses incremental chunks and returns the final result only. |
| NDJSON output | `--ndjson` | Emits newline-delimited events. Chat streams start/chunk/trace/tool/usage/error/done events; install/update/migration progress emits progress events. |
| Text output | `--text` | Emits human-readable text. This is the default. Chat streams chunks directly to stdout. |
| Table output | `--table` | Accepted output mode. Currently rendered by the same generic success path as text unless a command implements table-specific rendering. Treat as reserved for future table formatting. |
| Quiet | `--quiet` | Suppresses nonessential text output and progress detail. It does not suppress JSON/NDJSON envelopes. |
| Verbose | `--verbose` | Enables verbose diagnostics where supported. Chat text mode writes tool-progress labels to stderr only when verbose and not quiet. |
| Color | `--color <auto|always|never>`, `--color=<auto|always|never>` | Parsed and stored in context. Current output renderers do not emit ANSI formatting, so this is a reserved presentation hint. Invalid values are usage errors. |
| Stream hint | `--stream` | Parsed and stored in context. Current chat streaming is selected by `--ndjson` or text output; this flag is reserved as a capability hint. |
| Raw hint | `--raw` | Parsed and stored in context. Current commands return standard envelopes/rendering; this flag is reserved for command-specific raw payloads. |
| Help | `-h`, `--help` | Prints help. |
| Version | `-v`, `--version` | Prints package version. |

## Environment defaults and precedence

The CLI context is built in `src/cli/context.ts`.

Profile precedence:

```text
command/global --profile or -p -> MERCURY_PROFILE -> service default profile
```

Output precedence:

```text
explicit --json/--ndjson/--text/--table -> MERCURY_OUTPUT -> text
```

Accepted `MERCURY_OUTPUT` values are `json`, `ndjson`, `text`, and `table`. Invalid or empty `MERCURY_OUTPUT` values are ignored.

Storage/runtime environment:

- `HERMES_HOME` controls the Mercury/Hermes storage root used by existing main services.
- `MERCURY_SESSIONS_DIAG=1` enables best-effort session-service diagnostics for selected session/cache/search operations.
- Service-level environment such as `HERMES_PYTHON`, `HERMES_SCRIPT`, provider API keys, and runtime tokens are handled by the underlying main-process modules, not by the CLI parser.

## Output contract

### Streams

- stdout is for successful payloads, text chat chunks, and NDJSON events.
- stderr is for normalized errors in JSON/text modes and text progress/verbose diagnostics.
- In `--ndjson` mode, command-level error envelopes are written to stderr as an `error` event. Chat callback errors and `SIGINT` abort events may also appear on stdout as stream events before the final process error.

### JSON success envelope

`--json` success uses `CliSuccess<T>` from `src/cli/output.ts`:

```ts
interface CliSuccess<T> {
  ok: true;
  command: string;
  profile?: string;
  mode?: "local" | "remote" | "ssh";
  data: T;
  warnings?: Array<{ code: string; message: string }>;
}
```

Example:

```json
{"ok":true,"command":"sessions list","profile":"default","mode":"local","data":[]}
```

Notes:

- `command` is the parsed command path joined by spaces. For chat positional messages this can include the positional text in JSON envelopes, e.g. `chat send positional message`.
- `profile` appears when selected by CLI flag or `MERCURY_PROFILE`; services may still normalize an omitted profile to default internally.
- `mode` is best-effort metadata attached after `getConnection()` succeeds. Failure to read connection mode never blocks command execution.
- `warnings` is available in the envelope type but most service warnings currently appear inside `data` because they come from domain result objects.

### JSON error envelope

`--json` errors use `CliErrorEnvelope`:

```ts
interface CliErrorEnvelope {
  ok: false;
  command: string;
  profile?: string;
  mode?: "local" | "remote" | "ssh";
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

Example:

```json
{"ok":false,"command":"chat send","error":{"code":"runtime-error","message":"Gateway failed"}}
```

### Text output

Text mode is the default.

- If `data` is a string, it is printed as-is plus a trailing newline.
- If `data` is structured, it is pretty-printed as JSON plus a trailing newline.
- If `data` is `undefined`, nothing is printed.
- `--quiet` suppresses generic successful text output.
- `mercury chat send` streams chunks directly to stdout and suppresses the final generic success print when chunks were already streamed, preventing duplicate final responses.
- Chat text mode writes tool-progress lines to stderr only with `--verbose` and without `--quiet`.
- Install/update/migration progress writes progress `detail` strings to stderr in text mode unless quiet.

### NDJSON output

NDJSON mode emits one JSON object per line. Every line ends with `\n` and is independently parseable.

Generic non-streaming success:

```json
{"type":"done","data":{},"ts":1770000000000}
```

Generic command error:

```json
{"type":"error","error":{"code":"invalid-usage","message":"Missing value for --profile"},"ts":1770000000000}
```

Shared stream event union:

```ts
type CliStreamEvent =
  | { type: "start"; command: string; profile?: string; ts: number }
  | { type: "chunk"; text: string; ts: number }
  | { type: "trace"; event: unknown; ts: number }
  | { type: "tool"; text: string; ts: number }
  | { type: "usage"; usage: unknown; ts: number }
  | { type: "progress"; progress: unknown; ts: number }
  | { type: "done"; data: unknown; ts: number }
  | { type: "error"; error: { code: string; message: string; details?: unknown }; ts: number };
```

Chat automation currently emits the quoted event strings required by the contract tests: `"start"`, `"chunk"`, `"trace"`, `"tool"`, `"usage"`, `"done"`, and `"error"`.

Install/update/migration commands additionally emit `"progress"` before the final `"done"` event when the underlying installer reports progress.

## Exit codes and error normalization

Exit codes are defined in `src/cli/errors.ts` and returned by `runCli(...)`.

| Code | Name | Meaning | Typical error codes |
| --- | --- | --- | --- |
| `0` | success | Command completed successfully. | n/a |
| `1` | generic | Unclassified runtime failure. | `runtime-error` or unknown service errors |
| `2` | usage | Invalid command-line usage or missing required argument. | `invalid-usage` |
| `3` | unsupported | Command/domain is reserved but unsupported, or profile execution is unsupported in current mode. | `unsupported-command`, `runtime-unsupported-remote-profile` |
| `4` | runtime verification | Runtime identity/profile verification failed. | `runtime-profile-mismatch`, `runtime-profile-unverified`, `runtime-stale-after-profile-switch`, `runtime-port-conflict`, `runtime-auth-conflict`, `runtime-token-conflict`, `runtime-unavailable` |
| `5` | install | Install or install verification failure. | `not-installed`, `install-verification-failed` |
| `6` | connection | Connection, SSH, tunnel, or runtime connection failure. | `connection-failed`, `ssh-connection-failed`, `ssh-tunnel-failed`, `runtime-connection-failed` |
| `7` | not found | Requested object does not exist. | `not-found` |
| `8` | validation | Domain validation failed after parsing succeeded. | `validation-failed` |
| `130` | interrupted | Active command was aborted by user/process interruption. | `interrupted`, `aborted` |

Examples:

- `mercury --json claw3d status` returns exit `3` with `unsupported-command` because `claw3d` is reserved but deferred.
- Pure remote profile-bound chat/title fails closed with `runtime-unsupported-remote-profile`, mapped to exit `3`.
- Runtime identity mismatch maps to exit `4`.
- `SIGINT` during an active chat maps to exit `130`.

## Command reference

Each domain below lists implemented commands, important options, output shape, service anchors, and mode notes. If a command is not listed as implemented, treat it as unsupported even if the domain is reserved by `src/cli/index.ts`.

### `chat`

Source anchors: `src/cli/chat-commands.ts`, `src/main/services/chat-service.ts`, `src/main/hermes/gateway.ts`, `src/main/hermes/runtime.ts`, `src/main/trace-store.ts`, `src/main/session-cache.ts`.

#### `mercury chat send`

Usage:

```bash
mercury chat send [message words...]
mercury chat send --message <text>
mercury chat send -m <text>
mercury chat send --stdin
mercury chat send --resume <sessionId> [--history-file history.json] <message>
```

Profile options:

```bash
mercury --profile work chat send "Summarize recent work"
mercury chat send --profile work --message "Summarize recent work"
```

Input precedence:

1. `--message` / `-m`
2. positional text after `chat send`
3. stdin when piped or when `--stdin` is passed

Other options:

- `--resume <sessionId>` resumes/continues an existing Hermes session when the transport supports it.
- `--history-file <path>` loads previous messages and passes them to `runChatMessage(...)`.
- `--profile` / `-p` overrides the global/environment profile for this command.

History file formats:

```json
[{"role":"user","content":"Earlier context"}]
```

or:

```json
{"messages":[{"role":"user","content":"Earlier context"}]}
```

Each history entry must be an object with string `role` and string `content`. `chat send` does not restrict role names at CLI parse time; the chat service/transport receives the provided role strings.

Output:

- Text: assistant chunks stream to stdout; a trailing newline is appended if chunks were printed.
- JSON: one final envelope containing `{ response: string, sessionId?: string }`.
- NDJSON: `start`, zero or more `chunk`/`trace`/`tool`/`usage`/`error` events, then a final `done` event containing the chat result.

Side effects:

- Creates a trace run with the user message preview when trace-store writes succeed.
- Records resume/history/tool/transport/artifact/usage/terminal trace events as callbacks arrive.
- Updates the desktop session cache with the selected profile when a session id is returned.
- Aborts any previous active in-process CLI chat run before starting the new one.
- In local/SSH modes, may start/restart gateway/tunnel state as needed through `prepareChatBackend(...)`.

Examples:

```bash
mercury chat send "What can you do?"
mercury --json chat send --message "Return only the final answer"
mercury --ndjson --profile work chat send --resume session-123 --history-file history.json --message "Continue"
printf 'Draft a launch checklist' | mercury chat send --stdin
mercury chat send "Use a literal -- token" -- --not-a-flag
```

#### `mercury chat title`

Usage:

```bash
mercury chat title [message words...]
mercury chat title --message <text>
mercury chat title --messages-file messages.json
mercury chat title --history-file history.json
mercury chat title --session <sessionId> --messages-file messages.json
mercury chat title --resume <sessionId> --message <text>
```

Options:

- `--session <sessionId>` persists the generated title for the session/profile.
- `--resume <sessionId>` is accepted as an alias for the session id in title generation.
- `--messages-file <path>` loads title source messages.
- `--history-file <path>` is accepted as a convenience alias for `--messages-file`.
- `--message` / `-m`, positionals, or stdin can provide a single user message when no messages file is supplied.
- `--profile` / `-p` overrides the selected profile.

Messages file formats:

```json
[{"role":"user","content":"Explain Mercury CLI"}]
```

or:

```json
{"messages":[{"role":"assistant","content":"Earlier answer"}]}
```

Title messages require role `user`, `agent`, or `assistant`.

Output:

- JSON/text/NDJSON final data is `{ title: string, sessionId?: string }`.
- When `--session` or `--resume` is provided, `generateChatTitleForRequest(...)` persists the title through `updateSessionTitle(...)`.

Examples:

```bash
mercury --json chat title --session session-123 --messages-file messages.json
mercury chat title "Explain the CLI contract"
printf '[{"role":"user","content":"Summarize sessions"}]' | mercury --json chat title --stdin
```

#### Chat `SIGINT`

While `mercury chat send` is active, `SIGINT` / Ctrl-C triggers the CLI abort path:

1. The CLI records that the command was interrupted.
2. In NDJSON mode, stdout receives an `error` event with code `aborted` and message `Chat interrupted by SIGINT`.
3. In text mode, stderr receives `Interrupted; aborting active chat...` unless quiet.
4. The CLI calls `abortActiveChatRun("CLI interrupted the active Hermes run.")`.
5. The process returns exit code `130` and writes the normalized `interrupted` error through the active output mode.

### `sessions`

Source anchors: `src/cli/read-only-commands.ts`, `src/cli/mutating-commands.ts`, `src/main/services/sessions-service.ts`, `src/main/sessions.ts`, `src/main/session-cache.ts`, `src/main/ssh/sessions-profiles.ts`.

Implemented read commands:

```bash
mercury sessions list [--limit <n>] [--offset <n>] [--profile <name>]
mercury sessions messages <sessionId> [--profile <name>]
mercury sessions search <query words...> [--limit <n>] [--profile <name>]
mercury sessions cache list [--limit <n>] [--offset <n>] [--profile <name>]
```

Implemented mutation commands:

```bash
mercury sessions cache sync [--profile <name>]
mercury sessions title set <sessionId> <title words...> [--profile <name>]
```

Options:

- `--limit <n>` and `--offset <n>` must be non-negative integers where accepted.
- `--profile` / `-p` selects profile-scoped sessions/cache.
- `sessions search` joins all positional query words into one query string.
- `sessions title set` joins all words after `<sessionId>` into the title.

Output shapes mirror the underlying services:

- `sessions list`: array of Hermes session summaries.
- `sessions messages`: array of `{ id, role, content, timestamp }` messages.
- `sessions search`: array of search results with snippets and profile information when known.
- `sessions cache list` / `sessions cache sync`: desktop cache session summaries.
- `sessions title set`: `{ success: true, sessionId, title }` or `not-found` when the cache has no matching session.

Mode notes:

- Local mode reads local profile DBs and desktop cache under `HERMES_HOME`.
- SSH mode routes list/messages/search/profile/cache reads through SSH helpers when SSH config exists.
- `sessions cache sync` in SSH mode currently returns remote cached sessions; local mode syncs the desktop cache.
- Pure remote HTTP has no verified remote session-storage path in the CLI service layer; commands that do not explicitly reject remote may still operate on local files. Do not treat this as remote filesystem support.

Examples:

```bash
mercury --json sessions list --limit 50
mercury sessions messages session-123 --json
mercury sessions search "payment retry" --limit 10 --json
mercury --profile work sessions cache sync --json
mercury sessions title set session-123 "Customer onboarding debug"
```

### `profiles`

Source anchors: `src/main/services/sessions-service.ts`, `src/main/profiles.ts`, `src/main/ssh/sessions-profiles.ts`.

Implemented commands:

```bash
mercury profiles list
mercury profiles create <name> [--clone]
mercury profiles delete <name> --yes
mercury profiles use <name>
```

Output:

- `profiles list`: `{ profiles: [...] }` where each entry includes profile metadata from the service.
- `profiles create`: `{ success: true, name, clone }` after service success.
- `profiles delete`: `{ success: true, name }`; `--yes` is required.
- `profiles use`: `{ success: true, name }` after setting the active local profile.

Mode notes:

- Local mode uses local profile directories and `active_profile` storage.
- SSH mode routes list/create/delete through remote SSH helpers when configured.
- `profiles use` only writes active profile locally when not in SSH mode, but returns success in SSH mode for UI/CLI parity with the current service contract.

Examples:

```bash
mercury --json profiles list
mercury profiles create work --clone
mercury profiles use work
mercury profiles delete old-profile --yes
```

### `agents`

`agents` is an alias domain for `profiles`, kept for UI terminology parity.

Implemented commands:

```bash
mercury agents list
mercury agents create <name> [--clone]
mercury agents delete <name> --yes
mercury agents use <name>
```

Output is identical to `profiles` except list uses the key `{ agents: [...] }`.

Examples:

```bash
mercury --json agents list
mercury agents create research --clone
mercury agents use research
```

### `memory`

Source anchors: `src/main/services/knowledge-service.ts`, `src/main/memory.ts`, `src/main/ssh/memory-soul.ts`.

Implemented commands:

```bash
mercury memory read [--profile <name>]
mercury memory add <content words...> [--profile <name>]
mercury memory add --file <path> [--profile <name>]
mercury memory add --stdin [--profile <name>]
mercury memory update <index> <content words...> [--profile <name>]
mercury memory update <index> --file <path> [--profile <name>]
mercury memory remove <index> [--profile <name>]
```

Content options:

- `--file <path>` reads file content as the memory body.
- `--stdin` reads stdin as the memory body.
- Otherwise all remaining positionals are joined with spaces.

Output:

- `memory read`: `{ memory, user, stats }` with content/existence/mtime information.
- `memory add` / `memory update`: service result such as `{ success: true }` or validation failure.
- `memory remove`: `{ success: true, index }` or `not-found`.

Side effects:

- Successful add/update/remove marks the selected profile runtime stale.
- SSH mode routes through remote memory helpers.

Examples:

```bash
mercury --json memory read
mercury --profile work memory add "Prefers concise answers"
mercury memory update 0 --file revised-memory.md
mercury memory remove 2 --json
```

### `user-profile`

Source anchors: `src/main/services/knowledge-service.ts`, `src/main/memory.ts`.

Implemented command:

```bash
mercury user-profile write <content words...> [--profile <name>]
mercury user-profile write --file <path> [--profile <name>]
mercury user-profile write --stdin [--profile <name>]
```

Output: service result such as `{ success: true }`.

Side effects: successful writes mark the profile runtime stale. Local writes update the profile-scoped `USER.md` memory file; SSH routes through remote helpers.

Example:

```bash
mercury --profile work user-profile write --file USER.md --json
```

### `soul`

Source anchors: `src/main/services/knowledge-service.ts`, `src/main/soul.ts`, `src/main/ssh/memory-soul.ts`.

Implemented commands:

```bash
mercury soul read [--profile <name>]
mercury soul write <content words...> [--profile <name>]
mercury soul write --file <path> [--profile <name>]
mercury soul write --stdin [--profile <name>]
mercury soul reset [--profile <name>]
```

Output:

- `soul read`: SOUL text.
- `soul write`: `{ success: true }`.
- `soul reset`: `{ success: true, content }`.

Side effects: successful write/reset marks the selected profile runtime stale.

Examples:

```bash
mercury soul read
mercury --json soul write --file SOUL.md
mercury --profile research soul reset --json
```

### `tools`

Source anchors: `src/main/services/knowledge-service.ts`, `src/main/tools.ts`, `src/main/ssh/config.ts`.

Implemented commands:

```bash
mercury tools list [--profile <name>]
mercury tools set <toolsetKey> <true|false|1|0|yes|no|on|off> [--profile <name>]
```

Output:

- `tools list`: array of `{ key, label, description, enabled }` toolsets.
- `tools set`: `{ success: true, key, enabled }`.

Side effects: successful `tools set` marks the selected profile runtime stale. SSH routes through remote toolset config helpers.

Example:

```bash
mercury --json tools list
mercury tools set web false --profile work
```

### `skills`

Source anchors: `src/main/services/knowledge-service.ts`, `src/main/skills.ts`, `src/main/skills/importer.ts`, `src/main/ssh/skills.ts`, `src/shared/skills.ts`.

Implemented read commands:

```bash
mercury skills installed [--profile <name>]
mercury skills bundled
mercury skills content <skillPath>
mercury skills metadata <skillPath>
```

Implemented mutation commands:

```bash
mercury skills install <identifier> [--profile <name>]
mercury skills uninstall <name> [--profile <name>]
mercury skills import --file <markdownPath> [--name <name>] [--category <category>] [--description <text>] [--overwrite] [--profile <name>]
```

Output:

- `skills installed`: installed skill summaries for the selected profile.
- `skills bundled`: bundled/catalog skills for the current connection.
- `skills content`: raw skill markdown/content string.
- `skills metadata`: `SkillMetadata` with scripts/references and availability flags.
- `skills install` / `skills uninstall`: service result with success/error fields.
- `skills import`: `SkillMarkdownImportResult`; successful local/SSH imports may include `warning: "gateway-restart-required"` inside the data result when a gateway is running.

Mode notes:

- Local and SSH modes support installed/bundled/content/metadata/install/uninstall/import through the shared service.
- Pure remote `skills metadata` returns unavailable metadata with `unavailableReason` because remote HTTP cannot inspect arbitrary skill files.
- Pure remote Markdown import returns a failed service result because import writes to the selected profile filesystem; the CLI converts unsuccessful service results into validation failures.

Examples:

```bash
mercury --json skills installed --profile work
mercury skills content ~/.hermes/skills/custom/demo/SKILL.md
mercury skills metadata ~/.hermes/skills/custom/demo
mercury skills install github:org/repo/path --profile work
mercury --json skills import --file ./my-skill.md --name my_skill --category custom --overwrite
```

### `models`

Source anchors: `src/main/services/models-service.ts`, `src/main/models.ts`, `src/main/ssh/runtime.ts` for SSH listing.

Implemented commands:

```bash
mercury models list
mercury models add --name <displayName> --provider <provider> --model <model> [--base-url <url>]
mercury models update <modelId> [--name <displayName>] [--provider <provider>] [--model <model>] [--base-url <url>] [--context-window <positiveInteger>]
mercury models remove <modelId>
```

Output:

- `models list`: array of configured model entries.
- `models add`: created model entry with generated `id`.
- `models update`: `{ success: true, id, fields }`.
- `models remove`: `{ success: true, id }`.

Mode notes:

- Listing goes through `models-service.ts`, which can branch by connection mode.
- Mutations currently import `src/main/models` directly and write local model storage, matching current IPC behavior for model CRUD.
- `--context-window` is accepted only by `models update` and must be a positive integer.

Examples:

```bash
mercury --json models list
mercury models add --name "GPT Test" --provider openai --model gpt-test --base-url https://api.example.test
mercury models update model-123 --name "Renamed" --context-window 128000
mercury models remove model-123
```

### `credentials`

Source anchors: `src/main/services/models-service.ts`, `src/main/config.ts`.

Implemented commands:

```bash
mercury credentials get
mercury credentials set <provider> --entries-file <entries.json>
```

`--entries-file` must contain a JSON array of credential entries. The CLI does not validate entry object shape beyond requiring an array; `setCredentialPool(...)` persists the entries.

Output:

- `credentials get`: provider-to-entries credential pool object.
- `credentials set`: `{ success: true, provider, count }`.

Mode notes: credentials currently use local credential pool storage, matching IPC behavior.

Example:

```bash
printf '[{"key":"secret","label":"Primary"}]' > entries.json
mercury credentials set openai --entries-file entries.json --json
```

### `cron`

Source anchors: `src/main/services/cron-service.ts`, `src/main/cronjobs.ts`.

Implemented commands:

```bash
mercury cron list [--active-only] [--profile <name>]
mercury cron create --schedule <cronExpression> [--prompt <text> | --prompt-file <path> | <prompt words...>] [--name <name>] [--deliver <target>] [--profile <name>]
mercury cron remove <jobId> [--profile <name>]
mercury cron pause <jobId> [--profile <name>]
mercury cron resume <jobId> [--profile <name>]
mercury cron run <jobId> [--profile <name>]
```

Options:

- `cron list` includes disabled jobs by default. `--active-only` sets `includeDisabled` to false.
- `cron create` requires `--schedule`.
- Prompt precedence for `cron create`: `--prompt-file`, then `--prompt`, then positional prompt words, then omitted prompt.
- `--deliver` is passed as the delivery target string to the cron service.

Output: service job arrays or `{ success, ... }` domain results.

Mode notes:

- Cron commands are profile-aware.
- Pure remote profile-bound cron execution is not a verified remote execution path; do not rely on pure remote HTTP for profile-bound cron runs.

Examples:

```bash
mercury --json cron list --active-only
mercury cron create --schedule "0 9 * * *" --name daily --prompt "Summarize yesterday" --deliver slack
mercury cron pause job-123 --profile work
mercury cron run job-123 --json
```

### `traces`

Source anchors: `src/main/trace-store.ts`, `src/shared/traces.ts`, [Trace schema contract](trace-schema.md).

Implemented commands:

```bash
mercury traces list
mercury traces get <runId>
mercury traces skill-runs
```

Output:

- `traces list`: array of persisted `TraceRun` entries from the local trace store.
- `traces get`: one `TraceRun`; missing run ids return `not-found` exit `7`.
- `traces skill-runs`: derived `SkillTrainingRun` entries.

Mode notes:

- Current trace commands read the local `desktop-traces.json` store.
- Renderer `recordLocalChatTrace(...)` / local slash-command trace creation is not exposed as a CLI command yet.

Examples:

```bash
mercury --json traces list
mercury traces get run-123 --json
mercury traces skill-runs --json
```

### `runtime`

Source anchors: `src/main/services/system-service.ts`, `src/main/hermes/runtime.ts`, `src/shared/runtime.ts`.

Implemented commands:

```bash
mercury runtime diagnostic [--profile <name>]
mercury runtime revalidate [--profile <name>]
```

Output:

- `runtime diagnostic`: `RuntimeDiagnostic` for the selected/requested profile.
- `runtime revalidate`: result from `revalidateRuntime(profile)`.

Mode notes:

- Diagnostics expose profile identity, stale state, transport, and unsupported remote profile failures from the runtime manager.
- Revalidation is profile-aware and used after gateway/tunnel/config changes.

Examples:

```bash
mercury --json runtime diagnostic --profile work
mercury runtime revalidate --profile work --json
```

### `gateway`

Source anchors: `src/main/services/gateway-service.ts`, `src/main/hermes.ts`, `src/main/ssh-remote.ts`, `src/main/ssh-tunnel.ts`.

Implemented commands:

```bash
mercury gateway status [--profile <name>]
mercury gateway start [--profile <name>]
mercury gateway stop [--profile <name>]
mercury gateway restart [--profile <name>]
mercury gateway platform list [--profile <name>]
mercury gateway platform set <platform> <true|false|1|0|yes|no|on|off> [--profile <name>]
```

Output:

- `gateway status`: `{ running: boolean }`.
- `gateway start` / `stop` / `restart`: `{ success: true, action, profile? }` on supported modes.
- `gateway platform list`: platform enabled map.
- `gateway platform set`: `{ success: true, platform, enabled }`.

Mode notes:

- Local mode starts/stops/restarts local gateway processes.
- SSH mode starts/stops/restarts the remote gateway through SSH helpers and may refresh tunnel/API-key/runtime state for platform mutations.
- Pure remote mode returns unsupported for start/stop/restart/platform mutation; status is `false` and platform list is `{}`.

Examples:

```bash
mercury gateway status --json
mercury gateway restart --profile work
mercury gateway platform list --json
mercury gateway platform set telegram true --profile work --json
```

### `install`

Source anchors: `src/main/services/install-service.ts`, `src/main/install/*`.

Implemented commands:

```bash
mercury install status
mercury install verify
mercury install start
```

Output:

- `install status`: install status object from `checkInstallStatus()`.
- `install verify`: `{ verified: boolean }`.
- `install start`: `{ success: boolean, error?: string }`, with progress events/details while running.

Progress behavior:

- Text mode writes progress detail lines to stderr unless quiet.
- NDJSON mode writes `progress` events followed by `done`.
- JSON mode returns only the final envelope; progress details are not streamed.

Examples:

```bash
mercury --json install status
mercury install verify
mercury --ndjson install start
```

### `hermes`

Source anchors: `src/main/services/install-service.ts`, `src/main/install/paths.ts`, `src/main/install/executor.ts`, `src/main/ssh/runtime.ts`.

Implemented commands:

```bash
mercury hermes version [--refresh]
mercury hermes doctor
mercury hermes update [--profile <name>]
```

Output:

- `hermes version`: `{ version: string | null }`; `--refresh` clears/refreshes cached local version or asks SSH for remote version.
- `hermes doctor`: doctor output string.
- `hermes update`: `{ success: boolean, error?: string }`, with progress events/details while running.

Mode notes:

- Local update runs the local Hermes update executor.
- SSH update runs the remote update, starts remote gateway, starts tunnel, refreshes remote API key, and revalidates runtime for the selected profile.

Examples:

```bash
mercury hermes version --json
mercury hermes version --refresh --json
mercury hermes doctor
mercury --ndjson hermes update --profile work
```

### `config`

Source anchors: `src/main/services/config-service.ts`, `src/main/config.ts`, `src/main/ssh/config.ts`.

Implemented command:

```bash
mercury config set <key> <value> [--profile <name>]
```

Output: `{ success: boolean, key }`.

Side effects:

- Local and SSH set operations mark the selected profile runtime stale.
- SSH writes through remote config helpers.

Deferred parity:

- Renderer `getConfig(key, profile?)` exists, and `config-service.ts` has `getConfig(...)`, but the CLI dispatcher currently does **not** implement `mercury config get`. The `config` domain is reserved for that future parity.

Example:

```bash
mercury config set theme dark --profile work --json
```

### `env`

Source anchors: `src/main/services/config-service.ts`, `src/main/config.ts`, `src/main/ssh/config.ts`.

Implemented command:

```bash
mercury env set <key> <value> [--profile <name>]
```

Output: `{ success: boolean, key }`.

Side effects:

- Writes profile env locally or through SSH.
- Marks the selected profile runtime stale.
- Local mode restarts a running gateway when the changed key ends in `_API_KEY`, ends in `_TOKEN`, or is `HF_TOKEN`.
- SSH mode may restart the remote gateway and revalidate runtime when needed.

Deferred parity:

- Renderer `getEnv(profile?)` exists, but the CLI dispatcher currently does **not** implement `mercury env get`.

Example:

```bash
mercury env set OPENAI_API_KEY test-key --profile work --json
```

### `model-config`

Source anchors: `src/main/services/config-service.ts`, `src/main/config.ts`, `src/main/ssh/config.ts`.

Implemented command:

```bash
mercury model-config set --provider <provider> --model <model> [--base-url <url>] [--profile <name>]
```

Output: `{ success: boolean, provider, model, baseUrl }`.

Side effects:

- Writes selected profile model config locally or through SSH.
- Marks runtime stale when provider/model/base URL changed.
- Restarts/revalidates running local or SSH gateways when required.

Deferred parity:

- Renderer `getModelConfig(profile?)` exists, but the CLI dispatcher currently does **not** implement `mercury model-config get`.

Example:

```bash
mercury model-config set --provider openai --model gpt-4.1 --base-url https://api.example.test --profile work --json
```

### `connection`

Source anchors: `src/main/services/config-service.ts`, `src/main/config.ts`, `src/main/hermes/connection.ts`, `src/main/ssh-tunnel.ts`.

Implemented commands:

```bash
mercury connection get
mercury connection set --mode <local|remote|ssh> [--url <remoteUrl>] [--api-key <key>]
mercury connection ssh set --host <host> [--port <port>] --username <username> --key-path <path> [--remote-port <port>] [--local-port <port>]
```

Validation/defaults:

- `connection set --mode remote` requires `--url`.
- `connection set --mode local` and `--mode ssh` allow omitted `--url`.
- `connection ssh set` requires `--host`, `--username`, and `--key-path`.
- `connection ssh set` defaults `--port` to `22`, `--remote-port` to `8765`, and `--local-port` to `19642` at the CLI layer.
- Integer options must parse as integers.

Output:

- `connection get`: persisted connection config.
- `connection set`: `{ success: true, mode, remoteUrl }`.
- `connection ssh set`: `{ success: true, host, port, username, keyPath, remotePort, localPort }`.

Side effects:

- `connection set` marks all runtimes stale.
- `connection ssh set` switches mode to SSH, persists SSH fields, and marks all runtimes stale.

Deferred parity:

- Renderer remote/SSH test helpers exist, but CLI `connection test` / `connection ssh test` commands are not implemented.

Examples:

```bash
mercury --json connection get
mercury connection set --mode local --json
mercury connection set --mode remote --url https://gateway.example --api-key secret --json
mercury connection ssh set --host devbox --username fred --key-path ~/.ssh/id_ed25519 --remote-port 8765 --local-port 19000 --json
```

### `ssh`

Source anchors: `src/main/services/config-service.ts`, `src/main/ssh-tunnel.ts`, `src/main/ssh-remote.ts`.

Implemented commands:

```bash
mercury ssh tunnel status [--profile <name>]
mercury ssh tunnel start [--profile <name>]
mercury ssh tunnel stop [--profile <name>]
```

Output:

- `ssh tunnel status`: `{ active: boolean }`.
- `ssh tunnel start`: `{ success: boolean }`.
- `ssh tunnel stop`: `{ success: boolean }`.

Mode notes:

- `ssh tunnel start` returns `false` when current connection mode is not SSH.
- In SSH mode, start checks/starts the remote gateway, starts the tunnel, reads the remote API key, caches it for the profile, and revalidates runtime.
- `ssh tunnel stop` stops the active tunnel process and clears tunnel state.

Examples:

```bash
mercury --json ssh tunnel status --profile work
mercury ssh tunnel start --profile work
mercury ssh tunnel stop
```

### `backup`

Source anchors: `src/main/services/system-service.ts`, `src/main/installer.ts`.

Implemented command:

```bash
mercury backup run [--profile <name>]
```

Output: backup result such as `{ success: true, path }` or validation failure.

Mode notes: current backup path is local service behavior; SSH/pure-remote parity is not implemented as a distinct remote backup command.

Example:

```bash
mercury backup run --profile work --json
```

### `import`

Source anchors: `src/main/services/system-service.ts`, `src/main/installer.ts`.

Implemented command:

```bash
mercury import run <archivePath> [--profile <name>]
```

Output: import result such as `{ success: true }` or validation failure.

Side effects: successful import marks the selected profile runtime stale.

Example:

```bash
mercury import run ./hermes-backup.zip --profile work --json
```

### `logs`

Source anchors: `src/main/services/system-service.ts`, `src/main/installer.ts`, `src/main/ssh/runtime.ts`.

Implemented command:

```bash
mercury logs read [--file <logFile>] [--lines <n>] [--profile <name>]
```

Options:

- `--file` selects a specific log file/path accepted by the service.
- `--lines` must be a non-negative integer.

Output: `{ content: string, path: string }`.

Mode notes: SSH mode reads remote logs through SSH helpers; local mode reads local logs.

Example:

```bash
mercury --json logs read --lines 100
```

### `mcp`

Source anchors: `src/main/services/system-service.ts`, `src/main/installer.ts`, `src/main/ssh/runtime.ts`.

Implemented command:

```bash
mercury mcp list [--profile <name>]
```

Output: array of `{ name, type, enabled, detail }` MCP server summaries.

Mode notes: SSH mode routes through remote MCP listing helpers; local mode reads local config.

Example:

```bash
mercury --json mcp list --profile work
```

### `memory-providers`

Source anchors: `src/main/services/system-service.ts`, `src/main/installer.ts`, `src/main/ssh/runtime.ts`.

Implemented command:

```bash
mercury memory-providers list [--profile <name>]
```

Output: array of memory provider summaries with installation/active/env-var metadata.

Mode notes: SSH mode routes through remote discovery helpers; local mode uses local discovery.

Example:

```bash
mercury --json memory-providers list
```

### `dump`

Source anchors: `src/main/services/system-service.ts`, `src/main/installer.ts`, `src/main/ssh/runtime.ts`.

Implemented command:

```bash
mercury dump
```

Output: dump text string from local or SSH service.

Mode notes: SSH mode routes through remote dump helper; local mode uses local installer dump behavior.

Example:

```bash
mercury dump --json
```

### `claw`

Source anchors: `src/cli/mutating-commands.ts`, `src/main/services/install-service.ts`, `src/main/install/executor.ts`.

Implemented command:

```bash
mercury claw migrate
```

Output: `{ success: boolean, error?: string }`, with progress events/details while running.

Progress behavior matches `install start` and `hermes update`:

- Text: progress details on stderr unless quiet.
- NDJSON: `progress` events followed by `done`.
- JSON: final envelope only.

Example:

```bash
mercury --ndjson claw migrate
```

### `claw3d`

`claw3d` is a reserved/deferred CLI domain. The renderer/preload contract exposes Claw3D setup/status/port/ws/log/dev/adapter controls, but the CLI currently has no implemented `claw3d` subcommands.

Current behavior:

```bash
mercury --json claw3d status
```

returns exit `3` with `unsupported-command`.

Use `mercury claw migrate` for the implemented OpenClaw migration command.

### `system`

`system` is a reserved aggregate domain used by the parity contract. Concrete system helpers are exposed as separate CLI domains:

- `backup run`
- `import run`
- `dump`
- `logs read`
- `mcp list`
- `memory-providers list`
- `runtime diagnostic`
- `runtime revalidate`

`mercury system ...` itself is currently unsupported unless a future command is added.

### Reserved domains without implemented subcommands

The entrypoint reserves `openclaw` for future naming compatibility, but no `openclaw` subcommands are implemented. The implemented migration command is `claw migrate`.

Renderer-only/deferred surfaces with no direct CLI command today include:

- App update events: `checkForUpdates`, `downloadUpdate`, `installUpdate`, update event listeners.
- App version/getLocale/setLocale shell helpers.
- Renderer menu events.
- Local performance telemetry recording.
- Renderer local slash-command trace creation (`recordLocalChatTrace`).
- Claw3D process/control commands.

## Connection-mode behavior

The CLI attaches `mode` metadata best-effort by calling `getConnection()` through `config-service.ts` before handled commands. Mode metadata failure never blocks the command.

### Local mode

Local mode is the default.

Current CLI behavior:

- Profile-scoped files are read/written under `HERMES_HOME` and `profileHome(profile)` according to shared storage services.
- `mercury chat send` and `mercury chat title` use `prepareChatBackend(...)`, which lazy-starts the selected profile gateway when needed, then resolves a verified local API runtime or CLI fallback.
- Gateway commands control local gateway processes.
- Env/model/platform mutations mark runtimes stale and may restart the gateway when the service says they should.
- Session, memory, SOUL, tools, skills, cron, logs, MCP, model, credential, backup/import/dump commands use local implementations unless their service has a more specific branch.

### SSH mode

SSH mode is selected by `connection ssh set` or persisted connection config.

Current CLI behavior:

- Many read/write services branch to SSH helpers when `conn.mode === "ssh" && conn.ssh`.
- `mercury chat send` and `mercury chat title` ensure the selected profile's tunnel and remote gateway are healthy, start them if needed, read/cache the remote API key, and resolve a verified `ssh-api` runtime.
- `mercury ssh tunnel status|start|stop` exposes tunnel controls used by chat and renderer startup paths.
- SSH gateway/platform/model/env mutations can restart remote gateway, refresh the tunnel/API key, and revalidate runtime when required.
- Named SSH profiles require profile-specific remote verification support from the remote runtime; runtime verification failures map to exit `4`.

### Pure remote HTTP mode

Pure remote HTTP mode is `mode === "remote"`.

Current CLI behavior:

- `connection get` and `connection set --mode remote` can view/set remote URL and API key.
- Profile-bound chat/title execution fails closed through runtime verification because Mercury cannot prove the configured remote HTTP API is executing the requested profile. The canonical failure code is `runtime-unsupported-remote-profile`, mapped to exit `3`.
- Gateway start/stop/restart and platform mutation are unsupported in pure remote mode; status returns `false` and platform list returns `{}`.
- Skill Markdown import explicitly rejects pure remote mode because it writes to a profile filesystem.
- Some filesystem-backed commands still call local services when no SSH branch exists. This is current adapter/service parity with IPC and should not be documented or used as remote filesystem support.

## Preload/IPC parity matrix

This matrix maps major `window.hermesAPI` domains to CLI coverage. Rows are intentionally kept in a table with domain literals so `tests/cli-parity.test.ts` can guard coverage.

| Domain | Preload/API examples | CLI coverage | Shared/service anchor | Notes and gaps |
| --- | --- | --- | --- | --- |
| `chat` | `sendMessage`, `generateChatTitle`, `abortChat`, chat event listeners | `chat send`, `chat title`; active run abort via `SIGINT` | `chat-service.ts` | Cross-process abort is deferred until a daemon exists. Renderer `recordLocalChatTrace` is not a CLI command. |
| `sessions` | `listSessions`, `getSessionMessages`, `searchSessions`, `listCachedSessions`, `syncSessionCache`, `updateSessionTitle` | `sessions list`, `sessions messages`, `sessions search`, `sessions cache list`, `sessions cache sync`, `sessions title set` | `sessions-service.ts` | Local/SSH branches; pure remote is not verified session storage. |
| `profiles` | `listProfiles`, `createProfile`, `deleteProfile`, `setActiveProfile` | `profiles list/create/delete/use` | `sessions-service.ts` | SSH list/create/delete supported; `use` is local active-profile state. |
| `agents` | UI terminology over profile records | `agents list/create/delete/use` | `sessions-service.ts` | Alias for `profiles`; list output key is `agents`. |
| `memory` | `readMemory`, `addMemoryEntry`, `updateMemoryEntry`, `removeMemoryEntry`, `writeUserProfile` | `memory read/add/update/remove`; `user-profile write` | `knowledge-service.ts` | User profile is split into its own CLI domain. Successful mutations mark runtime stale. |
| `user-profile` | `writeUserProfile` | `user-profile write` | `knowledge-service.ts` | Profile-scoped `USER.md` memory write. |
| `soul` | `readSoul`, `writeSoul`, `resetSoul` | `soul read/write/reset` | `knowledge-service.ts` | Local/SSH support; mutations mark runtime stale. |
| `tools` | `getToolsets`, `setToolsetEnabled` | `tools list/set` | `knowledge-service.ts` | Boolean strings accepted for `set`. |
| `skills` | `listInstalledSkills`, `listBundledSkills`, `getSkillContent`, `getSkillMetadata`, `installSkill`, `uninstallSkill`, `importSkillMarkdown` | `skills installed/bundled/content/metadata/install/uninstall/import` | `knowledge-service.ts` | Pure remote Markdown import rejected; SSH supported. |
| `models` | `listModels`, `addModel`, `removeModel`, `updateModel` | `models list/add/remove/update` | `models-service.ts`, `src/main/models.ts` | Listing uses service; mutations currently use local model storage. |
| `credentials` | `getCredentialPool`, `setCredentialPool` | `credentials get/set` | `models-service.ts`, `src/main/config.ts` | Set expects a JSON array in `--entries-file`. |
| `cron` | `listCronJobs`, `createCronJob`, `removeCronJob`, `pauseCronJob`, `resumeCronJob`, `triggerCronJob` | `cron list/create/remove/pause/resume/run` | `cron-service.ts` | `--active-only` flips include-disabled behavior. |
| `traces` | `listTraceRuns`, `getTraceRun`, `listSkillTrainingRuns`, `recordLocalChatTrace` | `traces list/get/skill-runs` | `trace-store.ts` | Local trace recording is renderer-only/deferred for CLI. |
| `runtime` | `getRuntimeDiagnostic` | `runtime diagnostic/revalidate` | `system-service.ts`, `hermes/runtime.ts` | Revalidate is service/runtime maintenance parity. |
| `gateway` | `startGateway`, `stopGateway`, `gatewayStatus`, `restartGateway`, `getPlatformEnabled`, `setPlatformEnabled` | `gateway status/start/stop/restart/platform list/platform set` | `gateway-service.ts` | Pure remote mutation unsupported. |
| `install` | `checkInstall`, `verifyInstall`, `startInstall`, install progress listener | `install status/verify/start` | `install-service.ts` | Progress maps to stderr text or NDJSON `progress`. |
| `hermes` | `getHermesVersion`, `refreshHermesVersion`, `runHermesDoctor`, `runHermesUpdate` | `hermes version`, `hermes version --refresh`, `hermes doctor`, `hermes update` | `install-service.ts` | SSH update refreshes gateway/tunnel/API-key/runtime. |
| `config` | `getConfig`, `setConfig`, `getModelConfig`, `setModelConfig`, `getHermesHome` | `config set`; `model-config set`; `connection get` for connection config | `config-service.ts` | `config get`, `env get`, `model-config get`, `getHermesHome` are deferred in CLI. |
| `env` | `getEnv`, `setEnv` | `env set` | `config-service.ts` | `env get` deferred; set may restart/revalidate runtime. |
| `model-config` | `getModelConfig`, `setModelConfig` | `model-config set` | `config-service.ts` | Read parity deferred; mutation can restart gateway. |
| `connection` | `getConnectionConfig`, `setConnectionConfig`, `setSshConfig`, `testRemoteConnection`, `testSshConnection` | `connection get`, `connection set`, `connection ssh set` | `config-service.ts` | Remote/SSH test commands are reserved/deferred. |
| `ssh` | `isSshTunnelActive`, `startSshTunnel`, `stopSshTunnel` | `ssh tunnel status/start/stop` | `config-service.ts`, `ssh-tunnel.ts` | Start may start remote gateway, cache key, and revalidate runtime. |
| `system` | `runHermesBackup`, `runHermesImport`, `runHermesDump`, `listMcpServers`, `discoverMemoryProviders`, `readLogs` | `backup run`, `import run`, `dump`, `mcp list`, `memory-providers list`, `logs read` | `system-service.ts` | `system` itself is reserved aggregate; concrete helpers are separate domains. |
| `backup` | `runHermesBackup` | `backup run` | `system-service.ts` | Local backup behavior. |
| `import` | `runHermesImport` | `import run` | `system-service.ts` | Successful import marks runtime stale. |
| `logs` | `readLogs` | `logs read` | `system-service.ts` | Local/SSH log reads. |
| `mcp` | `listMcpServers` | `mcp list` | `system-service.ts` | Local/SSH server listing. |
| `memory-providers` | `discoverMemoryProviders` | `memory-providers list` | `system-service.ts` | Local/SSH discovery. |
| `dump` | `runHermesDump` | `dump` | `system-service.ts` | Local/SSH dump text. |
| `claw` | `runClawMigrate` | `claw migrate` | `install-service.ts` | OpenClaw migration only. |
| `claw3d` | `claw3dStatus`, setup/progress/port/ws/log/dev/adapter methods | Reserved/deferred | `src/main/ipc/claw3d.ts` | CLI returns unsupported for `claw3d ...`. |

## Automation examples

### Inspect active data as JSON

```bash
mercury --json connection get
mercury --json runtime diagnostic --profile work
mercury --json sessions list --profile work --limit 20
mercury --json sessions search "signup failed" --limit 5
mercury --json traces list
```

### Resume chat with streaming NDJSON

```bash
mercury --ndjson --profile work chat send \
  --resume session-123 \
  --history-file history.json \
  --message "Continue from the last debugging step"
```

Minimal robust parser pattern:

```js
for await (const line of ndjsonLines(process.stdin)) {
  const event = JSON.parse(line);
  if (event.type === "chunk") process.stdout.write(event.text);
  if (event.type === "trace") console.error(event.event.title);
  if (event.type === "tool") console.error(event.text);
  if (event.type === "usage") console.error(JSON.stringify(event.usage));
  if (event.type === "done") console.log("\nSESSION", event.data.sessionId);
  if (event.type === "error") throw new Error(event.error.message);
}
```

### Generate and persist a title

```bash
cat > messages.json <<'JSON'
{"messages":[{"role":"user","content":"Debug the checkout funnel"},{"role":"assistant","content":"I found a failing gateway request."}]}
JSON

mercury --json --profile work chat title --session session-123 --messages-file messages.json
```

### Mutate profile memory from files

```bash
mercury --profile work memory add --file ./new-memory.md --json
mercury --profile work user-profile write --file ./USER.md --json
mercury --profile work soul write --file ./SOUL.md --json
```

### Import a skill and inspect metadata

```bash
mercury --json skills import --file ./skills/debugging.md --name debugging --category custom --overwrite --profile work
mercury --json skills installed --profile work
mercury --json skills metadata ~/.hermes/skills/custom/debugging
```

### Configure a model and gateway platform

```bash
mercury model-config set --provider openai --model gpt-4.1 --base-url https://api.example.test --profile work --json
mercury gateway platform set telegram true --profile work --json
mercury runtime revalidate --profile work --json
```

### Create and trigger a cron job

```bash
mercury --json cron create --schedule "0 9 * * *" --name daily-summary --prompt-file ./daily-prompt.md --profile work
mercury --json cron run job-123 --profile work
```

### SSH setup then chat

```bash
mercury connection ssh set \
  --host devbox.example \
  --username fred \
  --key-path ~/.ssh/id_ed25519 \
  --remote-port 8765 \
  --local-port 19000 \
  --json

mercury --json ssh tunnel start --profile work
mercury --ndjson --profile work chat send "Summarize the remote runtime state"
```

### Backup/import and diagnostics

```bash
mercury --json backup run --profile work
mercury --json import run ./backup.zip --profile work
mercury --json logs read --lines 200 --profile work
mercury --json mcp list --profile work
mercury --json memory-providers list --profile work
```

## Troubleshooting

### `unsupported-command`

Cause: command domain is reserved but the specific command is not implemented.

Examples:

```bash
mercury claw3d status
mercury config get theme
mercury connection test
```

Resolution: use an implemented command listed in this reference, or add the dispatcher/service behavior and update this document/tests in the same change.

### `runtime-unsupported-remote-profile`

Cause: pure remote HTTP mode cannot verify that the remote API is executing the selected profile.

Resolution: use local mode or SSH mode for profile-bound chat/title/runtime execution until a remote profile identity contract exists.

### Runtime verification exit `4`

Cause: profile mismatch, unverified runtime, stale runtime after profile switch, port/auth/token conflict, or unavailable runtime.

Resolution:

```bash
mercury --json runtime diagnostic --profile <name>
mercury --json runtime revalidate --profile <name>
mercury gateway restart --profile <name>
```

For SSH, also verify:

```bash
mercury --json connection get
mercury --json ssh tunnel status --profile <name>
mercury --json ssh tunnel start --profile <name>
```

### No incremental chat output in JSON mode

This is expected. `--json` suppresses incremental chat chunks and emits one final success envelope. Use text output for human streaming or `--ndjson` for machine-readable streaming.

### NDJSON parser errors

NDJSON is one JSON object per line. Do not parse the whole stream as one JSON document. Read line by line, ignore empty trailing lines, and handle `error` events before `done`.

### History/messages file parse failures

Symptoms: exit `2` with `invalid-usage` and a message beginning `Invalid --history-file` or `Invalid --messages-file`.

Resolution:

- Ensure the file is valid JSON.
- Use either an array or an object with a `messages` array.
- Ensure every message has string `role` and string `content`.
- For `chat title`, role must be `user`, `agent`, or `assistant`.

### `SIGINT` leaves partial chat output

This is expected. Text and NDJSON modes may have already emitted partial chunks. The final process exit is `130`, and NDJSON mode emits an `error` event for the abort. Treat partial chunks as incomplete unless a `done` event was received.

### SSH tunnel/gateway failures

Symptoms: exit `6`, runtime verification exit `4`, or `ssh tunnel start` returns `{ success: false }`.

Resolution checklist:

```bash
mercury --json connection get
mercury --json ssh tunnel status --profile <name>
mercury --json ssh tunnel start --profile <name>
mercury --json gateway status --profile <name>
mercury --json hermes version --refresh
mercury --json hermes doctor
```

Also verify host, username, key path, remote port, local port, and remote Hermes installation outside Mercury if needed.

### Validation failures from service results

Some service mutations return `{ success: false, error }` instead of throwing. The CLI normalizes these into `validation-failed` exit `8` for commands that call `ensureResultSuccess(...)`.

Common causes:

- Deleting a profile without `--yes` is usage exit `2`.
- Removing a missing model/session/trace/memory entry is `not-found` exit `7` when the dispatcher can identify it.
- Importing a Markdown skill in pure remote mode fails validation because remote HTTP cannot write profile files.

## Deferred limitations

These are known CLI gaps, not bugs in this contract:

- No long-running Mercury daemon, so `abortChat()` parity is limited to the active CLI process and `SIGINT`.
- No `config get`, `env get`, `model-config get`, or `getHermesHome` CLI commands yet, despite service/preload read methods.
- No CLI remote/SSH connection test commands yet, despite service/preload helpers.
- No CLI command for renderer local trace recording (`recordLocalChatTrace`).
- No CLI commands for Claw3D setup/status/port/ws/log/dev/adapter controls.
- No app-update event/menu/shell/performance-telemetry CLI parity.
- `--table`, `--stream`, `--raw`, and `--color` are parsed but mostly reserved until individual commands implement specialized behavior.
- Pure remote HTTP profile-bound execution remains fail-closed until Mercury has a verifiable remote profile identity contract.

## Guardrails and validation

Contract tests and docs guardrails:

- `tests/cli-parser.test.ts` verifies global flags, equals syntax, env defaults, color validation, and usage-error mapping.
- `tests/cli-output-contract.test.ts` verifies JSON envelopes and NDJSON line formatting.
- `tests/cli-errors.test.ts` verifies stable exit-code mapping.
- `tests/cli-entrypoint.test.ts` verifies help/version and unsupported reserved-domain errors.
- `tests/cli-read-only-commands.test.ts` verifies read/list/status/get command routing and local fixture behavior.
- `tests/cli-mutating-commands.test.ts` verifies mutation commands, file effects, boolean parsing, credential/model/config writes, and progress NDJSON.
- `tests/cli-chat-commands.test.ts` verifies `mercury chat send`, `mercury chat title`, NDJSON events, text streaming, JSON final-only output, history/message files, and `SIGINT` abort behavior.
- `tests/cli-parity.test.ts` verifies major preload domains are reserved and documented here, plus chat automation event strings and command names.
- `scripts/check-docs.mjs` has a `cli-contract` rule requiring `src/cli/**` and `tests/cli-*.test.ts` changes to update this file or `docs/testing/contract-tests.md`.

Run after CLI contract edits:

```bash
npm run test:cli
npm run check:docs
```

Run after CLI TypeScript behavior changes:

```bash
npm run typecheck:cli
npm run test:cli
```

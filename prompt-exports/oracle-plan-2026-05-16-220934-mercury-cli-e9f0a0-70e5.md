## Final Prompt
<taskname="Mercury CLI"/>
<task>Plan a fully CLI-driven Mercury interface so AI agents can use Mercury autonomously without Electron. The plan should cover parity with the current `window.hermesAPI`/IPC surface: viewing data, chat/session interaction, CRUD for agents/profiles and profile data, memory, SOUL, skills, tools, models, schedules/cron, traces, runtime/connection/install/SSH operations, and automation-friendly output. Do not implement code; produce an actionable phased implementation plan suitable for delegation across multiple agents.</task>

<architecture>Mercury is an Electron/Vite TypeScript app. Renderer access is mediated by `window.hermesAPI` in `src/preload/index.d.ts`; main-process capability ownership is in `src/main/ipc/*.ts`, which mostly delegates to reusable service modules under `src/main/*`. A CLI should reuse these main-process service modules or a shared command/service layer extracted beside them, instead of copying renderer/preload behavior. Runtime execution is profile-bound through `ProfileRuntimeManager` and `ProfileRuntimeHandle` in `src/main/hermes/runtime.ts` / `types.ts`. Local, SSH, and pure remote HTTP modes have different capability and verification constraints documented in `docs/subsystems/connection-modes.md` and `docs/subsystems/storage-and-profiles.md`.</architecture>

<selected_context>
package.json, electron.vite.config.ts, tsconfig*.json, vitest.config.ts: project scripts/build/test config; package currently has Electron app scripts but no Mercury CLI `bin`/CLI script.
docs/contracts/ipc-preload.md: authoritative current renderer-facing API surface, IPC channel ownership, event channels, change rules, and verification guidance.
docs/subsystems/connection-modes.md: local vs pure remote vs SSH behavior, runtime handle contract, fail-closed remote profile limitations, gateway/tunnel semantics.
docs/subsystems/storage-and-profiles.md: profile scoping, persistent files, session/cache/memory/SOUL/models/credentials/trace storage, local/SSH/remote differences.
src/preload/index.d.ts, src/preload/index.ts: full `HermesAPI` type contract and preload exposure; use this as the UI parity checklist.
src/main/ipc/*.ts: full current IPC handlers for chat, config, cron, gateway, install, knowledge, models, sessions/profiles/cache, system, trace, Claw3D; these show current domain routing, mode branching, and side effects.
src/main/hermes/*.ts: chat dispatch/transports, runtime identity manager, connection helpers, title generation, trace event normalization; these are the core chat/runtime seams for CLI commands.
src/main/config.ts, cronjobs.ts, memory.ts, soul.ts, skills.ts, skills/importer.ts, tools.ts, models.ts, profiles.ts, sessions.ts, session-cache.ts, session-db.ts, trace-store.ts: reusable local domain services for CLI CRUD/list/read operations.
src/main/install/*, installer.ts: install/status/version/doctor/update/backup/import/dump/log/provider/MCP helper operations.
src/main/ssh-remote.ts, src/main/ssh/*, src/main/ssh-tunnel.ts: SSH equivalents and transport helpers needed for CLI parity in SSH mode.
src/shared/*.ts selected: shared schemas/types for runtime diagnostics, traces, skills import, perf, and chat metadata/context/title validation.
</selected_context>

<relationships>
- Current UI parity map: renderer screens -> `window.hermesAPI` (`src/preload/index.d.ts`) -> IPC channel modules (`src/main/ipc/*.ts`) -> main service modules (`src/main/*`).
- Chat path: CLI command should mirror `send-message` flow in `src/main/ipc/chat.ts` -> `ProfileRuntimeManager.resolveRuntime()` -> `sendMessage()` in `src/main/hermes/gateway.ts` -> API/SSH API/CLI transport -> trace-store/session-cache side effects.
- Profile data path: Agents/profiles use `profiles.ts`; storage reads/writes use `profileHome(profile)` via `utils.ts`; SSH mirrors profile paths in `src/main/ssh/*`.
- Knowledge path: memory/SOUL/tools/skills handlers in `ipc/knowledge.ts` branch local vs SSH and mark/restart/stale runtimes where appropriate.
- Sessions/traces path: `sessions.ts` reads profile DBs; `session-cache.ts` stores desktop cache; `trace-store.ts` stores runs/events; Trace Lab parity needs list/get/local-trace operations.
- Runtime/connection path: `config.ts`, `hermes/connection.ts`, `hermes/runtime.ts`, `ssh-tunnel.ts`, and `ssh/runtime.ts` together define valid local/SSH/remote behavior; pure remote profile-bound execution currently fails closed.
- Testing seam: existing contract tests are referenced in docs; a CLI plan should add/extend parity tests around command output, JSON schemas, exit codes, streaming, profile/mode routing, and IPC/service parity.
</relationships>

<plan_requirements>
Deliver a phased plan, not code. Include: CLI entrypoint/package layout; command taxonomy mapped to `HermesAPI` domains; shared service layer boundaries; output contract (`--json`, NDJSON/streaming events for chat/progress, exit codes, errors); profile/mode flags and config precedence; local/SSH/remote behavior; migration strategy from IPC-only APIs; tests/docs updates; and multi-agent delegation batches with dependencies and done criteria. Call out where a thin CLI can directly reuse existing services versus where an extracted non-Electron orchestration layer is needed.</plan_requirements>

<ambiguities>
- Renderer screen implementations are intentionally not selected to preserve budget; use `src/preload/index.d.ts` and `docs/contracts/ipc-preload.md` as the current UI parity source of truth.
- `src/main/index.ts` Electron lifecycle/updater/menu code is not selected; package/build config is selected for CLI entrypoint planning. If app updater/menu parity matters, account for it as an Electron-only concern unless a CLI-specific equivalent is explicitly required.
- Pure remote HTTP mode does not currently provide verified profile-bound execution; plans should preserve fail-closed behavior or explicitly define a future remote identity contract.
</ambiguities>

## Selection
- Files: 64 total (64 full)
- Total tokens: 107292 (Auto view)
- Token breakdown: full 107292

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── contracts/
│   │   └── ipc-preload.md — 4 279 tokens (full)
│   └── subsystems/
│       ├── connection-modes.md — 3 586 tokens (full)
│       └── storage-and-profiles.md — 4 640 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 237 tokens (full)
│   │   │   ├── chat-cli.ts — 1 803 tokens (full)
│   │   │   ├── connection.ts — 1 646 tokens (full)
│   │   │   ├── gateway.ts — 1 091 tokens (full)
│   │   │   ├── runtime.ts — 7 981 tokens (full)
│   │   │   ├── title.ts — 1 250 tokens (full)
│   │   │   ├── trace-events.ts — 2 616 tokens (full)
│   │   │   └── types.ts — 775 tokens (full)
│   │   ├── install/
│   │   │   ├── executor.ts — 3 517 tokens (full)
│   │   │   ├── introspection.ts — 1 827 tokens (full)
│   │   │   ├── maintenance.ts — 930 tokens (full)
│   │   │   └── paths.ts — 2 378 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 3 971 tokens (full)
│   │   │   ├── claw3d.ts — 429 tokens (full)
│   │   │   ├── config.ts — 2 115 tokens (full)
│   │   │   ├── cron.ts — 448 tokens (full)
│   │   │   ├── gateway.ts — 885 tokens (full)
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   ├── install.ts — 863 tokens (full)
│   │   │   ├── knowledge.ts — 2 080 tokens (full)
│   │   │   ├── models.ts — 339 tokens (full)
│   │   │   ├── sessions.ts — 2 134 tokens (full)
│   │   │   ├── system.ts — 719 tokens (full)
│   │   │   ├── trace.ts — 167 tokens (full)
│   │   │   └── types.ts — 35 tokens (full)
│   │   ├── skills/
│   │   │   └── importer.ts — 1 730 tokens (full)
│   │   ├── ssh/
│   │   │   ├── config.ts — 2 703 tokens (full)
│   │   │   ├── memory-soul.ts — 1 771 tokens (full)
│   │   │   ├── runtime.ts — 4 322 tokens (full)
│   │   │   ├── sessions-profiles.ts — 2 828 tokens (full)
│   │   │   ├── skills.ts — 2 310 tokens (full)
│   │   │   └── transport.ts — 1 881 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── cronjobs.ts — 2 528 tokens (full)
│   │   ├── installer.ts — 207 tokens (full)
│   │   ├── memory.ts — 1 495 tokens (full)
│   │   ├── models.ts — 826 tokens (full)
│   │   ├── profiles.ts — 1 806 tokens (full)
│   │   ├── session-cache.ts — 3 485 tokens (full)
│   │   ├── session-db.ts — 520 tokens (full)
│   │   ├── sessions.ts — 1 648 tokens (full)
│   │   ├── skills.ts — 2 585 tokens (full)
│   │   ├── soul.ts — 307 tokens (full)
│   │   ├── ssh-remote.ts — 363 tokens (full)
│   │   ├── ssh-tunnel.ts — 2 723 tokens (full)
│   │   ├── tools.ts — 2 034 tokens (full)
│   │   ├── trace-store.ts — 2 779 tokens (full)
│   │   └── utils.ts — 378 tokens (full)
│   ├── preload/
│   │   ├── index.d.ts — 3 767 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   └── shared/
│       ├── chat-metadata.ts — 1 139 tokens (full)
│       ├── perf.ts — 179 tokens (full)
│       ├── runtime.ts — 310 tokens (full)
│       ├── skills.ts — 264 tokens (full)
│       └── traces.ts — 417 tokens (full)
├── electron.vite.config.ts — 121 tokens (full)
├── package.json — 1 202 tokens (full)
├── tsconfig.json — 28 tokens (full)
├── tsconfig.node.json — 70 tokens (full)
├── tsconfig.web.json — 110 tokens (full)
└── vitest.config.ts — 126 tokens (full)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `mercury-cli-E9F0A0` | **Mode**: plan

### Response
## 1. **Summary**

Add a first-class, fully CLI-driven Mercury interface that reuses Mercury’s existing main-process domain services and runtime contracts without launching Electron. The CLI should expose automation-friendly parity with the current `window.hermesAPI`/IPC surface: chat, sessions, profiles/agents, memory, SOUL, skills, tools, models, cron schedules, traces, runtime diagnostics, connection/install/SSH operations, and system helpers. The best approach is a targeted shared orchestration layer plus a new Node CLI entrypoint: keep existing service modules as capability owners, extract Electron-specific IPC orchestration into reusable command services only where handlers currently contain important branching/side effects, and implement CLI commands as thin adapters over that shared layer.

---

## 2. **Current-state analysis**

### Existing architecture and ownership

Mercury currently has this capability flow:

```text
Renderer screen
  → window.hermesAPI in src/preload/index.d.ts
  → preload fragments in src/preload/api/*.ts
  → ipcMain.handle(...) in src/main/ipc/*.ts
  → reusable domain services in src/main/*
```

The renderer never imports main modules directly. Its stable API contract is `HermesAPI` in `src/preload/index.d.ts`, and the current authoritative documentation is `docs/contracts/ipc-preload.md`.

A CLI cannot reuse preload or IPC directly because those layers require Electron’s `ipcRenderer`/`ipcMain`. It should reuse the main service modules and, where IPC handlers contain non-trivial orchestration, move that orchestration into non-Electron service functions that both IPC and CLI can call.

### Current reusable service modules

Most capabilities already have reusable service functions suitable for direct CLI reuse:

- Profiles/agents:
  - `src/main/profiles.ts`
- Config/env/model/connection persistence:
  - `src/main/config.ts`
- Sessions:
  - `src/main/sessions.ts`
  - `src/main/session-cache.ts`
  - `src/main/session-db.ts`
- Memory:
  - `src/main/memory.ts`
- SOUL:
  - `src/main/soul.ts`
- Skills:
  - `src/main/skills.ts`
  - `src/main/skills/importer.ts`
- Tools:
  - `src/main/tools.ts`
- Models:
  - `src/main/models.ts`
- Cron:
  - `src/main/cronjobs.ts`
- Traces:
  - `src/main/trace-store.ts`
- Install/update/introspection:
  - `src/main/install/*`
  - `src/main/installer.ts`
- Runtime/chat:
  - `src/main/hermes/runtime.ts`
  - `src/main/hermes/gateway.ts`
  - `src/main/hermes/chat-api.ts`
  - `src/main/hermes/chat-cli.ts`
  - `src/main/hermes/title.ts`
  - `src/main/hermes/connection.ts`
- SSH:
  - `src/main/ssh-remote.ts`
  - `src/main/ssh/*`
  - `src/main/ssh-tunnel.ts`

### Blocking issue: IPC handlers contain important orchestration

Some IPC modules are not just thin wrappers. They encode critical mode branching, stale-runtime marking, restart behavior, SSH tunnel setup, trace side effects, and session-cache updates. A CLI that calls only low-level services would miss these behaviors.

Important examples:

- `src/main/ipc/chat.ts`
  - prepares local/SSH backend;
  - lazy-starts local gateway;
  - starts SSH gateway/tunnel and reads remote API key;
  - creates and finalizes trace runs;
  - emits streaming chunks/tool/usage/error events;
  - updates session profile/title.
- `src/main/ipc/config.ts`
  - branches local vs SSH for env/config/model writes;
  - marks runtimes stale;
  - restarts local/SSH gateways when needed;
  - revalidates SSH runtime.
- `src/main/ipc/knowledge.ts`
  - branches local vs SSH for memory/SOUL/tools/skills;
  - rejects pure remote Markdown skill import;
  - marks runtime stale;
  - reports gateway restart requirement.
- `src/main/ipc/gateway.ts`
  - branches local/SSH/remote;
  - handles SSH platform toggle restart/tunnel/key/revalidation sequence.
- `src/main/ipc/cron.ts`
  - marks runtime stale after cron mutations.
- `src/main/ipc/sessions.ts`
  - branches SSH/local;
  - adds diagnostics;
  - attaches cached profile metadata to local session search results.
- `src/main/ipc/install.ts`
  - branches SSH/local for version/doctor/update;
  - emits progress.
- `src/main/ipc/system.ts`
  - branches SSH/local for dump/logs/MCP/memory providers;
  - marks runtime stale after import.

These should be extracted into shared non-Electron command/service modules rather than duplicated in the CLI.

### Runtime and connection constraints

Runtime execution is profile-bound through `ProfileRuntimeManager` in `src/main/hermes/runtime.ts`.

Hard constraints to preserve:

- Local mode:
  - profile files are rooted through `profileHome(profile)`;
  - chat may use verified local API or local CLI fallback;
  - local gateway startup is profile-specific and managed by `ProfileRuntimeManager`.
- SSH mode:
  - profile-bound tunnel identity matters;
  - chat must use verified `ssh-api`;
  - named SSH profiles require a profile-specific remote port and cannot be verified through the default remote API port;
  - SSH API key must be read from remote `.env` and cached through `setSshRemoteApiKey(...)`.
- Pure remote HTTP mode:
  - `/health` validation is not enough to prove profile identity;
  - profile-bound chat/title/cron currently fails closed with `runtime-unsupported-remote-profile`;
  - filesystem-backed capabilities are unavailable or should return explicit unsupported errors unless already implemented as remote-safe diagnostics.

### Persistence constraints

The CLI will operate against the same persistent data as Mercury:

- `desktop.json` for connection mode/config.
- `models.json`, `auth.json`, `desktop/sessions.json`, `desktop-traces.json`.
- Profile-scoped `.env`, `config.yaml`, `state.db`, `memories/MEMORY.md`, `memories/USER.md`, `SOUL.md`, `skills`, `gateway.pid`, logs.
- SSH equivalents under `~/.hermes` and `~/.hermes/profiles/<profile>`.

No new data schema is required for the initial CLI. Additive CLI config can be avoided by using existing `desktop.json` and environment variables.

---

## 3. **Design**

### 3.1 CLI package layout and entrypoint

Add a Node CLI entrypoint under `src/cli`.

#### New files

```text
src/cli/
  index.ts                  # executable entrypoint
  parser.ts                 # argv parser and command dispatch
  output.ts                 # JSON/table/text/NDJSON/error formatting
  errors.ts                 # normalized CLI error classes + exit code mapping
  context.ts                # command context, profile/mode/output resolution
  commands/
    chat.ts
    sessions.ts
    profiles.ts
    config.ts
    memory.ts
    soul.ts
    skills.ts
    tools.ts
    models.ts
    cron.ts
    traces.ts
    runtime.ts
    gateway.ts
    install.ts
    system.ts
    claw3d.ts
  schemas/
    *.ts                    # optional command result type guards/schemas for tests
```

#### Package changes

Modify `package.json`:

- Add a CLI binary, for example:

```json
"bin": {
  "mercury": "./out/cli/index.js"
}
```

- Add scripts:

```json
"typecheck:cli": "tsc --noEmit -p tsconfig.cli.json --composite false",
"build:cli": "npm run typecheck:cli && electron-vite build",
"test:cli": "vitest run tests/cli-*.test.ts"
```

Decision: create a separate `tsconfig.cli.json` instead of widening `tsconfig.node.json` if CLI emits to a distinct build target. If electron-vite cannot build the CLI entry directly, use a lightweight `tsup`/`vite` CLI build later, but initial plan should prefer existing TypeScript/Vite infrastructure.

#### Build config

Update `electron.vite.config.ts` only if needed to emit a CLI bundle. Preferred design:

- keep Electron main/preload/renderer unchanged;
- add a separate Node-target Vite config or simple `tsc` output for `src/cli/index.ts`;
- do not bundle `better-sqlite3` into CLI; mark it external just like the main build.

The CLI entrypoint must include a shebang in source output or post-build wrapper:

```text
#!/usr/bin/env node
```

### 3.2 CLI context and global flags

Create `src/cli/context.ts`.

#### `CliContext`

Kind: immutable per-command record.

Fields:

```ts
type CliOutputMode = "json" | "ndjson" | "text" | "table";

interface CliContext {
  argv: string[];
  cwd: string;
  profile?: string;
  output: CliOutputMode;
  quiet: boolean;
  verbose: boolean;
  color: "auto" | "always" | "never";
  connectionMode?: "local" | "remote" | "ssh";
  stream: boolean;
  raw: boolean;
}
```

Global flags:

- `--profile <name>` / `-p <name>`
- `--json`
- `--ndjson`
- `--text`
- `--table`
- `--quiet`
- `--verbose`
- `--color auto|always|never`
- `--stream`
- `--raw`
- `--help`
- `--version`

Config precedence:

1. Explicit CLI flags.
2. Environment:
   - `MERCURY_PROFILE`
   - `MERCURY_OUTPUT`
   - `HERMES_HOME` already honored by existing install/path modules.
3. Existing Mercury desktop config from `src/main/config.ts`.
4. Defaults:
   - profile: `default`
   - output: `text` for human commands, `json` when `--json`, `ndjson` for streaming when `--ndjson`.

Do not add a separate CLI config file in phase 1.

### 3.3 Output contract

Create `src/cli/output.ts`.

#### Success envelope

For `--json`, every non-streaming command returns one JSON object:

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

#### Error envelope

For `--json` and `--ndjson`, errors return:

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

#### NDJSON streaming events

For chat and progress-heavy commands, `--ndjson` emits one object per line:

```ts
type CliStreamEvent =
  | { type: "start"; command: string; profile?: string; ts: number }
  | { type: "chunk"; text: string; ts: number }
  | { type: "trace"; event: TraceEvent; ts: number }
  | { type: "tool"; text: string; ts: number }
  | { type: "usage"; usage: TraceUsage; ts: number }
  | { type: "progress"; progress: InstallProgress; ts: number }
  | { type: "done"; data: unknown; ts: number }
  | { type: "error"; error: { code: string; message: string }; ts: number };
```

For normal text streaming chat, stdout receives assistant chunks only by default. Metadata goes to stderr unless `--ndjson` is set.

#### Exit codes

Use stable exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Generic runtime failure |
| `2` | Invalid CLI usage/arguments |
| `3` | Capability unsupported in current mode |
| `4` | Profile/runtime verification failed |
| `5` | Not installed or install verification failed |
| `6` | Connection/SSH/tunnel failure |
| `7` | Not found |
| `8` | Validation failed |
| `130` | Interrupted by SIGINT/user abort |

Map `ProfileRuntimeError.code` specifically:

- `runtime-profile-mismatch`, `runtime-profile-unverified`, `runtime-stale-after-profile-switch` → `4`
- `runtime-unsupported-remote-profile` → `3`
- `runtime-port-conflict`, `runtime-auth-conflict`, `runtime-token-conflict`, `runtime-unavailable` → `4` or `6` depending details.

### 3.4 Shared non-Electron orchestration layer

Add `src/main/cli-services` or `src/main/services`.

Recommended path:

```text
src/main/services/
  chat-service.ts
  config-service.ts
  gateway-service.ts
  knowledge-service.ts
  sessions-service.ts
  install-service.ts
  system-service.ts
  cron-service.ts
```

These services should be Electron-free and reusable by both IPC handlers and CLI.

#### Why this targeted extraction is needed

A broader rewrite of all main services is unnecessary because most domain functions are already reusable. The extraction should be targeted to IPC handlers that contain mode branching and side effects, so behavior stays unified and avoids parallel code paths.

#### Service interface shape

Example pattern:

```ts
interface ProgressSink<T> {
  emit: (event: T) => void;
}

interface ChatRunOptions {
  message: string;
  profile?: string;
  resumeSessionId?: string;
  history?: Array<{ role: string; content: string }>;
  callbacks: ChatCallbacks;
}

async function runChat(options: ChatRunOptions): Promise<{
  response: string;
  sessionId?: string;
  traceRunId?: string;
  abort?: () => void;
}>;
```

IPC handlers become Electron adapters:

```text
ipcMain.handle(...)
  → service function
  → service callbacks send event.sender events
```

CLI commands become terminal adapters:

```text
command parser
  → service function
  → callbacks write stdout/stderr/NDJSON
```

### 3.5 Chat command design

#### Commands

```text
mercury chat send [message] [--profile <name>] [--resume <sessionId>] [--history-file <path>] [--json|--ndjson|--stream]
mercury chat title --messages-file <path> [--session <id>] [--profile <name>]
mercury chat abort
```

For non-interactive automation, require one of:

- positional message;
- `--message <text>`;
- stdin.

#### Reused code

- Extract `prepareChatBackend(...)` from `src/main/ipc/chat.ts` to `src/main/services/chat-service.ts`.
- Reuse:
  - `sendMessage(...)` from `src/main/hermes/gateway.ts`
  - `profileRuntimeManager`
  - `createTraceRun`, `recordTraceEvent`, `finishTraceRun`, `recordTraceUsage`
  - `updateSessionProfile`, `updateSessionTitle`
  - `generateChatTitle` from `src/main/hermes/title.ts`
  - synthetic chat support from `src/main/hermes/synthetic-chat`

#### Behavior

`mercury chat send` must mirror IPC `send-message`:

1. Normalize profile through `profileRuntimeManager.normalizeProfile(profile)`.
2. If local and gateway is not running, start it.
3. If SSH:
   - ensure tunnel;
   - check remote gateway status and tunnel health;
   - start gateway/tunnel if needed;
   - read remote API key;
   - cache with `setSshRemoteApiKey`;
   - resolve verified runtime.
4. Resolve runtime with purpose `chat`.
5. Create trace run.
6. Stream chunks/tool events/usage.
7. On completion:
   - finish trace as `completed`;
   - update session profile;
   - emit final result.
8. On error:
   - record `transport.error`;
   - finish trace as `failed`;
   - exit non-zero.

SIGINT behavior:

- If a chat run is active, call its `abort()`.
- Finish trace as `aborted`.
- Emit NDJSON `{ type: "error", error: { code: "aborted" } }` when applicable.
- Exit `130`.

### 3.6 Sessions and cache commands

#### Commands

```text
mercury sessions list [--profile <name>] [--limit N] [--offset N]
mercury sessions messages <sessionId> [--profile <name>]
mercury sessions search <query> [--profile <name>] [--limit N]
mercury sessions cache list [--profile <name>] [--limit N] [--offset N]
mercury sessions cache sync [--profile <name>]
mercury sessions title set <sessionId> <title> [--profile <name>]
```

#### Reuse/extract

Extract mode-branching from `src/main/ipc/sessions.ts` into `src/main/services/sessions-service.ts`.

Use:

- local:
  - `listSessions`
  - `getSessionMessages`
  - `searchSessions`
  - `listCachedSessions`
  - `syncSessionCache`
  - `updateSessionTitle`
- SSH:
  - `sshListSessions`
  - `sshGetSessionMessages`
  - `sshSearchSessions`
  - `sshListCachedSessions`
- helper:
  - current `attachCachedProfiles(...)` should move to the service layer.

### 3.7 Profiles/agents commands

Use “profiles” as the technical command namespace, with “agents” alias for UI terminology parity.

#### Commands

```text
mercury profiles list
mercury profiles create <name> [--clone]
mercury profiles delete <name> [--yes]
mercury profiles use <name>
mercury agents list
mercury agents create <name> [--clone]
mercury agents delete <name> [--yes]
mercury agents use <name>
```

#### Behavior

- Local:
  - `listProfiles`, `createProfile`, `deleteProfile`, `setActiveProfile`.
- SSH:
  - `sshListProfiles`, `sshCreateProfile`, `sshDeleteProfile`.
  - `set-active-profile` currently returns true but does not set remote active profile. Preserve that behavior and document it.
- Pure remote:
  - if service currently falls through local behavior in IPC, decide explicitly:
    - for phase 1, return unsupported for profile CRUD in pure remote mode unless a pure remote API exists.
    - this is safer and matches remote-only filesystem gating.

### 3.8 Config, connection, runtime, gateway commands

#### Config/env/model commands

```text
mercury env get [--profile <name>]
mercury env set <key> <value> [--profile <name>]

mercury config get <key> [--profile <name>]
mercury config set <key> <value> [--profile <name>]

mercury model-config get [--profile <name>]
mercury model-config set --provider <p> --model <m> [--base-url <url>] [--profile <name>]
```

Extract logic from `src/main/ipc/config.ts` to `src/main/services/config-service.ts`, preserving:

- local/SSH branching;
- runtime stale marking;
- local gateway restart for credential/model changes;
- SSH gateway stop/start/tunnel/API-key/revalidation sequence.

#### Connection commands

```text
mercury connection get
mercury connection set --mode local
mercury connection set --mode remote --url <url> [--api-key <key>]
mercury connection ssh set --host <host> --port <port> --username <user> --key-path <path> --remote-port <port> --local-port <port>
mercury connection remote test --url <url> [--api-key <key>]
mercury connection ssh test --host <host> --port <port> --username <user> --key-path <path> --remote-port <port>
```

Use:

- `getConnectionConfig`
- `setConnectionConfig`
- `testRemoteConnection`
- `testSshConnection`
- `markAllRuntimesStale`

#### Runtime commands

```text
mercury runtime diagnostic [--profile <name>]
mercury runtime revalidate [--profile <name>]
```

Use:

- `getRuntimeDiagnostic`
- `revalidateRuntime`

#### Gateway commands

```text
mercury gateway start [--profile <name>]
mercury gateway stop [--profile <name>] [--force]
mercury gateway status [--profile <name>]
mercury gateway restart [--profile <name>]
mercury gateway platform list [--profile <name>]
mercury gateway platform set <platform> <enabled> [--profile <name>]
```

Extract logic from `src/main/ipc/gateway.ts`.

Preserve pure remote behavior:

- `start/stop/restart/status` returns unsupported or false with exit `3`;
- platform list returns `{}` in pure remote.

### 3.9 Memory, SOUL, tools, skills commands

Extract `src/main/ipc/knowledge.ts` branching into `src/main/services/knowledge-service.ts`.

#### Memory

```text
mercury memory read [--profile <name>]
mercury memory add <content> [--profile <name>]
mercury memory update <index> <content> [--profile <name>]
mercury memory remove <index> [--profile <name>]
mercury user-profile write [--file <path>|--stdin|<content>] [--profile <name>]
```

Preserve:

- memory char limit;
- user profile char limit;
- stale runtime marking after successful mutations.

#### SOUL

```text
mercury soul read [--profile <name>]
mercury soul write [--file <path>|--stdin|<content>] [--profile <name>]
mercury soul reset [--profile <name>]
```

Preserve stale runtime marking after write/reset.

#### Tools

```text
mercury tools list [--profile <name>]
mercury tools set <key> <enabled> [--profile <name>]
```

Preserve local mirrored `cli` + `api_server` toolset behavior in `src/main/tools.ts`.

#### Skills

```text
mercury skills installed [--profile <name>]
mercury skills bundled
mercury skills content <path>
mercury skills metadata <path>
mercury skills install <identifier> [--profile <name>]
mercury skills uninstall <name> [--profile <name>]
mercury skills import --file <path> [--name <slug>] [--category <slug>] [--description <text>] [--overwrite] [--profile <name>]
```

Preserve:

- SSH routing;
- pure remote Markdown import rejection;
- stale runtime marking;
- gateway restart warning if gateway is running.

### 3.10 Models and credential pool commands

#### Models

```text
mercury models list
mercury models add --name <name> --provider <provider> --model <model> [--base-url <url>]
mercury models remove <id>
mercury models update <id> [--name <name>] [--provider <provider>] [--model <model>] [--base-url <url>] [--context-window <tokens>]
```

Current IPC only routes `list-models` to SSH but local add/remove/update always operate on local `models.json`. Preserve that behavior for parity and document it.

Future phase can add SSH model save parity by using existing `sshSaveModels(...)`.

#### Credential pool

```text
mercury credentials get
mercury credentials set <provider> --entries-file <json>
```

Use local-only:

- `getCredentialPool`
- `setCredentialPool`

Document that credential pool does not currently branch to SSH.

### 3.11 Cron/schedules commands

```text
mercury cron list [--include-disabled] [--profile <name>]
mercury cron create --schedule <expr> [--prompt <text>|--prompt-file <path>] [--name <name>] [--deliver <target>] [--profile <name>]
mercury cron remove <jobId> [--profile <name>]
mercury cron pause <jobId> [--profile <name>]
mercury cron resume <jobId> [--profile <name>]
mercury cron run <jobId> [--profile <name>]
```

Use `src/main/cronjobs.ts`.

Preserve `src/main/ipc/cron.ts` side effect:

- mark runtime stale after create/remove/pause/resume.
- trigger/run does not currently mark stale; preserve.

Remote behavior:

- `cronjobs.ts` already uses `resolveCronApiRuntime(profile)` when `isRemoteMode()`.
- In pure remote HTTP, this currently fails closed via `ProfileRuntimeManager`; preserve.

### 3.12 Trace commands

```text
mercury traces list
mercury traces get <runId>
mercury traces skill-runs
mercury traces record-local --command <command> [--profile <name>] [--response-preview <text>] [--metadata-file <json>]
```

Use:

- `listTraceRuns`
- `getTraceRun`
- `listSkillTrainingRuns`
- `createLocalChatTrace`

No schema migration required.

### 3.13 Install, update, system, SSH, logs commands

#### Install/update

```text
mercury install status
mercury install verify
mercury install start [--json|--ndjson]
mercury hermes version [--refresh]
mercury hermes doctor
mercury hermes update [--profile <name>] [--ndjson]
mercury claw migrate
mercury openclaw check
```

Extract `src/main/ipc/install.ts` orchestration.

Progress behavior:

- `runInstall`, `runHermesUpdate`, `runClawMigrate` already accept progress callbacks.
- For CLI:
  - `--ndjson` emits `progress`;
  - text mode prints progress log/status to stderr.

SSH update behavior must preserve:

1. `sshRunUpdate`
2. `sshStartGateway`
3. `startSshTunnel`
4. `sshReadRemoteApiKey`
5. `setSshRemoteApiKey`
6. `revalidateRuntime`

#### SSH tunnel

```text
mercury ssh tunnel status [--profile <name>]
mercury ssh tunnel start [--profile <name>]
mercury ssh tunnel stop
```

Use same logic as `start-ssh-tunnel` handler in `src/main/ipc/config.ts`.

#### System helpers

```text
mercury backup run [--profile <name>]
mercury import run <archivePath> [--profile <name>]
mercury dump
mercury logs read [--file agent.log|errors.log|gateway.log] [--lines N] [--profile <name>]
mercury mcp list [--profile <name>]
mercury memory-providers list [--profile <name>]
```

Extract from `src/main/ipc/system.ts`.

Preserve:

- SSH routing for dump/logs/MCP/memory providers.
- stale runtime marking after successful import.
- backup/import remain local-only in current behavior unless a future SSH implementation is added.

### 3.14 Claw3D CLI parity

Commands:

```text
mercury claw3d status
mercury claw3d setup [--ndjson]
mercury claw3d port get
mercury claw3d port set <port>
mercury claw3d ws-url get
mercury claw3d ws-url set <url>
mercury claw3d start
mercury claw3d stop
mercury claw3d logs
mercury claw3d dev start
mercury claw3d dev stop
mercury claw3d adapter start
mercury claw3d adapter stop
```

Use existing `src/main/claw3d/*` modules through a thin command wrapper. This is lower priority if the “AI agents use Mercury autonomously” goal focuses on Hermes capabilities, but include it for `HermesAPI` parity.

---

## 4. **File-by-file impact**

### `package.json`

- Add `bin.mercury`.
- Add CLI build/typecheck/test scripts.
- Possibly add a dependency only if a parser is chosen. Prefer no new dependency initially; implement a small parser to avoid package churn.

Depends on CLI entrypoint existing.

### `tsconfig.cli.json` / `tsconfig.node.json`

- Add a dedicated CLI TypeScript config or include `src/cli/**/*` in node config.
- Must include `src/main/**/*` and `src/shared/**/*`.
- Ensure Node types are available.

Depends on package/build choice.

### `electron.vite.config.ts`

- If CLI is bundled by Vite, add a Node CLI build entry and keep `better-sqlite3` external.
- If CLI is emitted by `tsc`, no change or only docs comments.

### `src/cli/index.ts`

- New executable entry.
- Initializes parser, builds `CliContext`, dispatches commands, writes output, maps errors to exit codes.
- Installs SIGINT handler for long-running chat/progress commands.

Depends on `parser.ts`, `output.ts`, `errors.ts`.

### `src/cli/parser.ts`

- New command registry and argv parsing.
- Resolves global flags and command-specific options.
- No domain logic.

Depends on all command modules.

### `src/cli/context.ts`

- New context builder.
- Reads env defaults.
- Optionally reads `getConnectionConfig()` for mode metadata.

### `src/cli/output.ts`

- New output envelope and stream event helpers.
- Owns stdout/stderr writing.
- Must not import Electron.

### `src/cli/errors.ts`

- New `CliError` type and mapper from thrown errors, including `ProfileRuntimeError`.

### `src/cli/commands/*.ts`

- New command adapter modules.
- Should contain only argument validation, stdin/file reads, service invocation, and output selection.

### `src/main/services/chat-service.ts`

- New shared orchestration extracted from `src/main/ipc/chat.ts`.
- Owns `prepareChatBackend`, trace lifecycle, session-cache side effects, and active run abstraction without Electron `WebContents`.
- IPC and CLI both consume it.

Depends on current `src/main/ipc/chat.ts`.

### `src/main/ipc/chat.ts`

- Refactor to call `chat-service`.
- Retain Electron-specific `safeSend`, notifications, and IPC event channel emissions as adapter callbacks.
- Preserve `abortActiveChat` behavior by delegating to service-level active run registry or retaining IPC-specific active run if CLI has separate process lifetime.

Must be atomic with `chat-service`.

### `src/main/services/config-service.ts`

- New shared service extracted from `src/main/ipc/config.ts`.
- Owns env/config/model/connection/SSH tunnel orchestration and stale/restart/revalidate side effects.

### `src/main/ipc/config.ts`

- Refactor handlers to call `config-service`.

Must be atomic with `config-service`.

### `src/main/services/gateway-service.ts`

- New shared service extracted from `src/main/ipc/gateway.ts`.
- Owns local/SSH/remote gateway/platform branching.

### `src/main/ipc/gateway.ts`

- Refactor to call `gateway-service`.

### `src/main/services/knowledge-service.ts`

- New shared service extracted from `src/main/ipc/knowledge.ts`.
- Owns local/SSH branch for memory/SOUL/tools/skills and stale/warning side effects.

### `src/main/ipc/knowledge.ts`

- Refactor to call `knowledge-service`.

### `src/main/services/sessions-service.ts`

- New shared service extracted from `src/main/ipc/sessions.ts`.
- Owns local/SSH branch and cached profile attachment.
- Diagnostic file writing can remain IPC-only or be moved behind optional service diagnostics. For CLI, do not enable unless `MERCURY_SESSIONS_DIAG=1`.

### `src/main/ipc/sessions.ts`

- Refactor to call `sessions-service`.

### `src/main/services/install-service.ts`

- New shared service extracted from `src/main/ipc/install.ts`.
- Owns local/SSH install/version/doctor/update/OpenClaw orchestration.
- Uses progress sink.

### `src/main/ipc/install.ts`

- Refactor to call `install-service` and forward progress to `install-progress`.

### `src/main/services/system-service.ts`

- New shared service extracted from `src/main/ipc/system.ts`.
- Owns backup/import/dump/log/MCP/memory provider branching and stale import side effect.

### `src/main/ipc/system.ts`

- Refactor to call `system-service`.

### `src/main/services/cron-service.ts`

- New small wrapper around `src/main/cronjobs.ts`.
- Adds stale marking after mutations.

### `src/main/ipc/cron.ts`

- Refactor to call `cron-service`.

### `src/preload/index.d.ts`

- No CLI-related API changes needed.
- Use as parity checklist only.

### `docs/contracts/ipc-preload.md`

- Add a “CLI parity” note:
  - IPC/preload remains renderer contract.
  - CLI commands share service layer with IPC.
  - New CLI-visible capabilities should update CLI docs/tests when IPC changes.

### New `docs/contracts/cli.md`

- Document command taxonomy, flags, output envelopes, NDJSON streaming, exit codes, mode behavior, and examples.

### `docs/subsystems/connection-modes.md`

- Add CLI notes under each mode:
  - local gateway lazy start;
  - SSH tunnel/profile verification;
  - pure remote fail-closed for profile-bound execution.

### `docs/subsystems/storage-and-profiles.md`

- Add CLI notes that CLI operates against same profile storage and `HERMES_HOME`.

### Tests

Add:

```text
tests/cli-parser.test.ts
tests/cli-output-contract.test.ts
tests/cli-services-chat.test.ts
tests/cli-services-config-gateway.test.ts
tests/cli-services-knowledge.test.ts
tests/cli-services-sessions.test.ts
tests/cli-commands-smoke.test.ts
tests/cli-parity.test.ts
```

Use existing tests as references:

- `tests/ipc-handlers.test.ts`
- `tests/preload-api-surface.test.ts`
- `tests/chat-ipc-lifecycle.test.ts`
- `tests/reliable-profile-runtime-contract.test.ts`
- `tests/ssh-remote.test.ts`
- `tests/session-cache-sync.test.ts`
- `tests/skills-import.test.ts`
- `tests/hermes-title.test.ts`
- `tests/cron-runtime.test.ts`

---

## 5. **Risks and migration**

### Risk: duplicated behavior between IPC and CLI

Mitigation: do not implement CLI by copying IPC handler logic. Extract shared service functions first, then make both IPC and CLI call them.

### Risk: Electron imports leak into CLI

Mitigation:

- CLI must not import `electron`, `ipcMain`, `BrowserWindow`, `Notification`, or preload files.
- Keep Electron adapters in `src/main/ipc/*`.
- Shared services must be Electron-free.

### Risk: pure remote mode ambiguity

Mitigation:

- Preserve fail-closed behavior for profile-bound execution.
- Return explicit unsupported errors with exit code `3`.
- Do not add unverified remote chat execution.

### Risk: long-running chat process lifecycle differs from Electron

Mitigation:

- CLI active chat run only lives for the process lifetime.
- SIGINT calls abort and finalizes trace.
- `mercury chat abort` cannot abort a different already-exited process unless a future daemon is added. For phase 1, document that `chat abort` is only meaningful for future daemon/server mode or no-ops with a clear message.

### Risk: build packaging for desktop vs CLI

Mitigation:

- Keep CLI output separate from Electron renderer/preload.
- Mark native dependencies external.
- Add smoke test that invokes built CLI with `node out/cli/index.js --help`.

---

## 6. **Implementation order**

### Phase 1 — CLI foundation and output contract

1. Add `src/cli/context.ts`, `errors.ts`, `output.ts`, and `parser.ts`.
2. Add `src/cli/index.ts` with `--help`, `--version`, and placeholder command dispatch.
3. Update `package.json` and TypeScript/build config for CLI.
4. Add tests:
   - parser global flags;
   - JSON envelope;
   - NDJSON event formatting;
   - exit code mapping.

Done criteria:

- `mercury --help` works from built output.
- `npm run typecheck` passes.
- CLI output tests pass.

### Phase 2 — Extract shared service layer

1. Extract chat orchestration from `src/main/ipc/chat.ts` into `src/main/services/chat-service.ts`.
2. Extract config/gateway/knowledge/sessions/install/system/cron orchestration into service modules.
3. Refactor IPC handlers to call those services.
4. Run existing IPC/preload/runtime tests.

Done criteria:

- No behavior change for Electron UI.
- Existing tests pass:
  - `tests/ipc-handlers.test.ts`
  - `tests/preload-api-surface.test.ts`
  - `tests/chat-ipc-lifecycle.test.ts`
  - `tests/reliable-profile-runtime-contract.test.ts`

This phase should be landed before broad CLI command implementation.

### Phase 3 — Read-only CLI parity

Implement read/list/status commands first:

- `profiles/agents list`
- `sessions list/messages/search/cache list`
- `memory read`
- `soul read`
- `tools list`
- `skills installed/bundled/content/metadata`
- `models list`
- `credentials get`
- `cron list`
- `traces list/get/skill-runs`
- `runtime diagnostic`
- `connection get`
- `gateway status/platform list`
- `install status/verify`
- `hermes version/doctor`
- `logs read`
- `mcp list`
- `memory-providers list`
- `dump`

Done criteria:

- All commands support `--json`.
- SSH mode branches match IPC service behavior.
- Pure remote unsupported cases return exit `3`.

### Phase 4 — Mutating CRUD commands

Implement:

- profiles create/delete/use;
- env/config/model-config set;
- connection set/ssh set;
- gateway start/stop/restart/platform set;
- memory add/update/remove/user-profile write;
- soul write/reset;
- tools set;
- skills install/uninstall/import;
- models add/remove/update;
- credentials set;
- cron create/remove/pause/resume/run;
- backup/import.

Done criteria:

- Mutations mark runtime stale or restart/revalidate exactly like current IPC behavior.
- Skill import warnings are exposed in JSON.
- Existing domain tests plus new CLI command tests pass.

### Phase 5 — Chat and streaming automation

Implement:

- `chat send`
- `chat title`
- stdin input support
- history file support
- text streaming
- `--json` final result
- `--ndjson` streaming events
- SIGINT abort/finalize behavior

Done criteria:

- Chat command mirrors IPC trace/session side effects.
- NDJSON stream includes start/chunk/trace/tool/usage/done/error.
- Local, SSH, synthetic-chat, and pure remote failure paths are tested.

### Phase 6 — Install/progress-heavy commands and Claw3D parity

Implement:

- `install start`
- `hermes update`
- `claw migrate`
- `ssh tunnel start/status/stop`
- `claw3d *`

Done criteria:

- Progress callbacks emit text or NDJSON.
- SSH update sequence revalidates runtime.
- Claw3D command parity matches current `HermesAPI`.

### Phase 7 — Documentation, parity guardrails, delegation hardening

1. Add `docs/contracts/cli.md`.
2. Update `docs/contracts/ipc-preload.md`.
3. Update connection/storage docs with CLI notes.
4. Add a CLI parity test that compares command coverage against grouped `HermesAPI` domains.
5. Add examples for AI agents:
   - chat with NDJSON;
   - inspect runtime;
   - list sessions and get messages;
   - mutate memory/SOUL;
   - import skill;
   - manage cron.

Done criteria:

- Docs cover every command and output mode.
- Tests fail when a new IPC/preload domain is added without CLI parity decision.
- Implementation is ready for delegation across command-domain agents.

---

## Orchestrator progress

- [x] Item 1 — CLI foundation and output contract. Completed by session `F107CE02-F6A8-46EB-838D-7A3783B1A3A8`. Reported validation: `npm run test:cli`, `npm run typecheck`, `npm run build:cli && ./out/cli/index.js --help` all passed. Spot-check confirmed `src/cli/*` scaffold and `package.json` CLI wiring.
- [x] Item 2 — Extract shared non-Electron service layer and refactor IPC adapters. Completed by session `2FD5194D-F544-4546-B81C-8889108A1528`. Reported validation: `npm run typecheck`, focused IPC/preload/runtime/chat/cron vitest suite, and `npm run test:cli` all passed. Spot-check confirmed `src/main/services/*` and slim IPC adapters.
- [x] Item 3 — Implement read-only CLI parity commands. Completed by session `0D955A09-0535-4210-AAA3-129D53A6AD66`. Reported validation: `npm run test:cli`, `npm run typecheck`, and focused `tests/cli-read-only-commands.test.ts` passed. Spot-check confirmed `dispatchReadOnlyCommand` wiring and read-only service use.
- [x] Item 4 — Implement mutating CRUD/runtime/install/progress commands. Completed by session `BB5F726A-21DC-47AF-B549-509F752AD303`. Reported validation: `npm run test:cli` and `npm run typecheck` passed. Spot-check confirmed `mutating-commands.ts`, NDJSON done events, and representative temp-home mutation tests.
- [x] Item 5 — Implement chat streaming automation and CLI docs/parity guardrails. Completed by session `3DA4F7C7-2C01-480A-AFA8-1A98E8668E27`. Reported validation: `npm run test:cli`, `npm run test -- tests/docs-guard.test.ts`, `npm run typecheck`, and `npm run check:docs` passed. Spot-check confirmed `chat-commands.ts`, `docs/contracts/cli.md`, and CLI parity guardrails.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "mercury-cli-E9F0A0", new_chat: false)
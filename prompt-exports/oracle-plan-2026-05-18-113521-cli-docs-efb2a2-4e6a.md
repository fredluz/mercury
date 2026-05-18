## Final Prompt
<taskname="CLI Docs"/>
<task>Add comprehensive documentation for the new fully CLI-driven Mercury work. The user explicitly asked for docs comparable in coverage to the implementation ("1 line of docs per 1 line of code"), so this should be a substantial documentation pass, not a short overview. Focus on documentation and docs guardrails only; do not change CLI/service behavior unless a docs guard mapping must be adjusted to keep new evergreen docs enforceable.</task>

<prior_prompt_provenance>
The previous planning prompt is preserved verbatim for context only. Do not execute it as the current task; the CLI implementation it planned now exists and needs documentation.

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
</prior_prompt_provenance>

<architecture>
Mercury now has a Node CLI entrypoint in `src/cli/index.ts` exposed by `package.json` as `bin.mercury` and built by `npm run build:cli` via `tsconfig.cli.json`. CLI parsing/context/output/errors live in `src/cli/parser.ts`, `context.ts`, `output.ts`, and `errors.ts`; command domains are split across `chat-commands.ts`, `read-only-commands.ts`, and `mutating-commands.ts`.

The implementation extracts non-Electron orchestration into `src/main/services/*`. IPC modules in `src/main/ipc/*` now also delegate to these services, so docs should explain the shared service boundary: renderer/preload and CLI are adapters over the same main-process domain services where possible.

The CLI is intended for automation-first use: stable JSON envelopes, NDJSON streaming/progress events, exit codes, global profile/output flags, environment defaults, and local/SSH/remote mode behavior. Existing `window.hermesAPI` parity remains the reference surface in `src/preload/index.d.ts` and `docs/contracts/ipc-preload.md`.
</architecture>

<selected_context>
README.md: user-facing project overview currently lacks substantial CLI installation/usage/automation guidance; update if CLI should be discoverable from the root docs.
docs/index.md: evergreen docs entrypoint; add CLI docs links if creating or expanding CLI reference pages.
docs/contracts/cli.md: concise current CLI contract; primary candidate for expansion into command reference, output contract, examples, parity matrix, limitations, and operational guidance.
docs/contracts/ipc-preload.md: renderer API parity reference; useful for explaining CLI parity/migration from IPC-only access.
docs/contracts/trace-schema.md and docs/subsystems/chat-and-tracing.md: trace/chat semantics that CLI `chat send`, NDJSON `trace` events, and local trace limitations should align with.
docs/subsystems/connection-modes.md: local vs SSH vs pure remote behavior; expand with CLI profile/mode consequences and fail-closed remote profile-bound execution.
docs/subsystems/storage-and-profiles.md: profile-scoped files and data stores; expand with CLI profile flag/env precedence and CRUD effects.
docs/subsystems/skills.md: skill install/import/local/SSH behavior; expand with CLI skill commands if needed.
docs/architecture/overview.md: process-boundary architecture; add CLI adapter and shared services as first-class architecture if desired.
docs/testing/contract-tests.md: contract test map; expand CLI suite responsibilities and docs guard expectations.
scripts/check-docs.mjs and tests/docs-guard.test.ts: docs guard rule currently maps `src/cli/**` and `tests/cli-*.test.ts` to `docs/contracts/cli.md` and `docs/testing/contract-tests.md`; update only if new evergreen CLI docs need to satisfy future guard checks.
src/cli/*: full CLI implementation for global flags, parsing, error/exit contract, output formats, read-only/mutating domains, chat send/title streaming, history/message file handling, SIGINT abort.
src/main/services/*: shared non-Electron service layer for chat, config/connection, gateway, install/update, knowledge, models/credentials, sessions/profiles/cache, cron, runtime/system/logs/MCP/memory providers.
src/main/ipc/* and src/preload/index.d.ts: IPC/preload parity and current renderer-facing method surface.
src/shared/* selected: shared schemas for chat title validation, runtime diagnostics, skills import, and traces.
tests/cli-*.test.ts: executable contract for parser, envelopes, entrypoint, read-only/mutating routing, chat automation, and parity documentation.
package.json and tsconfig.cli.json: CLI bin/build/test/typecheck wiring and validation commands.
</selected_context>

<relationships>
- CLI adapter path: `package.json bin.mercury` -> `src/cli/index.ts` -> parser/context/output/error helpers -> domain dispatchers -> `src/main/services/*`.
- Chat automation path: `mercury chat send/title` -> `src/cli/chat-commands.ts` -> `chat-service.ts` -> runtime/gateway/SSH/trace/session-cache side effects; NDJSON emits `start`, `chunk`, `trace`, `tool`, `usage`, `done`, `error`.
- Parity path: renderer `window.hermesAPI` (`src/preload/index.d.ts`) -> IPC modules (`src/main/ipc/*`) -> shared services; CLI dispatchers should be documented as parallel adapters over those same services, with explicit deferred gaps.
- Data path: `--profile` / `MERCURY_PROFILE` flows through CLI context into service calls; services branch local vs SSH using connection config and preserve profile-scoped storage behavior documented in storage/connection docs.
- Guardrails: `tests/cli-parity.test.ts` reads `docs/contracts/cli.md` and requires major preload domains plus chat automation events to stay documented; `scripts/check-docs.mjs` requires CLI code/test changes to touch mapped CLI docs.
</relationships>

<documentation_targets>
Recommended edits/creations:
- Expand `docs/contracts/cli.md` substantially: install/build/run entrypoint, global flags/env precedence, output modes/envelopes, NDJSON events, exit codes, exhaustive command reference by domain, examples for humans and agents, local/SSH/remote behavior, profile semantics, parity matrix against preload domains, deferred limitations, and troubleshooting.
- Update `README.md` with a concise CLI discovery section and links to the expanded contract/reference.
- Update `docs/index.md` so the CLI reference is listed under evergreen contracts or a dedicated CLI section.
- Update `docs/architecture/overview.md` with CLI as a non-renderer adapter and `src/main/services/*` as the shared orchestration layer used by both IPC and CLI.
- Update `docs/subsystems/connection-modes.md`, `storage-and-profiles.md`, `chat-and-tracing.md`, and `skills.md` with CLI-specific behavior where the CLI materially changes how users/agents interact with those subsystems.
- Update `docs/testing/contract-tests.md` with fuller CLI suite responsibilities and when to run `npm run test:cli` / docs guard.
- Consider docs guard/test updates only if introducing a new evergreen path such as `docs/cli.md` or `docs/cli/*`; otherwise keep `docs/contracts/cli.md` as the guarded anchor.
</documentation_targets>

<validation>
Run or document these checks after docs edits:
- `npm run check:docs`
- `npm run test:cli` because `tests/cli-parity.test.ts` asserts `docs/contracts/cli.md` content
- If changing docs guard code or tests: `vitest run tests/docs-guard.test.ts` (or the repo's equivalent focused test command)
- If changing any TypeScript guard code, package scripts, or imports: `npm run typecheck:cli` or `npm run typecheck` as appropriate
</validation>

<ambiguities>
- The user asked for comprehensive docs, not a separate implementation plan; prefer writing docs over producing a plan unless the next agent is explicitly asked only to plan.
- It is not yet decided whether comprehensive CLI docs should live entirely in `docs/contracts/cli.md` or be split into a user guide plus contract reference. If splitting, update `docs/index.md` and consider expanding `scripts/check-docs.mjs` guard patterns.
- `prompt-exports/oracle-plan-2026-05-16-220934-mercury-cli-e9f0a0-70e5.md` exists but is not selected; use current source/tests/docs as the source of truth.
</ambiguities>

## Selection
- Files: 66 total (62 full, 4 codemap)
- Total tokens: 100678 (Auto view)
- Token breakdown: full 99089, codemap 1589

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── architecture/
│   │   └── overview.md — 2 862 tokens (full)
│   ├── contracts/
│   │   ├── cli.md — 2 276 tokens (full)
│   │   ├── ipc-preload.md — 4 578 tokens (full)
│   │   └── trace-schema.md — 3 571 tokens (full)
│   ├── subsystems/
│   │   ├── chat-and-tracing.md — 6 065 tokens (full)
│   │   ├── connection-modes.md — 3 859 tokens (full)
│   │   ├── skills.md — 3 168 tokens (full)
│   │   └── storage-and-profiles.md — 4 911 tokens (full)
│   ├── testing/
│   │   └── contract-tests.md — 6 873 tokens (full)
│   └── index.md — 1 037 tokens (full)
├── scripts/
│   └── check-docs.mjs — 3 517 tokens (full)
├── src/
│   ├── cli/
│   │   ├── chat-commands.ts — 2 789 tokens (full)
│   │   ├── context.ts — 391 tokens (full)
│   │   ├── errors.ts — 975 tokens (full)
│   │   ├── index.ts — 1 944 tokens (full)
│   │   ├── mutating-commands.ts — 6 161 tokens (full)
│   │   ├── output.ts — 631 tokens (full)
│   │   ├── parser.ts — 1 046 tokens (full)
│   │   └── read-only-commands.ts — 3 005 tokens (full)
│   ├── main/
│   │   ├── ipc/
│   │   │   ├── chat.ts — 1 015 tokens (full)
│   │   │   ├── claw3d.ts — 429 tokens (full)
│   │   │   ├── config.ts — 892 tokens (full)
│   │   │   ├── cron.ts — 363 tokens (full)
│   │   │   ├── gateway.ts — 386 tokens (full)
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   ├── install.ts — 483 tokens (full)
│   │   │   ├── knowledge.ts — 822 tokens (full)
│   │   │   ├── models.ts — 339 tokens (full)
│   │   │   ├── sessions.ts — 606 tokens (full)
│   │   │   ├── system.ts — 576 tokens (full)
│   │   │   ├── trace.ts — 167 tokens (full)
│   │   │   └── types.ts — 35 tokens (full)
│   │   └── services/
│   │       ├── chat-service.ts — 3 433 tokens (full)
│   │       ├── config-service.ts — 1 756 tokens (full)
│   │       ├── cron-service.ts — 386 tokens (full)
│   │       ├── gateway-service.ts — 862 tokens (full)
│   │       ├── install-service.ts — 879 tokens (full)
│   │       ├── knowledge-service.ts — 1 883 tokens (full)
│   │       ├── models-service.ts — 109 tokens (full)
│   │       ├── sessions-service.ts — 1 967 tokens (full)
│   │       └── system-service.ts — 509 tokens (full)
│   ├── preload/
│   │   ├── index.d.ts — 3 767 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   └── shared/
│       ├── chat-metadata.ts — 1 139 tokens (full)
│       ├── runtime.ts — 310 tokens (full)
│       ├── skills.ts — 264 tokens (full)
│       └── traces.ts — 417 tokens (full)
├── tests/
│   ├── cli-chat-commands.test.ts — 2 189 tokens (full)
│   ├── cli-entrypoint.test.ts — 361 tokens (full)
│   ├── cli-errors.test.ts — 274 tokens (full)
│   ├── cli-mutating-commands.test.ts — 2 344 tokens (full)
│   ├── cli-output-contract.test.ts — 460 tokens (full)
│   ├── cli-parity.test.ts — 710 tokens (full)
│   ├── cli-parser.test.ts — 432 tokens (full)
│   ├── cli-read-only-commands.test.ts — 1 938 tokens (full)
│   └── docs-guard.test.ts — 1 074 tokens (full)
├── README.md — 3 874 tokens (full)
├── package.json — 1 276 tokens (full)
├── tsconfig.cli.json — 102 tokens (full)
├── tsconfig.json — 28 tokens (full)
├── tsconfig.node.json — 70 tokens (full)
└── vitest.config.ts — 126 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── hermes/
    │   │   └── types.ts — 671 tokens (auto)
    │   └── install/
    │       └── paths.ts — 672 tokens (auto)
    └── shared/
        ├── i18n/
        │   └── types.ts — 43 tokens (auto)
        └── perf.ts — 203 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `cli-docs-EFB2A2` | **Mode**: plan

### Response
## 1. **Summary**

Add a substantial evergreen documentation pass for Mercury’s fully CLI-driven workflow, centered on expanding `docs/contracts/cli.md` into the authoritative automation contract and updating adjacent architecture, subsystem, README, index, testing, and docs-guard references so future CLI changes remain enforceably documented. This is best solved as a targeted documentation expansion plus a small docs-guard mapping adjustment only if a new CLI doc path is introduced; no CLI/service behavior should change because the implementation already exists and IPC/CLI adapters share `src/main/services/*`.

## 2. **Current-state analysis**

### Architecture and ownership today

Mercury now has three user-facing adapters over main-process capabilities:

1. **Renderer adapter**
   - `window.hermesAPI` typed in `src/preload/index.d.ts`.
   - Implemented by preload fragments under `src/preload/api/*`.
   - Routed through `src/main/ipc/*`.
2. **CLI adapter**
   - `package.json` exposes `bin.mercury: ./out/cli/index.js`.
   - `npm run build:cli` compiles `src/cli/**/*` through `tsconfig.cli.json`.
   - `src/cli/index.ts` parses entrypoint commands and dispatches to:
     - `src/cli/chat-commands.ts`
     - `src/cli/read-only-commands.ts`
     - `src/cli/mutating-commands.ts`
   - Shared CLI support:
     - `parser.ts`: global flag parsing.
     - `context.ts`: env/default context.
     - `output.ts`: JSON/NDJSON/text envelopes.
     - `errors.ts`: normalized CLI errors and stable exit codes.
3. **Shared main service layer**
   - `src/main/services/*` contains non-Electron orchestration reused by IPC and CLI.
   - IPC modules now mostly delegate to services instead of owning business behavior directly.

This means documentation must explain the service layer as the CLI/IPC parity seam, not duplicate renderer-only descriptions.

### CLI data/control flow

#### Entrypoint flow

```text
package.json bin.mercury
  → out/cli/index.js
  → src/cli/index.ts runCli(...)
  → parseCliArgs(...)
  → buildCliContext(...)
  → dispatchChatCommand(...)
     or dispatchReadOnlyCommand(...)
     or dispatchMutatingCommand(...)
  → src/main/services/*
```

Mutation and read commands pass `context.profile` from:

1. explicit command/global `--profile` / `-p`
2. `MERCURY_PROFILE`
3. undefined, which services normalize as default where applicable

Output mode comes from:

1. explicit `--json`, `--ndjson`, `--text`, `--table`
2. `MERCURY_OUTPUT`
3. default `"text"`

#### Chat flow

```text
mercury chat send/title
  → src/cli/chat-commands.ts
  → src/main/services/chat-service.ts
  → prepareChatBackend(...)
  → ProfileRuntimeManager.resolveRuntime(...)
  → src/main/hermes/gateway.ts sendMessage(...)
  → API / ssh-api / CLI transport
  → trace-store + session-cache side effects
  → CLI text/JSON/NDJSON output
```

Important existing behavior to document:

- `chat send` supports positional text, `--message`, stdin, `--resume`, and `--history-file`.
- `chat title` supports `--session`, `--messages-file`, `--history-file`, `--message`, positional text, and stdin.
- NDJSON stream event types are stable:
  - `"start"`
  - `"chunk"`
  - `"trace"`
  - `"tool"`
  - `"usage"`
  - `"done"`
  - `"error"`
  - `"progress"` for install/update progress commands through shared output type
- SIGINT aborts the active chat through `abortActiveChatRun(...)` and exits `130`.

#### Read-only and mutation command coverage

`src/cli/read-only-commands.ts` covers:

- `profiles list`, `agents list`
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
- `logs read`
- `mcp list`
- `memory-providers list`
- `dump`
- `connection get`
- `gateway status/platform list`
- `install status/verify`
- `hermes version/doctor`

`src/cli/mutating-commands.ts` covers:

- `profiles|agents create/delete/use`
- `sessions cache sync`, `sessions title set`
- `env set`
- `config set`
- `model-config set`
- `connection set`, `connection ssh set`
- `gateway start/stop/restart/platform set`
- `memory add/update/remove`
- `user-profile write`
- `soul write/reset`
- `tools set`
- `skills install/uninstall/import`
- `models add/remove/update`
- `credentials set`
- `cron create/remove/pause/resume/run`
- `backup run`
- `import run`
- `runtime revalidate`
- `install start`
- `hermes update`
- `claw migrate`
- `ssh tunnel status/start/stop`

Documentation currently lists these at a high level in `docs/contracts/cli.md`, but not at the level requested by the user.

### Existing docs and guardrails

Current relevant docs:

- `docs/contracts/cli.md`
  - concise CLI contract
  - already used by `tests/cli-parity.test.ts`
- `docs/contracts/ipc-preload.md`
  - renderer API and IPC contract
  - contains CLI parity note
- `docs/architecture/overview.md`
  - does not yet treat CLI as a first-class adapter in the process-boundary map
- `docs/subsystems/connection-modes.md`
  - has CLI notes for chat/title but not exhaustive command-domain consequences
- `docs/subsystems/storage-and-profiles.md`
  - has CLI storage parity but not command-by-command profile effects
- `docs/subsystems/chat-and-tracing.md`
  - explains renderer/IPC chat; needs CLI-specific stream/output section
- `docs/subsystems/skills.md`
  - explains IPC/preload skills; needs CLI command mapping
- `docs/testing/contract-tests.md`
  - already includes CLI contract tests, but should be expanded for this now-large CLI surface
- `README.md`
  - lacks substantial CLI discoverability and examples
- `docs/index.md`
  - does not currently list the CLI contract under Contracts

Current docs guard:

- `scripts/check-docs.mjs`
  - `cli-contract` maps `src/cli/**` and `tests/cli-*.test.ts` to:
    - `docs/contracts/cli.md`
    - `docs/testing/contract-tests.md`

This is sufficient if the expanded CLI docs remain in `docs/contracts/cli.md`. If adding `docs/cli.md` or `docs/cli/*`, update guard patterns and tests.

### Constraints

- Do **not** change runtime/service/CLI behavior.
- Do **not** introduce new public CLI commands in docs that are not implemented.
- Keep docs anchored to actual file names and tests.
- `tests/cli-parity.test.ts` requires:
  - major domains documented in `docs/contracts/cli.md` table with ``| `domain` ``
  - chat events documented as quoted strings like `"chunk"`
  - `mercury chat send`, `mercury chat title`, and `SIGINT` present
- Docs-only change should still run:
  - `npm run check:docs`
  - `npm run test:cli`

## 3. **Design**

### A. Expand `docs/contracts/cli.md` as the primary CLI reference

Keep `docs/contracts/cli.md` as the guarded anchor to avoid unnecessary docs-guard changes. Expand it from a concise contract into a long-form reference with these sections.

#### 1. Purpose and adapter architecture

Add an opening section explaining:

```text
CLI adapter → shared services → local/SSH/remote domain implementations
Renderer adapter → preload/IPC → same shared services
```

Specify that CLI does not import preload and does not require Electron.

Name source anchors:

- `package.json`
- `tsconfig.cli.json`
- `src/cli/index.ts`
- `src/cli/parser.ts`
- `src/cli/context.ts`
- `src/cli/output.ts`
- `src/cli/errors.ts`
- `src/cli/chat-commands.ts`
- `src/cli/read-only-commands.ts`
- `src/cli/mutating-commands.ts`
- `src/main/services/*`
- `docs/contracts/ipc-preload.md`

#### 2. Installation/build invocation

Document:

- packaged binary name: `mercury`
- source build:
  - `npm run build:cli`
  - full build includes CLI through `npm run build`
- local dev invocation expectations:
  - built output is `out/cli/index.js`
  - tests exercise `runCli(...)` directly
- `HERMES_HOME` is honored by shared services

Do **not** claim npm global install unless package publishing exists.

#### 3. Global flags and precedence

Document exact global flags from `helpText()` and parser:

- `-p`, `--profile <name>`, `--profile=name`
- `--json`
- `--ndjson`
- `--text`
- `--table`
- `--quiet`
- `--verbose`
- `--color auto|always|never`
- `--stream`
- `--raw`
- `--help`, `-h`
- `--version`, `-v`

Important nuance: global parser accepts global flags anywhere before/among command tokens in current parser, and command-specific parsers also accept domain options like `--profile`. Existing docs say “must appear before command domain”; adjust to actual behavior carefully:

- Prefer documenting recommended style:
  - global flags before domain
- Then document that many command parsers also accept command-local `--profile`.

Precedence:

```text
profile = command/global --profile or -p → MERCURY_PROFILE → default profile
output = explicit output flag → MERCURY_OUTPUT → text
HERMES_HOME = storage/runtime root used by services
```

#### 4. Output contract

Keep and expand:

- JSON success envelope shape:
  ```ts
  {
    ok: true;
    command: string;
    profile?: string;
    mode?: "local" | "remote" | "ssh";
    data: T;
    warnings?: Array<{ code: string; message: string }>;
  }
  ```
- JSON error envelope shape:
  ```ts
  {
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
- Text mode:
  - chat streams chunks directly
  - non-chat renders strings or JSON-like pretty data through `renderTextSuccess(...)`
  - `--quiet` suppresses nonessential text output
- NDJSON:
  - one JSON object per line
  - chat streaming events
  - progress events for install/update
  - final `done`

Clarify that `--table`, `--stream`, and `--raw` are currently accepted hints/reserved unless a command specifically uses them.

#### 5. Exit codes and error mapping

Expand current exit-code table with source mapping from `src/cli/errors.ts`:

- `0`: success
- `1`: generic runtime
- `2`: usage
- `3`: unsupported
- `4`: runtime verification
- `5`: install
- `6`: connection/SSH/tunnel
- `7`: not found
- `8`: validation
- `130`: interrupted

Also document examples:

- pure remote profile-bound chat → unsupported (`runtime-unsupported-remote-profile`) → exit `3`
- runtime profile mismatch → exit `4`
- SIGINT → exit `130`

#### 6. Exhaustive command reference

Replace the current compact taxonomy with a command reference organized by domain.

For every domain, include:

- implemented commands
- primary service module
- profile behavior
- local/SSH/remote notes
- output shape at a high level
- examples

Recommended structure:

```md
## Command reference

### `chat`

Source: `src/cli/chat-commands.ts`, `src/main/services/chat-service.ts`

#### `mercury chat send ...`
Usage...
Inputs...
Output...
Side effects...
Examples...

#### `mercury chat title ...`
...
```

Include these domains:

- `chat`
- `sessions`
- `profiles`
- `agents`
- `memory`
- `user-profile`
- `soul`
- `tools`
- `skills`
- `models`
- `credentials`
- `cron`
- `traces`
- `runtime`
- `gateway`
- `install`
- `hermes`
- `config`
- `env`
- `model-config`
- `connection`
- `ssh`
- `backup`
- `import`
- `logs`
- `mcp`
- `memory-providers`
- `dump`
- `claw`
- `claw3d` as reserved/deferred

For reserved/deferred, be precise:

- `claw migrate` exists through `domain === "claw"` and `action === "migrate"`.
- `claw3d` is reserved in entrypoint but not implemented; docs should say renderer Claw3D surface is deferred for CLI except `claw migrate`.

#### 7. Chat automation deep section

Expand chat docs beyond table:

- message input precedence:
  1. `--message`/`-m`
  2. positional text
  3. stdin when piped or `--stdin`
- history file format:
  ```json
  [{"role":"user","content":"Earlier"}]
  ```
  or
  ```json
  {"messages":[{"role":"user","content":"Earlier"}]}
  ```
- title message file roles:
  - `user`
  - `agent`
  - `assistant`
- NDJSON event sequence and shapes:
  ```ts
  { type: "start"; command: "chat send"; profile?: string; ts: number }
  { type: "chunk"; text: string; ts: number }
  { type: "trace"; event: TraceEvent; ts: number }
  { type: "tool"; text: string; ts: number }
  { type: "usage"; usage: TraceUsage; ts: number }
  { type: "done"; data: { response: string; sessionId?: string }; ts: number }
  { type: "error"; error: { code: string; message: string; details?: unknown }; ts: number }
  ```
- side effects:
  - trace run creation/persistence
  - session profile update on completion
  - title persistence on `chat title --session`
- SIGINT behavior
- local/SSH/remote runtime verification behavior

#### 8. Connection mode behavior

Document per mode:

- **Local**
  - storage under `HERMES_HOME`
  - chat may lazy-start gateway
  - runtime may use API or CLI fallback
- **SSH**
  - many services branch to `ssh*` helpers through service layer
  - chat/title ensure gateway/tunnel/key/runtime verification
  - `ssh tunnel start/status/stop` exposes tunnel controls
- **Pure remote HTTP**
  - connection config can be viewed/set
  - basic remote test exists in IPC but CLI test command is reserved/not implemented
  - profile-bound chat/title fail closed
  - filesystem-backed mutation commands may still call local services unless explicitly rejected by service behavior; document this as current parity with IPC, not remote filesystem support
  - Markdown skill import rejects pure remote

#### 9. Parity matrix against `window.hermesAPI`

Keep the domain table because tests rely on it, but enrich columns:

- Renderer/preload methods
- CLI command coverage
- Shared service module
- Notes/gaps

Example row shape:

```md
| `skills` | `listInstalledSkills`, `installSkill`, `importSkillMarkdown` | `skills installed`, `skills install`, `skills import` | `knowledge-service.ts` | Pure remote Markdown import rejected; SSH supported. |
```

Ensure every domain in `tests/cli-parity.test.ts` remains present:

- `chat`
- `sessions`
- `profiles`
- `memory`
- `soul`
- `tools`
- `skills`
- `models`
- `credentials`
- `cron`
- `traces`
- `runtime`
- `gateway`
- `install`
- `hermes`
- `config`
- `env`
- `connection`
- `ssh`
- `system`

Also keep `agents`, `user-profile`, `model-config`, etc. as practical docs.

#### 10. Automation examples

Add examples for agents:

- list sessions as JSON
- search sessions
- resume chat with NDJSON
- update memory from file
- switch active agent
- import skill markdown
- set gateway platform
- run cron job
- inspect runtime diagnostic
- SSH tunnel start then chat
- backup/import

#### 11. Troubleshooting

Add short but concrete entries:

- “Unsupported in remote mode”
- “Runtime profile mismatch/unverified”
- “No chat output in JSON until final”
- “NDJSON parser guidance”
- “History/messages file parse errors”
- “SIGINT handling”
- “SSH tunnel/gateway failures”
- “Command reserved but unsupported”

### B. Update `README.md`

Add a concise but discoverable section, not a duplicate reference.

Recommended location: after “Development” or after “Features”.

Content:

- “Mercury CLI” heading
- State binary is `mercury`
- Mention automation-first access without Electron
- Examples:
  ```bash
  mercury --json sessions list
  mercury --ndjson chat send "Summarize recent work"
  mercury --profile work memory read --json
  mercury runtime diagnostic --json
  ```
- Link to `docs/contracts/cli.md`
- Mention `npm run build:cli` for source builds

### C. Update `docs/index.md`

Under Contracts, add:

- `[CLI contract](contracts/cli.md)` — Node CLI entrypoint, command reference, output envelopes, exit codes, automation behavior, and parity with `window.hermesAPI`.

Potentially also mention it in “How future agents should use these docs”:

- Read CLI contract before changing `src/cli/**` or CLI-facing services.

### D. Update `docs/architecture/overview.md`

Modify process boundaries to include CLI as a first-class boundary.

Current list has four boundaries. Change to five or add CLI under main/shared adapters.

Suggested design:

1. Main process
2. Preload bridge
3. Renderer app
4. CLI adapter
5. Shared contracts

CLI adapter section must specify:

- `src/cli/index.ts` is Node-only and does not launch Electron.
- CLI dispatches into `src/main/services/*`.
- CLI output/error contracts live in `src/cli/output.ts` and `src/cli/errors.ts`.
- Chat uses same `chat-service.ts` as IPC.

Update responsibility map with:

| CLI entrypoint, parsing, output | `src/cli/*` |
| Shared CLI/IPC orchestration | `src/main/services/*` |

Update change guidance:

- CLI behavior changes must update `docs/contracts/cli.md` and run `npm run test:cli`.

### E. Update `docs/contracts/ipc-preload.md`

Add or expand CLI parity note:

- IPC/preload remains renderer contract.
- CLI is parallel, not layered on preload.
- Both IPC and CLI should call shared services.
- New renderer-visible capability should make explicit CLI parity decision:
  - expose in CLI now
  - reserve/defer with documentation
  - Electron-only with rationale

Add `docs/contracts/cli.md` to related docs/source anchors.

### F. Update `docs/subsystems/connection-modes.md`

Expand CLI notes in each mode.

Add a dedicated “CLI behavior by connection mode” section:

- command mode metadata is attached best-effort through `getConnection()`
- local chat/title same as IPC
- SSH chat/title same preparation sequence
- `mercury ssh tunnel status|start|stop`
- pure remote profile-bound chat/title fail closed
- pure remote filesystem-backed capabilities remain constrained by current service behavior; do not document them as remote operations unless service actually routes remote

Clarify that CLI `connection set` and `connection ssh set` mutate `desktop.json` through `config-service.ts` and mark runtimes stale.

### G. Update `docs/subsystems/storage-and-profiles.md`

Expand CLI storage parity into concrete profile semantics.

Add:

- `--profile` / `MERCURY_PROFILE` precedence.
- `profiles` and `agents` command aliases.
- CLI mutations use same profile storage:
  - memory
  - user-profile
  - soul
  - tools
  - skills
  - sessions title/cache
  - cron
  - env/config/model-config
- Mention mutations mark runtime stale through services where applicable.
- Note models/credentials mutations currently use local storage, matching IPC behavior.

### H. Update `docs/subsystems/chat-and-tracing.md`

Add a CLI chat automation section adjacent to existing main send-message flow.

Cover:

- `mercury chat send` uses `chat-service.ts`, not IPC.
- NDJSON event mapping to callbacks:
  - `onChunk` → `"chunk"`
  - `onLiveTraceEvent` → `"trace"`
  - `onToolProgress` → `"tool"`
  - `onUsage` → `"usage"`
  - completion → `"done"`
  - errors → `"error"`
- Text mode streams chunks to stdout.
- JSON mode suppresses chunks and emits final envelope.
- SIGINT abort behavior.
- Trace/session side effects are the same as IPC path.

### I. Update `docs/subsystems/skills.md`

Add CLI command mapping:

- `skills installed`
- `skills bundled`
- `skills content <path>`
- `skills metadata <path>`
- `skills install <identifier>`
- `skills uninstall <name>`
- `skills import --file <path> [--name ...] [--category ...] [--description ...] [--overwrite]`

Document:

- CLI uses `knowledge-service.ts`.
- Local/SSH/pure-remote behavior matches IPC.
- Import returns same `SkillMarkdownImportResult`.
- Gateway restart warnings may appear in JSON `data.warning` as part of service result, not necessarily CLI envelope `warnings`.

### J. Update `docs/testing/contract-tests.md`

Expand CLI contract tests section.

Include per-test responsibilities:

- `tests/cli-parser.test.ts`
  - global flags, env defaults, usage errors
- `tests/cli-output-contract.test.ts`
  - JSON envelopes and NDJSON event formatting
- `tests/cli-errors.test.ts`
  - exit code mapping
- `tests/cli-entrypoint.test.ts`
  - help/version/reserved domain errors
- `tests/cli-read-only-commands.test.ts`
  - shared service routing for read commands
- `tests/cli-mutating-commands.test.ts`
  - mutation commands and filesystem effects
- `tests/cli-chat-commands.test.ts`
  - chat send/title, NDJSON, text streaming, JSON final-only, SIGINT
- `tests/cli-parity.test.ts`
  - domain reservation and docs coverage

Update “When to run”:

- Run `npm run test:cli` when changing:
  - `src/cli/**`
  - `src/main/services/**` behavior consumed by CLI
  - `docs/contracts/cli.md`
  - CLI docs guard rules
  - IPC/preload parity decisions that affect CLI

Add docs guard note:

- `scripts/check-docs.mjs` `cli-contract` rule requires CLI source/test changes to update `docs/contracts/cli.md` or `docs/testing/contract-tests.md`.

### K. Docs guard decision

#### Preferred: no new CLI doc path

If all comprehensive docs live in `docs/contracts/cli.md`, do **not** change:

- `scripts/check-docs.mjs`
- `tests/docs-guard.test.ts`

Rationale: existing guard already enforces the correct evergreen anchor and `tests/cli-parity.test.ts` reads that file directly.

#### Alternative: if adding `docs/cli.md` or `docs/cli/*`

Only then update:

`script/check-docs.mjs`:

```js
{
  id: "cli-contract",
  codePatterns: ["src/cli/**", "tests/cli-*.test.ts"],
  docPatterns: [
    "docs/contracts/cli.md",
    "docs/cli.md",
    "docs/cli/**",
    "docs/testing/contract-tests.md"
  ],
}
```

Update `tests/docs-guard.test.ts` to add a case proving the new CLI doc path satisfies `cli-contract`.

Still keep `docs/contracts/cli.md` updated enough for `tests/cli-parity.test.ts`.

## 4. **File-by-file impact**

### `docs/contracts/cli.md`

**What changes**

- Expand into comprehensive CLI contract/reference.
- Add source anchors.
- Add architecture adapter description.
- Add global flags/env precedence.
- Add output, NDJSON, error, and exit-code contracts.
- Add exhaustive command reference.
- Add chat automation deep section.
- Add connection-mode behavior.
- Add parity matrix.
- Add examples and troubleshooting.

**Why**

Primary documentation target requested by user; already guarded by CLI tests and docs guard.

**Dependencies**

Must remain compatible with `tests/cli-parity.test.ts` string expectations.

---

### `README.md`

**What changes**

- Add concise “Mercury CLI” discovery section.
- Include build/use examples and link to `docs/contracts/cli.md`.

**Why**

User-facing entrypoint currently doesn’t surface the new CLI-driven workflow adequately.

**Dependencies**

None.

---

### `docs/index.md`

**What changes**

- Add CLI contract to Evergreen Contracts.
- Optionally mention CLI docs in future-agent guidance.

**Why**

Makes the comprehensive CLI reference discoverable.

**Dependencies**

If a new doc path is introduced, index must link it; otherwise link `contracts/cli.md`.

---

### `docs/architecture/overview.md`

**What changes**

- Add CLI as a process/adapter boundary.
- Add shared service layer ownership.
- Add CLI to responsibility map and change guidance.

**Why**

Architecture currently describes Electron boundaries but not the Node CLI adapter or shared service extraction.

**Dependencies**

Should reference `src/cli/*`, `src/main/services/*`, and `docs/contracts/cli.md`.

---

### `docs/contracts/ipc-preload.md`

**What changes**

- Expand CLI parity notes.
- Clarify CLI is parallel to IPC/preload and should reuse shared services.
- Add CLI parity decision to change rules.

**Why**

IPC/preload remains the renderer contract, but future renderer APIs must account for CLI parity.

**Dependencies**

Cross-link to `docs/contracts/cli.md`.

---

### `docs/subsystems/connection-modes.md`

**What changes**

- Add CLI-specific connection-mode behavior section.
- Document `connection set`, `connection ssh set`, `ssh tunnel *`, local/SSH/remote chat behavior, and fail-closed pure remote profile execution.

**Why**

CLI commands interact directly with connection mode and runtime verification.

**Dependencies**

Must not overclaim pure remote support beyond current service behavior.

---

### `docs/subsystems/storage-and-profiles.md`

**What changes**

- Expand CLI storage parity and profile selection.
- Document agent/profile alias and profile-scoped mutation effects.
- Mention local model/credential mutation parity.

**Why**

CLI is a major new way to mutate profile-backed data.

**Dependencies**

Use actual service behavior from `sessions-service.ts`, `knowledge-service.ts`, `config-service.ts`, `models-service.ts`.

---

### `docs/subsystems/chat-and-tracing.md`

**What changes**

- Add CLI chat flow and NDJSON mapping.
- Document text vs JSON vs NDJSON chat behavior and SIGINT abort.
- Link to CLI contract.

**Why**

CLI chat reuses core chat service and trace lifecycle but has adapter-specific output behavior.

**Dependencies**

Must align with `src/cli/chat-commands.ts` and `src/main/services/chat-service.ts`.

---

### `docs/subsystems/skills.md`

**What changes**

- Add CLI skill command reference and mode behavior note.
- Explain CLI import uses same shared request/result contract.

**Why**

Skills are a notable CRUD/import surface for autonomous agents.

**Dependencies**

Must align with `knowledge-service.ts` and `mutating-commands.ts`.

---

### `docs/testing/contract-tests.md`

**What changes**

- Expand CLI test responsibilities.
- Update run guidance for `npm run test:cli`.
- Mention docs guard CLI mapping.

**Why**

The CLI suite is now a first-class contract suite.

**Dependencies**

Should reference all `tests/cli-*.test.ts`.

---

### `scripts/check-docs.mjs` — conditional

**What changes**

- No change if using `docs/contracts/cli.md` as the comprehensive doc.
- If adding `docs/cli.md` or `docs/cli/**`, add those paths to `cli-contract.docPatterns`.

**Why**

Only needed if future CLI docs live outside currently guarded docs.

**Dependencies**

Any change requires updating `tests/docs-guard.test.ts`.

---

### `tests/docs-guard.test.ts` — conditional

**What changes**

- No change unless `scripts/check-docs.mjs` changes.
- If guard expands, add a test that `docs/cli.md` or `docs/cli/reference.md` satisfies CLI code changes.

**Why**

Docs guard tests cover exported evaluator behavior.

**Dependencies**

Must be atomic with guard mapping change.

## 5. **Risks and migration**

### Risk: docs overclaim unsupported CLI parity

Mitigation:

- For each command, verify against `src/cli/read-only-commands.ts`, `src/cli/mutating-commands.ts`, and `src/cli/chat-commands.ts`.
- Use “reserved/deferred” for unsupported domains, especially `claw3d`.
- Document pure remote profile execution as fail-closed.

### Risk: docs guard no longer enforces the main CLI reference

Mitigation:

- Prefer keeping comprehensive docs in `docs/contracts/cli.md`.
- If splitting docs, update `scripts/check-docs.mjs` and `tests/docs-guard.test.ts` atomically.

### Risk: `tests/cli-parity.test.ts` fails due to wording changes

Mitigation:

- Preserve:
  - a table row containing each domain as ``| `domain` ``
  - quoted event strings `"start"`, `"chunk"`, `"trace"`, `"tool"`, `"usage"`, `"done"`, `"error"`
  - literal phrases `mercury chat send`, `mercury chat title`, and `SIGINT`

## 6. **Implementation order**

1. **Expand `docs/contracts/cli.md` first**
   - Add full command reference, output contracts, examples, parity matrix, mode behavior, and troubleshooting.
   - Keep existing required test sentinel strings.

2. **Update discoverability docs**
   - Update `README.md`.
   - Update `docs/index.md`.

3. **Update architecture and IPC parity docs**
   - Update `docs/architecture/overview.md`.
   - Update `docs/contracts/ipc-preload.md`.

4. **Update subsystem docs**
   - `docs/subsystems/connection-modes.md`
   - `docs/subsystems/storage-and-profiles.md`
   - `docs/subsystems/chat-and-tracing.md`
   - `docs/subsystems/skills.md`

5. **Update testing docs**
   - Expand CLI suite details in `docs/testing/contract-tests.md`.

6. **Only if a new CLI doc path is created**
   - Update `scripts/check-docs.mjs`.
   - Update `tests/docs-guard.test.ts`.
   - Land these two changes atomically.

7. **Validate**
   - Run:
     ```bash
     npm run check:docs
     npm run test:cli
     ```
   - If docs guard code changed:
     ```bash
     npm run test -- tests/docs-guard.test.ts
     ```
   - If any TypeScript files changed unexpectedly:
     ```bash
     npm run typecheck:cli
     ```

---

## Orchestrator progress

- [x] Item 1 — Expand `docs/contracts/cli.md` into the exhaustive CLI reference/contract: architecture, global flags, output/NDJSON/error/exit contracts, command reference, chat automation, connection modes, parity matrix, automation examples, troubleshooting. Completed by session `42A500D6-0840-4D11-9EB6-71E30711CC3A`; reported `npm run test:cli` and `npm run check:docs` passed. Spot-check confirmed 1,621-line contract reference with source anchors, command grammar, output contracts, NDJSON events, and domain reference.
- [x] Item 2 — Update adjacent docs and discoverability: `README.md`, `docs/index.md`, `docs/architecture/overview.md`, `docs/contracts/ipc-preload.md`, subsystem docs, and `docs/testing/contract-tests.md`; keep docs guard changes minimal unless new doc paths are introduced. Completed by session `6AB7749B-B086-4446-B9B4-5D227D601115`; reported `npm run check:docs` and `npm run test:cli` passed. Spot-check confirmed README discovery, docs index link, architecture CLI adapter/shared services section, and adjacent docs diff.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "cli-docs-EFB2A2", new_chat: false)
# Mercury Architecture Map

Boundary and control-flow map for agents changing Mercury. Pair this with [Code map](code-map.md) when choosing files.

## System Shape

```text
React renderer
  src/renderer/src/*
  calls window.hermesAPI only
        |
        v
Preload bridge
  src/preload/index.ts
  src/preload/api/*.ts
  src/preload/index.d.ts
        |
        v
Electron main IPC
  src/main/ipc/*.ts
  thin adapters and event fanout
        |
        v
Shared main services
  src/main/services/*.ts
  adapter-neutral domain orchestration
        |
        +----------------------+-----------------------+
        |                      |                       |
        v                      v                       v
Hermes runtime/BFF       Local storage/processes     SSH helpers
src/main/hermes/*        ~/.hermes, desktop files     src/main/ssh*
src/main/hermes/bff/*    gateway child processes      ssh process/tunnel
```

Parallel CLI adapter:

```text
Node CLI
  package.json bin.mercury
  src/cli/index.ts
        |
        v
parser/context/output/errors + command dispatchers
  src/cli/*.ts
        |
        v
Shared main services
  src/main/services/*.ts
```

## Durable Boundaries

| Boundary | Owns | Must not own |
| --- | --- | --- |
| Renderer | UI state, screen routing, local visual state, calls to `window.hermesAPI` | Filesystem/process access, Hermes API credentials, direct `src/main/*` imports |
| Preload | Stable renderer contract and listener cleanup wrappers | Domain logic, arbitrary Hermes proxying |
| Main IPC | Channel registration, argument validation, event fanout, adapter glue | Long domain workflows that CLI also needs |
| Main services | Shared domain workflows, local/SSH/remote branching, runtime verification use, persistence side effects | Renderer state, CLI formatting, IPC event channels |
| Hermes runtime manager | Profile-bound runtime identity, local/SSH verification, diagnostics, fail-closed remote HTTP behavior | UI routing, command-line parsing |
| Hermes BFF clients | Typed calls to verified Hermes API surfaces | Accepting arbitrary renderer-controlled paths or tokens |
| CLI | Command grammar, output envelopes, streaming events, exit codes, SIGINT | Electron/preload behavior, renderer-only UI concerns |
| Shared contracts | Cross-process data shapes | Process-specific behavior |

## Named Seams

| Seam | Files | Contract |
| --- | --- | --- |
| Renderer to Mercury main | `src/preload/index.d.ts`, `src/preload/api/*`, `src/main/ipc/*` | `window.hermesAPI`; update preload, d.ts, IPC, docs, and tests together |
| IPC/CLI to shared services | `src/main/ipc/*`, `src/cli/*`, `src/main/services/*` | IPC and CLI share domain behavior through service functions |
| Mercury to Hermes runtime | `src/main/hermes/runtime/*`, `src/main/hermes/types.ts` | Runtime must be verified for profile-bound execution; pure remote HTTP fails closed |
| Mercury to Hermes Gateway BFF | `src/main/hermes/bff/*` | Internal main-only typed client built from a verified runtime handle |
| Local process boundary | `src/main/hermes/runtime/local-runtime.ts`, `src/main/hermes/gateway.ts`, `src/main/install/*` | Mercury starts/manages profile-specific gateway processes and verifies process/PID/API identity |
| SSH boundary | `src/main/ssh-tunnel.ts`, `src/main/ssh/*`, `src/main/hermes/runtime/ssh-runtime.ts` | SSH mode verifies profile-bound remote runtime through tunnel and remote API key |
| Mercury-owned data | `src/main/trace-store.ts`, `src/main/config.ts`, `src/main/session-cache.ts` | Desktop connection state, traces, and cache are Mercury-owned |
| Hermes-owned data | `src/main/memory.ts`, `src/main/soul.ts`, `src/main/tools.ts`, `src/main/skills.ts`, `src/main/sessions.ts` | Skills, memory, SOUL, config, sessions live in Hermes profile storage |

## Startup Flow

```text
src/main/index.ts
  app.whenReady()
    set Mercury/Mercury Nightly app identity
    watch window shortcuts
    build native menu
    registerIpcHandlers({ getMainWindow })
    create BrowserWindow with preload ../preload/index.js
    setup updater IPC/event behavior
    if connection mode is SSH:
      check/start remote gateway
      start SSH tunnel
      read/cache remote API key

renderer App.tsx
  splash
    getConnectionConfig()
      SSH -> startSshTunnel() -> main or welcome with error
      remote HTTP -> testRemoteConnection() -> main or welcome
      local -> checkInstall() -> welcome/setup/main
    after main/setup in local mode -> background verifyInstall()

renderer Layout.tsx
  mount shell
  poll isRemoteOnlyMode() and getRuntimeDiagnostic(activeProfile)
  lazy-mount tabs, keep visited tabs mounted
  listen for menu and updater events
```

## Chat Control Flow

```text
Chat UI
  src/renderer/src/screens/Chat/*
  useChatController()
    local slash command?
      execute in renderer, optionally recordLocalChatTrace()
    normal message?
      window.hermesAPI.sendMessage(message, profile, sessionId, history)
        |
        v
preload chatApi
  ipcRenderer.invoke("send-message", ...)
  subscribe to chat-chunk/chat-done/chat-error/chat-usage/chat-trace-event
        |
        v
main ipc/chat.ts
  registerChatIpc()
  runChatMessage(...callbacks that send renderer events...)
        |
        v
services/chat-service.ts
  abort previous active run
  create Mercury trace run
  prepareChatBackend(profile, "chat", sessionId)
  dispatch to Hermes API/BFF
  record trace events/usage
  update session cache/title metadata best-effort
        |
        v
Hermes runtime boundary
  local -> start/verify profile gateway
  SSH -> ensure tunnel/gateway/API key, verify runtime
  pure remote HTTP -> fail closed for profile-bound execution
        |
        v
Hermes Gateway API/BFF
  structured run/session events stream back through callbacks
```

The chat service is the shared seam for desktop and CLI. `src/cli/chat-commands.ts` calls the same service and maps callbacks to text/JSON/NDJSON output instead of IPC events.

## Runtime Verification Flow

```text
ProfileRuntimeManager.resolveRuntime({ profile, mode, purpose, sessionId })
  normalize profile
  mode from request or desktop connection config

  mode local:
    ensure local API server config
    start/track health polling
    verify Mercury-managed gateway evidence
    probe /health and /v1/capabilities
    return verified "api" handle or structured runtime error

  mode ssh:
    resolve profile-bound tunnel URL
    verify remote profile runtime over SSH
    probe capabilities through tunnel with cached API key
    return verified "ssh-api" handle or structured runtime error

  mode remote:
    create unverified external diagnostic identity
    throw runtime-unsupported-remote-profile
```

Important invariants:

- Chat/title/cron execution must not fall back to unverified CLI or old chat-completions paths.
- BFF clients are created only from verified API runtime handles.
- Runtime diagnostics must preserve profile identity, stale state, invalid auth, update-required, unsupported, mismatch, and unverified states for the renderer.

## Connection Modes

| Mode | Renderer behavior | Main/runtime behavior | CLI behavior |
| --- | --- | --- | --- |
| Local | Normal full UI; local install verification path active | Starts/manages local Hermes gateway per profile, verifies local API identity/capabilities | Same shared services; can start/verify gateway without Electron |
| Pure remote HTTP | Startup tests remote `/health`; filesystem-backed screens are gated by `RemoteNotice` | Profile-bound execution fails closed because profile identity is unverified | Connection config commands work; profile-bound execution fails closed |
| SSH | Full UI, not remote-only | Starts/checks remote gateway, local tunnel, remote API key, verified `ssh-api` runtime | Same SSH preparation through services |

See [Connection modes](../subsystems/connection-modes.md) for detailed behavior.

## IPC And Event Boundaries

Request/response calls use `ipcRenderer.invoke(...)` from preload fragments and `ipcMain.handle(...)` in main IPC modules.

Main-to-renderer event channels:

| Category | Channels | Producers |
| --- | --- | --- |
| Chat stream | `chat-chunk`, `chat-done`, `chat-tool-progress`, `chat-trace-event`, `chat-usage`, `chat-error` | `src/main/ipc/chat.ts` callbacks from `chat-service.ts` |
| Install progress | `install-progress` | `src/main/ipc/install.ts` |
| Updater | `update-available`, `update-download-progress`, `update-downloaded`, `update-not-available`, `update-error` | `src/main/index.ts` updater setup |
| Native menu | `menu-new-chat`, `menu-search-sessions` | `src/main/index.ts` menu handlers |

`src/preload/api/*` listener methods must return cleanup functions.

## State Management

| State | Owner | Files |
| --- | --- | --- |
| Top-level app screen | Renderer | `src/renderer/src/App.tsx` |
| Active view/sidebar/session/profile | Renderer | `src/renderer/src/screens/Layout/Layout.tsx` |
| Chat composer/messages/activity/run UI state | Renderer | `src/renderer/src/screens/Chat/hooks/*` |
| Runtime/process state | Main | `src/main/hermes/runtime/manager.ts`, `state.ts`, `src/main/hermes/gateway.ts`, `src/main/ssh-tunnel.ts` |
| Connection config | Mercury | `src/main/config.ts` writes `<HERMES_HOME>/desktop.json` |
| Traces | Mercury | `src/main/trace-store.ts` writes `desktop-traces.json` |
| Session cache | Mercury cache over Hermes source of truth | `src/main/session-cache.ts`, `src/main/services/sessions-service.ts` |
| Hermes profile data | Hermes | `src/main/memory.ts`, `soul.ts`, `skills.ts`, `tools.ts`, `config.ts`, `sessions.ts` |
| CLI context/output state | CLI adapter | `src/cli/context.ts`, `src/cli/output.ts` |

## Build Pipeline

```text
package.json
  npm run typecheck
    typecheck:node -> tsconfig.node.json
    typecheck:web  -> tsconfig.web.json
    typecheck:cli  -> tsconfig.cli.json

  npm run build:cli
    tsc -p tsconfig.cli.json
    chmod +x out/cli/index.js

  npm run build
    typecheck
    build:cli
    electron-vite build

  npm run build:main*
    build
    electron-builder for target platform
```

Electron main output starts at `out/main/index.js`; CLI output starts at `out/cli/index.js`; renderer output is built by electron-vite.

## Change Rules

When changing a boundary:

| Change | Update |
| --- | --- |
| New/changed renderer API | `src/preload/api/*`, `src/preload/index.d.ts`, `src/main/ipc/*`, `docs/contracts/ipc-preload.md`, relevant tests |
| New/changed CLI command | `src/cli/*`, shared service if applicable, `docs/contracts/cli.md`, `tests/cli-*.test.ts` |
| Runtime verification or connection behavior | `src/main/hermes/runtime/*`, `docs/subsystems/connection-modes.md`, runtime/connection tests |
| Chat streaming/trace behavior | `src/main/services/chat-service.ts`, `src/main/ipc/chat.ts`, renderer Chat hooks, `docs/subsystems/chat-and-tracing.md`, trace/chat tests |
| Storage/profile behavior | owning `src/main/*` module, `docs/subsystems/storage-and-profiles.md`, focused tests |
| New main service shared by CLI and IPC | `src/main/services/*`, IPC adapter, CLI adapter, code map/architecture docs if a new domain appears |

## Risky Boundaries

- `src/main/hermes/runtime/*`: small changes can accidentally allow unverified or wrong-profile execution.
- `src/main/services/chat-service.ts`: central path for desktop and CLI chat, traces, sessions, approvals, aborts, and title persistence.
- `src/preload/index.d.ts` vs `src/preload/api/*` vs `src/main/ipc/*`: drift breaks renderer type safety or runtime IPC.
- `src/main/ssh-tunnel.ts` plus `src/main/ssh/*`: must preserve profile-bound SSH tunnel identity and avoid leaking raw SSH errors/secrets.
- `src/main/services/*`: adapters share these; a fix for UI can silently change CLI behavior.
- `src/renderer/src/screens/Layout/Layout.tsx`: owns active profile, view mounting, remote gating, runtime diagnostic display, menu/updater behavior.

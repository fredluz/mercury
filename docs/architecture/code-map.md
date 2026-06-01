# Mercury Code Map

Agent-facing navigation map for Mercury's Electron/Vite/TypeScript desktop app and Node CLI. Use this when you need to find the right file before reading implementation detail.

## Map State

Current as of the source tree with `src/main/hermes/runtime/*`, `src/main/hermes/bff/*`, shared `src/main/services/*`, and the Node CLI under `src/cli/*`.

- Existing map before this file: `docs/architecture/overview.md`.
- State of existing overview: useful and mostly current for startup, preload/IPC, CLI, and renderer routing, but too broad to act as a file-finder and light on the split Hermes runtime/BFF modules.
- Missing before this file: a dedicated "where is X?" code map and a separate architecture boundary map.

## Top-Level Source Layout

| Path | Responsibility | Start here when... |
| --- | --- | --- |
| `src/main/` | Electron main process, Hermes process/runtime control, local/SSH file and process operations, IPC handlers, shared services | Changing anything privileged, filesystem-backed, process-backed, or IPC-handled |
| `src/preload/` | Safe renderer bridge exposed as `window.hermesAPI` | Adding/changing renderer-facing API methods or event listeners |
| `src/renderer/` | Vite/React UI | Changing screens, navigation, chat UI state, setup/onboarding, local rendering behavior |
| `src/cli/` | Node `mercury` CLI adapter over shared main services | Adding automation commands or fixing CLI output/errors |
| `src/shared/` | Cross-boundary types, schemas, i18n config, trace/runtime contracts | Changing data shapes used by more than one process |
| `tests/` | Vitest contract/unit/bench tests | Finding expected behavior for IPC, preload, CLI, runtime, traces, sessions |
| `docs/contracts/` | Stable API contracts | Changing `window.hermesAPI`, CLI, or trace schema |
| `docs/subsystems/` | Evergreen subsystem docs | Changing connection, chat, storage, skills, models, memory |

## Electron Main Process

### App Lifecycle

| File | Owns |
| --- | --- |
| `src/main/index.ts` | Electron app startup, `BrowserWindow`, native menu, updater IPC/events, startup telemetry, dev/prod renderer loading, SSH auto-start, shutdown cleanup |
| `src/main/perf/telemetry.ts` | Local opt-in startup/session telemetry persisted from main and renderer marks |

Startup flow lives in `app.whenReady()` in `src/main/index.ts`: set app name/user model id, install menu, register IPC handlers, create the window, set up updater handlers, optionally start SSH support, then handle activation.

Shutdown flow also lives in `src/main/index.ts`: `window-all-closed` stops gateways/tunnel before quitting on non-macOS, and `before-quit` stops polling, aborts active chat, stops gateways, and stops SSH tunnel.

### IPC Composition

| File | IPC domain |
| --- | --- |
| `src/main/ipc/index.ts` | Composition root; registers every IPC module and re-exports `abortActiveChat` |
| `src/main/ipc/install.ts` | Install, verify, Hermes version/doctor/update, migration/OpenClaw progress |
| `src/main/ipc/config.ts` | Env/config/model config, locale, connection mode, remote and SSH tests, tunnel controls |
| `src/main/ipc/chat.ts` | Chat send/abort/title/approval handlers and chat event fanout |
| `src/main/ipc/trace.ts` | Trace reads and local slash-command trace writes |
| `src/main/ipc/gateway.ts` | Gateway lifecycle and messaging platform toggles |
| `src/main/ipc/sessions.ts` | Sessions, profiles/agents, cache sync, session search |
| `src/main/ipc/knowledge.ts` | Memory, user profile, soul, tools, skills, Markdown skill import |
| `src/main/ipc/models.ts` | Codex auth recovery, credential pool, model inventory/CRUD |
| `src/main/ipc/cron.ts` | Cron/schedule job CRUD and lifecycle |
| `src/main/ipc/system.ts` | External URLs, runtime diagnostics, debug agent launch, backup/import/dump/logs/MCP/perf |
| `src/main/ipc/types.ts` | Shared IPC registration context |

Rule of thumb: IPC files should stay thin. Put domain behavior in `src/main/services/*` when the CLI should share it.

### Shared Main Services

These are the adapter-neutral service layer used by IPC and CLI.

| File | Owns |
| --- | --- |
| `src/main/services/chat-service.ts` | Chat orchestration, backend preparation, trace run creation/finalization, live trace callbacks, title generation, approval resolution, active-run abort |
| `src/main/services/config-service.ts` | Connection/config/env/model settings exposed to IPC and CLI |
| `src/main/services/install-service.ts` | Install, doctor, update, version, migration/OpenClaw service behavior |
| `src/main/services/knowledge-service.ts` | Memory, soul, tools, skills, import behavior across local/SSH/remote limits |
| `src/main/services/sessions-service.ts` | Session/profile list/read/search/cache behavior |
| `src/main/services/gateway-service.ts` | Gateway lifecycle and platform toggles |
| `src/main/services/models-service.ts` | Credential pool, model inventory, saved model CRUD |
| `src/main/services/hermes-model-inventory-service.ts` | Hermes provider/model inventory loading and fallback rules |
| `src/main/services/hermes-sessions-api.ts` | Hermes sessions API adapter and session projection helpers |
| `src/main/services/cron-service.ts` | Cron/schedule job operations and remote/local routing |
| `src/main/services/codex-auth-service.ts` | Codex device auth and app-server provider setup |
| `src/main/services/system-service.ts` | Runtime diagnostics/revalidation, debug agent, backup/import/dump/log/MCP/memory providers |
| `src/main/services/runtime-debug-service.ts` | Runtime debug-agent launch request handling |

### Hermes Boundary

| Path | Responsibility |
| --- | --- |
| `src/main/hermes.ts` | Compatibility facade for gateway/chat/config helpers used by older call sites |
| `src/main/hermes/gateway.ts` | Local gateway process helpers and chat dispatch into verified API runtimes |
| `src/main/hermes/chat-api.ts` | Chat API transport implementation |
| `src/main/hermes/runs-api.ts` | Run approval and runs API helpers |
| `src/main/hermes/title.ts` | Chat title generation/persistence helpers |
| `src/main/hermes/connection.ts` | Low-level API URL, auth header, capability probe, remote/SSH helpers |
| `src/main/hermes/runtime.ts` | Barrel plus singleton `profileRuntimeManager` |
| `src/main/hermes/runtime/*` | Profile runtime verification and state machine |
| `src/main/hermes/bff/*` | Internal typed Hermes Gateway BFF clients for runs, sessions, jobs, models, capabilities |
| `src/main/hermes/types.ts` | Runtime handles, callbacks, diagnostics, errors |
| `src/main/hermes/trace-events.ts` | Trace event extraction from Hermes output |
| `src/main/hermes/run-registry.ts` | Run registry helpers |
| `src/main/hermes/synthetic-chat.ts` | Test/synthetic chat stream switches |

Runtime module split:

| File | Owns |
| --- | --- |
| `runtime/manager.ts` | `ProfileRuntimeManager`: normalize profile, local/SSH/remote runtime resolution, lifecycle state, health polling |
| `runtime/local-runtime.ts` | Local process evidence, command args, API readiness, local auth |
| `runtime/ssh-runtime.ts` | SSH runtime resolution and verification integration |
| `runtime/api-runtime.ts` | Verified API handle assertions |
| `runtime/diagnostics.ts` | Runtime diagnostic construction |
| `runtime/identity.ts` | Local, SSH, remote, and diagnostic runtime identities |
| `runtime/profile.ts` | Profile normalization |
| `runtime/command.ts` | Hermes profile command argument construction |
| `runtime/state.ts` | Per-profile runtime state shape |

BFF module split:

| File | Owns |
| --- | --- |
| `bff/client.ts` | Authenticated JSON/SSE HTTP client over a verified runtime handle |
| `bff/runs.ts` | Runs submission/events/approval operations |
| `bff/sessions.ts` | Session resources |
| `bff/jobs.ts` | Schedule/cron remote job operations |
| `bff/models.ts` | Runtime model inventory |
| `bff/capabilities.ts` | Capability checks |
| `bff/diagnostics.ts` | BFF diagnostic records |
| `bff/errors.ts` | BFF error normalization |
| `bff/types.ts` | BFF request/response types |

### Local, SSH, Storage, and Domain Files

| File/Path | Owns |
| --- | --- |
| `src/main/config.ts` | `desktop.json`, connection config, env/config/model config read/write |
| `src/main/install/*` and `src/main/installer.ts` | Hermes install paths, introspection, maintenance/update policy, executor, installer |
| `src/main/ssh-tunnel.ts` | Local SSH port-forward process lifecycle and tunnel health |
| `src/main/ssh-remote.ts` | Compatibility re-exports for SSH domain helpers |
| `src/main/ssh/*` | Remote SSH config/runtime/sessions/skills/memory/transport implementations |
| `src/main/sessions.ts`, `src/main/session-db.ts`, `src/main/session-cache.ts` | Hermes session reads, SQLite access, Mercury cache/projection |
| `src/main/trace-store.ts` | Mercury-owned trace persistence in `desktop-traces.json` |
| `src/main/memory.ts`, `src/main/soul.ts`, `src/main/tools.ts`, `src/main/skills.ts`, `src/main/skills/importer.ts` | Hermes profile knowledge surfaces |
| `src/main/models.ts` | Saved/manual model config and credential pool |
| `src/main/cronjobs.ts` | Local cron job file behavior |
| `src/main/profiles.ts` | Hermes profile/agent list/create/delete |
| `src/main/migration/*` | Migration inventory and prompt generation |
| `src/main/locale.ts` | Locale persistence/helpers |
| `src/main/utils.ts` | Shared main-process path/profile utilities |

## Preload Bridge

| File | Owns |
| --- | --- |
| `src/preload/index.ts` | Exposes `electron` and `hermesAPI` into the renderer world |
| `src/preload/index.d.ts` | Renderer-facing `Window.hermesAPI` TypeScript contract |
| `src/preload/api/index.ts` | Composes preload fragments |
| `src/preload/api/install.ts` | Install/progress/version/update/migration/locale methods |
| `src/preload/api/config.ts` | Env/config/model config, connection mode, SSH methods |
| `src/preload/api/chat.ts` | Chat invoke methods and streaming listeners |
| `src/preload/api/navigation.ts` | Traces, gateway, sessions, profiles |
| `src/preload/api/knowledge.ts` | Memory, soul, tools, skills |
| `src/preload/api/models.ts` | Session cache/search, Codex auth, credential pool, models |
| `src/preload/api/app.ts` | Runtime diagnostics, updater/menu events, cron, backup/import/dump/logs/system/perf |

When adding renderer-facing behavior, update all three: preload fragment, `src/preload/index.d.ts`, and matching main IPC handler/service.

## Renderer

| File/Path | Responsibility |
| --- | --- |
| `src/renderer/src/main.tsx` | React entrypoint |
| `src/renderer/src/App.tsx` | Splash/welcome/install/setup/main routing and startup connection/install checks |
| `src/renderer/src/screens/Layout/Layout.tsx` | Main app shell, nav, active profile/agent, session state, remote gating, runtime diagnostics, updater/menu handling |
| `src/renderer/src/screens/Layout/ChatListSidebar.tsx` | Chat session sidebar |
| `src/renderer/src/screens/Layout/ChatAgentPicker.tsx` | Active agent/profile picker |
| `src/renderer/src/screens/Chat/Chat.tsx` | Chat screen composition |
| `src/renderer/src/screens/Chat/hooks/useChatController.ts` | Chat UI state coordinator |
| `src/renderer/src/screens/Chat/hooks/chatSendFlows.ts` | Message send flows and approval/quick ask handling |
| `src/renderer/src/screens/Chat/hooks/useChatIpcListeners.ts` | Chat stream event subscriptions |
| `src/renderer/src/screens/Chat/chatCommands.ts` | Local slash commands |
| `src/renderer/src/screens/Sessions/*` | Session list, cache hook, filtering utilities |
| `src/renderer/src/screens/TraceLab/*` | Trace Lab UI, helper functions, trace types |
| `src/renderer/src/screens/Agents/Agents.tsx` | Profile-backed agents UI |
| `src/renderer/src/screens/Providers/Providers.tsx` | Provider/model setup UI |
| `src/renderer/src/screens/Skills/Skills.tsx` | Skill browser/install UI |
| `src/renderer/src/screens/Soul/Soul.tsx` | Persona/SOUL editor |
| `src/renderer/src/screens/Memory/Memory.tsx` | Memory/user profile UI |
| `src/renderer/src/screens/Tools/Tools.tsx` | Toolset toggles |
| `src/renderer/src/screens/Schedules/*` | Schedule/cron UI and modals |
| `src/renderer/src/screens/Gateway/Gateway.tsx` | Messaging gateway UI |
| `src/renderer/src/screens/Settings/*` | Settings sections, logs, backup/import, network/system controls |
| `src/renderer/src/components/*` | Shared renderer components, i18n/theme/error/runtime notice |
| `src/renderer/src/constants/*` | UI constants for providers, gateway, theme, settings, install, i18n |
| `src/renderer/src/assets/styles/*` | Screen/component CSS |
| `src/renderer/src/perf.ts` | Renderer telemetry helper |

Renderer rule: call `window.hermesAPI`; do not import `src/main/*` or access Hermes credentials/endpoints directly.

## CLI

| File | Responsibility |
| --- | --- |
| `src/cli/index.ts` | Shebang entrypoint, help/version, dispatch order, reserved command domains, top-level error handling |
| `src/cli/parser.ts` | Global flag parser and command path parsing |
| `src/cli/context.ts` | CLI context, profile/output/env defaults, command naming |
| `src/cli/output.ts` | Text/JSON/NDJSON success/error formatting |
| `src/cli/errors.ts` | Normalized CLI errors and exit codes |
| `src/cli/chat-commands.ts` | `chat send`, `chat title`, streaming/SIGINT behavior |
| `src/cli/read-only-commands.ts` | Read/status/list/get/verify/doctor/inventory/prompt commands |
| `src/cli/mutating-commands.ts` | Set/create/update/remove/start/stop/install/import commands |
| `tsconfig.cli.json` | CLI TypeScript build target |
| `package.json` | `bin.mercury`, `build:cli`, `test:cli` |

CLI rule: keep parsing/output/exit-code behavior in `src/cli/*`; put shared domain behavior in `src/main/services/*`.

## Shared Contracts

| File/Path | Responsibility |
| --- | --- |
| `src/shared/runtime.ts` | Runtime diagnostic shape shared by main/preload/renderer |
| `src/shared/traces.ts` | Trace run/event schema and local trace requests |
| `src/shared/chat-metadata.ts` | Chat title/session metadata request shapes |
| `src/shared/chat-remediation.ts` | Chat remediation classification |
| `src/shared/codex-auth-recovery.ts` | Codex auth recovery metadata |
| `src/shared/models.ts` | Provider/model shared types |
| `src/shared/skills.ts` | Skill metadata shared types |
| `src/shared/schedules.ts` | Schedule/cron shared types |
| `src/shared/perf.ts` | Perf telemetry event shapes |
| `src/shared/i18n/*` | i18n config, types, and locale strings |

If a type crosses process boundaries, prefer adding or updating it in `src/shared/*` instead of duplicating it in renderer/main/CLI.

## Find X

| Task | Start with |
| --- | --- |
| Add a renderer button that calls main | `src/renderer/src/...`, `src/preload/api/*.ts`, `src/preload/index.d.ts`, `src/main/ipc/*.ts` |
| Add a CLI command for existing app behavior | `src/cli/*`, then the relevant `src/main/services/*` function |
| Fix chat streaming | `src/renderer/src/screens/Chat/hooks/useChatIpcListeners.ts`, `src/main/ipc/chat.ts`, `src/main/services/chat-service.ts`, `src/main/hermes/chat-api.ts`, `src/main/hermes/bff/runs.ts` |
| Fix runtime verification | `src/main/hermes/runtime/manager.ts`, `local-runtime.ts`, `ssh-runtime.ts`, `api-runtime.ts`, `diagnostics.ts` |
| Fix SSH behavior | `src/main/ssh-tunnel.ts`, `src/main/ssh/*`, `src/main/services/*` branch for the domain |
| Fix pure remote gating | `src/renderer/src/App.tsx`, `src/renderer/src/screens/Layout/Layout.tsx`, `src/main/hermes/runtime/manager.ts`, `src/main/services/*` |
| Fix session listing/search | `src/main/services/sessions-service.ts`, `src/main/sessions.ts`, `src/main/session-db.ts`, `src/main/session-cache.ts`, `src/renderer/src/screens/Sessions/*` |
| Fix model/provider inventory | `src/main/services/models-service.ts`, `src/main/services/hermes-model-inventory-service.ts`, `src/main/hermes/bff/models.ts`, `src/renderer/src/screens/Providers/Providers.tsx` |
| Fix skills/memory/soul/tools | `src/main/services/knowledge-service.ts`, `src/main/skills.ts`, `src/main/skills/importer.ts`, `src/main/memory.ts`, `src/main/soul.ts`, `src/main/tools.ts` |
| Fix schedules | `src/main/services/cron-service.ts`, `src/main/cronjobs.ts`, `src/main/hermes/bff/jobs.ts`, `src/renderer/src/screens/Schedules/*` |
| Fix Trace Lab | `src/main/trace-store.ts`, `src/main/ipc/trace.ts`, `src/shared/traces.ts`, `src/renderer/src/screens/TraceLab/*` |
| Fix updater/menu events | `src/main/index.ts`, `src/preload/api/app.ts`, `src/renderer/src/screens/Layout/Layout.tsx` |
| Fix install/update/doctor | `src/main/services/install-service.ts`, `src/main/install/*`, `src/main/installer.ts`, `src/main/ipc/install.ts` |
| Fix docs guard failures | `scripts/check-docs.mjs`, `docs/index.md`, relevant `docs/contracts/*` or `docs/subsystems/*` |

## Tests To Check

| Area | Tests |
| --- | --- |
| IPC/preload surface | `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`, `tests/chat-ipc-lifecycle.test.ts` |
| CLI | `tests/cli-*.test.ts`, `tests/cli-parity.test.ts` |
| Runtime/connection | `tests/hermes-runtime.test.ts`, `tests/reliable-profile-runtime-contract.test.ts`, `tests/ssh-remote.test.ts`, `tests/hermes-capabilities.test.ts` |
| Chat/SSE/title | `tests/sse-parser.test.ts`, `tests/chat-*.test.ts`, `tests/hermes-title.test.ts`, renderer Chat tests |
| Sessions/cache | `tests/sessions-*.test.ts`, `tests/session-cache-sync.test.ts`, renderer Sessions tests |
| Trace Lab | `tests/trace-*.test.ts`, renderer TraceLab tests |
| Knowledge/skills/models | `tests/knowledge-service.test.ts`, `tests/skills-import.test.ts`, `tests/model-roles.test.ts`, `tests/hermes-model-inventory.test.ts` |
| Docs | `tests/docs-guard.test.ts`, `npm run check:docs` |

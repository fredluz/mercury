## Final Prompt
<taskname="Profile Runtime Plan"/>
<task>
Create an actionable multi-phase implementation plan for Mercury's reliable profile runtime. Do not implement code changes in this step. The plan must have no more than 5 work items, and each item must include: goal, done criteria, files/modules, dependencies, test expectations, and notes for sub-agents. Bias toward sequencing that can actually be delegated and verified.

The target outcome: when the UI/profile manager chooses profile X, chat, title generation, gateway/API lifecycle, tools, skills, memory, SOUL, schedules/cron, sessions/resume, local mode, SSH mode, and remote HTTP mode either execute under a runtime identity verified to match profile X or fail closed with clear IPC/UI diagnostics.
</task>

<architecture>
- Profile selection originates in renderer state: `Layout.tsx` owns `activeProfile`; `Agents.tsx` can switch it; `Gateway.tsx`, `Schedules.tsx`, and `useChatController.ts` receive/pass profile intent.
- Preload and IPC are the enforcement boundary. Many config/knowledge/session/chat APIs already accept `profile`, but gateway lifecycle/status APIs are profile-less through `preload/api/navigation.ts`, `ipc/gateway.ts`, and renderer callers.
- Local profile storage mostly exists via `profileHome(profile)` across config, memory, SOUL, tools, skills, sessions, session cache, cron jobs, and import helpers. This proves file separation, not live runtime identity.
- CLI chat is closest to correct: `chat-cli.ts` passes `-p <profile>` for non-default profiles and loads profile-scoped env/model config.
- Local API/gateway is the central risk: `hermes/gateway.ts` holds one global process/PID/readiness state, `connection.ts` exposes one `getApiUrl()`/auth header, and `chat-api.ts`/`title.ts` send profile-specific config to a profile-less API URL with no identity verification.
- SSH mode mixes profile-aware remote storage with profile-less execution: `ssh/config.ts`, `ssh/memory-soul.ts`, `ssh/sessions-profiles.ts`, and `ssh/skills.ts` use profile paths, but `ssh/runtime.ts` starts/stops/checks `hermes gateway` and reads default `~/.hermes` PID/log/API key paths without `-p <profile>`; `ssh-tunnel.ts` tracks one tunnel globally.
- Cron is split: local `cronjobs.ts` stores jobs under `profileHome(profile)` and can use `-p`, but API/remote cron calls use global `getApiUrl()` and auth without runtime identity.
- A robust design likely needs a `ProfileRuntimeManager`/`RuntimeIdentity` equivalent keyed by requested profile, backend mode, API URL/port, auth key, gateway process/PID, tunnel, health/readiness, and verification status. Treat this as a contract-level implementation, not parameter-threading.
</architecture>

<selected_context>
- `docs/investigations/reliable-profile-runtime-2026-05-16.md`: source-of-truth investigation, symptoms, current violations, upstream profile/gateway background, and done-criteria seeds.
- Runtime core: `src/main/hermes/gateway.ts`, `connection.ts`, `chat-api.ts`, `chat-cli.ts`, `title.ts`, `types.ts`, `hermes.ts` for gateway lifecycle, API URL/auth, health, chat dispatch, CLI fallback, and title generation.
- IPC/preload boundary: `src/main/ipc/chat.ts`, `gateway.ts`, `config.ts`, `knowledge.ts`, `cron.ts`, `sessions.ts`, `system.ts`, `index.ts`; `src/preload/api/chat.ts`, `navigation.ts`, `config.ts`, `knowledge.ts`, `app.ts`, `index.ts`; `src/preload/index.d.ts` slice for renderer-visible API contracts.
- Local profile helpers: `src/main/config.ts`, `profiles.ts`, `sessions.ts`, `session-cache.ts`, `session-db.ts`, `cronjobs.ts`, `memory.ts`, `soul.ts`, `tools.ts`, `skills.ts`, `utils.ts`, plus install introspection/maintenance for MCP server lists, memory providers, backups/imports/logs.
- SSH/remote helpers: `src/main/ssh/runtime.ts`, `config.ts`, `memory-soul.ts`, `sessions-profiles.ts`, `skills.ts`, `src/main/ssh-tunnel.ts`, `src/main/ssh-remote.ts`.
- Renderer profile surfaces: `Layout.tsx`, `Gateway.tsx`, `Schedules.tsx`, `useChatController.ts` slices; `Agents.tsx` codemap shows the profile switch surface.
- Tests: `chat-ipc-lifecycle.test.ts`, `preload-api-surface.test.ts`, `ipc-handlers.test.ts`, `profiles.test.ts`, `session-cache-sync.test.ts`, `sessions-profile-db.test.ts` for current IPC, chat lifecycle, profile/session cache, and contract-testing patterns.
- Codemaps: install paths, IPC types, skill importer, models, chat types, shared metadata/perf/traces/i18n types.
</selected_context>

<relationships>
- `Layout.activeProfile` -> screens/hooks -> preload APIs -> IPC handlers -> local helpers or SSH helpers.
- Chat route: `useChatController` -> `hermesAPI.sendMessage(profile, resumeSessionId, history)` -> `ipc/chat.prepareChatBackend(profile)` -> local `startGateway(profile)` or SSH `sshStartGateway(conn.ssh)` -> `sendMessage()` -> API or CLI.
- Local CLI route: `sendMessageViaCli(profile)` -> `hermes -p <profile> chat ...` with profile env/model config.
- Local API route: `sendMessageViaApi(profile)` -> `getModelConfig(profile)` but `getApiUrl()`/auth/readiness are global.
- Gateway UI route: `Gateway(profile)` reads/writes profile config, but `startGateway()`, `stopGateway()`, and `gatewayStatus()` currently omit profile through preload and IPC.
- SSH route: chat/config/gateway IPC calls `sshGatewayStatus(conn.ssh)`, `sshStartGateway(conn.ssh)`, `sshStopGateway(conn.ssh)`, and `startSshTunnel(conn.ssh)` without profile, while storage helpers may read/write profile-specific remote files.
- Cron route: `Schedules(profile)` -> preload app cron APIs -> `ipc/cron.ts` -> `cronjobs.ts`; local CLI can pass profile, remote/API cron is tied to whichever global API runtime `getApiUrl()` addresses.
- Sessions route: `ipc/sessions.ts` and cache tests show rows carry `profile`; SSH `set-active-profile` currently returns true without changing/validating remote active runtime identity.
</relationships>

<current_violations>
- One global API URL/auth/readiness state can be reused for the wrong selected profile.
- Gateway lifecycle/status is not keyed by profile/backend mode; local gateway PID/process state is global.
- API chat/title/cron can use profile-specific inputs while talking to a backend whose actual profile is unknown.
- SSH gateway lifecycle/log/API-key paths are hard-coded to default runtime locations and commands omit `-p <profile>`.
- SSH tunneling tracks a single active tunnel and cannot represent multiple profile runtimes/ports.
- Pure remote HTTP mode has no selected-profile contract or identity verification; it should be externally managed/unknown unless a remote identity contract exists.
- Operational surfaces such as dump/logs/MCP server lists/gateway status inspect files or global state, not verified live runtime identity.
</current_violations>

<plan_requirements>
Produce up to 5 work items. Recommended sequencing to evaluate, refine, or replace based on the selected code:
1. Runtime identity contract and manager for local/API/CLI/SSH/remote modes.
2. Profile-keyed gateway/API lifecycle, readiness, auth, PID/log/port state, and fail-closed identity verification.
3. SSH and tunnel parity with profile-keyed remote commands/paths/ports plus explicit unsupported/unknown remote semantics.
4. Route all consumer surfaces through the runtime contract: chat, title, cron, tools, skills, memory/SOUL, MCP diagnostics, sessions/resume, gateway UI.
5. Contract/unit/integration test expansion and diagnostics/UI error surfaces proving mismatch prevention and profile-switch isolation.
</plan_requirements>

<acceptance_tests>
Done means tests/diagnostics prove selecting profile X uses a runtime identity matching X for CLI, local API/gateway, SSH, and supported remote operations, or fails closed with visible mismatch/unsupported-mode messaging. Switching X -> Y must not reuse X's API URL, auth key, tunnel, process, health cache, session resume target, tool registry, or cron backend unless identity verification confirms a match. Tests should cover preload/IPC signatures, chat backend preparation, gateway lifecycle identity, cron routing, session/cache/resume behavior, SSH command construction, and mismatch/fail-closed outcomes.
</acceptance_tests>

<ambiguities>
- Upstream Hermes appears to support `hermes -p <profile> gateway ...` and per-profile ports/auth, but this code lacks an implemented upstream identity endpoint. The plan should call out whether to add/depend on such an endpoint or derive identity from profile-owned runtime config.
- Provider credentials/model libraries may remain partly global/shared; the plan should identify what stays global versus profile-local before claiming runtime isolation.
- Existing git status has unrelated modified/untracked files, including an untracked investigation report and a modified `src/main/index.ts` with startup telemetry gating. Do not plan to revert unrelated work.
</ambiguities>

## Selection
- Files: 65 total (53 full, 2 slice, 10 codemap)
- Total tokens: 107725 (Auto view)
- Token breakdown: full 96407, slice 7750, codemap 3568

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   └── investigations/
│       └── reliable-profile-runtime-2026-05-16.md — 10 956 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 192 tokens (full)
│   │   │   ├── chat-cli.ts — 1 793 tokens (full)
│   │   │   ├── connection.ts — 1 052 tokens (full)
│   │   │   ├── gateway.ts — 1 591 tokens (full)
│   │   │   ├── title.ts — 979 tokens (full)
│   │   │   └── types.ts — 184 tokens (full)
│   │   ├── install/
│   │   │   ├── introspection.ts — 1 792 tokens (full)
│   │   │   └── maintenance.ts — 930 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 3 740 tokens (full)
│   │   │   ├── config.ts — 1 651 tokens (full)
│   │   │   ├── cron.ts — 293 tokens (full)
│   │   │   ├── gateway.ts — 509 tokens (full)
│   │   │   ├── index.ts — 251 tokens (full)
│   │   │   ├── knowledge.ts — 1 605 tokens (full)
│   │   │   ├── sessions.ts — 2 134 tokens (full)
│   │   │   └── system.ts — 560 tokens (full)
│   │   ├── ssh/
│   │   │   ├── config.ts — 2 634 tokens (full)
│   │   │   ├── memory-soul.ts — 1 771 tokens (full)
│   │   │   ├── runtime.ts — 2 791 tokens (full)
│   │   │   ├── sessions-profiles.ts — 2 828 tokens (full)
│   │   │   └── skills.ts — 1 661 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── cronjobs.ts — 2 225 tokens (full)
│   │   ├── hermes.ts — 120 tokens (full)
│   │   ├── index.ts — 3 014 tokens (full)
│   │   ├── memory.ts — 1 495 tokens (full)
│   │   ├── profiles.ts — 1 806 tokens (full)
│   │   ├── session-cache.ts — 3 485 tokens (full)
│   │   ├── session-db.ts — 520 tokens (full)
│   │   ├── sessions.ts — 1 648 tokens (full)
│   │   ├── skills.ts — 1 999 tokens (full)
│   │   ├── soul.ts — 307 tokens (full)
│   │   ├── ssh-remote.ts — 336 tokens (full)
│   │   ├── ssh-tunnel.ts — 2 264 tokens (full)
│   │   ├── tools.ts — 2 034 tokens (full)
│   │   └── utils.ts — 378 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── app.ts — 1 538 tokens (full)
│   │   │   ├── chat.ts — 825 tokens (full)
│   │   │   ├── config.ts — 748 tokens (full)
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   ├── knowledge.ts — 797 tokens (full)
│   │   │   └── navigation.ts — 660 tokens (full)
│   │   ├── index.d.ts — 2 240 tokens (lines 1-12 (Imports for renderer-facing HermesAPI type dependencies.), 53-261 (HermesAPI contract covering config, chat, gateway, sessions, profiles, memory, soul, tools, and skills profile parameters.), 405-475 (HermesAPI contract for backup/import/debug, memory-provider discovery, MCP server listing, and log viewer profile-adjacent APIs.))
│   │   └── index.ts — 127 tokens (full)
│   └── renderer/
│       └── src/
│           └── screens/
│               ├── Chat/
│               │   └── hooks/
│               │       └── useChatController.ts — 5 510 tokens (lines 1-170 (Hook imports, args, profile/session refs, and reset-on-profile-change behavior for Chat runtime profile routing.), 300-370 (Profile-aware model config/service-tier loading used by Chat when active profile changes.), 560-892 (Chat send/quick-ask/approval flows pass profile and resume session id through hermesAPI.sendMessage; return object exposes controller state to Chat.tsx.))
│               ├── Gateway/
│               │   └── Gateway.tsx — 2 383 tokens (full)
│               ├── Layout/
│               │   └── Layout.tsx — 4 231 tokens (full)
│               └── Schedules/
│                   └── Schedules.tsx — 3 306 tokens (full)
└── tests/
    ├── chat-ipc-lifecycle.test.ts — 3 305 tokens (full)
    ├── ipc-handlers.test.ts — 1 380 tokens (full)
    ├── preload-api-surface.test.ts — 2 389 tokens (full)
    ├── profiles.test.ts — 1 087 tokens (full)
    ├── session-cache-sync.test.ts — 3 623 tokens (full)
    └── sessions-profile-db.test.ts — 1 160 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── install/
    │   │   └── paths.ts — 672 tokens (manual)
    │   ├── ipc/
    │   │   └── types.ts — 44 tokens (manual)
    │   ├── skills/
    │   │   └── importer.ts — 327 tokens (manual)
    │   └── models.ts — 288 tokens (manual)
    ├── renderer/
    │   └── src/
    │       └── screens/
    │           ├── Agents/
    │           │   └── Agents.tsx — 239 tokens (manual)
    │           └── Chat/
    │               └── types.ts — 900 tokens (manual)
    └── shared/
        ├── i18n/
        │   └── types.ts — 43 tokens (manual)
        ├── chat-metadata.ts — 466 tokens (manual)
        ├── perf.ts — 203 tokens (manual)
        └── traces.ts — 386 tokens (manual)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `profile-runtime-plan-D9847B` | **Mode**: plan

### Response


--
Error:
Unknown error [RepoPrompt.AIProviderError, code 1]: invalidConfiguration(detail: "You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:03 PM.")


> 💡 Continue this plan conversation with ask_oracle(chat_id: "profile-runtime-plan-D9847B", new_chat: false)
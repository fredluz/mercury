# Investigation: Reliable Profile Runtime

## Summary
Mercury already has a mostly working profile storage contract, but reliable profile runtime is not done until every execution request resolves a backend whose actual runtime identity is verified to match the selected profile. The robust fix is an explicit `ProfileRuntimeManager`/`RuntimeIdentity` contract: chat, title generation, cron, gateway/API, tools, skills, memory, SOUL, MCP, sessions/resume, local, SSH, and remote modes must either execute under the requested profile or fail closed with a visible structured reason.

## Implementation status after Items 1-5

The implementation plan is complete as of 2026-05-16. The historical investigation below remains useful context, but the final behavior now differs from several "current gap" notes captured before implementation:

- `ProfileRuntimeManager` and the runtime types in `src/main/hermes/types.ts` now centralize runtime identity, profile-keyed local gateway/API state, CLI fallback command identity, SSH runtime handles, pure remote fail-closed behavior, diagnostics, and stale-runtime markers.
- Gateway lifecycle is profile-aware through renderer, preload, IPC, local main-process handlers, and SSH handlers. Local managed API identity is keyed by profile and profile-specific port/PID/config/auth evidence; SSH lifecycle uses `hermes -p <profile>` or profile-specific remote paths.
- Chat, title generation, and cron API routing resolve a verified runtime handle before execution. API transports use the handle's URL/auth and reject mismatched or unverified profile identity; local CLI fallback uses `hermes -p <profile>` for named profiles.
- Title/session duplicate handling is profile-aware for existing-title lookup and session cache updates, preserving `(sessionId, profile)` identity across duplicate IDs.
- Diagnostics are exposed through `get-runtime-diagnostic` / `getRuntimeDiagnostic(profile)` and surfaced in Layout, Chat, Gateway, and Settings. They report selected/requested/actual profile, mode, transport, API URL/port, PID/config/auth source, verification time, stale/mismatch/unsupported reasons, and related evidence where available.
- Profile-scoped changes to env/config/model/tools/skills/memory/SOUL/MCP/cron-adjacent state mark runtimes stale or restart/revalidate them where practical so storage edits do not silently imply a loaded runtime.
- Sentinel and behavioral tests now cover runtime identity, profile switching/gateway lifecycle, chat API mismatch prevention, title duplicate handling, cron routing, SSH/remote fail-closed behavior, diagnostics/stale state, and the documentation distinction between storage isolation and runtime isolation. The new sentinel file guards cross-module wiring, while focused unit tests continue to exercise behavior in the runtime, cron, title, chat IPC, SSH, preload, and IPC suites.

The remaining limitations are explicit rather than silent fallbacks: generic pure remote HTTP endpoints still cannot prove selected-profile runtime identity without an upstream/declarative identity mechanism, and broad profile-manager menu restructuring remains outside this runtime work. SSH parity is implemented for execution identity paths covered by this plan; any future remote APIs should continue using the same verified-handle/fail-closed contract.

## Symptoms
- User wants to understand why runtime isolation matters if skills/memory/etc. already appear profile-scoped.
- Prior investigation found profile-backed storage/UI is mostly isolated, but API/gateway runtime can still run under default/global Hermes state.
- Desired outcome is not a narrow patch spec: define the robust agent-runtime model and the acceptance criteria for completion.

## Background / Prior Research
- Prior report: `/Users/fredluz/Code/mercury/docs/investigations/profile-tools-skills-memory-isolation-2026-05-16.md`.
- Prior report: `/Users/fredluz/Code/mercury/docs/investigations/profile-manager-agent-2026-05-16.md`.
- Prior conclusion: local storage/UI for tools, skills, memory, and SOUL is mostly profile-aware; CLI runtime is profile-aware via `-p`; API/gateway and SSH runtime paths are not reliably profile-addressed.
- Upstream Hermes profile model: profiles are separate state homes selected by `hermes -p <profile> <command>`, sticky active profile, or aliases. Each profile should have separate config, `.env`, skills, memory, session DB, SOUL, gateway PID/logs, and cron jobs.
- Upstream code/docs indicate `hermes -p <profile>` changes `HERMES_HOME` early via `_apply_profile_override()` in `hermes_cli/main.py`; profile wrappers are equivalent to `hermes -p <profile> ...`.
- Upstream gateway lifecycle is profile-aware when launched under a profile: `hermes gateway start|stop|status|restart` uses the current profile `HERMES_HOME`; `--all` acts across profiles.
- Upstream API server defaults to `127.0.0.1:8642` but supports `API_SERVER_PORT`, `API_SERVER_HOST`, `API_SERVER_KEY`, CORS, and model-name config. Docs show multiple profile gateways can run simultaneously on different ports.
- Upstream API has `/health`, `/health/detailed`, `/v1/models`, `/v1/capabilities`, and session headers (`X-Hermes-Session-Id`, `X-Hermes-Session-Key`), but no dedicated profile identity endpoint was found. Profile identity may need to be inferred/verified via selected port/runtime config or added by Mercury/upstream.
- Upstream supports per-profile cron state/jobs because cron lives under profile `HERMES_HOME`; API cron behavior is tied to whichever profile runtime owns the API server.
- Upstream constraints: multiple profile gateways are allowed, but profiles cannot use the same messaging bot token simultaneously; token-lock conflicts are expected and should surface in UI.

## Investigator Findings
<!-- Pair investigator appends structured analysis here: file:line refs, evidence, conclusions. -->

### 2026-05-16 - Runtime contract audit: local chat, gateway/API, SSH/remote, cron, sessions, and knowledge surfaces

#### Executive conclusion

Mercury currently has two different profile contracts:

1. **Storage/UI contract, mostly implemented:** renderer screens and main-process helpers often accept `profile`, and many files are read/written under `profileHome(profile)`.
2. **Runtime execution contract, not yet implemented/proven:** the preferred local/SSH/remote API path only proves that an HTTP server answered; it does not prove that the answering Hermes process was started under the selected profile. In several paths Mercury stores or displays profile-specific state, then executes against a default/global gateway/API process.

A reliable profile runtime therefore needs a hard invariant: **every execution request must carry an intended profile identity, bind to a runtime whose actual profile identity is verified, and fail closed if Mercury cannot prove the runtime is profile X.** This must apply to chat, title generation, cron, gateway lifecycle, tools/skills/memory/SOUL consumption, session resume, local mode, SSH mode, and pure remote HTTP mode.

#### Current local chat path: what carries profile and where it stops

- **Renderer and preload carry the selected profile correctly.** `Chat` accepts `profile` and passes it to `useChatController` (`src/renderer/src/screens/Chat/Chat.tsx:33-47`). Normal sends and quick-asks call `window.hermesAPI.sendMessage(text, profile, resumeSessionId, historyMessages)` (`src/renderer/src/screens/Chat/hooks/useChatController.ts:612-632`, `src/renderer/src/screens/Chat/hooks/useChatController.ts:686-699`). Title generation also includes `profile` and `sessionId` (`src/renderer/src/screens/Chat/hooks/useChatController.ts:541-559`). Preload forwards `send-message` arguments exactly (`src/preload/api/chat.ts:6-20`) and forwards `generate-chat-title` (`src/preload/api/chat.ts:23-24`). The documented IPC contract agrees that `sendMessage(message, profile?, resumeSessionId?, history?)` and `generateChatTitle(request.profile?)` are part of the renderer API (`docs/contracts/ipc-preload.md:128-151`).
- **IPC receives the profile but backend preparation is not profile-verified.** `send-message` calls `prepareChatBackend(profile)` and then `sendMessage(..., profile, resumeSessionId, history)` (`src/main/ipc/chat.ts:123-137`, `src/main/ipc/chat.ts:215-365`). `prepareChatBackend(profile)` starts a local gateway only if `!isRemoteMode() && !isGatewayRunning()` (`src/main/ipc/chat.ts:102-109`), but `isGatewayRunning()` is a global check, not keyed by profile. In SSH mode it checks/starts `sshGatewayStatus(conn.ssh)`, `sshStartGateway(conn.ssh)`, and `startSshTunnel(conn.ssh)` without a profile (`src/main/ipc/chat.ts:111-120`).
- **Dispatch prefers API over the only clearly profile-correct CLI path.** `sendMessage()` uses API for remote/SSH mode, probes local API readiness, uses API if available, and only falls back to CLI otherwise (`src/main/hermes/gateway.ts:15-43`). The CLI path is the strong profile path: it inserts `-p <profile>` for non-default profiles and `--resume <sessionId>` when supplied (`src/main/hermes/chat-cli.ts:45-66`). The API path only uses `profile` to choose the outbound model via `getModelConfig(profile)` (`src/main/hermes/chat-api.ts:11-19`), then sends a body containing `model`, `messages`, and `stream` with no profile selector (`src/main/hermes/chat-api.ts:30-43`). It captures session identity from `x-hermes-session-id` (`src/main/hermes/chat-api.ts:190-193`) but does not send the resume id upstream in a header/body field (`src/main/hermes/chat-api.ts:11-19`, `src/main/hermes/chat-api.ts:30-43`).
- **Title generation is profile-shaped but not runtime-verified.** The main handler normalizes/persists title with `normalizedRequest.profile` (`src/main/ipc/chat.ts:399-425`), and model title selection uses `getModelConfig(request.profile)` (`src/main/hermes/title.ts:33-52`). But the request posts to `${getApiUrl()}/v1/chat/completions` with no profile selector (`src/main/hermes/title.ts:35-59`). Also, the existing-title fast path calls `getSessionTitle(request.sessionId)` without passing `request.profile`, even though `getSessionTitle(sessionId, profile?)` supports profile disambiguation (`src/main/hermes/title.ts:99-105`, `src/main/sessions.ts:195-219`).
- **Session/profile metadata is a cache annotation, not runtime proof.** On chat completion, IPC calls `updateSessionProfile(sessionId, profile)` (`src/main/ipc/chat.ts:260-274`), and `updateSessionProfile` updates the desktop session cache from the selected profile scope (`src/main/session-cache.ts:421-459`). This helps UI resume/search, but it does not prove that the upstream Hermes process used that profile. A mismatched API server can still return a session id that Mercury tags with the requested profile.

**Required local chat contract:** every chat/title request must produce a `RuntimeIdentity` before execution: `{ requestedProfile, mode, transport, baseUrl/port, actualProfile, hermesHome, pid/processId, apiKeySource, sessionId?, verifiedAt }`. If transport is CLI, `actualProfile` is proven by `-p <profile>`/profile home. If transport is API, Mercury must either launch/select an API server for that profile or send an upstream-supported profile selector, then verify the server reports the same profile. If no identity endpoint exists, Mercury must not silently claim profile isolation; it must either force the proven CLI path or fail with a clear “backend profile could not be verified” error.

#### Local gateway/API runtime: current process state and reliable-runtime contract

- **Profile homes exist, but gateway state is global/default.** `profileHome(profile)` maps named profiles to `HERMES_HOME/profiles/<name>` and default/missing to `HERMES_HOME` (`src/main/utils.ts:19-26`). In contrast, `startGateway(profile?)` hard-sets the child env `HERMES_HOME` to the default constant and spawns `[HERMES_SCRIPT, "gateway"]` with no `-p <profile>` (`src/main/hermes/gateway.ts:85-114`). It injects env vars from `readEnv(profile)` (`src/main/hermes/gateway.ts:99-104`), so a default-home runtime can be given selected-profile secrets without becoming that profile.
- **PID, process, readiness, and lifecycle state are not profile-keyed.** `gatewayProcess`, `gatewayStartedByApp`, and `apiServerAvailable` are single module globals (`src/main/hermes/gateway.ts:13`, `src/main/hermes/gateway.ts:79-82`). PID reads/removals use `join(HERMES_HOME, "gateway.pid")` (`src/main/hermes/gateway.ts:133-179`). `isApiServerReady()` checks only `${getApiUrl()}/health` for HTTP 200 (`src/main/hermes/connection.ts:64-86`), and `startHealthPolling` caches one readiness boolean for all profiles (`src/main/hermes/gateway.ts:59-75`).
- **API server config and local port are default/global.** `getApiUrl()` returns fixed `http://127.0.0.1:8642` for local mode (`src/main/hermes/connection.ts:8-24`). `ensureApiServerConfig()` edits `join(HERMES_HOME, "config.yaml")` with a hard-coded host/port if no `api_server` block exists (`src/main/hermes/connection.ts:89-114`). It has no profile parameter and does not create/patch the selected profile config.
- **Manual Gateway UI drops profile at lifecycle boundaries.** The Gateway screen uses `profile` for env and platform toggles (`src/renderer/src/screens/Gateway/Gateway.tsx:15-25`, `src/renderer/src/screens/Gateway/Gateway.tsx:60-70`), but status/start/stop call `window.hermesAPI.gatewayStatus()`, `startGateway()`, and `stopGateway()` with no profile (`src/renderer/src/screens/Gateway/Gateway.tsx:15-51`). Preload exposes gateway lifecycle methods with no profile argument (`src/preload/api/navigation.ts:15-19`), and IPC `start-gateway`, `stop-gateway`, and `gateway-status` are also profile-less (`src/main/ipc/gateway.ts:21-41`).

**Reliable local runtime means:** lifecycle APIs must be profile-addressed (`start/status/stop/restart(profile)`), runtime state must be keyed by profile, and readiness must verify identity, not just liveness. Either run one gateway/API per profile on profile-specific ports/PID/log/auth, or maintain one selected local runtime and fail/restart when the requested profile changes. Port/PID/log/API-key sources must be derived from the selected profile’s config/home. A request for profile X must never reuse a healthy API server for profile Y just because `/health` returned 200.

#### SSH and pure remote runtime: identity gaps and fail-closed contract

- **SSH gateway commands are default-home/global.** `sshGatewayStatus` reads `$HOME/.hermes/gateway.pid` (`src/main/ssh/runtime.ts:11-23`), `sshStartGateway` runs `nohup hermes gateway start > $HOME/.hermes/gateway.log ...` (`src/main/ssh/runtime.ts:26-33`), and `sshStopGateway` runs `hermes gateway stop` plus a `$HOME/.hermes/gateway.pid` fallback (`src/main/ssh/runtime.ts:34-47`). None accepts or uses a selected profile.
- **SSH API key/tunnel auth is not profile-bound.** `sshReadRemoteApiKey(config)` calls `sshReadEnv(config)` without profile and returns default-profile `API_SERVER_KEY` (`src/main/ssh/runtime.ts:50-56`). `start-ssh-tunnel` caches that key with `setSshRemoteApiKey(key)` (`src/main/ipc/config.ts:216-236`). `getRemoteAuthHeader()` sends SSH auth only if this one cached key exists; otherwise it returns `{}` (`src/main/hermes/connection.ts:37-52`). The SSH tunnel forwards only `localPort -> 127.0.0.1:remotePort` and does not encode profile identity (`src/main/ssh-tunnel.ts:104-123`, `src/main/ssh-tunnel.ts:135-220`).
- **SSH profile activation/status is not a real remote runtime identity.** `set-active-profile` deliberately skips `setActiveProfile(name)` when connection mode is SSH (`src/main/ipc/sessions.ts:159-166`). `sshListProfiles` reports default `isActive: true` and all named profiles `isActive: false` rather than reading remote active profile state (`src/main/ssh/sessions-profiles.ts:177-249`). `sshGetPlatformEnabled` explicitly discards `profile` and reads global `$HOME/.hermes/gateway_state.json` (`src/main/ssh/runtime.ts:105-129`).
- **Pure remote HTTP mode has no profile selector.** `getApiUrl()` returns the configured `remoteUrl` for remote mode (`src/main/hermes/connection.ts:10-21`), and `getRemoteAuthHeader()` uses an optional stored API key (`src/main/hermes/connection.ts:37-52`). `testRemoteConnection` only checks `/health` 200 (`src/main/hermes/connection.ts:116-136`). Remote chat/title/cron requests therefore run under whatever profile the remote server already represents; Mercury cannot infer or select profile X from the local `activeProfile`.
- **Fail-closed behavior is inconsistent.** SSH tunnel setup uses `StrictHostKeyChecking=accept-new`, `BatchMode=yes`, and `ExitOnForwardFailure=yes` (`src/main/ssh-tunnel.ts:104-123`), and the UI explains first-use trust then fail-closed on host-key changes (`src/renderer/src/screens/Settings/components/SettingsCoreSections.tsx:344-350`). But gateway start/stop/status helpers catch errors and often return success/false without surfacing identity uncertainty (`src/main/ssh/runtime.ts:11-47`), and chat preparation can proceed after `sshStartGateway` best-effort starts a default runtime (`src/main/ipc/chat.ts:111-120`).

**Required SSH/remote contract:** SSH operations need `profile` parameters all the way down: `sshGatewayStatus(config, profile)`, `sshStartGateway(config, profile)`, `sshStopGateway(config, profile)`, `sshReadRemoteApiKey(config, profile)`, tunnel/runtime identity records, and platform state keyed by the selected profile. Remote commands should invoke `hermes -p <profile> gateway ...` or an upstream-supported profile wrapper. If remote `/health` cannot assert profile identity, pure remote mode must be marked “externally profile-bound”: Mercury may connect only when the configured remote endpoint is explicitly declared to represent profile X, and chat/cron/title must fail closed when the selected local profile differs from that declared identity.

#### Cron, schedules, and API ambiguity

- **Local cron storage and CLI creation are profile-aware.** Jobs are read from `join(profileHome(profile), "cron", "jobs.json")` (`src/main/cronjobs.ts:26-31`, `src/main/cronjobs.ts:87-134`). `runCronCommand(args, profile)` inserts `-p <profile>` for non-default profiles before `cron ...` (`src/main/cronjobs.ts:141-159`). The Schedules screen and cron IPC pass `profile` for list/create/remove/pause/resume/run (`src/renderer/src/screens/Schedules/Schedules.tsx:60-72`, `src/renderer/src/screens/Schedules/Schedules.tsx:133-215`, `src/main/ipc/cron.ts:11-40`).
- **Remote/SSH cron uses the active API server with no profile selector.** In `isRemoteMode()` (remote or SSH), list/create/delete/pause/resume/run use `/api/jobs` endpoints via `remoteFetch` (`src/main/cronjobs.ts:63-116`, `src/main/cronjobs.ts:171-280`). `remoteFetch` adds only auth headers and does not include profile (`src/main/cronjobs.ts:63-72`). Therefore cron operations in remote/SSH mode act on the API server’s current/default profile, not necessarily the selected Mercury profile.

**Required cron contract:** cron API calls must include/verify runtime profile the same way chat does. Local CLI cron is acceptable when `-p` is present. API cron must either be served by a verified profile-X gateway or include a verified profile selector/header. Job list results should include the owning runtime profile, and create/run/pause/resume/delete should fail if the requested profile and API runtime profile differ.

#### Tools, skills, memory, SOUL, and MCP: storage scoped does not prove runtime consumption

- **Local profile-scoped storage exists.** Memory reads/writes use `profileHome(profile)/memories/MEMORY.md`, `USER.md`, and profile `state.db` stats (`src/main/memory.ts:34-126`). SOUL uses `profileHome(profile)/SOUL.md` (`src/main/soul.ts:12-35`). Toolsets read/write selected-profile `config.yaml` and mirror enabled toolsets into both `platform_toolsets.cli` and `platform_toolsets.api_server` (`src/main/tools.ts:240-292`). Installed skills are listed from `profileHome(profile)/skills`, and local install/uninstall add `-p <profile>` (`src/main/skills.ts:63-104`, `src/main/skills.ts:231-287`). Knowledge IPC forwards `profile` for memory, soul, tools, and most skill operations (`src/main/ipc/knowledge.ts:42-184`).
- **Runtime consumption is only proven if the executing Hermes process is profile-bound.** The storage facts above prove where Mercury writes config/files, not which Hermes runtime loads them. Because API/gateway chat can hit a default/global runtime (`src/main/hermes/gateway.ts:85-179`, `src/main/hermes/chat-api.ts:30-43`), a named profile’s tools/skills/memory/SOUL can be correctly stored yet unused at execution time.
- **SSH knowledge parity gaps remain.** SSH config paths support profile-specific `.env`/`config.yaml` (`src/main/ssh/config.ts:50-219`), and SSH memory/SOUL helpers use profile-specific remote paths (`src/main/ssh/memory-soul.ts:23-40`, `src/main/ssh/memory-soul.ts:159-180`). But SSH toolset writes only the `cli` section, unlike local mirroring to `api_server` (`src/main/ssh/config.ts:55-104`, `src/main/tools.ts:173-292`). SSH skill install/uninstall drops the IPC profile in the SSH branch and the SSH functions run `hermes skills install/uninstall` without profile (`src/main/ipc/knowledge.ts:141-156`, `src/main/ssh/skills.ts:73-90`).
- **MCP listing is profile-shaped locally but mode-incorrect for SSH.** Tools calls both `getToolsets(profile)` and `listMcpServers(profile)` (`src/renderer/src/screens/Tools/Tools.tsx:264-272`). `listMcpServers(profile)` reads local selected-profile `config.yaml` (`src/main/install/introspection.ts:124-183`), but the system IPC handler always calls the local implementation with no SSH branch (`src/main/ipc/system.ts:52-55`). In SSH mode this can show local MCP servers while other SSH knowledge surfaces read remote state.
- **Pure remote mode hides some local surfaces but not all profile implications.** Layout shows `RemoteNotice` for pure remote-only Skills/Soul/Memory/Tools/Gateway/Providers screens (`src/renderer/src/screens/Layout/Layout.tsx:356-496`), but Schedules still renders and calls remote cron APIs (`src/renderer/src/screens/Layout/Layout.tsx:459-463`, `src/main/cronjobs.ts:87-280`), and chat/title remain available without profile verification.

**Required knowledge/tool contract:** changing tools/skills/memory/SOUL for profile X must either restart/invalidate the verified profile-X runtime or warn that a restart is required for profile X. The runtime diagnostics must show the toolset/skills/memory/SOUL source paths actually loaded by the executing process. SSH must mirror local `cli`/`api_server` toolset semantics, pass profile for skill install/uninstall, and list MCP servers from the same host/profile that will execute them.

#### Sessions/resume/title: duplicate profile risk and required safeguards

- **Session storage/search is now profile-aware in many places.** Session DB paths use `profileHome(profile)/state.db` (`src/main/session-db.ts:13-29`), unfiltered discovery aggregates default plus named profiles (`src/main/session-db.ts:32-61`), and cache keys include profile plus session id (`src/main/session-db.ts:65-70`). `listSessions`, `searchSessions`, and `getSessionMessages` use a supplied profile when present, otherwise aggregate/search scopes (`src/main/sessions.ts:95-109`, `src/main/sessions.ts:180-192`, `src/main/sessions.ts:262-275`). Sessions UI passes row profile into resume/open-trace (`src/renderer/src/screens/Sessions/Sessions.tsx:318-390`), and Layout resumes with `getSessionMessages(sessionId, rowProfile)` then switches `activeProfile` to the row profile (`src/renderer/src/screens/Layout/Layout.tsx:271-289`). Tests cover duplicate session IDs across profiles and profile-specific message lookup (`tests/sessions-profile-db.test.ts:86-134`, `tests/session-cache-sync.test.ts:435-469`).
- **Remaining title/session risks are runtime rather than storage.** `generateChatTitle` existing-title lookup omits profile (`src/main/hermes/title.ts:99-105`), and API transport does not send a backend resume id/profile selector (`src/main/hermes/chat-api.ts:11-43`). A duplicate session id in two profile DBs can be displayed/resumed correctly at the UI/storage layer, but title generation/API continuation must also use the selected profile and verified runtime.

**Required session contract:** every session-bearing operation must include `(sessionId, profile)` or must explicitly search all profiles and return a disambiguated `(sessionId, profile)` result. Title generation, resume, trace correlation, and cache updates must use this pair. API continuation must either use backend resume semantics for that exact pair or deliberately run from provided history while recording that backend session continuity was not used.

#### Definition of “done”: acceptance tests and diagnostics

Reliable profile runtime is done only when these pass:

1. **Local chat runtime identity test:** with profiles `alpha` and `beta`, each with distinct SOUL/memory/tool/skill sentinel, selecting `alpha` and sending chat over the preferred API path proves the server identity is `alpha` and the response/trace/tool activity can only come from `alpha`. Repeating with `beta` must not reuse `alpha`’s process/port/PID/readiness cache.
2. **Gateway lifecycle profile tests:** renderer `Gateway(profile)` calls `start/status/stop(profile)` through preload and IPC; local `startGateway("alpha")` launches Hermes with `-p alpha` or selected profile home; status reads the alpha runtime, not default; `startGateway("beta")` either starts a separate beta runtime on a non-conflicting port or fails/restarts with an explicit profile-switch event.
3. **API readiness identity test:** `/health` 200 alone is insufficient. A diagnostic must record actual profile, hermes home, port, pid, API key source, config path, and startup command. Readiness for profile X must be false if the server reports profile Y or cannot report identity.
4. **CLI fallback parity test:** disabling API forces CLI; command args include `-p <profile>` and `--resume <sessionId>`; title/session/profile metadata remains keyed by the same profile.
5. **Title contract test:** `generateChatTitle({ profile: "alpha", sessionId })` checks existing titles in alpha only, posts to a verified alpha runtime, and persists with alpha. Duplicate session IDs in alpha/beta must not cross-read titles.
6. **Cron contract tests:** local cron create/run uses `-p <profile>`; remote/SSH cron APIs fail closed unless the API runtime identity is the selected profile; job list/create/run responses include or are correlated with owning profile.
7. **SSH runtime tests:** `sshStartGateway(config, "alpha")`, `sshGatewayStatus(config, "alpha")`, `sshStopGateway(config, "alpha")`, and `sshReadRemoteApiKey(config, "alpha")` target `~/.hermes/profiles/alpha` or `hermes -p alpha`. SSH tunnel diagnostics show the remote endpoint profile. Missing auth/profile identity produces a visible error, not a silent `{}` auth header or best-effort start.
8. **Pure remote fail-closed tests:** remote mode requires an explicit configured remote runtime identity/profile or an upstream identity endpoint. Selecting a different local Mercury profile than the remote endpoint identity blocks chat/title/cron with a clear message.
9. **Tools/skills/memory/SOUL execution tests:** after changing profile X toolsets/skills/memory/SOUL, the next profile-X runtime either restarts/reloads or reports stale config with a restart-required warning. Execution traces must include source paths/config sections loaded for the verified profile.
10. **MCP/SSH parity tests:** in SSH mode, MCP server listing comes from the remote selected profile; SSH toolset writes mirror `cli` and `api_server`; SSH skill install/uninstall passes profile; pure remote mode either exposes supported remote APIs or fails with `RemoteNotice`/clear unsupported errors.
11. **Diagnostics surface:** add a runtime inspector visible from Chat/Gateway/Settings that shows requested profile vs actual runtime profile, mode, transport, pid/port, config path, env/API-key source, last verification time, and last mismatch error. Existing sessions diagnostics already record mode/profile metadata (`src/main/ipc/sessions.ts:35-115`) and trace runs are created with requested profile (`src/main/ipc/chat.ts:143-151`); extend that pattern to runtime identity.

#### Recommended implementation contract

- Introduce an explicit `ProfileRuntimeRequest` for execution surfaces: `{ profile, mode, purpose: "chat" | "title" | "cron" | "gateway" | "tools" | "skills" | "memory" | "soul" | "mcp", sessionId? }`.
- Introduce a `RuntimeIdentity` resolver in main process. It must prepare/start/connect, verify actual profile identity, and return a handle containing API URL/auth/transport plus evidence. It should own lifecycle state instead of scattered globals such as `apiServerAvailable` and `gatewayProcess`.
- Require all execution APIs to call the resolver before work. Storage-only APIs can still read/write `profileHome(profile)`, but any operation that causes Hermes to execute must have a verified runtime identity.
- Prefer fail-closed errors over fallback ambiguity: do not silently use CLI when API profile mismatches unless the user/contract explicitly allows “fallback to proven CLI profile X”; do not silently use default gateway when selected profile is named; do not silently call remote URLs that cannot report identity.
- Treat pure remote URLs as external runtimes with declared identity. Mercury cannot make a generic remote URL profile-aware without upstream API support; it can only verify or reject.
- Preserve intentional global surfaces separately: desktop connection config lives in `<HERMES_HOME>/desktop.json` (`src/main/config.ts:26-73`), models and credential pools are currently global (`docs/subsystems/storage-and-profiles.md:43-61`, `docs/subsystems/storage-and-profiles.md:86-117`). Decide explicitly whether these remain global, but do not conflate them with runtime profile identity.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Reliable profile runtime requires a runtime identity contract: every execution path must know the requested profile, start/connect to a backend for that profile, verify the backend's actual profile identity, and fail closed if it cannot prove a match.
**Findings:** Prior reports distinguish storage isolation from runtime isolation. Need upstream details for Hermes gateway/API profile semantics, ports, PID files, service names, health/identity endpoints, and whether per-request profile selection exists.
**Evidence:** Prior reports listed above.
**Conclusion:** Run external upstream check, then context_builder and pair investigation.

### Phase 1.5 - Upstream Hermes Runtime Semantics
**Hypothesis:** Upstream Hermes can support profile-scoped gateway/API runtimes if Mercury launches/configures them correctly.
**Findings:** Upstream `hermes -p <profile>` sets profile `HERMES_HOME` early; gateway lifecycle under that profile is profile-scoped; profile-specific PID/logs/cron jobs are expected; API server port/auth/host are configurable; multiple profile gateways can run on different ports. No dedicated profile identity endpoint was found.
**Evidence:** Upstream findings recorded in Background / Prior Research.
**Conclusion:** Mercury should use upstream profile launch semantics and per-profile ports/auth/PID/log/config. Because no identity endpoint was found, Mercury must either add/depend on one or conservatively verify only runtimes it launched and can correlate to profile-specific process/port/config.

### Phase 2 - Context Builder Assessment
**Hypothesis:** The repo has profile-scoped files but lacks a profile-keyed runtime layer.
**Findings:** Context Builder selected local runtime, SSH runtime, IPC/preload, cron, sessions, tools/skills/memory/SOUL, renderer Gateway/Chat/Schedules, and tests. It identified global API URL/auth/readiness, global gateway process/PID state, and SSH default-runtime commands as primary violations.
**Evidence:** Selection included `src/main/hermes/*`, `src/main/ipc/*`, `src/preload/*`, `src/main/ssh/*`, `src/main/cronjobs.ts`, `src/main/session-*`, `src/main/tools.ts`, `src/main/skills.ts`, `src/main/memory.ts`, `src/main/soul.ts`, and relevant tests.
**Conclusion:** Pair investigation should trace execution, not just file paths.

### Phase 3 - Pair Investigator Findings
**Hypothesis:** Every execution path must resolve a verified runtime identity; storage reads are insufficient.
**Findings:** Pair investigator confirmed two profile contracts: storage/UI is mostly implemented, runtime execution is not. It traced where profile is carried correctly and where it stops: `prepareChatBackend` global gateway checks, API dispatch preference, global gateway state, global API URL/config/readiness, profile-less SSH runtime, profile-less remote cron, title lookup omissions, and local-only MCP listing.
**Evidence:** See `## Investigator Findings`, especially `src/main/ipc/chat.ts:95-149`, `src/main/hermes/gateway.ts:13-179`, `src/main/hermes/chat-api.ts:11-43`, `src/main/hermes/title.ts:30-114`, `src/main/ssh/runtime.ts:1-135`, `src/main/cronjobs.ts:60-199`, `src/main/ssh-tunnel.ts:1-225`, and `src/main/install/introspection.ts:120-189`.
**Conclusion:** A reliable runtime needs an explicit main-process runtime manager and identity proof.

### Phase 4 - Spot Check and Oracle Synthesis
**Hypothesis:** The final done criteria should be identity-based and fail-closed.
**Findings:** Direct spot checks confirmed the load-bearing claims. Oracle synthesized the architecture: `ProfileRuntimeRequest`, `RuntimeIdentity`, profile-keyed lifecycle/readiness, runtime handles for execution paths, local/SSH/remote rules, and acceptance tests that prove actual runtime profile identity.
**Evidence:** Spot-checked the runtime files listed above. Oracle synthesis used the selected context plus verified upstream findings.
**Conclusion:** Final root cause, done criteria, and recommendations below are evidence-backed.

## Root Cause
Mercury conflates **profile storage isolation** with **profile runtime isolation**.

Storage isolation means Mercury reads/writes profile files under `profileHome(profile)`: config, env, skills, memory, SOUL, sessions, tools, and cron files. Runtime isolation means the live Hermes process/API/tool engine that executes chat, tools, skills, memory, SOUL, title generation, cron, and session continuation was actually started, connected, and verified as that same profile.

Today, Mercury can select profile `research`, show/edit `research` skills/memory/tools, use `research` model config, and still send work to a default or stale API/gateway backend because:

- local API URL and config are global (`127.0.0.1:8642`, default `HERMES_HOME/config.yaml`);
- API readiness is one global `apiServerAvailable` boolean;
- gateway process/PID/log state is global/default-home;
- renderer/preload/IPC gateway start/status/stop are profile-less;
- API chat/title/cron requests do not carry or verify profile identity;
- SSH gateway/status/API-key/tunnel state is default/global;
- pure remote HTTP mode has no selected-profile identity contract;
- `/health` only proves liveness, not which profile is running.

The invariant Mercury lacks is: **requested profile must equal verified actual runtime profile before execution**.

## Done Criteria
Reliable profile runtime is done when all execution surfaces obey this rule:

> A request for profile X may only execute against a backend whose actual runtime identity is verified as X. If Mercury cannot verify that, it fails closed or clearly labels the runtime as externally managed/unknown.

Concrete acceptance criteria:

1. **Runtime identity contract exists.** Main process has a `ProfileRuntimeRequest`/`RuntimeIdentity` or equivalent, carrying requested profile, actual profile, mode, transport, API URL/port, PID, PID file, log dir, `HERMES_HOME`, config path, auth-key source/fingerprint, capabilities, verification source, verification time, and mismatch reason.
2. **Gateway lifecycle is profile-keyed.** Renderer, preload, IPC, local, and SSH expose `startGateway(profile)`, `stopGateway(profile)`, `gatewayStatus(profile)`, and `restartGateway(profile)`. Starting `alpha` does not make `beta` status running; a default gateway cannot satisfy named-profile status.
3. **Local API runtime is profile-bound.** Local profile X gateway/API is launched with upstream profile semantics (`hermes -p X gateway ...` or profile-specific `HERMES_HOME`), profile-specific port/auth/PID/log/config, and identity verification stronger than `/health` 200.
4. **Global API state is removed from execution paths.** No execution path relies on one global `apiServerAvailable`, one global `getApiUrl()`, one global SSH auth key, or one global gateway process for all profiles. Runtime handles supply URL/auth/readiness.
5. **Chat/title/session execution is verified.** Chat and title generation use a verified runtime handle for the selected profile. Session resume/title lookup use `(sessionId, profile)`, handle duplicate IDs across profiles, and fail on runtime/profile mismatch.
6. **CLI fallback remains a proven runtime.** CLI execution is valid when command args include `-p <profile>` for named profiles, `--resume` when needed, profile env/model config, and the runtime identity records verification source as CLI args/profile home.
7. **Cron execution is verified.** Local cron uses `-p <profile>` or profile home. Remote/SSH cron API calls go only through a verified profile runtime or fail/mark unsupported.
8. **Tools/skills/memory/SOUL consumption is proven.** Tests/diagnostics verify the executing runtime loaded selected-profile tool registry, skills directory, memory files, SOUL file, MCP config, and cron state. File reads in Mercury UI do not count as proof.
9. **SSH mirrors local runtime semantics.** SSH gateway/status/stop/API-key/log/tunnel APIs accept profile, use `hermes -p <profile>` or profile-specific remote paths, and key tunnel state by host/user/profile/remote port/local port. Default remote gateway cannot satisfy named-profile execution.
10. **Pure remote HTTP is explicit.** A generic remote URL is treated as externally managed/unknown unless it declares/verifies runtime identity. Mismatched or unverifiable remote profile blocks profile-local claims and execution.
11. **Diagnostics expose proof.** UI/API can show selected profile, actual runtime profile, mode, transport, API URL/port, PID/process source, Hermes home, config path, auth source/fingerprint, capabilities, last verification time, and mismatch/unsupported reason.
12. **Structured errors exist.** Failures use testable codes such as `runtime-profile-mismatch`, `runtime-profile-unverified`, `runtime-unsupported-remote-profile`, `runtime-port-conflict`, `runtime-auth-conflict`, `runtime-token-conflict`, and `runtime-stale-after-profile-switch`.

## Recommended Runtime Architecture
Introduce a main-process `ProfileRuntimeManager` or equivalent. It should own runtime lifecycle and replace scattered global connection state.

Recommended request shape:

```ts
type ProfileRuntimeRequest = {
  profile: string;
  mode: "local" | "ssh" | "remote";
  purpose:
    | "chat"
    | "title"
    | "cron"
    | "gateway"
    | "tools"
    | "skills"
    | "memory"
    | "soul"
    | "sessions"
    | "mcp";
  sessionId?: string;
};
```

Recommended identity shape:

```ts
type RuntimeIdentity = {
  requestedProfile: string;
  actualProfile: string | null;
  verified: boolean;
  verificationSource:
    | "identity-endpoint"
    | "managed-process"
    | "declared-remote"
    | "cli-args"
    | "unverified";
  mode: "local" | "ssh" | "remote";
  transport: "cli" | "api" | "ssh-api" | "remote-api";
  apiBaseUrl?: string;
  localPort?: number;
  remotePort?: number;
  pid?: number;
  pidFile?: string;
  logDir?: string;
  hermesHome?: string;
  configPath?: string;
  authKeyFingerprint?: string;
  startedByMercury: boolean;
  verifiedAt: number;
  capabilities?: Record<string, boolean>;
};
```

Runtime manager responsibilities:

1. Resolve runtime for `(profile, mode, purpose)`.
2. Start/connect to local, SSH, or remote backend.
3. Allocate/profile ports and auth keys.
4. Launch local/SSH gateway with profile-selected Hermes semantics.
5. Verify actual runtime identity.
6. Return a runtime handle used by chat/title/cron/etc.
7. Invalidate/restart stale runtime on profile switch or config changes.
8. Surface structured mismatch/unsupported errors.

## Local / SSH / Remote Rules

### Local
- CLI is acceptable when it uses `-p <profile>` and records identity as `cli-args`.
- API/gateway must be profile-keyed. No global `apiServerAvailable`, no default `HERMES_HOME` launch for named profiles, no profile-less `getApiUrl()` in execution paths.
- Multiple profile gateways are allowed if ports/auth/PID/log/config are separate. If Mercury chooses one active gateway at a time, switching profiles must explicitly stop/restart or fail, never silently reuse.

### SSH
- SSH must mirror local: `sshStartGateway(config, profile)`, `sshGatewayStatus(config, profile)`, `sshStopGateway(config, profile)`, `sshReadRemoteApiKey(config, profile)`.
- Remote commands should use `hermes -p <profile> ...` or profile wrappers.
- Tunnel state must be keyed by SSH host/user/profile/remote port/local port.
- If remote profile identity cannot be verified, execution fails closed.

### Remote HTTP
- Generic remote URLs are externally managed, not profile-local by default.
- Remote execution for profile X requires an identity endpoint, header/body selector, or user-declared runtime identity that matches X.
- Otherwise Mercury must block or label the runtime unverified and avoid claiming isolated tools/skills/memory/SOUL.

## Recommendations
1. **Define the runtime contract first.** Add runtime request/identity/handle types and structured errors before touching all call sites.
2. **Create `ProfileRuntimeManager`.** Move gateway/API readiness, process/PID state, auth, port, tunnel, and identity verification into a profile-keyed manager.
3. **Profile-key gateway lifecycle.** Thread profile through Gateway renderer, preload, IPC, local runtime, and SSH runtime.
4. **Replace global connection helpers in execution paths.** Chat API, title generation, remote cron, SSH tunnel setup, MCP listing, and diagnostics should use runtime handles instead of global `getApiUrl()`/`getRemoteAuthHeader()`.
5. **Add identity verification.** Prefer adding/upstreaming a Hermes runtime identity endpoint. Until then, verify Mercury-managed local runtimes by launch command + PID + profile-specific port/auth/config, and treat generic remote URLs as unverified.
6. **Fix SSH parity.** Profile-scoped gateway commands, API key reads, logs, tunnels, toolset mirroring, skill install/uninstall, and remote MCP listing.
7. **Make config changes invalidate runtime.** Toolsets, skills, memory, SOUL, env, provider/model, MCP, cron config changes should mark the selected profile runtime stale or restart it with a clear warning.
8. **Build diagnostics/UI.** Show requested vs actual profile and runtime evidence in Chat/Gateway/Settings/Profile manager.
9. **Keep global surfaces explicit.** Models, credential pool, connection mode, and global session browsing may remain global by product decision, but they must not be confused with execution identity.

## Preventive Measures
- Add contract tests for preload/IPC profile-aware gateway signatures.
- Add local runtime tests proving profile-keyed ports/PIDs/readiness and mismatch failures.
- Add API chat tests where default API is healthy but named profile is selected; named profile must not use default runtime.
- Add title/session tests for duplicate session IDs across profiles and profile-specific title lookup.
- Add cron tests for local `-p` usage and remote/SSH fail-closed identity verification.
- Add SSH command/tunnel tests for profile-specific gateway/API-key/status/log behavior.
- Add pure remote tests for declared identity vs unverified endpoint behavior.
- Add execution tests with sentinel tools/skills/memory/SOUL proving the runtime loaded selected-profile sources.
- Add diagnostics tests for requested profile, actual profile, mode, transport, port, PID, config path, auth source, verified time, and error codes.

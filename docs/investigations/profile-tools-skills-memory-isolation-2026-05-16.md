# Investigation: Profile Tools, Skills, and Memory Isolation

## Summary
Mercury mostly isolates profile-backed storage and UI state for tools, skills, memory, and SOUL, but it does not reliably isolate the runtime assistant when chat goes through the preferred API/gateway path. CLI chat uses `-p <profile>`, while local and SSH gateway/API flows start or reuse a default/global Hermes runtime and send chat API requests without a profile selector, so profile-specific tools, skills, memory, and SOUL can be configured correctly yet not actually used by the running agent.

## Symptoms
- Concern that all agent profiles may share the same enabled tools.
- Concern that all agent profiles may share the same available/enabled skills.
- Concern that all agent profiles may share the same memory/soul state.
- Desired end state: each profile has separate tools, skills, and memory that the user can set individually.

## Background / Prior Research
- Local Hermes agent skill notes upstream Hermes has multi-instance profiles where each profile gets isolated config, memory, sessions, skills, and gateway. This is a design expectation to compare Mercury against.
- External upstream Hermes repo/docs check confirms profile isolation is intended to be implemented by switching `HERMES_HOME` per profile. Upstream docs state each profile has its own `config.yaml`, `.env`, skills directory, memory store, session DB, `SOUL.md`, and gateway process/service.
- Upstream profile selection mechanisms include one-shot `hermes -p <name> <command>`, sticky `hermes profile use <name>`, and generated profile wrapper aliases such as `<profile> gateway start`.
- Relevant upstream references:
  - Profiles guide: https://hermes-agent.nousresearch.com/docs/user-guide/profiles/
  - FAQ profile isolation statement: https://hermes-agent.nousresearch.com/docs/reference/faq/
  - Toolsets reference: https://hermes-agent.nousresearch.com/docs/reference/toolsets-reference
  - Profile commands: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/profile-commands.md
  - CLI command/profile flag docs: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md

## Investigator Findings
<!-- Pair investigator appends structured analysis here: file:line refs, evidence, conclusions. -->

### 2026-05-16 - Profile isolation trace: tools, skills, memory, soul, chat, gateway, SSH

#### Confirmed isolated

- **Profile home pathing exists and is consistently used by local storage helpers.** `profileHome(profile)` maps `default`/missing to `HERMES_HOME` and named profiles to `HERMES_HOME/profiles/<name>` (`src/main/utils.ts:19-26`). Local config/env/model/platform helpers derive `.env` and `config.yaml` from that profile home (`src/main/config.ts:100-110`, `src/main/config.ts:113-152`, `src/main/config.ts:179-249`, `src/main/config.ts:291-327`).
- **Tools UI and local config writes are profile-scoped.** Layout passes the active profile into Tools (`src/renderer/src/screens/Layout/Layout.tsx:449-457`); Tools calls `getToolsets(profile)`, `listMcpServers(profile)`, and `setToolsetEnabled(..., profile)` (`src/renderer/src/screens/Tools/Tools.tsx:264-287`); preload preserves the profile argument (`src/preload/api/knowledge.ts:49-57`); IPC forwards it locally or over SSH (`src/main/ipc/knowledge.ts:106-121`). Local `getToolsets` and `setToolsetEnabled` read/write `join(profileHome(profile), "config.yaml")` (`src/main/tools.ts:238-270`) and intentionally mirror toggles into both `platform_toolsets.cli` and `platform_toolsets.api_server` (`src/main/tools.ts:171-183`, `src/main/tools.ts:281-286`).
- **Skills UI and local installed/import/install/uninstall paths are profile-scoped.** Layout passes `activeProfile` to Skills (`src/renderer/src/screens/Layout/Layout.tsx:419-427`); Skills calls installed/install/uninstall/import APIs with `profile` (`src/renderer/src/screens/Skills/Skills.tsx:50-57`, `src/renderer/src/screens/Skills/Skills.tsx:78-115`); preload carries it (`src/preload/api/knowledge.ts:62-88`); local installed skills are read from `profileHome(profile)/skills` (`src/main/skills.ts:63-104`); local CLI install/uninstall add `-p <profile>` for non-default profiles (`src/main/skills.ts:231-254`, `src/main/skills.ts:260-282`); Markdown import writes under `resolve(profileHome(profile), "skills")` and validates the write stays inside that root (`src/main/skills/importer.ts:153-211`).
- **Memory and Soul management screens are profile-scoped at the UI/preload/IPC/storage layers.** Layout passes `activeProfile` to Soul and Memory (`src/renderer/src/screens/Layout/Layout.tsx:429-445`); Memory reads/writes `readMemory`, `getConfig`, `discoverMemoryProviders`, `getEnv`, entry CRUD, and user profile writes with `profile` (`src/renderer/src/screens/Memory/Memory.tsx:106-181`); Soul reads/writes/resets with `profile` (`src/renderer/src/screens/Soul/Soul.tsx:20-57`); preload and IPC preserve profile for those operations (`src/preload/api/knowledge.ts:7-43`, `src/main/ipc/knowledge.ts:38-102`). Local memory paths are `profileHome(profile)/memories/MEMORY.md`, `USER.md`, and stats from `profileHome(profile)/state.db` (`src/main/memory.ts:34-39`, `src/main/memory.ts:78-126`); Soul uses `profileHome(profile)/SOUL.md` (`src/main/soul.ts:12-35`).
- **CLI chat path is profile-aware.** Renderer chat passes `profile` to `sendMessage` (`src/renderer/src/screens/Chat/hooks/useChatController.ts:627-630`, `src/renderer/src/screens/Chat/hooks/useChatController.ts:695-698`); preload and IPC preserve it (`src/preload/api/chat.ts:6-20`, `src/main/ipc/chat.ts:126-137`, `src/main/ipc/chat.ts:359-365`); the Hermes CLI fallback adds `-p <profile>` for non-default profiles and reads profile config/env before spawning (`src/main/hermes/chat-cli.ts:45-66`, `src/main/hermes/chat-cli.ts:70-120`). This path should consume selected-profile tools, skills, memory, soul, and session DB because upstream profile selection is applied before `chat`.
- **Session cache/DB browsing is profile-partitioned and resume mostly preserves original profile.** Session DB scopes point to `profileHome(profile)/state.db` (`src/main/session-db.ts:17-29`); global discovery enumerates default plus `HERMES_HOME/profiles/*` (`src/main/session-db.ts:32-61`); cache keys include profile plus session id (`src/main/session-db.ts:65-69`); cache sync tracks per-profile timestamps and filters when a profile is requested (`src/main/session-cache.ts:193-195`, `src/main/session-cache.ts:284-322`, `src/main/session-cache.ts:325-338`). Sessions UI displays profile tags and resumes with the row's profile (`src/renderer/src/screens/Sessions/Sessions.tsx:120-134`, `src/renderer/src/screens/Sessions/Sessions.tsx:318-348`, `src/renderer/src/screens/Sessions/Sessions.tsx:379-390`), and Layout switches `activeProfile` to the row profile before opening chat (`src/renderer/src/screens/Layout/Layout.tsx:303-321`). Chat completion also records session/profile metadata via `updateSessionProfile(sessionId, profile)` (`src/main/ipc/chat.ts:268-274`, `src/main/session-cache.ts:421-459`).
- **SSH Memory/Soul read/write paths are profile-scoped.** SSH memory/user/soul path helpers choose `~/.hermes/profiles/<profile>/...` for named profiles and `~/.hermes/...` for default (`src/main/ssh/memory-soul.ts:23-40`, `src/main/ssh/memory-soul.ts:159-180`), and IPC forwards profile to all SSH memory/soul operations (`src/main/ipc/knowledge.ts:38-102`).

#### Confirmed shared/global

- **Local gateway process management is global/default even though `startGateway(profile)` accepts a profile.** The gateway spawn command is `[HERMES_SCRIPT, "gateway"]` with no `-p <profile>` and `HERMES_HOME` fixed to the default home (`src/main/hermes/gateway.ts:85-114`). PID/status/stop also read and remove `join(HERMES_HOME, "gateway.pid")`, not a profile path (`src/main/hermes/gateway.ts:133-179`). Therefore a selected profile's `.env` is injected into a default-home gateway process, but Hermes itself is not switched to that profile.
- **Manual Gateway UI start drops the selected profile before IPC.** The Gateway screen receives `profile` for env/platform editing (`src/renderer/src/screens/Gateway/Gateway.tsx:4-25`, `src/renderer/src/screens/Gateway/Gateway.tsx:60-70`), but `toggleGateway()` calls `window.hermesAPI.startGateway()` without profile (`src/renderer/src/screens/Gateway/Gateway.tsx:36-51`). Preload exposes `startGateway()` without a profile parameter (`src/preload/api/navigation.ts:15-18`), and IPC calls `startGateway()` / `sshStartGateway(conn.ssh)` without profile (`src/main/ipc/gateway.ts:21-35`).
- **API chat requests are not profile-addressed.** `sendMessageViaApi` uses the selected profile only to select Mercury's outgoing model value via `getModelConfig(profile)` (`src/main/hermes/chat-api.ts:11-19`), then posts an OpenAI-compatible body with only `model`, `messages`, and `stream` (`src/main/hermes/chat-api.ts:30-35`). It does not include a profile parameter/header, and auth comes from `getRemoteAuthHeader()` rather than profile env (`src/main/hermes/chat-api.ts:37-43`). Thus API chat uses whichever Hermes gateway/API server context is already running.
- **API server auto-config is default-home only.** `ensureApiServerConfig()` edits `join(HERMES_HOME, "config.yaml")` and has no profile parameter (`src/main/hermes/connection.ts:89-113`). This can enable the API server in the default profile even when the selected profile is named.
- **Pure remote HTTP mode has no profile switching semantics.** `getApiUrl()` returns the configured remote URL in remote mode and SSH tunnel URL in SSH mode (`src/main/hermes/connection.ts:10-24`); `sendMessage()` uses API for both remote and SSH modes (`src/main/hermes/gateway.ts:28-31`); the API request does not carry profile (`src/main/hermes/chat-api.ts:30-43`). Remote isolation therefore depends entirely on the remote server's already-selected profile, not Mercury's `activeProfile`.
- **SSH gateway/runtime state is global.** SSH gateway status/start/stop use `~/.hermes/gateway.pid`, `~/.hermes/gateway.log`, and `hermes gateway start/stop` with no profile (`src/main/ssh/runtime.ts:12-43`). SSH platform status ignores its `profile` argument and reads global `~/.hermes/gateway_state.json` (`src/main/ssh/runtime.ts:106-129`). SSH API key discovery reads `sshReadEnv(config)` without profile (`src/main/ssh/runtime.ts:50-56`).
- **SSH active-profile state is not real.** Local profiles read `HERMES_HOME/active_profile` and mark active accordingly (`src/main/profiles.ts:82-129`, `src/main/profiles.ts:155-168`), while SSH profile listing hardcodes default `isActive: true` and named profiles `isActive: false` (`src/main/ssh/sessions-profiles.ts:217-238`). IPC also deliberately skips `setActiveProfile(name)` when connection mode is SSH (`src/main/ipc/sessions.ts:159-166`).

#### Runtime gaps

- **Main runtime split:** CLI fallback is profile-correct, but the preferred local API/gateway path is not. `sendMessage()` prefers API when remote mode is active or `apiServerAvailable` is true, and only falls back to CLI otherwise (`src/main/hermes/gateway.ts:15-43`). Because the API request has no profile and the gateway is started without `-p`, a named profile's selected toolsets/skills/memory/soul may not be the runtime context despite profile-scoped UI/storage writes.
- **Tool runtime consumption is only guaranteed on the CLI path.** Local Tools writes the selected profile's config and mirrors `cli`/`api_server` (`src/main/tools.ts:238-286`), but runtime consumption through API depends on the Hermes API server having been launched inside that same profile. Current gateway launch does not do that (`src/main/hermes/gateway.ts:85-114`).
- **Skills/memory/soul runtime consumption is only guaranteed on the CLI path.** Local UI/storage writes profile-specific files (`src/main/skills.ts:63-104`, `src/main/skills/importer.ts:153-211`, `src/main/memory.ts:34-126`, `src/main/soul.ts:12-35`), but API/gateway chat does not pass `-p` or a profile request field. The running server context decides which skills/memory/SOUL are loaded.
- **Gateway restarts sometimes receive profile, but start does not.** Config/env/model/platform mutations can call `restartGateway(profile)` or `sshStopGateway`/`sshStartGateway` (`src/main/ipc/config.ts:60-73`, `src/main/ipc/config.ts:100-130`, `src/main/ipc/gateway.ts:55-64`), yet the underlying local `startGateway(profile)` still omits `-p`, and the SSH start function has no profile argument (`src/main/hermes/gateway.ts:85-114`, `src/main/ssh/runtime.ts:27-33`).

#### SSH gaps

- **SSH tool definitions lag local definitions.** Local exposes `cronjob`, `moa`, and `todo` toolsets in addition to the common set (`src/main/tools.ts:85-97`), while SSH `TOOLSET_DEFS` stops at `delegation` (`src/main/ssh/config.ts:9-27`). SSH users cannot view/toggle the full local toolset surface.
- **SSH tool writes do not mirror `api_server`.** SSH parsing/writes only target `platform_toolsets.cli` (`src/main/ssh/config.ts:31-104`), unlike local mirroring to both `cli` and `api_server` (`src/main/tools.ts:171-183`, `src/main/tools.ts:281-286`). If SSH chat runs through the remote API server, UI toggles may not match actual tool availability.
- **SSH skill install/uninstall drops profile.** IPC receives `_profile` but the SSH branches call `sshInstallSkill(conn.ssh, identifier)` and `sshUninstallSkill(conn.ssh, name)` without passing it (`src/main/ipc/knowledge.ts:141-156`). SSH implementations have no profile parameter and run `hermes skills install/uninstall ...` globally (`src/main/ssh/skills.ts:73-90`). In contrast, local install/uninstall pass `-p <profile>` (`src/main/skills.ts:231-282`). SSH `listInstalledSkills` and Markdown import are profile-scoped (`src/main/ssh/skills.ts:11-69`, `src/main/ssh/skills.ts:95-155`), so install/uninstall are the inconsistent operations.
- **SSH MCP server listing is local-only.** Tools screen asks for `listMcpServers(profile)` (`src/renderer/src/screens/Tools/Tools.tsx:264-272`), preload forwards profile (`src/preload/api/app.ts:165-171`), but `list-mcp-servers` IPC always calls local `listMcpServers(profile)` and has no SSH branch (`src/main/ipc/system.ts:50-55`). `listMcpServers` itself reads local `HERMES_HOME`/profile config (`src/main/install/introspection.ts:124-183`). SSH Tools can therefore show local MCP servers while other SSH knowledge APIs operate on the remote host.
- **SSH profile commands may not match upstream naming.** Local profile create/delete use `hermes profile create/delete` (`src/main/profiles.ts:180-207`, `src/main/profiles.ts:217-246`), while SSH create/delete try `hermes profiles create/delete` and then fall back to filesystem operations (`src/main/ssh/sessions-profiles.ts:260-282`). The report background says upstream commands are singular `profile`; this divergence should be verified/fixed for parity.

#### Recommended fix points

1. **Make gateway/API runtime profile-addressed.** Change renderer/preload/IPC gateway start/status/stop APIs to accept `profile`, pass `activeProfile` from `Gateway.tsx`, and pass profile through SSH start/status/stop where possible (`src/renderer/src/screens/Gateway/Gateway.tsx:36-51`, `src/preload/api/navigation.ts:15-18`, `src/main/ipc/gateway.ts:21-35`).
2. **Launch Hermes gateway/API with upstream profile selection.** Local `startGateway(profile)` should invoke Hermes with `-p <profile>` for non-default profiles or set an equivalent profile-specific `HERMES_HOME`, and it should use profile-specific PID/config expectations if upstream writes them there (`src/main/hermes/gateway.ts:85-179`). SSH `sshStartGateway`, `sshGatewayStatus`, and `sshStopGateway` need the same profile parameter and should call `hermes -p <profile> gateway ...` or generated profile wrappers (`src/main/ssh/runtime.ts:12-43`).
3. **Do not rely on API body model selection as profile isolation.** Either ensure there is one API server per selected profile or add/support an explicit profile field/header in Hermes API calls, then update `sendMessageViaApi` accordingly (`src/main/hermes/chat-api.ts:30-43`). Until then, selected profile isolation is reliable only on CLI fallback.
4. **Profile-scope API server config and remote auth.** `ensureApiServerConfig` should accept profile and edit that profile's `config.yaml` (`src/main/hermes/connection.ts:89-113`). SSH API key reads should use the same profile as the tunnel/gateway target (`src/main/ssh/runtime.ts:50-56`).
5. **Fix SSH tool parity.** Share a single toolset definition list with local code or add the missing `cronjob`, `moa`, and `todo` keys to SSH (`src/main/tools.ts:85-97`, `src/main/ssh/config.ts:9-27`), and mirror SSH writes to both `platform_toolsets.cli` and `platform_toolsets.api_server` (`src/main/ssh/config.ts:31-104`).
6. **Fix SSH skill install/uninstall profile propagation.** Add `profile?: string` to `sshInstallSkill`/`sshUninstallSkill`, pass it from IPC, and run `hermes -p <profile> skills ...` for named profiles (`src/main/ipc/knowledge.ts:141-156`, `src/main/ssh/skills.ts:73-90`).
7. **Add SSH MCP server introspection.** Route `list-mcp-servers` through an SSH implementation when `conn.mode === "ssh"`, reading the selected remote profile's config rather than local `HERMES_HOME` (`src/main/ipc/system.ts:50-55`, `src/main/install/introspection.ts:124-183`).
8. **Clarify session browsing semantics in UI/tests.** Current global browsing/search across profiles appears intentional when no profile filter is passed (`src/main/sessions.ts:77-88`, `src/main/sessions.ts:166-177`, `src/main/session-cache.ts:284-322`), and resume uses the row profile (`src/renderer/src/screens/Layout/Layout.tsx:303-321`). Keep that global session browser, but test duplicate session ids across profiles and make the profile tag/resume behavior explicit to avoid cross-profile ambiguity.

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Mercury has profile objects but some or all tools/skills/memory APIs use global configuration/storage rather than profile-scoped paths or records.
**Findings:** Report created and Hermes skill checked for architectural expectation: profiles should isolate config, memory, sessions, skills, and gateway.
**Evidence:** `.agents/skills/hermes-agent/SKILL.md` describes Hermes profiles as isolated across config, memory, sessions, skills, and gateway.
**Conclusion:** Needs workspace investigation across profile, tools, skills, memory, soul, chat, IPC, and SSH profile integration code.

### Phase 1.5 - Upstream Hermes Profile Semantics
**Hypothesis:** Upstream Hermes expects profiles to isolate runtime state, not just UI metadata.
**Findings:** Upstream docs describe profiles as separate state homes with their own config, API keys, memory, sessions, skills, and gateway state. Profile selection is done via `hermes -p <profile> <command>`, sticky `hermes profile use`, or generated profile aliases.
**Evidence:** Upstream profiles guide, FAQ, toolsets reference, profile command docs, and CLI command docs linked in Background / Prior Research.
**Conclusion:** Mercury should either launch Hermes runtime with the selected profile or use an explicit upstream-supported per-request profile selector. Merely injecting selected-profile env into a default gateway is insufficient.

### Phase 2 - Context Builder Assessment
**Hypothesis:** The repo contains enough profile plumbing to distinguish storage isolation from runtime isolation.
**Findings:** Context Builder selected renderer, preload, IPC, local, SSH, Hermes gateway/API/CLI, session, tools, skills, memory, and soul files. Initial assessment predicted storage/UI isolation is mostly implemented, while API/gateway runtime propagation is the highest-risk gap.
**Evidence:** Selection included `src/main/utils.ts`, `src/main/tools.ts`, `src/main/skills.ts`, `src/main/memory.ts`, `src/main/soul.ts`, `src/main/hermes/*`, `src/main/ssh/*`, IPC handlers, preload APIs, and renderer screens.
**Conclusion:** Confirmed a broad, cross-layer investigation was required rather than a single-file lookup.

### Phase 3 - Pair Investigator Findings
**Hypothesis:** Tools/skills/memory/SOUL are profile-scoped in file-backed paths but can still be shared in practice if the runtime gateway is global/default.
**Findings:** Pair investigator confirmed local storage/UI isolation, CLI profile correctness, local API/gateway profile loss, and SSH parity gaps. Findings were appended above with file:line references.
**Evidence:** See `## Investigator Findings`, especially `src/main/hermes/gateway.ts:85-179`, `src/main/hermes/chat-api.ts:11-43`, `src/main/hermes/chat-cli.ts:45-66`, `src/main/tools.ts:238-286`, `src/main/skills.ts:63-104`, `src/main/memory.ts:34-126`, and `src/main/soul.ts:12-35`.
**Conclusion:** Root cause is runtime profile propagation, not wholesale lack of profile-specific storage.

### Phase 4 - Spot Check and Oracle Synthesis
**Hypothesis:** Pair findings are accurate and the final fix plan should prioritize runtime propagation.
**Findings:** Direct spot checks confirmed `profileHome()` pathing, profile-aware CLI, profile-less API body, default-home gateway PID/config, Gateway UI dropping profile, SSH gateway default state, SSH skill install/uninstall dropping profile, and SSH tools writing only `cli`.
**Evidence:** Spot-checked `src/main/utils.ts:19-26`, `src/main/hermes/gateway.ts:15-43` and `85-179`, `src/main/hermes/chat-api.ts:11-43`, `src/main/hermes/chat-cli.ts:45-66`, `src/main/hermes/connection.ts:89-113`, `src/renderer/src/screens/Gateway/Gateway.tsx:15-51`, `src/main/ipc/gateway.ts:21-35`, `src/main/ssh/runtime.ts:12-56`, `src/main/ssh/config.ts:9-104`, and `src/main/ssh/skills.ts:73-90`.
**Conclusion:** Final root cause and recommendations below are evidence-backed.

## Root Cause
Mercury carries `profile` through most renderer, preload, IPC, and file-backed storage flows, but it does not consistently carry that profile into the Hermes runtime process used for API/gateway chat.

The decisive split is:

- **Storage/UI layer:** Mostly profile-scoped. `profileHome(profile)` maps named profiles to `HERMES_HOME/profiles/<name>` (`src/main/utils.ts:19-26`). Local tools write selected-profile `config.yaml` (`src/main/tools.ts:238-286`), skills use selected-profile directories or `-p` for local install/uninstall (`src/main/skills.ts:63-104`, `src/main/skills.ts:231-282`), memory uses selected-profile `memories/MEMORY.md`, `USER.md`, and `state.db` (`src/main/memory.ts:34-126`), and SOUL uses selected-profile `SOUL.md` (`src/main/soul.ts:12-35`).
- **CLI runtime:** Profile-aware. `sendMessageViaCli` inserts `-p <profile>` for named profiles before running `chat` (`src/main/hermes/chat-cli.ts:45-66`).
- **API/gateway runtime:** Not profile-aware. `sendMessage()` prefers API when ready (`src/main/hermes/gateway.ts:15-43`), but `startGateway(profile)` spawns `hermes gateway` without `-p`, sets `HERMES_HOME` to default, and reads default `HERMES_HOME/gateway.pid` (`src/main/hermes/gateway.ts:85-179`). `sendMessageViaApi` only uses `profile` to choose Mercury's outgoing model and sends `{ model, messages, stream }` without a profile selector (`src/main/hermes/chat-api.ts:11-43`). `ensureApiServerConfig()` edits only default `HERMES_HOME/config.yaml` (`src/main/hermes/connection.ts:89-113`).

Therefore the user's fear is **correct in practice for API/gateway chat**: a named profile may show separate tools, skills, memory, and SOUL in Mercury, but the running assistant may still be the default/global Hermes runtime.

## Eliminated / Qualified Hypotheses
- **"Mercury has no per-profile storage for tools."** Mostly eliminated locally. Local tool config is profile-scoped and mirrored to `cli` and `api_server`; the runtime gateway is the weak link.
- **"Mercury has no per-profile storage for skills."** Mostly eliminated locally. Installed/imported skills are profile-scoped and local install/uninstall adds `-p`; bundled skill catalog is global by design.
- **"Mercury has no per-profile memory or SOUL files."** Eliminated for file-backed local and SSH paths. The risk is whether the runtime loads those selected-profile files.
- **"Sessions necessarily leak between profiles."** Qualified. Session browsing/search is global by default, but rows carry profile metadata and resume switches to the row profile. This is likely intentional but needs tests for duplicate session IDs and explicit UI semantics.

## Recommendations
1. **Make gateway lifecycle profile-aware end to end.** Add `profile` to renderer/preload/IPC gateway `start`, `stop`, and `status` calls; pass `activeProfile` from `Gateway.tsx`; update local `startGateway`, `stopGateway`, `isGatewayRunning`, and `restartGateway` accordingly.
2. **Launch Hermes gateway with selected profile.** For named profiles, run upstream profile selection (`hermes -p <profile> gateway ...` or equivalent profile-specific `HERMES_HOME`) instead of only injecting selected-profile `.env` into a default-home process.
3. **Track API readiness by profile.** Replace the single global `apiServerAvailable` cache with profile-aware runtime state, or track the active gateway profile and refuse/restart when the selected profile differs.
4. **Make API server config profile-scoped.** Change `ensureApiServerConfig()` to accept `profile` and edit `profileHome(profile)/config.yaml`, creating a minimal config if needed.
5. **Decide the API profile contract.** If upstream Hermes supports per-request profile selection, include it in `sendMessageViaApi`. If not, Mercury must ensure one running API server/gateway is selected for the active profile before sending chat.
6. **Fix SSH runtime parity.** Add profile parameters to `sshStartGateway`, `sshStopGateway`, `sshGatewayStatus`, and `sshReadRemoteApiKey`; run remote commands as `hermes -p <profile> ...`; use profile-specific gateway PID/log/API key paths where upstream writes them.
7. **Fix SSH tools and skills parity.** Share local toolset definitions or add missing `cronjob`, `moa`, and `todo`; mirror SSH tool writes to both `platform_toolsets.cli` and `platform_toolsets.api_server`; pass profile through SSH skill install/uninstall and run remote `hermes -p <profile> skills ...`.
8. **Harden config helpers.** Replace regex-only config editing with YAML/dotted-path-aware helpers for `memory.provider`, `network.*`, `agent.service_tier`, and similar nested config. Ensure setters create profile config when missing instead of silently returning false.
9. **Document intentional globals.** Keep bundled skill catalog global by design, but explicitly decide/document whether `models.json`, `auth.json` credential pool, desktop connection mode, and global session browsing should remain shared across profiles.

## Preventive Measures
- Add regression tests proving named-profile chat runtime uses selected-profile gateway/API/CLI state for tools, skills, memory, and SOUL.
- Add tests for gateway profile switching while a different profile's gateway is already running.
- Add tests for fresh profile config creation and toolset toggling.
- Add SSH parity tests for gateway commands, remote API key lookup, toolset mirroring, and skill install/uninstall profile flags.
- Add a runtime diagnostic/debug surface showing the profile currently backing the active gateway/API server; health checks should prove not just "server alive" but "server is using selected profile".
- Keep profile tags visible in global session search/browsing and test resume behavior when different profiles contain the same session ID.

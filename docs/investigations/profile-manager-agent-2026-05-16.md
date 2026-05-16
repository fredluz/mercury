# Investigation: Profile Manager Agent and Profile-First Mercury

## Summary
Mercury should become profile-first by launching into a Mercury-owned profile manager surface, built from the existing Profiles/Agents card grid, rather than into `New Chat / Agent: Default`. The current code already has profile card actions and profile-aware destination screens, but the shell is still chat-first, the sidebar exposes profile-specific controls globally, profile metadata/recency is too thin for recommendations, and API/gateway runtime isolation must be fixed before the UX can honestly promise separate agents.

## Symptoms
- Current Mercury has profile concepts, but the app opens into a normal active profile/chat flow (`New Chat`, `Agent: Default`) rather than a profile-selection or profile-manager experience.
- The desired launch experience includes a persistent/special "profile manager" agent that helps choose an existing profile or create a new one for the user's task.
- The UI should also expose a menu/list of recent profiles to quickly pick from.
- User-provided screenshots show Skills, Memory, Tools, Persona, Gateway, and related controls still exposed as global sidebar destinations. Desired design: once these are per-agent/profile, they should be accessed through the existing agent/profile menu button on each profile card, not through global sidebar items.
- Profiles grid already shows per-profile action buttons/icons on cards, suggesting a natural place to move profile-scoped Skills/Memory/Tools/Persona/Gateway controls.
- The earlier investigation found profile-backed storage is mostly isolated, but runtime gateway/API isolation is incomplete and must be solved for profile-first UX to be trustworthy.

## Background / Prior Research
- Prior report: `/Users/fredluz/Code/mercury/docs/investigations/profile-tools-skills-memory-isolation-2026-05-16.md`.
- Prior conclusion: local storage/UI for tools, skills, memory, and SOUL is mostly profile-scoped, but API/gateway runtime is not reliably profile-scoped. A profile-first UX depends on fixing runtime profile propagation.
- Upstream Hermes profile model: profiles are intended as separate state homes selected by `hermes -p <profile> <command>`, sticky active profile, or profile aliases. Each profile should have separate config, `.env`, skills, memory, sessions, SOUL, and gateway state.
- External upstream check found profile commands: `hermes profile list|use|create|delete|show|alias|rename|export|import|install|update|info`. Clone behavior is via `hermes profile create <name> --clone`, `--clone-all`, or `--clone-from <profile>`.
- Upstream sticky active profile is file-based (`~/.hermes/active_profile`), while aliases are generated wrappers like `~/.local/bin/<profile>` executing `hermes -p <profile> ...`.
- Upstream profile metadata is operational rather than recommendation-rich: model/provider, gateway state, env presence, skill count, alias path, distribution metadata. No built-in profile manager/recommender agent or per-profile description/last-used scoring was found.
- Upstream gateway constraints: per-profile gateway launch is supported via `hermes -p <profile> gateway ...` or aliases, but profiles cannot simultaneously use the same messaging bot token.
- Impeccable context loader found no `PRODUCT.md` or `DESIGN.md`; this report therefore avoids brand-specific visual styling and focuses on architecture, product flow, and implementation seams.

## Investigator Findings
<!-- Pair investigator appends structured analysis here: file:line refs, evidence, conclusions. -->

### 2026-05-16 - Profile-first launch/profile-manager investigation

#### Current architecture

- **App launch enters the normal chat shell, not a profile manager.** `App` starts at `screen = "splash"` (`src/renderer/src/App.tsx:18`), runs install/connection checks that choose `welcome`, `setup`, or `main` (`src/renderer/src/App.tsx:23-82`), then renders `<Layout />` for `main` (`src/renderer/src/App.tsx:156-157`). `Layout` starts with `view = "chat"` (`src/renderer/src/screens/Layout/Layout.tsx:82`), `activeProfile = "default"` (`src/renderer/src/screens/Layout/Layout.tsx:89`), and `visitedViews = new Set(["chat"])` (`src/renderer/src/screens/Layout/Layout.tsx:94-96`). That is why launch lands in Chat rather than Profiles/profile manager.
- **The “New Chat / Agent: Default” header is a direct result of that initial state.** `ChatHeader` chooses `t("chat.title")` when there is no title and `messages.length === 0` (`src/renderer/src/screens/Chat/components/ChatHeader.tsx:43-50`), and maps default/missing profile to `t("chat.defaultAgent")` (`src/renderer/src/screens/Chat/components/ChatHeader.tsx:51`). The English strings are `title: "New Chat"`, `defaultAgent: "Default"`, and `agentIdentity: "Agent: {{profile}}"` (`src/shared/i18n/locales/en/chat.ts:2-5`).
- **Layout routing is internal state, not URL/router based.** `goTo` adds a view to `visitedViews` and sets `view` (`src/renderer/src/screens/Layout/Layout.tsx:108-111`). Sidebar buttons call `goTo(v)` (`src/renderer/src/screens/Layout/Layout.tsx:313-321`), new chat clears session state and returns to chat (`src/renderer/src/screens/Layout/Layout.tsx:214-227`), and session resume switches to the row profile when present before returning to chat (`src/renderer/src/screens/Layout/Layout.tsx:271-289`). Non-chat panes lazy-mount only after first visit and then stay mounted behind `display: none` via `paneStyle` (`src/renderer/src/screens/Layout/Layout.tsx:100-106`, `src/renderer/src/screens/Layout/Layout.tsx:355-496`).
- **Persisted active profile is not loaded into Layout on mount.** The profiles backend reads `HERMES_HOME/active_profile` and marks profiles active (`src/main/profiles.ts:82-94`, `src/main/profiles.ts:111-168`), and `setActiveProfile` shells out to `hermes profile use <name>` (`src/main/profiles.ts:241-253`), but `Layout` initializes local state to `"default"` and only changes it through profile selection/session resume (`src/renderer/src/screens/Layout/Layout.tsx:89`, `src/renderer/src/screens/Layout/Layout.tsx:241-249`, `src/renderer/src/screens/Layout/Layout.tsx:271-289`).
- **Existing profile manager foundation is the Agents/Profiles screen.** `Agents` loads `window.hermesAPI.listProfiles()` (`src/renderer/src/screens/Agents/Agents.tsx:82-86`), creates profiles via `createProfile(name, cloneConfig)` (`src/renderer/src/screens/Agents/Agents.tsx:91-105`), deletes via `deleteProfile(name)` (`src/renderer/src/screens/Agents/Agents.tsx:107-114`), and selects via `setActiveProfile(name)` followed by `onSelectProfile(name)` (`src/renderer/src/screens/Agents/Agents.tsx:116-120`). Cards render from `profiles.map` (`src/renderer/src/screens/Agents/Agents.tsx:220-324`) and show model/provider/skill/gateway status (`src/renderer/src/screens/Agents/Agents.tsx:242-259`).
- **Profile actions already route through the right selection seam.** Current card actions are `chat`, `skills`, `tools`, `soul`, and `memory` (`src/renderer/src/screens/Agents/Agents.tsx:28-38`). Clicking one calls `handleProfileAction`, which first awaits `handleSelect(name)` and then calls `onProfileAction(view)` (`src/renderer/src/screens/Agents/Agents.tsx:123-128`). `Layout` wires `onProfileAction={goTo}` (`src/renderer/src/screens/Layout/Layout.tsx:403-412`) and passes `activeProfile` into destination screens such as `Providers`, `Skills`, `Soul`, `Memory`, `Tools`, `Schedules`, `Gateway`, and `Settings` (`src/renderer/src/screens/Layout/Layout.tsx:419-496`).

#### Evidence for desired sidebar move

- **The sidebar exposes profile-scoped controls globally today.** `NAV_ITEMS` includes Chat, Sessions, Profiles, Models, Providers, Skills, Persona/Soul, Memory, Tools, Schedules, Gateway, and Settings (`src/renderer/src/screens/Layout/Layout.tsx:58-78`), and renders all of them as global sidebar buttons (`src/renderer/src/screens/Layout/Layout.tsx:313-321`). English navigation labels confirm `soul: "Persona"`, plus Providers/Skills/Memory/Tools/Schedules/Gateway (`src/shared/i18n/locales/en/navigation.ts:1-14`).
- **Most of those destinations are already profile-aware.** `Layout` passes `activeProfile` to Providers, Skills, Soul/Persona, Memory, Tools, Schedules, Gateway, and Settings (`src/renderer/src/screens/Layout/Layout.tsx:419-496`). That means demoting/removing those global sidebar items is primarily a navigation/product change, not a rewrite of the destination screens.
- **The card action rail is the natural replacement, but it is incomplete.** Profile cards already expose Chat, Skills, Tools, Persona, and Memory actions (`src/renderer/src/screens/Agents/Agents.tsx:28-38`, `src/renderer/src/screens/Agents/Agents.tsx:261-280`) with labels in `agents.ts` (`src/shared/i18n/locales/en/agents.ts:18-22`). Missing per-card actions are **Providers, Gateway, and Schedules** even though those are profile-scoped destinations in `Layout` (`src/renderer/src/screens/Layout/Layout.tsx:419-496`).
- **Safe demotion path:** keep global Chat/Sessions/Profiles and truly app-level Settings/Models as primary navigation; move Providers/Skills/Persona/Memory/Tools/Schedules/Gateway behind each profile card/menu after adding the missing card actions. Until runtime isolation is fixed, visually demoting Gateway should be paired with warnings because current Gateway start/status is not actually profile-addressed (see Runtime prerequisite).

#### Data/metadata gaps

- **Current `ProfileInfo` is operational, not product/recommendation rich.** It exposes `name`, `path`, `isDefault`, `isActive`, `model`, `provider`, `hasEnv`, `hasSoul`, `skillCount`, and `gatewayRunning` (`src/main/profiles.ts:15-25`). The list builder fills those fields for default and named profile directories (`src/main/profiles.ts:111-168`). There is no description, purpose, icon/color, pinned, hidden/manager, createdAt, updatedAt, lastUsedAt, recommendation score, or onboarding/completion metadata.
- **Session data can derive recency but not intent.** `CachedSession` has `id`, `title`, `startedAt`, `source`, `messageCount`, `model`, and `profile` (`src/main/session-cache.ts:20-28`). Cache sync records global `lastSync` and per-profile `profileSync` (`src/main/session-cache.ts:30-33`, `src/main/session-cache.ts:313-314`), and `listCachedSessions` can filter by profile and sort by session start time (`src/main/session-cache.ts:328-341`). This supports a “recent profiles” picker by taking max session `startedAt` per profile, but not a high-quality recommender.
- **Session DB/profile scope is already partitioned.** `session-db.ts` maps profile names to `profileHome(profile)/state.db` and discovers default plus `HERMES_HOME/profiles/*` (`src/main/session-db.ts:15-31`, `src/main/session-db.ts:33-60`). `listSessions`/`searchSessions` aggregate all profiles when no profile filter is supplied, or use one profile scope when provided (`src/main/sessions.ts:95-109`, `src/main/sessions.ts:180-192`). Existing tests cover aggregated profile metadata and duplicate session IDs across profiles (`tests/sessions-profile-db.test.ts:76-134`).
- **Recommended new metadata:** add a profile metadata file/API (for example `profile.json` or a `profiles` table under desktop state) with `displayName`, `description`, `purpose`, `tags`, `icon/color`, `pinned`, `hidden`, `isManager`, `createdAt`, `updatedAt`, `lastUsedAt`, and optional `recommendedFor`/`embeddingSummary`. Keep recency derivation from sessions as a fallback; update explicit `lastUsedAt` on profile selection/card action/chat send/resume.
- **Manager hiding needs first-class metadata.** `listProfiles()` treats any non-dot directory under `HERMES_HOME/profiles` as a profile and deliberately does not require config/env so fresh profiles remain visible (`src/main/profiles.ts:131-168`). A hidden manager profile implemented as a real Hermes profile would appear unless `listProfiles` gains hidden-profile metadata/filtering.

#### Runtime prerequisite

- **Renderer/profile plumbing is mostly present, but the preferred runtime path can lose it.** Chat receives `profile={activeProfile}` (`src/renderer/src/screens/Layout/Layout.tsx:335-352`), preload forwards profile to `send-message` (`src/preload/api/chat.ts:6-19`), and the CLI fallback adds `-p <profile>` for named profiles (`src/main/hermes/chat-cli.ts:45-66`).
- **API/gateway chat is not profile-isolated.** `sendMessage` prefers API when remote mode or `apiServerAvailable` is true, falling back to CLI only otherwise (`src/main/hermes/gateway.ts:15-43`). `sendMessageViaApi` uses `profile` only for model lookup and sends a body with `model`, `messages`, and `stream`, not a profile selector (`src/main/hermes/chat-api.ts:11-43`). `startGateway(profile)` injects profile env vars but spawns `[HERMES_SCRIPT, "gateway"]` with `HERMES_HOME` set to the default home and no `-p <profile>` (`src/main/hermes/gateway.ts:85-114`); status/stop use default `HERMES_HOME/gateway.pid` (`src/main/hermes/gateway.ts:133-179`).
- **Gateway UI drops profile at the action boundary.** `Gateway` receives `profile` and uses it for env/platform reads and writes (`src/renderer/src/screens/Gateway/Gateway.tsx:4-25`, `src/renderer/src/screens/Gateway/Gateway.tsx:60-70`), but `toggleGateway` calls `startGateway()`, `stopGateway()`, and `gatewayStatus()` without profile (`src/renderer/src/screens/Gateway/Gateway.tsx:20-51`). The preload and IPC gateway APIs also have no profile parameter for start/stop/status (`src/preload/api/navigation.ts:15-18`, `src/main/ipc/gateway.ts:21-41`).
- **Schedules are more profile-aware locally but still inherit remote/API caveats.** The Schedules screen passes profile into list/create/remove/pause/resume/run calls (`src/renderer/src/screens/Schedules/Schedules.tsx:60-72`, `src/renderer/src/screens/Schedules/Schedules.tsx:133-148`), IPC forwards it (`src/main/ipc/cron.ts:10-40`), local cron commands add `-p <profile>` (`src/main/cronjobs.ts:140-159`), and local reads use `profileHome(profile)/cron/jobs.json` (`src/main/cronjobs.ts:22-31`, `src/main/cronjobs.ts:95-134`). In remote mode, however, cron APIs hit the currently running API server without a profile selector (`src/main/cronjobs.ts:74-91`, `src/main/cronjobs.ts:95-116`, `src/main/cronjobs.ts:171-193`).
- **Design choice: Mercury-owned launcher is safer than a real hidden Hermes profile right now.** A Mercury-owned profile manager launch surface can be an app-level view/agent that reads profile/session metadata and routes the user into a selected runtime without pretending to be an isolated Hermes profile. A real hidden Hermes profile would require hiding/filter metadata, avoid appearing in the normal profile directory scan, avoid stealing sticky active profile, and still depends on the unfixed gateway/API runtime profile propagation above. If a true manager agent is desired later, create it only after gateway/API lifecycle is profile-addressed and make it a reserved hidden profile with explicit metadata and no user task runtime.

#### Recommended implementation plan

1. **Phase 0 - Runtime isolation gate.** Add profile parameters through Gateway renderer/preload/IPC start/stop/status and SSH equivalents, launch local/SSH gateway/API with upstream profile selection (`hermes -p <profile> gateway ...`) or a supported profile header, make API readiness profile-aware instead of a single `apiServerAvailable`, and update `ensureApiServerConfig` to edit the selected profile config. Key files: `src/renderer/src/screens/Gateway/Gateway.tsx`, `src/preload/api/navigation.ts`, `src/main/ipc/gateway.ts`, `src/main/hermes/gateway.ts`, `src/main/hermes/chat-api.ts`, `src/main/hermes/connection.ts`, `src/main/ssh/runtime.ts`.
2. **Phase 1 - Profile metadata and recency.** Extend `ProfileInfo`/preload types and add a metadata store for description/purpose/pinned/hidden/lastUsedAt/recommendation fields. Backfill recent ordering from `session-cache` max `startedAt` by profile, then update explicit `lastUsedAt` on profile select/card action/chat send/session resume. Key files: `src/main/profiles.ts`, `src/preload/api/navigation.ts`, `src/main/session-cache.ts`, `src/main/ipc/sessions.ts`, `src/renderer/src/screens/Agents/Agents.tsx`.
3. **Phase 2 - Launch/navigation refactor.** Introduce a first-class launch view such as `profileManager` or make `agents` the initial main view after setup. Update `Layout` initial `view`/`visitedViews`, load persisted active profile instead of hardcoding default, and provide a recent/recommended profile picker plus “new profile for this task”. Key files: `src/renderer/src/App.tsx`, `src/renderer/src/screens/Layout/Layout.tsx`, `src/renderer/src/screens/Agents/Agents.tsx`, `src/shared/i18n/locales/*/agents.ts`, `src/shared/i18n/locales/*/navigation.ts`.
4. **Phase 3 - Move profile-scoped controls to profile cards/menu.** Add Providers/Gateway/Schedules card actions; consider a compact overflow/menu for Skills, Memory, Tools, Persona, Providers, Gateway, Schedules, Settings. Remove or demote global sidebar entries for profile-scoped screens once card/menu routing covers them. Key files: `src/renderer/src/screens/Agents/Agents.tsx`, `src/renderer/src/screens/Layout/Layout.tsx`, `src/shared/i18n/locales/*/agents.ts`, `src/shared/i18n/locales/*/navigation.ts`, `src/renderer/src/assets/styles/agents.css`, `src/renderer/src/assets/styles/layout.css`.
5. **Phase 4 - Manager agent behavior.** Start with a Mercury-owned launcher assistant that recommends profiles from metadata/session recency and can create/select profiles. Only later consider a reserved hidden Hermes profile for manager conversations after profile-runtime isolation is proven. The manager should route by calling the same `handleSelectProfile`/`goTo` seams rather than duplicating profile state.

#### Tests

- **Launch/profile-first tests:** extend `src/renderer/src/screens/Layout/Layout.test.tsx` to assert the initial main surface is profile manager/Profiles instead of Chat when configured, `visitedViews` includes the manager surface, persisted active profile is loaded, and selecting a recent profile routes to Chat with that profile.
- **Header regression tests:** extend `src/renderer/src/screens/Chat/components/ChatHeader.test.tsx` to keep the current “New Chat / Agent: Default” fallback but verify profile-first launch no longer renders that as the first post-setup surface.
- **Profile manager/card tests:** add/extend Agents tests for recent ordering, pinned/hidden manager filtering, missing actions added for Providers/Gateway/Schedules, and action sequencing: select profile first, then route.
- **Metadata tests:** extend `tests/profiles.test.ts` for new metadata fields, hidden profile exclusion, pinned ordering, and fallback behavior for profiles without metadata (fresh-profile behavior is currently covered at `tests/profiles.test.ts:43-114`).
- **Recency tests:** extend `tests/session-cache-sync.test.ts` and `tests/sessions-profile-db.test.ts` for deriving profile recency from sessions, explicit `lastUsedAt` updates, duplicate session IDs across profiles, and global-vs-profile-filtered session browsing.
- **Runtime prerequisite tests:** add main-process tests for gateway/API profile propagation: `startGateway("work")` invokes Hermes with `-p work` or selected profile home, gateway status/readiness is keyed by profile, `Gateway.tsx` passes profile through start/stop/status, and API/remote cron/chat paths cannot silently use a different profile runtime.


## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Mercury already has enough profile CRUD/session/UI infrastructure to support a profile-first launcher, but needs a first-class launch mode, recent-profile ranking, a special profile manager agent/profile, and runtime profile isolation before routing to task profiles.
**Findings:** Prior investigation confirms profile runtime isolation is prerequisite work. User screenshots add a key UX requirement: global sidebar entries for Skills/Memory/Tools/Persona/Gateway should be removed or demoted once those become profile-specific, with profile card/agent-menu access replacing them. Need current-workspace investigation of launch flow, Layout activeProfile handling, Agents/Profile screens, Sessions recency data, chat routing, profile creation APIs, onboarding/Welcome/Setup surfaces, sidebar navigation, and docs.
**Evidence:** Prior report, upstream Hermes profile docs, and user-provided screenshots of Chat, Skills, Memory, and Profiles screens.
**Conclusion:** Proceed with context_builder, then pair investigation.

### Phase 1.5 - Upstream Profile Mechanics
**Hypothesis:** Upstream Hermes may already provide enough profile metadata or a manager concept to mirror in Mercury.
**Findings:** Upstream Hermes provides rich profile commands (`list`, `use`, `create`, `delete`, `show`, `alias`, `rename`, `export`, `import`, `install`, `update`, `info`) and clone flags (`--clone`, `--clone-all`, `--clone-from`), plus sticky active profile and wrapper aliases. It does not provide a profile recommender/manager agent or rich profile recency/description metadata.
**Evidence:** Upstream docs/repo findings recorded in Background / Prior Research.
**Conclusion:** Mercury must own the profile manager UX and metadata layer; upstream profile commands are useful implementation primitives but not the product experience.

### Phase 2 - Context Builder Assessment
**Hypothesis:** `Agents.tsx` and `Layout.tsx` likely contain the main seams for a profile-first launch and sidebar migration.
**Findings:** Context Builder confirmed `Layout` is chat-first/default-profile-first and that `Agents.tsx` is already the profile card grid/manager foundation. It also identified session cache as the best existing recency source and prior runtime isolation work as a prerequisite.
**Evidence:** Selected files included `App.tsx`, `Layout.tsx`, `Agents.tsx`, Chat components/hooks, Sessions/session-cache/session-db, profile IPC/preload contracts, Gateway/runtime files, and profile-scoped control screens.
**Conclusion:** Proceeded to pair investigation for line-evidence and implementation seams.

### Phase 3 - Pair Investigator Findings
**Hypothesis:** The desired design can be implemented mainly by promoting Agents into the launch surface, enriching profile metadata/recency, moving profile-scoped controls from sidebar to card/menu actions, and fixing runtime isolation.
**Findings:** Pair investigator confirmed the hypothesis with evidence: launch enters `Layout` in chat/default; `NAV_ITEMS` globally exposes profile-scoped controls; Agents already selects profiles before routing actions; `ProfileInfo` is operational but lacks product metadata; `CachedSession.profile` and `startedAt` can derive recents; runtime/API/gateway profile isolation remains the critical blocker.
**Evidence:** See `## Investigator Findings`, especially `src/renderer/src/screens/Layout/Layout.tsx:58-96`, `src/renderer/src/screens/Agents/Agents.tsx:28-38`, `82-128`, `220-280`, `src/main/profiles.ts:15-25`, `111-168`, and `src/main/session-cache.ts:20-33`, `328-341`.
**Conclusion:** `Agents.tsx` should become the Mercury-owned profile manager surface for V1. A real hidden Hermes manager profile should wait until runtime isolation is proven.

### Phase 4 - Spot Check and Oracle Synthesis
**Hypothesis:** Final recommendations should prioritize a Mercury-owned manager surface, runtime isolation, metadata/recency, then navigation/sidebar migration.
**Findings:** Direct spot checks confirmed `Layout` initial state, profile card actions, thin profile metadata, session recency fields, Gateway profile drop, and local cron profile behavior. Oracle synthesized a phased plan and risks.
**Evidence:** Spot-checked `src/renderer/src/App.tsx:156-157`, `src/renderer/src/screens/Layout/Layout.tsx:58-96`, `src/renderer/src/screens/Agents/Agents.tsx:28-128`, `220-280`, `src/main/profiles.ts:15-168`, `src/main/session-cache.ts:20-49`, `src/renderer/src/screens/Gateway/Gateway.tsx:1-75`, `src/preload/api/navigation.ts:1-35`, and `src/main/cronjobs.ts:1-210`.
**Conclusion:** Final root cause and recommendations below are evidence-backed.

## Root Cause
Mercury has profile infrastructure, but the product shell and runtime still treat `default` chat as the starting point and profile-specific configuration as globally reachable sidebar screens.

The current blockers are:

1. **Chat-first launch state.** `App.tsx` renders `Layout` after setup, and `Layout` initializes `view` to `"chat"`, `activeProfile` to `"default"`, and `visitedViews` to `chat`. That naturally produces the `New Chat / Agent: Default` startup instead of a profile manager.
2. **Global sidebar exposes profile-specific controls.** `Layout.NAV_ITEMS` includes Providers, Skills, Persona/Soul, Memory, Tools, Schedules, and Gateway as app-level navigation even though these screens receive `activeProfile` and should conceptually belong to a selected profile/agent.
3. **Profile card actions are promising but incomplete.** `Agents.tsx` already selects a profile then routes to Chat, Skills, Tools, Persona, or Memory. It lacks Providers, Gateway, Schedules, and profile settings/backup actions, and it needs an overflow/menu model rather than a growing icon rail.
4. **Profile metadata is not rich enough.** `ProfileInfo` only exposes operational state such as model/provider/env/soul/skillCount/gateway status. Recency can be derived from sessions, but purpose, description, pinned/hidden state, last-used, and recommendation fields do not exist.
5. **Runtime isolation remains prerequisite.** API/gateway chat and gateway start/status/stop are not reliably profile-addressed. A profile-first UI would be misleading until chat/gateway/remote/SSH runtime selection matches the selected profile.

## Architecture Decision
Use a **Mercury-owned profile manager surface** for V1, not a real hidden Hermes profile/agent.

Rationale:
- Choosing or creating a profile is app orchestration, not ordinary assistant work.
- A hidden Hermes manager profile would require hidden-profile metadata, filtering, memory/tool isolation, and runtime isolation that is not fully in place yet.
- The existing `Agents.tsx` card grid can become the manager surface immediately once launch/navigation and metadata work are done.
- A real reserved manager profile such as `__mercury_profile_manager` can be revisited later after profile runtime isolation is proven.

The manager surface can still feel agentic: it can ask “What are you working on?”, recommend a profile from deterministic metadata/recency, and offer to create a new profile for the task. But it should route through Mercury profile APIs rather than run as a normal task profile.

## Recommendations
1. **Fix profile runtime isolation first or in the same first milestone.** Add profile parameters through Gateway renderer/preload/IPC start/stop/status; launch local and SSH gateway/API with selected upstream profile (`hermes -p <profile> gateway ...` or equivalent); make API readiness/profile state keyed by selected profile; update `ensureApiServerConfig(profile)`; prevent chat/cron/API calls from silently using a mismatched runtime. Key files: `Gateway.tsx`, `preload/api/navigation.ts`, `preload/index.d.ts`, `ipc/gateway.ts`, `hermes/gateway.ts`, `hermes/chat-api.ts`, `hermes/connection.ts`, `ipc/chat.ts`, `ssh/runtime.ts`.
2. **Promote Agents into the launch surface.** In `Layout.tsx`, initialize to `agents` or a new `profileManager` view instead of `chat`; initialize `visitedViews` accordingly; avoid visually selecting `default` as the startup workspace. Longer term, split `selectedProfile: string | null` from `activeProfile` so launch can mean “no work profile selected yet.”
3. **Build recent profile ranking.** Derive V1 recents from max `CachedSession.startedAt` per `CachedSession.profile`, keeping profiles without sessions visible. Later persist explicit `lastUsedAt` on profile select, card action, chat send, and session resume.
4. **Add profile metadata.** Extend or supplement `ProfileInfo` with `displayName`, `description`, `purpose`, `tags`, `icon/color`, `pinned`, `hidden`, `isManager`, `createdAt`, `updatedAt`, `lastUsedAt`, `lastChatAt`, and optional recommendation fields. Store in a Mercury metadata file/API or profile-local metadata; preserve fresh-profile visibility.
5. **Move profile-scoped controls behind profile cards/menus.** Extend `Agents.tsx` actions to include Providers, Gateway, Schedules, and profile settings/backup/import. Replace the fixed icon rail with a primary Chat button plus an overflow Configure menu containing Skills, Memory, Tools, Persona, Providers, Gateway, Schedules, and profile settings.
6. **Clean up the global sidebar.** After card/menu parity exists, remove/demote Providers, Skills, Persona/Soul, Memory, Tools, Schedules, and Gateway from `Layout.NAV_ITEMS`. Keep app-level navigation such as Profiles/Manager, Sessions, Models if intentionally global, Settings, and optionally Trace Activity.
7. **Split global vs profile settings.** Treat profile configuration as card/menu-scoped: Providers/model/API env, Skills, Tools, Memory, Persona, Schedules, Gateway, profile backup/import. Keep global app settings for theme/language, connection mode, install/update/doctor, logs, and any explicitly shared model/credential pools.
8. **Use deterministic recommendations first.** Start with rules based on pinned profiles, recency, tags/purpose text, skill/tool availability, and session titles. Defer a real manager assistant until metadata and runtime isolation are reliable.

## Sidebar/Menu Migration Strategy
1. Add missing profile actions in `Agents.tsx`: Providers, Gateway, Schedules, Profile settings.
2. Replace the current five-icon card rail with a clearer menu model: primary Chat, optional Resume, Configure overflow.
3. Route every Configure item through the existing safe seam: select profile first, then `goTo(view)`.
4. Keep old sidebar entries temporarily behind a feature flag or during transition if needed.
5. Remove profile-scoped sidebar entries after parity tests pass.
6. Keep global sidebar focused on app-level areas, not selected-profile internals.

This directly matches the screenshot feedback: Skills, Memory, Tools, Persona, Gateway, and similar controls should no longer look global once they are per-agent/profile.

## Open Decisions / Risks
- **Manager identity:** Mercury-owned launcher now vs real hidden Hermes profile later. Recommendation: Mercury-owned now.
- **Remote HTTP mode:** If the remote API has no profile selector, Mercury can only report that profile isolation is managed externally.
- **Models and credential pool:** Decide whether `models.json` and `auth.json` remain global or move/profile-shadow into profile configuration.
- **Settings split:** Current Settings mixes global and profile-scoped concerns; profile-first UX needs a clearer division.
- **Gateway port/token conflicts:** Multiple profile gateways may conflict on ports or messaging bot tokens; UI must make this visible.
- **Hidden profile filtering:** If a real manager profile is later created, `listProfiles()` must support hidden/reserved profiles so it does not appear as a normal work profile.

## Preventive Measures
- Add renderer tests proving the post-setup main surface is profile manager, not `New Chat / Agent: Default`.
- Add Agents/ProfileManager tests for recent sorting, pinned profiles, hidden filtering, missing/no-session profiles, and action sequencing: select profile first, route second.
- Add tests for sidebar cleanup so profile-specific entries are absent from global nav once card/menu parity lands.
- Add metadata tests in `profiles.test.ts` for new fields, fallback behavior, and hidden/reserved profile handling.
- Add recency tests in `session-cache-sync.test.ts` and `sessions-profile-db.test.ts`, including duplicate session IDs across profiles.
- Add runtime tests proving gateway start/status/stop, API readiness, chat send, remote/SSH paths, and cron/API paths use or validate the selected profile.
- Add UI diagnostics showing which profile currently backs the active gateway/API runtime, so “server alive” cannot be mistaken for “correct profile active.”

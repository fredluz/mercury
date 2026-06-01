# Investigation: Profile Skill Allocation and Persistence

## Summary
This investigation records the pre-fix failure modes and the 2026-05-31 implementation notes. Current behavior after the implementation notes below: Mercury presents Hermes profiles as Agents; newly created local/SSH Agents start with skills off; pure remote profile/skill mutations fail closed; and skill enable/disable is still install/uninstall under the selected profile's `skills/` directory, not a separate boolean flag. Skill state is persistent because it is filesystem-backed, but changes affect future runtime context after runtime reload/revalidation rather than rewriting historical sessions.

## Symptoms
- User wants to understand how skill allocation works for each agent/profile.
- User asks what actually happens when a skill is enabled or disabled for a profile/specification.
- User asks whether that enabled/disabled state persists.

## Background / Prior Research
No external research required so far; this appears to be implemented in the workspace.

## Investigator Findings
<!-- Pair investigator will append structured findings here. -->

### 2026-05-31 - Pair investigation: profile-scoped skill allocation, persistence, and runtime impact

#### Executive conclusion

- **Agents in the UI are Hermes profiles.** The user-facing Agents screen is a profile manager over `ProfileInfo` records; it calls `listProfiles`, `createProfile`, and `setActiveProfile`, while product copy/action labels present those profiles as Agents (`src/renderer/src/screens/Agents/Agents.tsx:18-29`, `src/renderer/src/screens/Agents/Agents.tsx:82-89`, `src/renderer/src/screens/Agents/Agents.tsx:209-220`, `src/renderer/src/screens/Agents/Agents.tsx:342-430`).
- **Skill enable/disable is install/uninstall for the selected profile, not a persisted boolean flag.** The Skills renderer computes `enabled` by matching bundled skills against installed profile skills (`src/renderer/src/screens/Skills/Skills.tsx:348-370`), and the buttons call `installSkill(skill.name, profile)` or `uninstallSkill(targetName, profile)` (`src/renderer/src/screens/Skills/Skills.tsx:231-264`, `src/renderer/src/screens/Skills/Skills.tsx:272-315`). Mercury does not store a separate skill-enabled boolean.
- **Persistence is filesystem-backed for Mercury's skill state.** Installed skill state is derived by walking `<profileHome>/skills/<category>/<skill>/SKILL.md` (`src/main/skills.ts:61-113`), where `profileHome()` maps `default` to `HERMES_HOME` and named profiles to `HERMES_HOME/profiles/<name>` (`src/main/utils.ts:18-26`). Disabled, from Mercury's perspective, is absence from the installed-skill listing; I found no Mercury deny-list/tombstone layer.
- **Skill mutations mark the selected profile runtime stale; toolset mutations currently do not.** Successful local or SSH skill install/uninstall calls `markProfileMutation(profile, "Skills")`, which calls `markRuntimeStale(profile, "Skills changed for profile runtime.")` (`src/main/services/knowledge-service.ts:46-48`, `src/main/services/knowledge-service.ts:195-215`). By contrast, `setToolsetEnabledForProfile` deliberately returns the config write result without stale marking (`src/main/services/knowledge-service.ts:145-154`).
- **Current SSH behavior is profile-aware.** Contrary to older investigation notes, current `installSkillForProfile` and `uninstallSkillForProfile` pass `profile` into `sshInstallSkill`/`sshUninstallSkill` (`src/main/services/knowledge-service.ts:195-214`), and SSH commands use `hermes -p <profile>` for named profiles (`src/main/ssh/skills.ts:129-164`, `tests/ssh-remote.test.ts:49-53`).
- **Pure remote HTTP remains asymmetric.** The renderer hides filesystem-backed Skills UI in pure remote mode (`src/renderer/src/screens/Layout/Layout.tsx:681-687`) and manual Markdown import explicitly fails in `mode === "remote"` (`src/main/services/knowledge-service.ts:223-239`), but install/uninstall only special-case SSH and otherwise fall through to local install/uninstall (`src/main/services/knowledge-service.ts:195-214`). So non-UI callers in pure remote mode would mutate local profile skills, not the remote runtime.

#### Renderer Skills UI -> preload/IPC -> service flow

1. `Layout` passes the currently selected profile into Skills: `<Skills profile={activeProfile} />` (`src/renderer/src/screens/Layout/Layout.tsx:681-687`). In pure remote mode the pane is replaced by `RemoteNotice` instead of mounting Skills.
2. `Skills` loads installed profile skills with `window.hermesAPI.listInstalledSkills(profile)` and bundled skills with `listBundledSkills()` (`src/renderer/src/screens/Skills/Skills.tsx:101-118`).
3. The visible rows are grouped by category and carry `enabled: true` for installed skills or `enabled: Boolean(fallbackInstalled)` for bundled skills (`src/renderer/src/screens/Skills/Skills.tsx:338-370`).
4. The category/row component labels installed/matched rows as enabled and unmatched bundled rows as disabled, with buttons labelled Enable/Disable/Enable all/Disable all/Disable enabled (`src/renderer/src/screens/Skills/components/SkillCategorySection.tsx:70-113`, `src/renderer/src/screens/Skills/components/SkillCategorySection.tsx:133-184`; English labels at `src/shared/i18n/locales/en/skills.ts:41-48`).
5. Individual enable calls `window.hermesAPI.installSkill(skill.name, profile)`; individual disable calls `window.hermesAPI.uninstallSkill(targetName, profile)` (`src/renderer/src/screens/Skills/Skills.tsx:231-264`). Bulk actions loop sequentially and call the same APIs for each target (`src/renderer/src/screens/Skills/Skills.tsx:272-315`).
6. Preload exposes those methods as IPC invokes on `install-skill` and `uninstall-skill` (`src/preload/api/knowledge.ts:59-86`), and main IPC delegates the channels to `installSkillForProfile`/`uninstallSkillForProfile` (`src/main/ipc/knowledge.ts:73-92`).
7. The detail view reinforces profile-as-agent terminology: it asks `listProfiles()`, then for each profile calls `listInstalledSkills(agent.name)` to show “Agents using this skill” (`src/renderer/src/screens/Skills/Skills.tsx:131-159`; copy at `src/shared/i18n/locales/en/skills.ts:54-64`).

#### Local and SSH storage/operation details

- Local installed-skill listing is purely directory-based under `join(profileHome(profile), "skills")`; it parses each `SKILL.md` frontmatter for display metadata (`src/main/skills.ts:61-113`).
- Local install shells out to Hermes as `hermes skills install <identifier> --yes`; named profiles insert `-p <profile>` before `skills` (`src/main/skills.ts:319-346`). Local uninstall similarly shells out to `hermes skills uninstall <name>` with optional `-p <profile>` (`src/main/skills.ts:348-375`).
- Manual Markdown import writes `SKILL.md` directly under the selected profile's `skills/<category>/<name>/` directory and rejects invalid profile/name/category/path escapes (`src/main/skills/importer.ts:146-211`). Tests verify default-profile writes, named-profile writes, duplicate handling, overwrite behavior, and metadata discovery (`tests/skills-import.test.ts:22-196`).
- SSH installed-skill listing scans `~/.hermes/skills` for default or `~/.hermes/profiles/<profile>/skills` for named profiles, then prefixes returned paths with `REMOTE:` (`src/main/ssh/skills.ts:11-64`).
- SSH install/uninstall executes remote `hermes` commands via `sshExec`; `hermesProfileCommand()` inserts `-p <profile>` for named profiles (`src/main/ssh/skills.ts:129-164`). `tests/ssh-remote.test.ts:49-53` locks this in for skill commands.
- SSH manual Markdown import also writes remote `SKILL.md` directly into the profile-scoped skills directory (`src/main/ssh/skills.ts:167-230`).

#### Runtime stale behavior and chat/session implications

- `markRuntimeStale` stores stale state in the in-memory profile runtime manager: it sets `staleReason`, `staleAt`, and `apiServerAvailable = false` (`src/main/hermes/runtime/manager.ts:380-386`). Starting a managed gateway clears the stale marker on the new runtime state (`src/main/hermes/runtime/manager.ts:238-256`).
- `clearRuntimeStale` refuses to clear a stale marker unless a verified identity exists and was verified after the stale timestamp; `revalidateRuntime` temporarily clears stale to resolve the runtime and only permanently clears it if profile identity verifies (`src/main/hermes/runtime/manager.ts:388-431`). Tests assert stale diagnostics and that stale markers survive until revalidation (`tests/hermes-runtime.test.ts:631-689`).
- Chat sends go through `prepareChatBackend(profile, "chat", sessionId)` before creating/resuming server sessions and sending the message (`src/main/services/chat-service.ts:146-185`, `src/main/services/chat-service.ts:461-478`). Local runtime resolution fails fast if `state.staleReason` exists, returning `runtime-stale-after-profile-switch` (`src/main/hermes/runtime/local-runtime.ts:60-88`).
- Therefore skill changes affect future runtime resolution / future messages for that profile. I found no code path that rewrites historical session records when a skill is enabled or disabled; existing `resumeSessionId` is only used after runtime preparation succeeds (`src/main/services/chat-service.ts:461-478`).

#### Profile listing and Agents UI `skillCount`

- Local `listProfiles()` includes `skillCount` in `ProfileInfo` (`src/main/profiles.ts:15-25`). It counts skills by walking each profile's `skills` directory for nested `SKILL.md` files (`src/main/profiles.ts:72-91`) and assigns that count to both default and named profile records (`src/main/profiles.ts:150-171`, `src/main/profiles.ts:190-209`).
- SSH profile listing mirrors that shape and counts remote `skills` directories in Python (`src/main/ssh/sessions-profiles.ts:164-250`).
- The sessions IPC/preload path forwards profile listing unchanged via `list-profiles` (`src/main/ipc/sessions.ts:35`, `src/preload/api/navigation.ts:87-100`).
- Agents UI renders the count in the card stats as `agents.skillsCount` with `profile.skillCount` (`src/renderer/src/screens/Agents/Agents.tsx:385-389`).
- Test coverage gap: `tests/profiles.test.ts` covers profile discovery/model/gateway/active profile behavior but has no direct `skillCount` assertion (`tests/profiles.test.ts:45-151`). Agents tests include a fixture `skillCount` but do not assert the rendered text (`src/renderer/src/screens/Agents/Agents.test.tsx:14-24`). Migration inventory tests do cover skill-count-derived activity for migration candidates (`tests/migration-inventory.test.ts:56`, `tests/migration-inventory.test.ts:96`, `tests/migration-inventory.test.ts:187-188`).

#### Tools/toolsets contrast

- Tools use a different persistence model: `getToolsets(profile)` reads `profileHome(profile)/config.yaml` and defaults to all enabled if no `platform_toolsets` exists (`src/main/tools.ts:244-262`). `setToolsetEnabled` mutates `platform_toolsets.cli` and `platform_toolsets.api_server` in config YAML (`src/main/tools.ts:265-294`). SSH uses analogous remote config reads/writes (`src/main/ssh/config.ts:34-130`).
- The Tools renderer optimistically toggles UI state and calls `setToolsetEnabled(key, nextEnabled, profile)`; success copy says the change is for the next message (`src/renderer/src/screens/Tools/Tools.tsx:263-310`).
- Tests explicitly assert toolset toggles do not call `markRuntimeStale` in either local or SSH mode (`tests/knowledge-service.test.ts:110-151`) and that empty toolset lists persist as explicit `cli: []` and `api_server: []` config sections (`tests/toolsets-config.test.ts:35-72`).

#### Hypotheses checked

- **Agents in UI are Hermes profiles:** confirmed.
- **Skill enable/disable is install/uninstall into profile-specific skills directory:** confirmed for Mercury state and local/SSH operations.
- **Persistence is filesystem-backed; disabled state is absence:** confirmed for Mercury's listing/installed state. Mercury has no separate skill enable flag or deny-list/tombstone; uninstall is delegated to Hermes CLI locally/remotely.
- **Skill changes mark runtime stale and affect future runtime context, not historical sessions:** confirmed for runtime stale/future chat path; no historical-session rewrite path found.
- **Local vs SSH vs pure remote differ:** confirmed. Local and SSH are profile-aware; pure remote UI is gated, import fails closed, but install/uninstall would fall through to local if invoked outside the UI.
- **Tools/toolsets have different persistence semantics:** confirmed. Toolsets persist in profile config YAML and are explicitly treated as next-message config writes, not runtime-stale mutations.


### 2026-05-31 - Follow-up audit: skill enable/disable failure modes and startup defaults

#### Corrected startup-defaults claim

- **The claim "all agents start with all skills off by default" is false for the local Mercury-created Agent/profile path.** The Agents UI initializes `cloneConfig` to `true`, calls `createProfile(name, cloneConfig)`, and labels the checkbox as clone config (`src/renderer/src/screens/Agents/Agents.tsx:79`, `src/renderer/src/screens/Agents/Agents.tsx:163`, `src/renderer/src/screens/Agents/Agents.tsx:275-281`). Local `createProfile()` translates that default into `hermes profile create <name> --clone` (`src/main/profiles.ts:225-233`). Upstream Hermes documents and implements clone as copying installed skills from the source profile (`/Users/fredluz/.hermes/hermes-agent/hermes_cli/profiles.py:636-665`, `/Users/fredluz/.hermes/hermes-agent/hermes_cli/profiles.py:721-744`), and the CLI create path prints "Cloned config, .env, SOUL.md, and skills" (`/Users/fredluz/.hermes/hermes-agent/hermes_cli/main.py:10310-10319`).
- **Even if the user unchecks clone locally, Mercury still does not request an empty-skill profile.** Non-clone local creation shells out as `hermes profile create <name>` with no `--no-skills` (`src/main/profiles.ts:230-233`). Upstream Hermes has an explicit `--no-skills` flag (`/Users/fredluz/.hermes/hermes-agent/hermes_cli/main.py:13915-13918`), but its default is `no_skills=False` (`/Users/fredluz/.hermes/hermes-agent/hermes_cli/profiles.py:636-643`), and `cmd_profile` calls `seed_profile_skills(profile_dir)` for all non-`clone_all` creates (`/Users/fredluz/.hermes/hermes-agent/hermes_cli/main.py:10331-10349`). The opt-out marker exists specifically for `--no-skills` (`/Users/fredluz/.hermes/hermes-agent/hermes_cli/profiles.py:102-108`, `/Users/fredluz/.hermes/hermes-agent/hermes_cli/profiles.py:764-775`).
- **Safer corrected wording:** "Local Mercury-created agents start by cloning the default profile's skills unless the user disables cloning; fresh non-clone Hermes profiles still receive bundled skills unless `--no-skills` is used. Mercury currently does not expose/pass `--no-skills`."
- **SSH is inconsistent enough that an empty profile can happen accidentally, not by a deliberate all-off default.** `sshCreateProfile()` uses `hermes profiles create ...` (plural) and falls back to `mkdir -p ~/.hermes/profiles/<name>` on command failure (`src/main/ssh/sessions-profiles.ts:253-266`), while the inspected upstream CLI registers singular `profile`, not `profiles` (`/Users/fredluz/.hermes/hermes-agent/hermes_cli/main.py:13877-13885`). That fallback can silently create a bare directory with no clone/seeding, but that is a failure-mode/partial fallback, not proof of the desired default.

#### Failure modes and slowdown risks

- **Serial bulk operations multiply subprocess/SSH latency.** Category enable/disable computes targets, then awaits each target in a `for ... of` loop (`src/renderer/src/screens/Skills/Skills.tsx:272-290`). Local install/uninstall each spawn Hermes synchronously with 60s and 30s timeouts (`src/main/skills.ts:319-339`, `src/main/skills.ts:348-368`). SSH install uses one remote Hermes command with a 120s timeout, while SSH uninstall uses the default `sshExec` timeout (`src/main/ssh/skills.ts:144-164`, `src/main/ssh/transport.ts:94-115`). A category with many skills can therefore take minutes and blocks completion until the serial loop ends.
- **Each successful item in a bulk skill operation repeatedly marks the runtime stale.** The UI calls install/uninstall once per target (`src/renderer/src/screens/Skills/Skills.tsx:286-290`), and the service marks the profile runtime stale after every successful skill install/uninstall/import (`src/main/services/knowledge-service.ts:46-48`, `src/main/services/knowledge-service.ts:195-214`, `src/main/services/knowledge-service.ts:218-240`). This is fail-closed, but excessive bulk changes can generate repeated stale writes/revalidation work for the same logical category action.
- **Per-click operations pay Hermes subprocess cost and have weak thrown-error UX.** Individual enable/disable await one IPC call (`src/renderer/src/screens/Skills/Skills.tsx:231-257`), which maps to local `execFileSync` install/uninstall or SSH remote commands (`src/main/skills.ts:329-339`, `src/main/skills.ts:358-368`, `src/main/ssh/skills.ts:150-164`). The individual handlers use `try/finally` but no `catch`; returned `{ success:false }` sets an error, but thrown/rejected IPC errors bypass friendly `setError(...)` (`src/renderer/src/screens/Skills/Skills.tsx:231-246`, `src/renderer/src/screens/Skills/Skills.tsx:249-269`).
- **Bulk partial success is allowed but under-explained.** Bulk operations count successes and collect only failed skill names, then can show a success notice and a failure banner in the same run (`src/renderer/src/screens/Skills/Skills.tsx:283-313`). Error details from failed result objects are discarded, so users cannot tell timeout vs duplicate vs CLI failure from the UI (`src/renderer/src/screens/Skills/Skills.tsx:291-298`, `src/renderer/src/screens/Skills/Skills.tsx:311-313`).
- **Duplicate name/category mismatch can misreport enabled state.** The renderer's primary key is normalized `(category, name)` (`src/renderer/src/screens/Skills/Skills.tsx:43-48`), but browse rows mark a bundled skill enabled by exact key or by a fallback that matches an installed skill with an empty category and the same name (`src/renderer/src/screens/Skills/Skills.tsx:372-390`). Installed/bundled inventory can derive display names from `SKILL.md` frontmatter while category comes from the containing directory (`src/main/skills.ts:64-113`, `src/main/skills.ts:266-315`), so frontmatter/category drift can create false disabled/false enabled rows or duplicate-looking rows.
- **Uninstall target ambiguity remains name-only.** Row disable picks `installedSkill?.name || skill.name` and bulk disable does the same (`src/renderer/src/screens/Skills/Skills.tsx:249-257`, `src/renderer/src/screens/Skills/Skills.tsx:286-290`). The service and local/SSH backends accept only a name, not a category/path/key (`src/main/services/knowledge-service.ts:208-214`, `src/main/skills.ts:348-368`, `src/main/ssh/skills.ts:157-164`). Upstream hub uninstall is also keyed by skill name and removes the lock-file install path for that name (`/Users/fredluz/.hermes/hermes-agent/tools/skills_hub.py:3208-3235`). If two visible skills share a name, Mercury cannot precisely target one by category/path.
- **SSH profile creation has a dangerous partial-success fallback.** `sshCreateProfile()` returns `true` after running `hermes profiles create ... || mkdir -p ...` (`src/main/ssh/sessions-profiles.ts:253-267`). If the Hermes command fails (including because upstream exposes singular `profile`), clone/seeding/config behavior degrades to a directory-only profile while the UI/service sees success.
- **Pure remote HTTP still falls through to local for lower-level calls.** `createProfileForConnection()` special-cases SSH only, otherwise calling local `createProfile()` (`src/main/services/sessions-service.ts:254-257`); skill install/uninstall likewise special-case SSH only, otherwise calling local install/uninstall (`src/main/services/knowledge-service.ts:195-214`). Import explicitly fails closed in `remote` mode (`src/main/services/knowledge-service.ts:231-238`), so install/uninstall/profile-create are asymmetric if invoked outside the renderer's pure-remote UI gating.
- **Detail-panel “Agents using this skill” can be an SSH fan-out.** Opening installed skill details lists profiles, then calls `listInstalledSkills(agent.name)` for each profile in parallel (`src/renderer/src/screens/Skills/Skills.tsx:131-159`). In SSH mode each profile listing runs a remote Python scan (`src/main/ssh/skills.ts:11-64`), so many profiles can create a burst of remote filesystem scans.

#### Test coverage gaps observed

- `src/renderer/src/screens/Skills/Skills.test.tsx` covers happy-path individual and one-item bulk calls (`src/renderer/src/screens/Skills/Skills.test.tsx:139-180`), but it does not cover partial failure messaging, thrown IPC errors, duplicate names/categories, or multi-target latency behavior.
- `tests/knowledge-service.test.ts` verifies toolset toggles do not mark runtime stale and memory mutations do (`tests/knowledge-service.test.ts:111-166`), but it does not assert skill install/uninstall/import stale behavior or remote-mode fallthrough.
- `tests/profiles.test.ts` covers profile listing only; there are no create-profile default/clone/`--no-skills` assertions in that file (`tests/profiles.test.ts:45-151`). A repo test search found no direct assertions for `createProfileForConnection`, `sshCreateProfile`, `installSkillForProfile`, or `uninstallSkillForProfile` beyond mocks/API-surface/happy UI usage (`tests/sessions-service.test.ts:23-73`, `src/renderer/src/screens/Skills/Skills.test.tsx:63-64`, `src/renderer/src/screens/Skills/Skills.test.tsx:139-180`).

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Profile/agent skill toggles are stored in profile-scoped configuration or filesystem state and are composed into the effective runtime when chat launches or profile runtime is refreshed.
**Findings:** Existing ADR language suggests Mercury treats Hermes profiles as agents and intends project/profile skill composition to happen at launch time, but implementation details still need verification.
**Evidence:** Initial search surfaced `docs/adr/0001-projects-as-mercury-owned-runtime-boundary.md`, `docs/architecture/overview.md`, and likely implementation areas under `src/main/skills.ts`, `src/main/profiles.ts`, renderer profile/skill screens, and tests.
**Conclusion:** Confirmed after Phase 2-4 with code-level evidence.

### Phase 2-4 - Context Builder, Pair Investigation, and Oracle Synthesis
**Hypothesis:** Skill allocation is profile-scoped and filesystem-backed, while runtime freshness controls when changes affect future messages.
**Findings:** Context builder, pair investigator, spot checks, and oracle synthesis converged: enable/disable maps to install/uninstall; installed files are the source of truth; skill mutations mark the profile runtime stale; sessions are not rewritten.
**Evidence:** See `## Investigator Findings` and `## Root Cause` file:line references.
**Conclusion:** Confirmed.

## Root Cause
This is not a bug so much as an implementation model to understand:

- **Agent/profile identity:** The UI's Agents are Hermes profiles. Renderer code works with `ProfileInfo` and profile names while labeling them as Agents (`src/renderer/src/screens/Agents/Agents.tsx:18-29`, `src/renderer/src/screens/Agents/Agents.tsx:380-389`).
- **Enabled state source of truth:** Installed skill state is discovered by walking `join(profileHome(profile), "skills")` and finding `skills/<category>/<skill>/SKILL.md` (`src/main/skills.ts:61-113`). `profileHome()` maps `default` to `HERMES_HOME` and named profiles to `HERMES_HOME/profiles/<name>` (`src/main/utils.ts:18-26`).
- **Enable/disable behavior:** The Skills UI calls `installSkill(skill.name, profile)` for enable and `uninstallSkill(targetName, profile)` for disable (`src/renderer/src/screens/Skills/Skills.tsx:231-315`). Local install/uninstall shell out to Hermes, inserting `-p <profile>` for named profiles (`src/main/skills.ts:319-375`). SSH mirrors this remotely with `hermes -p <profile>` and remote profile skill roots (`src/main/ssh/skills.ts:11-64`, `src/main/ssh/skills.ts:129-164`).
- **Persistence model:** There is no separate Mercury `{ profile, skill, enabled }` row or deny-list. Enabled persists as installed files. Disabled persists as absence from installed skill files/listing.
- **Runtime effect:** Successful skill install/uninstall/import calls `markRuntimeStale(profile, "Skills changed for profile runtime.")` through `knowledge-service.ts` (`src/main/services/knowledge-service.ts:46-48`, `src/main/services/knowledge-service.ts:195-239`). The stale marker makes local runtime resolution fail until revalidation/restart can prove the runtime is current (`src/main/hermes/runtime/manager.ts:380-431`, `src/main/hermes/runtime/local-runtime.ts:60-88`).
- **Chat/session effect:** Chat sends call `prepareChatBackend(profile, "chat", sessionId)` before creating/resuming server sessions and sending messages (`src/main/services/chat-service.ts:146-185`, `src/main/services/chat-service.ts:461-478`). Skill changes therefore affect future runtime context, not prior messages or historical session records.
- **Pure remote caveat:** The renderer hides Skills in pure remote mode (`src/renderer/src/screens/Layout/Layout.tsx:681-687`), and Markdown import is explicitly blocked for remote HTTP mode (`src/main/services/knowledge-service.ts:223-239`). Non-UI install/uninstall paths only special-case SSH, so in pure remote HTTP they fall back to local operations and should not be described as managing the remote server's skills.

## Recommendations
1. When explaining the feature, say: **"Enable installs the skill into the selected Agent/profile; disable uninstalls it from that Agent/profile."** Avoid saying skills are toggled in config.
2. Tell users persistence is **profile filesystem persistence**: local default profile uses `<HERMES_HOME>/skills`, named local profiles use `<HERMES_HOME>/profiles/<profile>/skills`, and SSH uses the equivalent remote `~/.hermes` paths.
3. Warn that skill changes affect **future turns after runtime reload/revalidation**, not old transcripts or already-generated messages.
4. Keep skills distinct from toolsets: toolsets are config toggles in `config.yaml` and are treated as next-message config writes; skills are installed/uninstalled assets and mark the runtime stale.
5. Consider documenting or tightening pure remote HTTP behavior so lower-level install/uninstall calls cannot be mistaken for true remote skill management.
6. If the product requirement is "all new agents start with all skills off", change profile creation to pass upstream Hermes `--no-skills` for the empty/default path and turn off or redefine the UI's default `cloneConfig=true` behavior.
7. Avoid large serial bulk installs/uninstalls as currently implemented; they run one Hermes local/SSH command per skill and can take minutes. Prefer batch backend operations or direct filesystem/lockfile mutation with one runtime-stale mark per bulk action.
8. Improve failure UX: individual handlers should catch thrown IPC errors, bulk failures should preserve per-skill error details, and uninstall should target a stable category/path/id rather than name only.

## Implementation Notes - 2026-05-31

- Agent/profile creation now starts with skills off as the 2026-05-31 implementation state. Local and SSH profile creation pass upstream Hermes `--no-skills`; the UI copy frames the default checkbox as copying config/API keys only, not skills. This is historical/current implementation context, not the later product direction; future docs should prefer the `default` skill category seeding model for new Agents while other categories remain opt-in.
- Pure remote HTTP mode now fails closed for profile and skill mutation paths that would otherwise mutate local filesystem state. Skill mutation failures use `unsupported-remote-mode` item details for batch calls.
- Skill mutation now has a batch contract (`mutateSkills`) with ordered per-target results. Service-level orchestration serializes batches per profile and marks the runtime stale once for a batch that actually changed installed skills.
- Renderer Skills UX now uses batch mutation for individual and category actions, reloads installed skills once after bulk completion, catches thrown IPC errors, preserves per-skill failure details, and uses `directoryName` plus installed path for stable action/row identity.
- Uninstall targeting is safer: UI passes `category`, `directoryName`, and installed `path`; local/SSH mutation engines validate paths under the selected profile skills root and fail closed on ambiguous matches instead of relying only on display name.

## Preventive Measures
- Add user-facing docs/copy that defines "enabled skill" as "installed for this Agent/profile".
- Add tests for `ProfileInfo.skillCount` rendering and profile-specific skill counts if the Agents UI relies on this as a visible allocation signal.
- Add explicit tests or guards for pure remote HTTP skill install/uninstall/list behavior to avoid accidental local mutation when users expect remote mutation.
- Preserve the runtime-stale behavior for skill mutations so profile runtime freshness remains fail-closed.
- Add tests for local profile creation defaults: clone-on copies skills, non-clone seeds bundled skills today, and a future all-off requirement must assert `--no-skills` behavior.
- Add tests for skill install/uninstall runtime-stale marking, thrown IPC errors, partial bulk failures, duplicate skill names/categories, and remote-mode fallthrough.
- Fix or remove the SSH `hermes profiles create ... || mkdir -p ...` fallback because it can silently report success while skipping clone/seeding/config setup.

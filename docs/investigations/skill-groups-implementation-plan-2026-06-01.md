# Investigation: Skill Groups Implementation Plan

## Summary
Skill groups should be implemented as Mercury-owned activation recipes that expand to the existing batch skill mutation API; actual per-agent enabled state remains installed-file backed. The plan must include a Phase 0 runtime-refresh fix because current skill disable can leave chat blocked behind a stale runtime diagnostic that claims Mercury is updating automatically without a guaranteed recovery job.

## Symptoms
- Users need skill groups/packs so not every skill has to be toggled individually.
- Some groups should be selectable as defaults for new agents.
- Skill groups must also be enableable/disableable after agent creation.
- Existing skill state should remain installed-file backed and should reuse the recent batch skill mutation API.
- Live failure mode observed 2026-06-01: after disabling a skill, the UI shows “Runtime updating — Runtime settings changed. Mercury is applying the update automatically” while chat remains disabled with “Waiting for the verified API runtime before chat can run.”

## Background / Prior Research
- Prior plan export exists at `/Users/fredluz/Code/mercury/prompt-exports/oracle-plan-2026-06-01-081154-skill-groups-plan-5a-9f22.md`.
- Recent implementation already added no-skills new agents and batch `mutateSkills` APIs; this investigation should plan on top of that current working tree.
- Prior runtime analysis in `docs/investigations/toolset-runtime-refresh-2026-05-29.md` found the same anti-pattern for toolsets: generic blocking runtime-stale state can prevent chat before Mercury contacts Hermes, even when a setting may apply on the next request.
- Current skill mutation code has the same risk: `mutateSkillsForProfile` marks runtime stale after any changed skill batch, while local runtime resolution checks `state.staleReason` before health/probe and returns non-retryable `runtime-stale-after-profile-switch`.

## Investigator Findings
<!-- Pair investigator will append structured findings here. -->

### 2026-06-01 - Evidence-backed refinement

#### Current mutation primitive is the right group-apply substrate
- `SkillMutationTarget` already carries the portable identity a group member needs for install (`action`, `name`, optional `category`, optional `directoryName`) and the extra `path` needed for precise uninstall (`src/shared/skills.ts:11-17`). Batch results already represent partial success, no-op success, and per-item errors (`src/shared/skills.ts:28-54`).
- The renderer/preload/IPC contract is a direct batch bridge: `window.hermesAPI.mutateSkills(targets, profile?)` invokes `"mutate-skills"` (`src/preload/api/knowledge.ts:90-94`, `src/preload/index.d.ts:341-344`, `src/main/ipc/knowledge.ts:94-98`).
- `mutateSkillsForProfile` is the cross-mode choke point. It returns no-op success for empty batches, fails closed in pure remote HTTP mode, serializes mutations per profile, routes SSH to `sshMutateSkills`, routes local to `mutateLocalSkills`, and marks the profile runtime stale only when at least one item actually changed (`src/main/services/knowledge-service.ts:51-77`, `src/main/services/knowledge-service.ts:95-121`, `src/main/services/knowledge-service.ts:269-292`).
- Local mutation resolution already avoids unsafe/ambiguous writes: uninstall prefers `path`, then `category + directoryName`, then `category + name`, then name fallback; install resolves bundled skills by the same stable identity; unsafe segments and escaped paths fail closed (`src/main/skills.ts:469-539`, `src/main/skills.ts:542-566`, `src/main/skills.ts:568-687`).
- SSH batch mutation mirrors the same contract in one remote Python call, validates profile names before remote writes, prefixes remote installed paths as `REMOTE:`, installs via remote `hermes skills install ... --yes`, and removes resolved installed directories on uninstall (`src/main/ssh/skills.ts:238-257`, `src/main/ssh/skills.ts:301-375`, `src/main/ssh/skills.ts:380-467`).
- Existing category bulk actions are already a working group prototype: `handleCategoryAction` filters enabled/disabled rows, maps each row to install/uninstall targets, calls one `mutateSkills(targets, profile)`, reloads installed skills once, and renders partial failures (`src/renderer/src/screens/Skills/Skills.tsx:360-404`). `SkillCategorySection` provides the current enable-all/disable-all insertion pattern (`src/renderer/src/screens/Skills/components/SkillCategorySection.tsx:47-105`).

**Conclusion:** skill groups should not introduce a second enabled-skill store or a new filesystem mutation path. Groups should be Mercury-owned recipes that expand to `SkillMutationTarget[]` and then reuse `mutateSkillsForProfile`.

#### Persistence should be app-owned recipes, not per-profile enabled flags
- Current skill enablement is file-backed under `<profileHome>/skills/<category>/<skill>/SKILL.md`; docs explicitly say newly created agents start with no skills and the copy-default-config option does not copy skills (`docs/subsystems/skills.md:52-63`, `docs/subsystems/storage-and-profiles.md:31-38`).
- `src/main/config.ts` already has private desktop JSON helpers under `HERMES_HOME` (`desktopConfigFile`, `readDesktopConfig`, `writeDesktopConfig`) for Mercury-owned app state (`src/main/config.ts:26-40`), but those helpers are intentionally not a skill API surface.

**Plan:** add a dedicated skill-group persistence module rather than writing through renderer state.
- New module: `src/main/skill-groups.ts`.
- Store: app-owned JSON under `HERMES_HOME`, either as a new `skill-groups.json` file or a namespaced `skillGroups` key in the existing desktop config. Prefer a dedicated `skill-groups.json` for clearer ownership and easier validation/migration.
- Persist only group definitions and defaults, not enabled state. Suggested shape: `version`, `groups[]`, each group with stable `id`, `name`, optional `description`, `defaultForNewAgents`, and `members[]` of `{ name, category, directoryName }`.
- Never persist member `path`; derive `path` only from current installed skills when generating uninstall targets. Paths are profile/mode-specific and SSH paths may be `REMOTE:`-prefixed.

#### API contracts to add
- Extend shared types in `src/shared/skills.ts` next to the existing mutation types (`src/shared/skills.ts:1-54`):
  - `SkillGroupMember`: `{ name: string; category?: string; directoryName?: string }`.
  - `SkillGroupDefinition`: `{ id: string; name: string; description?: string; members: SkillGroupMember[]; defaultForNewAgents?: boolean; builtIn?: boolean }`.
  - `SkillGroupApplyRequest`: `{ groupIds: string[]; action: "install" | "uninstall"; profile?: string }`.
  - `SkillGroupApplyResult`: wrap the existing `SkillMutationBatchResult`, plus `groupIds`, `missingMembers`, and `noopCount` if useful for UI copy.
- Add preload and IPC methods beside existing knowledge/skill APIs (`src/preload/api/knowledge.ts:80-100`, `src/main/ipc/knowledge.ts:86-101`, `src/preload/index.d.ts:331-347`):
  - `listSkillGroups()`
  - `saveSkillGroup(group)` / `deleteSkillGroup(id)`
  - `setDefaultSkillGroups(groupIds)` or persist `defaultForNewAgents` via `saveSkillGroup`
  - `applySkillGroups(groupIds, action, profile?)`
- Implement API orchestration in `src/main/services/knowledge-service.ts`, but keep the low-level mutation call as `mutateSkillsForProfile`. `applySkillGroups` should load group definitions, expand/dedupe members, compute install/uninstall targets for the current profile, then call one `mutateSkillsForProfile` batch.

#### Group enable/disable after agent creation
- UI insertion point: add a Groups tab or a groups panel above the existing installed/browse category list. The current render seam is after header/notice/error and before the existing tabs (`src/renderer/src/screens/Skills/Skills.tsx:538-606`). Existing tabs/search/category rendering and empty states continue below (`src/renderer/src/screens/Skills/Skills.tsx:598-712`).
- Reuse the current row identity helpers: `skillIdentityKey` already normalizes `category + directoryName/name` (`src/renderer/src/screens/Skills/Skills.tsx:58-66`), and install/uninstall target builders already produce the correct payload shapes (`src/renderer/src/screens/Skills/Skills.tsx:113-136`).
- Group state should be derived, not persisted:
  - `on`: every resolvable member is installed.
  - `off`: no resolvable member is installed.
  - `partial`: some installed, some not installed, or some members cannot be resolved in the current catalog/profile.
- Disable semantics need explicit copy: because there is no per-group ownership flag, disabling a group means “uninstall this group’s member set from this profile,” even if another group also contains a member.
- Treat `updated === 0` as possible success/no-op, not failure. Existing batch results mark already-installed local skills as `changed: false` (`src/main/skills.ts:608-613`) and the service only marks stale if something changed (`src/main/services/knowledge-service.ts:288-291`).

#### Default groups during agent creation
- Current renderer creation flow calls `window.hermesAPI.createProfile(name, copyDefaultConfig)` and then saves optional model config from the renderer (`src/renderer/src/screens/Agents/Agents.tsx:160-194`). The create modal currently has only name, copy-config, provider, and model controls (`src/renderer/src/screens/Agents/Agents.tsx:250-324`).
- Preload and IPC currently accept only `(name, clone)` (`src/preload/api/navigation.ts:102-107`, `src/preload/index.d.ts:267-271`, `src/main/ipc/sessions.ts:35-38`).
- The single backend insertion point is `createProfileForConnection`: it dispatches local/SSH/pure-remote creation and returns the structured result (`src/main/services/sessions-service.ts:260-278`). Local and SSH profile creation both hardcode upstream `--no-skills`, and config copy copies only `config.yaml`/`.env` (`src/main/profiles.ts:239-255`, `src/main/ssh/sessions-profiles.ts:311-333`).

**Plan:** keep upstream profile creation no-skills, then apply default groups as a post-create Mercury batch.
- Extend the create-profile API as an object or additive third parameter: `createProfile(name, clone, defaultSkillGroupIds?)`. Prefer an object payload if broader create options are expected soon; otherwise a third optional arg is the lowest migration cost.
- In `createProfileForConnection`, after `{ success: true }`, call a skill-group service helper that expands selected/default group IDs and invokes `mutateSkillsForProfile(targets, newProfileName)` once.
- Do not roll back the profile if group application partially fails. Return `success: true` with `skillGroups`/`warning` details so the UI can show “Agent created; some default skills failed to enable.” Rollback would be surprising and could delete copied config/API keys.
- Because `mutateSkillsForProfile` queues per profile, default group application will serialize with any immediate user-driven skill mutation for that new profile (`src/main/services/knowledge-service.ts:51-77`).

#### Local, SSH, and pure-remote behavior
- Local: group application expands to existing local install/uninstall targets and uses bundled skill copy or CLI fallback (`src/main/skills.ts:568-687`).
- SSH: group definitions remain Mercury-owned locally, but application runs against the remote profile/catalog through `sshMutateSkills`. Remote install chooses `category/directoryName` when present and shells out to remote Hermes (`src/main/ssh/skills.ts:380-399`). Expect partial failures if a locally-defined group references skills unavailable in the remote Hermes catalog.
- Pure remote HTTP: profile creation already fails closed (`src/main/services/sessions-service.ts:264-278`), and skill mutation already fails closed with `unsupported-remote-mode` (`src/main/services/knowledge-service.ts:95-121`, `src/main/services/knowledge-service.ts:279-281`). Group CRUD can still be allowed if persisted locally, but group apply/default creation must be disabled or return the same unsupported-mode failure. `isRemoteOnlyMode()` is exactly `mode === "remote"` (`src/main/hermes/connection.ts:84-86`).

#### UI/i18n/docs insertion points
- Skills screen: add group management around the current header/tab/category seams (`src/renderer/src/screens/Skills/Skills.tsx:538-712`); reuse or generalize category section layout from `SkillCategorySection` (`src/renderer/src/screens/Skills/components/SkillCategorySection.tsx:34-105`) and category CSS (`src/renderer/src/assets/styles/skills.css:432-499`).
- Agents screen: add default group selector in the create panel near `cloneConfig` before model selection (`src/renderer/src/screens/Agents/Agents.tsx:274-324`). The current English clone copy explicitly says “start with skills off,” so it must change when defaults are selected (`src/shared/i18n/locales/en/agents.ts:1-8`).
- i18n: add `skills.*` group labels and `agents.*` default-group labels across `src/shared/i18n/locales/{en,es,pt-BR,zh-CN}/skills.ts` and `agents.ts`; current skills copy is category-only (`src/shared/i18n/locales/en/skills.ts:1-80`).
- Docs: update `docs/subsystems/skills.md`, especially renderer API and UI semantics (`docs/subsystems/skills.md:19-32`, `docs/subsystems/skills.md:52-63`), local/SSH/pure-remote behavior (`docs/subsystems/skills.md:217-261`), and contract test map (`docs/subsystems/skills.md:263-291`). Update `docs/subsystems/storage-and-profiles.md` to clarify that skill groups are app-owned recipes while actual profile skill state remains file-backed (`docs/subsystems/storage-and-profiles.md:31-38`, `docs/subsystems/storage-and-profiles.md:127-159`).

#### Test strategy
- Unit-test persistence in a new `tests/skill-groups.test.ts`: validation, stable IDs, sorted/deduped members, `defaultForNewAgents`, corrupt/missing JSON fallback, and migration/version handling.
- Extend `tests/knowledge-service.test.ts` around the existing mutation policy tests: group apply expands to one local batch, marks stale once only when changed, preserves partial failures, treats empty/no-op groups as success, routes SSH through `sshMutateSkills`, and returns unsupported failures in pure remote mode (`tests/knowledge-service.test.ts:184-302`).
- Extend `tests/skills-mutation.test.ts` for any new member expansion helper edge cases; current coverage is path-safety focused (`tests/skills-mutation.test.ts:37-100`).
- Extend `tests/sessions-service.test.ts` for default groups after create: local success + partial group warning, SSH success path, pure-remote still fail-closed, and no group application when profile creation fails (`tests/sessions-service.test.ts:164-196`).
- Extend `tests/profiles.test.ts` and `tests/ssh-remote.test.ts` only to preserve the invariant that raw profile creation still uses `--no-skills` and does not copy skills (`tests/profiles.test.ts:58-101`, `tests/ssh-remote.test.ts:46-76`).
- Extend `tests/ipc-handlers.test.ts` and `tests/preload-api-surface.test.ts` for new channels/methods and shared type exposure; these already guard `mutate-skills` and `mutateSkills` (`tests/ipc-handlers.test.ts:176-201`, `tests/preload-api-surface.test.ts:220-227`).
- Extend `src/renderer/src/screens/Skills/Skills.test.tsx` for group cards/tab, on/off/partial derivation, enable/disable payloads, no-op success copy, and partial failure rendering. Existing category bulk tests are the closest template (`src/renderer/src/screens/Skills/Skills.test.tsx:143-224`).
- Extend `src/renderer/src/screens/Agents/Agents.test.tsx` for default group selection and create-profile payload. Existing tests assert `createProfile("coder", true)` (`src/renderer/src/screens/Agents/Agents.test.tsx:90-116`).
- Add or strengthen locale-key parity coverage; current shared i18n test is minimal (`src/shared/i18n/index.test.ts:4-8`).

#### Risks and edge cases
- **Group overlap:** no ownership tracking means disabling one group can uninstall a skill also listed in another group. Avoid hidden group-enabled flags; document this as “apply/remove this set.”
- **Catalog drift:** a group member may not exist in the current local bundled catalog or remote registry. Surface per-member failure using the existing batch result model.
- **Identity collisions:** persist `category + directoryName + name`; avoid name-only group members except for legacy/imported cases because name-only resolution can be ambiguous and fail closed (`src/main/skills.ts:469-539`).
- **Remote mismatch:** SSH applies groups against the remote Hermes environment; local app-defined groups may partially fail remotely.
- **No-op UX:** already-installed skills and already-disabled/missing targets can produce `updated: 0`; UI copy must distinguish all-no-op success from failure.
- **Create-time partial failure:** profile creation should remain successful if group install partially fails; return warnings and let users retry from the Skills screen.
- **Runtime freshness:** group apply must go through `mutateSkillsForProfile`; otherwise runtime-stale marking, local/SSH parity, and mutation queueing will be bypassed (`src/main/services/knowledge-service.ts:269-292`).

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Skill groups should be modeled as Mercury-owned activation recipes that translate to existing `mutateSkills` batches; actual per-profile skill state should stay installed-file backed.
**Findings:** Prior planning points toward group persistence plus group mutation APIs, not a separate enabled flag table.
**Evidence:** Existing prior plan export and recent skill allocation investigation.
**Conclusion:** Needs code-level verification and refinement.

### Phase 2 - Runtime Hang Regression
**Hypothesis:** Skill enable/disable currently marks a blocking stale runtime but does not guarantee bounded recovery, producing the screenshot's “Runtime updating” hang.
**Findings:** Confirmed by code path. `mutateSkillsForProfile(...)` marks runtime stale when any skill mutation changes files. `resolveLocalApiRuntimeAttempt(...)` checks `state.staleReason` before probing the API and returns non-retryable `runtime-stale-after-profile-switch`. `RuntimeDiagnosticNotice` labels stale as “Runtime updating” and says Mercury is applying the update automatically, even though skill mutation does not prove a restart/revalidate job is active.
**Evidence:** `src/main/services/knowledge-service.ts`, `src/main/hermes/runtime/local-runtime.ts`, `src/main/hermes/runtime/manager.ts`, `src/renderer/src/components/RuntimeDiagnosticNotice.tsx`, `docs/investigations/toolset-runtime-refresh-2026-05-29.md`.
**Conclusion:** Confirmed. Skill groups must not be built on top of the current “mark stale only” behavior; otherwise group enable/disable will reproduce the same hang at larger scale.

### Phase 3 - Oracle Synthesis
**Hypothesis:** A robust skill-groups plan needs a runtime mutation policy layer before or alongside group APIs.
**Findings:** Oracle recommended centralizing runtime mutation policy, classifying skill/group mutations as restart-required until Hermes provides evidence that skills are hot-read per request, and replacing indefinite stale UX with bounded refresh/manual states.
**Evidence:** Current selection plus pair findings and runtime code verification.
**Conclusion:** Confirmed. Runtime mutation policy is Phase 0 of the implementation plan.

## Root Cause
Skill groups are not hard because of the group model; they are hard because skill mutation already has ambiguous runtime semantics.

The current implementation treats a changed skill install/uninstall as a generic profile runtime mutation. `mutateSkillsForProfile(...)` writes files through the local or SSH mutation path and, if any item changed, calls the same stale mechanism used for broader runtime-sensitive settings. For local chat, `resolveLocalApiRuntimeAttempt(...)` checks that stale marker before health checks, capability probes, or chat dispatch. If stale is present, Mercury returns `runtime-stale-after-profile-switch` immediately and chat is blocked.

That makes the UI copy misleading. `RuntimeDiagnosticNotice` says Mercury is “applying the update automatically,” but the skill mutation path only marks stale; it does not itself guarantee an active, bounded restart/revalidate job. If revalidation cannot produce a newer verified identity, stale remains. This explains the observed post-disable hang.

Skill groups would amplify the problem because group enable/disable is just a larger batch of the same skill install/uninstall operations. Create-time default groups could also accidentally mark a newly-created profile stale before first chat if runtime policy is not explicit.

## Recommendations

### Design decision
Implement skill groups as **Mercury-owned activation recipes**, not as a second per-profile enabled-state store.

- Persist group definitions globally for the current connection/environment.
- Keep actual skill enabled state file-backed under the profile's `skills/` directory.
- Derive group state in the UI from installed skills:
  - `on`: every resolvable member installed.
  - `off`: no resolvable members installed.
  - `partial`: mixed install state or unresolved members.
- Enabling/disabling a group expands to one deduped `SkillMutationTarget[]` and calls the existing batch mutation path once.
- Disabling a group means “uninstall this recipe's member set from this Agent,” even if another group shares a member. Do not add hidden ownership flags.

### Phase 0 — fix runtime mutation policy first
Add a central runtime mutation policy helper and stop feature services from directly calling `markRuntimeStale(...)` for ordinary settings writes.

Suggested policy classes:

1. `hot-readable-next-request`: persisted config is read on the next Hermes request; no blocking stale.
2. `restart-required`: running gateway may have startup-loaded state; restart/revalidate if active.
3. `skill-catalog-reload-required`: installed skill files changed; refresh the running skill command/catalog cache without restarting the whole gateway when the runtime supports it.
4. `identity-revalidate-required`: mutation affects profile/runtime identity, credentials, ports, connection mode, or ownership proof; keep strict stale/revalidation.
5. `unsupported`: fail closed without stale mutation.

Classify current skill/group behavior conservatively:

| Mutation | Policy | Behavior |
| --- | --- | --- |
| Toolset toggle | `hot-readable-next-request` where proven | no blocking stale |
| Skill install/uninstall | `skill-catalog-reload-required` | reload running skill catalog if runtime is active; restart only as fallback |
| Skill group enable/disable | `skill-catalog-reload-required` | same as one changed skill batch |
| Create-time default groups | bootstrap/no active runtime | no stale; next start reads installed skills |
| Pure remote HTTP skill/group mutation | `unsupported` | fail closed; no stale |

Runtime behavior for changed skill/group batches:

- If no local/SSH gateway is running for the profile: do **not** mark blocking stale. The next gateway start should read current skill files.
- If a gateway is running and exposes a supported skill reload path: enter an explicit `refreshing` state, invoke skill-catalog reload, and re-check diagnostics with bounded retry.
- If no supported reload path exists for that runtime/version: do **not** auto-stop the gateway on every skill toggle. Return an actionable `manual-restart-required` or `manual-reload-required` state/copy.
- On success: clear refresh/stale state and re-enable chat.
- On failure: transition to actionable `manual-restart-required` / `runtime-refresh-failed`, not indefinite “updating.”
- Only show “Mercury is applying the update automatically” while an actual reload/refresh job is active.

### Phase 1 — contracts and persistence
Add shared DTOs in `src/shared/skills.ts`:

- `SkillGroupMember`: `{ name, category, directoryName }`
- `SkillGroupDefinition`: stable `id`, `name`, optional `description`, `members`, `defaultForNewAgents`, timestamps, optional `builtIn`
- `SkillGroupUpsertRequest`
- `SkillGroupMutationRequest`
- `SkillGroupMutationResult`, wrapping the existing batch result plus skipped/missing member details and runtime refresh metadata

Add persistence:

- Local store: `src/main/skill-groups.ts`, backed by `<HERMES_HOME>/skill-groups.json`.
- SSH store: `src/main/ssh/skill-groups.ts`, backed by remote `~/.hermes/skill-groups.json`.
- Pure remote HTTP: group apply should fail closed; group CRUD can either be disabled in remote mode or explicitly scoped to local app state, but the clearer first implementation is fail-closed for both CRUD and apply in pure remote mode.

Validation requirements:

- Versioned JSON.
- Corrupt JSON fails closed and is not overwritten silently.
- Safe stable IDs.
- Non-empty group names.
- Member identities prefer `category + directoryName`; name-only members should be rejected for new groups because uninstall/install resolution can become ambiguous.
- Dedupe members by normalized `category + directoryName`.

### Phase 2 — backend service and IPC/preload API
Add `src/main/services/skill-groups-service.ts` with connection-aware operations:

- `listSkillGroupsForConnection()`
- `saveSkillGroupForConnection(request)`
- `deleteSkillGroupForConnection(id)`
- `mutateSkillGroupsForProfile(request, profile?)`

Add IPC/preload methods beside existing skill APIs:

- `list-skill-groups` / `listSkillGroups()`
- `save-skill-group` / `saveSkillGroup(request)`
- `delete-skill-group` / `deleteSkillGroup(id)`
- `mutate-skill-groups` / `mutateSkillGroups(request, profile?)`

Group mutation algorithm:

1. Load group definitions for the active connection.
2. Validate all requested IDs before mutating.
3. Flatten members in requested group order.
4. Dedupe by `category + directoryName`.
5. For install, emit install targets with `name`, `category`, `directoryName`.
6. For uninstall, load installed skills for the target profile, match by `category + directoryName`, include `path` in uninstall targets, and count absent members as skipped/no-op.
7. Call `mutateSkillsForProfile(targets, profile)` exactly once.
8. Return detailed batch result plus runtime refresh metadata.

### Phase 3 — default groups for new Agents
Keep raw profile creation no-skills:

1. `createProfile` continues to create an empty-skills profile via upstream `--no-skills`.
2. Extend create-profile API with optional `skillGroupIds`.
3. After profile creation succeeds, apply selected/default groups once as a post-create install batch.
4. Do not roll back profile creation if default group application partially fails; return success with warnings.
5. Do not mark blocking stale for the normal new-profile case where no runtime exists yet.

### Phase 4 — renderer UX
Skills screen:

- Add a Groups tab/panel near the existing Installed/Browse flows.
- Show group cards with on/off/partial state, member count, unresolved count, and default-for-new-agents badge.
- Add create/edit/delete group modals.
- Let users enable/disable a group for the currently selected Agent after creation.
- Reuse existing partial failure rendering from batch mutations.

Agents screen:

- Add default skill group selector in the create-agent panel.
- Preselect groups marked `defaultForNewAgents`.
- Preserve “all skills off by default” when no default groups are selected.
- Update copy so it does not claim copied config includes skills unless selected groups are explicitly applied.

Runtime UX:

- Replace generic stale copy with state-specific copy:
  - Refreshing: “Reloading the Agent skill catalog.”
  - Manual required: “Skills changed. Reload skills or restart this Agent gateway to continue.”
  - No runtime active: “Skill changes saved. They apply when this Agent starts.”
- Chat disabled reason should reflect the diagnostic state, not always the generic “Waiting for the verified API runtime.”

### Phase 5 — docs and migration notes
Update:

- `docs/subsystems/skills.md`: group recipe model, group state derivation, enable/disable semantics, runtime refresh policy, local/SSH/remote behavior.
- `docs/subsystems/storage-and-profiles.md`: `skill-groups.json` is app-owned recipe state; installed skills remain profile-owned runtime state.
- `docs/subsystems/chat-and-tracing.md`: runtime diagnostic states and non-indefinite refresh behavior.
- Existing investigation report `profile-skill-allocation-2026-05-31.md` if needed to reference group semantics.

### Test plan
Add/extend tests for:

1. Runtime policy:
   - Changed skill mutation with no gateway running does not leave a blocking stale diagnostic.
   - Changed skill mutation with gateway running triggers one bounded restart/revalidate path.
   - Refresh success clears stale and chat can verify again.
   - Refresh failure becomes actionable manual-required state, not “updating.”
   - Pure remote skill/group mutation fails closed without marking stale.
2. Skill group persistence:
   - Missing store returns empty groups.
   - Corrupt store fails closed.
   - Validation rejects unsafe IDs, duplicate names, empty names, and ambiguous/name-only members.
   - Members are deduped and normalized.
3. Skill group mutation:
   - Enable expands multiple groups to one deduped install batch.
   - Disable matches installed skills by `category + directoryName` and includes paths for safe uninstall.
   - Partial missing/unavailable members are reported without aborting unrelated members unless group ID itself is invalid.
   - Runtime policy is applied once per changed group batch.
4. Agent creation defaults:
   - No selected groups preserves no-skills profile creation.
   - Selected/default groups are applied after creation.
   - Partial group failures return warnings, not rollback.
   - Bootstrap group install does not stale a never-started profile.
5. Renderer/API contracts:
   - IPC/preload exposes group CRUD/mutate methods.
   - Skills UI derives on/off/partial state correctly.
   - Agents UI passes selected default group IDs.
   - Runtime notice copy only claims automatic update while refresh is active.
   - Chat input disabled reason matches stale/refresh/manual diagnostic state.

## Preventive Measures
- Require every profile-affecting setting mutation to declare a runtime policy; do not allow ad hoc `markRuntimeStale(...)` calls in feature services.
- Keep skill groups as declarative recipes and derive profile state from installed files to avoid split-brain enabled state.
- Add contract tests that skill and group mutations cannot leave permanent stale state without an active refresh job or actionable manual state.
- Do not classify skills as fully hot-readable until Hermes exposes code evidence or capability metadata proving installed skill changes are visible automatically per request. Prefer explicit skill-catalog reload over gateway restart when available.
- Keep group application batched so runtime refresh happens at most once per user action.
- Document overlapping-group disable semantics explicitly; no hidden group ownership state means disabling one group can uninstall a skill used by another group.

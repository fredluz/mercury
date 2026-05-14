## Final Prompt
<taskname="Profile Actions"/>
<task>Plan and implement the Profiles/Agents card action update. In `src/renderer/src/screens/Agents/Agents.tsx`, replace the large text Chat button with a smaller icon-only chat button and add icon-only action buttons for Skills, Tools, Persona, and Memory. Buttons should navigate to existing tabs filtered/scoped to the selected profile. Always show Chat, Skills, Tools, Persona, and Memory icons on every card, disabled when the corresponding category is unavailable. Do not add schedule support.</task>

<architecture>
Mercury is an Electron/React app. `Layout.tsx` owns the active `View`, `activeProfile`, chat session state, lazy-mounted tab set, and passes `profile={activeProfile}` into existing profile-scoped tabs.

`Agents.tsx` is the profile card screen. It loads `window.hermesAPI.listProfiles()`, stores local `ProfileInfo[]`, selects profiles via `window.hermesAPI.setActiveProfile(name)` + `onSelectProfile(name)`, and currently has one footer Chat button calling `onChatWith(p.name)`.

Destination tabs already support profile scoping:
- `Skills({ profile })` calls `listInstalledSkills(profile)`, `installSkill(..., profile)`, `uninstallSkill(..., profile)`, and `importSkillMarkdown(..., profile)`.
- `Tools({ profile })` calls `getToolsets(profile)`, `listMcpServers(profile)`, and `setToolsetEnabled(..., profile)`.
- `Soul({ profile })` calls `readSoul(profile)`, `writeSoul(..., profile)`, and `resetSoul(profile)`.
- `Memory({ profile })` calls `readMemory(profile)`, memory entry CRUD, user profile write, memory provider discovery/config/env APIs with `profile`.

Profile summaries are produced by local `src/main/profiles.ts` and SSH `src/main/ssh/sessions-profiles.ts`, forwarded by `src/main/ipc/sessions.ts`, typed in `src/preload/api/navigation.ts` and `src/preload/index.d.ts`, and consumed by `Agents.tsx`. Current profile summary fields are `name`, `path`, `isDefault`, `isActive`, `model`, `provider`, `hasEnv`, `hasSoul`, `skillCount`, `gatewayRunning`.
</architecture>

<selected_context>
src/renderer/src/screens/Agents/Agents.tsx: Full profile card implementation, `ProfileInfo`, `AgentsProps`, profile loading/create/delete/select flows, current footer Chat button and delete confirmation.
src/renderer/src/screens/Layout/Layout.tsx: Full app shell, `View` union, `goTo`, `handleSelectProfile`, `onChatWith`, lazy `visitedViews`, and mounting of `Agents`, `Skills`, `Soul`, `Memory`, `Tools` with `profile={activeProfile}`.
src/renderer/src/screens/Skills/Skills.tsx: Full Skills tab; already profile-aware and reloads installed skills on `profile` changes.
src/renderer/src/screens/Tools/Tools.tsx: Full Tools tab; already profile-aware and loads toolsets/MCP servers for the profile.
src/renderer/src/screens/Soul/Soul.tsx: Full Persona/Soul tab; already profile-aware.
src/renderer/src/screens/Memory/Memory.tsx: Full Memory tab; already profile-aware and delegates panel rendering.
src/renderer/src/screens/Memory/components/MemoryPanels.tsx: Full Memory panel implementation for entries, user profile, and providers; useful to understand profile-scoped memory behavior.
src/renderer/src/assets/styles/agents.css: Full card/grid/footer/delete styles; likely edit surface for compact icon action row and disabled states.
src/renderer/src/assets/styles/foundation.css: Shared `.btn`, `.btn-sm`, disabled, and hover styles.
src/renderer/src/assets/icons/index.tsx: Exported lucide aliases; already exports `ChatBubble`, `Puzzle`, `Wrench`, `Sparkles`, `Brain`, `Trash`, `Plus`.
src/shared/i18n/locales/{en,es,pt-BR,zh-CN}/agents.ts: Agents translation namespace; currently only has `chat` and delete/profile labels, so icon `title`/`aria-label` keys may need additions in all locales.
src/main/profiles.ts: Local `ProfileInfo` interface and `listProfiles()` implementation; currently summarizes `hasSoul` and `skillCount` only for requested categories.
src/main/ssh/sessions-profiles.ts: SSH `SshProfileInfo` and `sshListProfiles()` mirror; update if profile summary fields are extended.
src/main/ipc/sessions.ts: Forwards local/SSH `listProfiles()` and handles `set-active-profile`; no transformation currently.
src/preload/api/navigation.ts: Renderer preload `listProfiles()` typed return shape.
src/preload/index.d.ts: Global `window.hermesAPI` type surface including `listProfiles`, Memory, Soul, Tools, Skills APIs.
src/main/skills.ts: Installed/bundled skills logic; installed skills are profile-scoped and missing skills dir returns empty list.
src/main/tools.ts: Toolsets are profile-scoped; if no config exists, `getToolsets(profile)` returns all toolsets enabled by default.
src/main/memory.ts: Memory/user profile are profile-scoped; missing files return empty content/existence false but the tab remains functional.
src/main/soul.ts: Persona/Soul is profile-scoped; missing `SOUL.md` returns empty content and reset can create default content.
tests/preload-api-surface.test.ts: Contract test that checks preload methods and typings remain aligned; relevant if the preload shape is changed.
package.json: Verification scripts include `typecheck:web`, `typecheck:node`, `typecheck`, `test`, and `lint`.
</selected_context>

<relationships>
- Agents card action → stop card click propagation → select/scope profile → Layout `goTo("chat" | "skills" | "tools" | "soul" | "memory")` → destination tab receives `profile={activeProfile}`.
- Current Chat path: `Agents.onChatWith(p.name)` → `Layout` calls `handleSelectProfile(name)` → `goTo("chat")` → `Chat profile={activeProfile}`.
- Existing tab filtering/scoping is profile prop based; no URL/query/router exists.
- If adding profile availability fields: `profiles.ts` local interface/result → `ssh/sessions-profiles.ts` remote mirror → `preload/api/navigation.ts` return type → `preload/index.d.ts` global type → `Agents.tsx ProfileInfo`.
- `Layout` `View` union already includes `skills`, `soul`, `memory`, `tools`; no schedule action should be added.
- Delete action is an absolute-positioned hover control in `agents.css`; new footer action row should coexist with delete/confirm-delete behavior and preserve `stopPropagation()`.
</relationships>

<ambiguities>
The user requires buttons disabled when the corresponding category is unavailable, but current profile summaries only expose `skillCount` and `hasSoul`. Memory and Tools APIs are profile-scoped and functional even when their backing files/config are absent (`readMemory` returns empty structures; `getToolsets` defaults to enabled toolsets without config). Decide whether "unavailable" should be based only on current summary fields (`skillCount`, `hasSoul`) or whether to extend profile summaries with explicit memory/tools availability fields. If extending fields, update local + SSH + preload typings consistently.

Skills availability is also slightly ambiguous: `skillCount === 0` can mean no installed skills, but the Skills tab still lets the user browse/import/install skills for that profile.
</ambiguities>

<validation>
Recommended checks after implementation: `npm run typecheck:web`; if profile/preload/main typings are changed, also run `npm run typecheck:node` and `npm test -- preload-api-surface.test.ts` or the full `npm test` if feasible.
</validation>

<orchestrator_progress>
- [x] Implemented as one focused work item by sub-agent `Profile Card Actions`.
- [x] Profile card footer now renders compact icon-only actions for Chat, Skills, Tools, Persona, and Memory.
- [x] Actions select/scope the clicked profile before navigating to existing tabs.
- [x] Schedule action intentionally omitted per user clarification.
- [x] Verified focused diff and noted unrelated existing TraceLab/docs work remains untouched.
- [x] Builder reported `npm run typecheck:web`, targeted ESLint, and `npm test -- src/shared/i18n/index.test.ts` passed.
</orchestrator_progress>

## Selection
- Files: 29 total (25 full, 4 codemap)
- Total tokens: 40988 (Auto view)
- Token breakdown: full 39447, codemap 1541

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   └── sessions.ts — 789 tokens (full)
│   │   ├── ssh/
│   │   │   └── sessions-profiles.ts — 2 197 tokens (full)
│   │   ├── memory.ts — 1 495 tokens (full)
│   │   ├── profiles.ts — 1 806 tokens (full)
│   │   ├── skills.ts — 1 999 tokens (full)
│   │   ├── soul.ts — 307 tokens (full)
│   │   └── tools.ts — 2 034 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   └── navigation.ts — 638 tokens (full)
│   │   └── index.d.ts — 3 373 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── icons/
│   │       │   │   └── index.tsx — 182 tokens (full)
│   │       │   └── styles/
│   │       │       ├── agents.css — 1 098 tokens (full)
│   │       │       └── foundation.css — 1 780 tokens (full)
│   │       └── screens/
│   │           ├── Agents/
│   │           │   └── Agents.tsx — 2 245 tokens (full)
│   │           ├── Layout/
│   │           │   └── Layout.tsx — 2 827 tokens (full)
│   │           ├── Memory/
│   │           │   ├── components/
│   │           │   │   └── MemoryPanels.tsx — 3 608 tokens (full)
│   │           │   └── Memory.tsx — 2 359 tokens (full)
│   │           ├── Skills/
│   │           │   └── Skills.tsx — 3 379 tokens (full)
│   │           ├── Soul/
│   │           │   └── Soul.tsx — 899 tokens (full)
│   │           └── Tools/
│   │               └── Tools.tsx — 2 979 tokens (full)
│   └── shared/
│       └── i18n/
│           └── locales/
│               ├── en/
│               │   └── agents.ts — 171 tokens (full)
│               ├── es/
│               │   └── agents.ts — 201 tokens (full)
│               ├── pt-BR/
│               │   └── agents.ts — 190 tokens (full)
│               └── zh-CN/
│                   └── agents.ts — 179 tokens (full)
├── tests/
│   └── preload-api-surface.test.ts — 2 013 tokens (full)
└── package.json — 699 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── install/
    │   │   └── paths.ts — 672 tokens (auto)
    │   └── ssh-tunnel.ts — 440 tokens (auto)
    └── shared/
        ├── i18n/
        │   └── types.ts — 43 tokens (auto)
        └── traces.ts — 386 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `profile-actions-149015` | **Mode**: plan


> 💡 Continue this plan conversation with ask_oracle(chat_id: "profile-actions-149015", new_chat: false)
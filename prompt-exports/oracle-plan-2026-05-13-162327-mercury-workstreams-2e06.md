## Final Prompt
<taskname="Mercury Workstreams"/>
<task>
Plan the next Mercury app workstreams. Do not implement code. Produce up to 5 work items with: goal, done criteria, key files, dependencies, suggested agent role, verification commands, and which items can run in parallel.

Required workstream themes:
1. Reduce product/UI bloat, first priority: complete removal of the visible Office/3D feature from the app UI.
2. Reshape global Skills/Memory/Soul concepts toward agent/profile-specific flows, including manual Markdown skill import for Hermes.
3. Audit and optimize Electron/React/TypeScript performance.
</task>

<architecture>
Mercury is Electron + React + TypeScript.

App entry and shell:
- `src/renderer/src/App.tsx` decides splash/welcome/install/setup/main and renders `Layout` for the main app.
- `src/renderer/src/screens/Layout/Layout.tsx` owns the sidebar, `View` union, `NAV_ITEMS`, lazy-mounted panes via `visitedViews`, `activeProfile`, and passes `profile={activeProfile}` into Chat/Skills/Soul/Memory/Tools/Schedules/Gateway/Settings.
- `src/renderer/src/assets/main.css` is selected as focused slices for global controls/sidebar and affected Agents/Skills/Soul/Memory/Office styles.

Office/3D surface:
- Visible Office UI lives in `Layout.tsx` (`office` view, Building icon, nav item, pane render) and `src/renderer/src/screens/Office/Office.tsx` (Claw3D setup/start/stop/webview/polling UI).
- Office labels live in all `src/shared/i18n/locales/*/navigation.ts`; Office namespace is eagerly imported and registered in `src/shared/i18n/index.ts`; Office translation files are selected for all locales.
- Backend/preload Claw3D APIs remain in `src/main/claw3d.ts`, IPC handlers in `src/main/index.ts`, preload methods/types in `src/preload/index.ts` and `src/preload/index.d.ts`. The user’s first cleanup priority is visible UI removal; decide whether backend/preload cleanup should be later/dependent, not assumed part of the first slice.
- `scripts/e2e-flow-sweep.mjs` and `README.md` still mention Office and will need plan coverage if visible Office is removed.

Agent/profile-specific concepts:
- `Agents.tsx` is the current profile management surface: lists profiles from `listProfiles`, creates/deletes profiles, calls `setActiveProfile`, and routes “Chat” for selected profile.
- Profile roots are resolved by `src/main/utils.ts` `profileHome(profile)`: default maps to `HERMES_HOME`, named profiles map to `HERMES_HOME/profiles/<name>`.
- `src/main/profiles.ts` counts profile-local skills and reads profile config/env/SOUL state.
- `src/main/skills.ts` reads installed skills from `profileHome(profile)/skills/<category>/<skill>/SKILL.md`; bundled skills are read from the Hermes repo; install/uninstall currently shell out to `hermes skills install/uninstall` with optional `-p` for named profiles. There is no selected implementation for paste/upload/select manual Markdown import today.
- `Skills.tsx` is a global sidebar screen but already accepts `profile`; it has Installed/Browse tabs, installed detail overlay rendered by `AgentMarkdown`, install/uninstall, and refresh/search/category UI.
- `Memory.tsx` is a global sidebar screen but already accepts `profile`; it manages memory entries, user profile text, provider selection/env keys, and session/message stats from `src/main/memory.ts`.
- `Soul.tsx` is a global sidebar screen but already accepts `profile`; it auto-saves SOUL.md and supports reset.
- `Tools.tsx` and `Gateway.tsx` are also profile-aware and selected because they show adjacent global-vs-agent patterns.
- Remote/SSH parity: `src/main/ssh-remote.ts` is selected as codemap only; it already mirrors list/read/install/uninstall skills, memory, soul, toolsets, profiles, and config APIs but has no manual import API yet.

Performance audit targets:
- `src/main/index.ts` eagerly imports nearly every main-process subsystem, including Claw3D, installer, Hermes, SSH, config, sessions, profiles, memory, skills, cron, trace-store, locale, and ssh-remote.
- `Layout.tsx` statically imports all screen components; panes lazy-mount only after first visit but are still in the renderer bundle up front.
- `src/shared/i18n/index.ts` eagerly imports every locale namespace, including Office, for all locales.
- Polling/IPC patterns: `Gateway.tsx` polls gateway status every 10s; `Office.tsx` polls Claw3D every 5s when visible/ready; `Memory.tsx` and `Skills.tsx` load multiple IPC resources together on mount/profile change.
- Persistence patterns: `trace-store.ts` does JSON read-modify-write per trace event/usage/run finish; `session-cache.ts` and `config.ts` include local caching/sync patterns useful for comparison.
</architecture>

<selected_context>
.agent skills:
- `.agents/skills/electron-pro/SKILL.md`: Electron review role reference.
- `.agents/skills/typescript-expert/SKILL.md`: TypeScript review role reference.
- `.agents/skills/hermes-agent/SKILL.md` slices: Hermes Profiles/Skills architecture, SKILL.md structure, skill discovery/indexing, external dirs, profile isolation.

Core app/UI:
- `src/renderer/src/App.tsx`, `main.tsx`: renderer entry and boot flow.
- `src/renderer/src/screens/Layout/Layout.tsx`: sidebar/nav/view ownership and profile propagation.
- `src/renderer/src/screens/Office/Office.tsx`: visible Office/Claw3D UI to remove from user-facing app.
- `src/renderer/src/screens/Agents/Agents.tsx`: existing profile/agent management surface.
- `src/renderer/src/screens/Skills/Skills.tsx`, `Memory/Memory.tsx`, `Soul/Soul.tsx`, `Tools/Tools.tsx`, `Gateway/Gateway.tsx`: current global screens and profile-aware flows.
- `src/renderer/src/assets/icons/index.tsx`, `src/renderer/src/assets/main.css` slices: icon exports and relevant sidebar/screen styles.

Main/preload/storage:
- `src/main/index.ts`: IPC registration and eager main-process imports.
- `src/preload/index.ts`, `index.d.ts`: exposed renderer API and type surface.
- `src/main/claw3d.ts`: Office backend process/config helpers.
- `src/main/skills.ts`, `memory.ts`, `soul.ts`, `profiles.ts`, `utils.ts`, `config.ts`: profile-scoped storage and config implementation.
- `src/main/hermes.ts`, `session-cache.ts`, `trace-store.ts`, `src/shared/traces.ts`: performance and trace/skill-eval context.
- Codemaps: `src/main/ssh-remote.ts`, `installer.ts`, `Settings.tsx`, `Providers.tsx`, `TraceLab.tsx` for secondary APIs/surfaces.

I18n/docs/tests:
- `src/shared/i18n/index.ts`, `config.ts`, `types.ts`, and all selected locale files for navigation/office/skills/memory/soul/agents.
- `scripts/e2e-flow-sweep.mjs`: E2E nav expectations include Office and Skills/Memory/Persona flows.
- `tests/ipc-handlers.test.ts`, `preload-api-surface.test.ts`, `trace-store.test.ts`, `session-cache-sync.test.ts`: verification-relevant tests.
- `README.md` and `docs/hermes-product-spec.md`: product positioning, Office mentions, Trace/Skill Lab direction.
</selected_context>

<relationships>
- `App` -> `Layout` -> sidebar `NAV_ITEMS` -> individual screen panes.
- `Layout.activeProfile` -> `Agents.onSelectProfile()` -> `Skills/Memory/Soul/Tools/Gateway` props -> main IPC profile args -> `profileHome(profile)`.
- `Skills.tsx` -> preload `listInstalledSkills/listBundledSkills/getSkillContent/installSkill/uninstallSkill` -> `src/main/index.ts` -> `src/main/skills.ts` or `ssh-remote.ts`.
- Manual Markdown skill import likely crosses `Skills.tsx` or an agent/profile-focused surface -> preload typing/API -> main IPC -> local `skills.ts` and potentially SSH parity.
- `Memory.tsx` -> preload memory/config/env APIs -> `memory.ts` and `config.ts` using profile paths.
- `Soul.tsx` -> preload soul APIs -> `soul.ts` using `profileHome(profile)/SOUL.md`.
- Visible Office removal crosses `Layout.tsx`, `Office.tsx`, `main.css` Office styles, navigation/i18n, README, and E2E sweep; Claw3D backend/preload APIs are separate from visible UI.
- Performance work crosses `main/index.ts` eager imports, renderer screen imports in `Layout.tsx`, i18n eager imports, polling in Gateway/Office, and trace-store JSON persistence.
</relationships>

<ambiguities>
- “Complete removal of visible Office/3D feature” is clear for sidebar/UI/docs/tests, but backend/preload Claw3D removal is explicitly separable and may be a later cleanup unless the plan justifies including it.
- “Agent/profile-specific flows” could mean moving Skills/Memory/Soul under the Agents/Profile screen, adding profile context banners/filters, or creating a new agent detail workspace. Plan should present a staged path without assuming a single UI redesign.
- Manual skill import source is unspecified: paste Markdown, select `.md`, select folder containing `SKILL.md`, or all of these. Plan should call out API/UX decisions and validation/security boundaries.
</ambiguities>

## Selection
- Files: 74 total (67 full, 2 slice, 5 codemap)
- Total tokens: 112200 (Auto view)
- Token breakdown: full 95039, slice 12587, codemap 4574

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── .agents/
│   └── skills/
│       ├── electron-pro/
│       │   └── SKILL.md — 1 215 tokens (full)
│       ├── hermes-agent/
│       │   └── SKILL.md — 4 596 tokens (lines 70-120 (Hermes overview table highlighting learning loop, Skills, Profiles, and per-profile isolation context for agent/profile-specific planning.), 170-215 (Hermes repository architecture references for skill commands/config/hub and tools, useful for dispatching Hermes-specific research work.), 621-699 (CLI/profile/config excerpts showing `hermes skills`, profile pre-parsing, isolated agent instances, and external skill directories.), 1119-1297 (Skill commands and Skills System details: SKILL.md structure, auto-discovery, skills index, and skill loading behavior relevant to manual Markdown import UX/API.), 1470-1475 (Profile isolation note: named profiles own config, memory, sessions, skills, and gateway service.))
│       └── typescript-expert/
│           └── SKILL.md — 3 798 tokens (full)
├── docs/
│   └── hermes-product-spec.md — 1 191 tokens (full)
├── scripts/
│   └── e2e-flow-sweep.mjs — 3 050 tokens (full)
├── src/
│   ├── main/
│   │   ├── claw3d.ts — 4 248 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── hermes.ts — 6 574 tokens (full)
│   │   ├── index.ts — 9 605 tokens (full)
│   │   ├── memory.ts — 1 495 tokens (full)
│   │   ├── profiles.ts — 1 806 tokens (full)
│   │   ├── session-cache.ts — 1 407 tokens (full)
│   │   ├── skills.ts — 1 971 tokens (full)
│   │   ├── soul.ts — 307 tokens (full)
│   │   ├── trace-store.ts — 1 662 tokens (full)
│   │   └── utils.ts — 378 tokens (full)
│   ├── preload/
│   │   ├── index.d.ts — 3 284 tokens (full)
│   │   └── index.ts — 5 612 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── icons/
│   │       │   │   └── index.tsx — 185 tokens (full)
│   │       │   └── main.css — 7 991 tokens (lines 119-270 (Global design tokens and shared button/input styles used by affected UI screens and any new import controls.), 799-965 (App layout/sidebar/content styles that govern visible nav item removal and first-class surface bloat cleanup.), 1863-1895 (Shared settings container/header styles reused by Memory/Gateway and relevant when reshaping global screens.), 2288-2518 (Agents/Profile screen styles, the destination surface for agent-specific flows.), 2756-3120 (Skills screen styles including tabs, cards, detail overlay, and Markdown rendering for manual skill import planning.), 3454-3922 (Soul/Persona and Memory styles including editor, tabs, entries, profile, and provider panels for agent-specific UX reshaping.), 4335-4650 (Office/Claw3D styles to remove with visible Office UI cleanup while leaving unrelated CSS intact.))
│   │       ├── screens/
│   │       │   ├── Agents/
│   │       │   │   └── Agents.tsx — 2 245 tokens (full)
│   │       │   ├── Gateway/
│   │       │   │   └── Gateway.tsx — 2 383 tokens (full)
│   │       │   ├── Layout/
│   │       │   │   └── Layout.tsx — 2 906 tokens (full)
│   │       │   ├── Memory/
│   │       │   │   └── Memory.tsx — 5 547 tokens (full)
│   │       │   ├── Office/
│   │       │   │   └── Office.tsx — 4 153 tokens (full)
│   │       │   ├── Skills/
│   │       │   │   └── Skills.tsx — 3 010 tokens (full)
│   │       │   ├── Soul/
│   │       │   │   └── Soul.tsx — 899 tokens (full)
│   │       │   └── Tools/
│   │       │       └── Tools.tsx — 2 979 tokens (full)
│   │       ├── App.tsx — 1 303 tokens (full)
│   │       └── main.tsx — 88 tokens (full)
│   └── shared/
│       ├── i18n/
│       │   ├── locales/
│       │   │   ├── en/
│       │   │   │   ├── agents.ts — 171 tokens (full)
│       │   │   │   ├── memory.ts — 651 tokens (full)
│       │   │   │   ├── navigation.ts — 86 tokens (full)
│       │   │   │   ├── office.ts — 321 tokens (full)
│       │   │   │   ├── skills.ts — 223 tokens (full)
│       │   │   │   └── soul.ts — 130 tokens (full)
│       │   │   ├── es/
│       │   │   │   ├── agents.ts — 201 tokens (full)
│       │   │   │   ├── memory.ts — 775 tokens (full)
│       │   │   │   ├── navigation.ts — 93 tokens (full)
│       │   │   │   ├── office.ts — 366 tokens (full)
│       │   │   │   ├── skills.ts — 262 tokens (full)
│       │   │   │   └── soul.ts — 157 tokens (full)
│       │   │   ├── pt-BR/
│       │   │   │   ├── agents.ts — 190 tokens (full)
│       │   │   │   ├── memory.ts — 743 tokens (full)
│       │   │   │   ├── navigation.ts — 93 tokens (full)
│       │   │   │   ├── office.ts — 365 tokens (full)
│       │   │   │   ├── skills.ts — 261 tokens (full)
│       │   │   │   └── soul.ts — 144 tokens (full)
│       │   │   └── zh-CN/
│       │   │       ├── agents.ts — 179 tokens (full)
│       │   │       ├── memory.ts — 641 tokens (full)
│       │   │       ├── navigation.ts — 86 tokens (full)
│       │   │       ├── office.ts — 322 tokens (full)
│       │   │       ├── skills.ts — 212 tokens (full)
│       │   │       └── soul.ts — 117 tokens (full)
│       │   ├── config.ts — 69 tokens (full)
│       │   ├── index.ts — 2 011 tokens (full)
│       │   └── types.ts — 35 tokens (full)
│       └── traces.ts — 300 tokens (full)
├── tests/
│   ├── ipc-handlers.test.ts — 853 tokens (full)
│   ├── preload-api-surface.test.ts — 1 571 tokens (full)
│   ├── session-cache-sync.test.ts — 1 641 tokens (full)
│   └── trace-store.test.ts — 517 tokens (full)
├── README.md — 3 627 tokens (full)
├── electron.vite.config.ts — 121 tokens (full)
├── package.json — 659 tokens (full)
├── tsconfig.json — 28 tokens (full)
├── tsconfig.node.json — 70 tokens (full)
├── tsconfig.web.json — 110 tokens (full)
└── vitest.config.ts — 126 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── installer.ts — 1 220 tokens (manual)
    │   └── ssh-remote.ts — 2 795 tokens (manual)
    └── renderer/
        └── src/
            └── screens/
                ├── Providers/
                │   └── Providers.tsx — 45 tokens (manual)
                ├── Settings/
                │   └── Settings.tsx — 88 tokens (manual)
                └── TraceLab/
                    └── TraceLab.tsx — 426 tokens (manual)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `mercury-workstreams-AC4BBC` | **Mode**: plan

### Response
## 1. Summary

Mercury should proceed with a staged, targeted cleanup rather than a broad rewrite: first remove the visible Office/3D surface from the app UI, then consolidate Skills/Memory/Persona into profile-specific agent flows, add profile-local manual Markdown skill import, and finally run focused Electron/React/TypeScript performance work. The existing `activeProfile -> profile prop -> IPC -> profileHome(profile)` path already supports profile-scoped behavior, so most work should reuse current `Skills`, `Memory`, and `Soul` components instead of duplicating storage or APIs.

---

## 2. Current-state analysis

### App shell and navigation

- `src/renderer/src/App.tsx` only controls boot flow and renders `Layout` for the main app.
- `src/renderer/src/screens/Layout/Layout.tsx` owns:
  - `View` union.
  - `NAV_ITEMS`.
  - Lazy pane mounting via `visitedViews`.
  - `activeProfile`.
  - Passing `profile={activeProfile}` into profile-aware screens.
- `Layout` currently exposes first-class nav items for:
  - `office`
  - `skills`
  - `soul`
  - `memory`
  - plus other system screens.

### Office/3D surface

Visible Office functionality is fully renderer-owned through:

- `Layout.tsx`
  - `office` view in `View`.
  - `Building` icon import.
  - Office nav item.
  - Office pane render.
- `src/renderer/src/screens/Office/Office.tsx`
  - Claw3D setup/start/stop UI.
  - `webview`.
  - 5s polling when visible and ready.
  - Calls `window.hermesAPI.claw3d*`.
- `src/renderer/src/assets/main.css`
  - `.office-*` styles.
- I18n:
  - `navigation.office` in every locale.
  - `office` namespace imported and registered in `src/shared/i18n/index.ts`.
  - locale files: `src/shared/i18n/locales/*/office.ts`.
- Docs/e2e:
  - `README.md` lists Office as a feature/screen.
  - `scripts/e2e-flow-sweep.mjs` expects and clicks Office.

Backend Claw3D remains separate:

- `src/main/claw3d.ts`
- Claw3D IPC handlers in `src/main/index.ts`
- preload methods/types in `src/preload/index.ts` and `src/preload/index.d.ts`

The first cleanup slice should remove visible UI only; backend/preload removal should be a later dependent cleanup.

### Profile-scoped agent concepts

Existing profile flow is already usable:

```text
Layout.activeProfile
  -> Skills/Memory/Soul profile prop
  -> preload IPC profile arg
  -> main handler profile arg
  -> profileHome(profile)
  -> ~/.hermes or ~/.hermes/profiles/<name>
```

Relevant ownership:

- `src/main/utils.ts`
  - `profileHome(profile)` maps `default` to `HERMES_HOME`, named profiles to `HERMES_HOME/profiles/<name>`.
- `src/main/profiles.ts`
  - Lists profiles.
  - Counts profile-local skills.
  - Reads profile config/env/SOUL state.
- `src/main/skills.ts`
  - Reads installed skills from `profileHome(profile)/skills/<category>/<skill>/SKILL.md`.
  - Installs/uninstalls bundled skills through Hermes CLI.
  - Does **not** support manual Markdown import today.
- `src/main/memory.ts`
  - Reads/writes profile-local `memories/MEMORY.md` and `memories/USER.md`.
- `src/main/soul.ts`
  - Reads/writes profile-local `SOUL.md`.

Blocking issue: the UI still presents Skills, Memory, and Persona as global sidebar concepts even though the data path is profile-specific.

### Performance hotspots

Current likely hotspots:

- `src/main/index.ts` eagerly imports many main-process modules, including optional/heavy subsystems.
- `Layout.tsx` statically imports all screens even though panes lazy-mount only after first visit.
- `src/shared/i18n/index.ts` eagerly imports all locales and namespaces.
- Office currently adds a visible polling/webview surface; removing it reduces renderer work.
- `Memory.tsx` and `Skills.tsx` load multiple IPC resources on mount/profile change and should guard against stale async results after profile switches.

---

## 3. Design — work items

## Work item 1 — Remove visible Office/3D UI first

### Goal

Completely remove Office/Claw3D from the user-facing app: sidebar, renderer route, visible strings, CSS, README, and e2e expectations. Do **not** remove backend/preload Claw3D APIs in this first slice.

### Done criteria

- Sidebar no longer shows Office in any locale.
- `Layout` has no `office` view, no Office pane, and no Office import.
- No renderer code calls `window.hermesAPI.claw3d*`.
- Office-specific renderer CSS is removed.
- README and e2e sweep no longer list/click Office.
- Claw3D backend/preload IPC remains intact for now.

### Key files

- `src/renderer/src/screens/Layout/Layout.tsx`
- `src/renderer/src/screens/Office/Office.tsx`
- `src/renderer/src/assets/icons/index.tsx`
- `src/renderer/src/assets/main.css`
- `src/shared/i18n/index.ts`
- `src/shared/i18n/locales/*/navigation.ts`
- `src/shared/i18n/locales/*/office.ts`
- `scripts/e2e-flow-sweep.mjs`
- `README.md`

### Important implementation details

- Delete or orphan-remove `Office.tsx`; preferred: delete it once `Layout` no longer imports it.
- Remove `Building` icon export/import only if no other renderer file uses it.
- Remove `.office-*` styles.
- Before deleting `@keyframes spin`, validate whether non-office loading styles use it. If yes, keep/move it to a shared loading section.
- Remove `office` namespace from `resources` in `src/shared/i18n/index.ts`.
- Remove `navigation.office` keys from all locale files.

### Dependencies

- Must be first.
- Blocks work item 2 because both touch `Layout.tsx`.

### Suggested agent role

Electron/React product cleanup engineer.

### Verification commands

```bash
npm run typecheck
npm run lint
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts src/shared/i18n/index.test.ts
```

Optional real app sweep after updating expectations:

```bash
npm run build
node scripts/e2e-flow-sweep.mjs
```

### Parallelization

Run alone as the first UI slice. README/e2e edits can be done in parallel with renderer edits, but land atomically.

---

## Work item 2 — Move Skills/Memory/Persona into profile-specific agent flows

### Goal

Stop presenting Skills, Memory, and Persona as global sidebar surfaces. Make them contextual tabs inside the existing Profiles/Agents surface for the selected profile.

### Done criteria

- Sidebar no longer shows top-level Skills, Memory, or Persona.
- Profiles/Agents screen exposes tabs for:
  - Overview
  - Skills
  - Memory
  - Persona
- Each tab operates on the selected `activeProfile`.
- Existing `Skills`, `Memory`, and `Soul` storage/API paths are reused.
- No duplicate implementations of skills, memory, or soul editing are introduced.

### Key files

- `src/renderer/src/screens/Layout/Layout.tsx`
- `src/renderer/src/screens/Agents/Agents.tsx`
- `src/renderer/src/screens/Skills/Skills.tsx`
- `src/renderer/src/screens/Memory/Memory.tsx`
- `src/renderer/src/screens/Soul/Soul.tsx`
- `src/renderer/src/assets/main.css`
- `src/shared/i18n/locales/*/navigation.ts`
- `src/shared/i18n/locales/*/agents.ts`

### Design decisions

- Keep internal data model terminology as `profile`.
- Keep current `activeProfile` state in `Layout`.
- `Agents.tsx` becomes the profile workspace owner.
- Add embedded mode props to reused screens:

```ts
type EmbeddedProfileScreenProps = {
  profile?: string;
  embedded?: boolean;
  profileLabel?: string;
};
```

- `Skills`, `Memory`, and `Soul` should continue to work standalone during transition, but after `Layout` nav removal they are rendered only from `Agents`.
- In embedded mode:
  - Avoid full-page duplicated padding where needed.
  - Avoid nested scroll conflicts.
  - Keep existing IPC calls unchanged.

### State/data flow

```text
User selects profile card in Agents
  -> Agents calls window.hermesAPI.setActiveProfile(name)
  -> Layout.onSelectProfile(name)
  -> activeProfile changes
  -> Agents detail tabs receive profile={activeProfile}
  -> Skills/Memory/Soul reload profile-scoped data
  -> main process resolves profileHome(profile)
```

If a stale async load returns after profile switch, the component must ignore it using a request id/ref guard.

### Dependencies

- Depends on work item 1.
- Should land before work item 3 UI integration so manual import lands in the final Skills location.

### Suggested agent role

React product/IA engineer with Hermes profile awareness.

### Verification commands

```bash
npm run typecheck:web
npm run lint
npm run test -- src/shared/i18n/index.test.ts
```

Manual smoke:

```bash
npm run dev
```

Validate:

- Create/switch profile.
- Open profile Skills tab.
- Open profile Memory tab.
- Open profile Persona tab.
- Confirm profile-specific content changes when active profile changes.

### Parallelization

Can run in parallel with work item 4 audit-only tasks, but not with work item 4 `Layout.tsx` code-splitting edits.

---

## Work item 3 — Add profile-local manual Markdown skill import

### Goal

Allow users to manually import a Hermes skill by pasting Markdown for a `SKILL.md`, scoped to the selected profile.

### Done criteria

- Skills tab has an “Import Markdown” action.
- User can paste Markdown, set/confirm name/category/description, and import.
- Imported skill is written to:

```text
profileHome(profile)/skills/<category>/<skill-name>/SKILL.md
```

- Imported skill appears immediately in Mercury’s installed skills list.
- Duplicate imports fail unless overwrite is explicitly enabled.
- Local and SSH modes have parity.
- Pure remote HTTP mode remains unsupported because profile-local filesystem access is unavailable.

### Key files

- `src/shared/skills.ts` — new shared request/result types.
- `src/main/skills.ts`
- `src/main/index.ts`
- `src/main/ssh-remote.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `src/renderer/src/screens/Skills/Skills.tsx`
- `src/shared/i18n/locales/*/skills.ts`
- `tests/ipc-handlers.test.ts`
- `tests/preload-api-surface.test.ts`
- New test: `tests/skills-import.test.ts`

### API shape

Add a new preload method:

```ts
importSkillMarkdown(
  request: SkillMarkdownImportRequest,
  profile?: string,
): Promise<SkillMarkdownImportResult>
```

Shared request/result shape:

```ts
type SkillMarkdownImportRequest = {
  markdown: string;
  name?: string;
  category?: string;
  description?: string;
  overwrite?: boolean;
};

type SkillMarkdownImportResult =
  | {
      success: true;
      skill: {
        name: string;
        category: string;
        description: string;
        path: string;
      };
      warning?: "gateway-restart-required";
    }
  | {
      success: false;
      code:
        | "invalid-markdown"
        | "invalid-name"
        | "invalid-category"
        | "duplicate"
        | "write-failed";
      error: string;
    };
```

### Validation rules

- `markdown` is required.
- Reject Markdown over `200_000` characters.
- Reject NUL bytes.
- Skill name slug:
  - Source: explicit `request.name`, else frontmatter `name`, else first `# Heading`.
  - Must match: `^[a-z0-9][a-z0-9_-]{1,63}$`.
- Category slug:
  - Default: `custom`.
  - Must match: `^[a-z0-9][a-z0-9_-]{0,63}$`.
- Use `path.resolve`/prefix validation to guarantee target remains under profile skills root.
- Write only `SKILL.md`; do not support folder/resource import in this slice.

### Markdown normalization

- If YAML frontmatter exists, normalize or insert `name` and `description`.
- If no frontmatter exists, prepend minimal frontmatter.
- Preserve the body content exactly after frontmatter normalization.

### Hermes runtime behavior

Manual import writes files directly. Mercury should immediately show the skill in its installed list. If gateway is currently running, return/display `gateway-restart-required` because Hermes may not re-index profile skills until a new process/session.

### Dependencies

- API work can start after work item 1.
- Final UI placement depends on work item 2.

### Suggested agent role

Hermes Agent integration engineer + TypeScript API engineer.

### Verification commands

```bash
npm run typecheck
npm run test -- tests/skills-import.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
```

Manual smoke:

- Import valid pasted Markdown into default profile.
- Import into a named profile.
- Attempt duplicate without overwrite.
- Attempt invalid slug.
- Confirm installed list refreshes.

### Parallelization

Main/preload API implementation can run in parallel with work item 2 if the request/result type is agreed first. UI integration should wait for work item 2.

---

## Work item 4 — Electron/React/TypeScript performance audit and quick wins

### Goal

Measure and reduce initial app startup/render cost without changing product behavior.

### Done criteria

- A short `docs/performance-audit.md` records before/after:
  - Typecheck timings.
  - Build chunk sizes.
  - Main startup observations.
  - Renderer initial route behavior.
- Non-chat screens are code-split.
- Heavy optional main-process modules are lazy-loaded behind IPC handlers where safe.
- No IPC channels are broken.
- Typecheck/test results remain clean.

### Key files

- `src/renderer/src/screens/Layout/Layout.tsx`
- `src/renderer/src/screens/Agents/Agents.tsx`
- `src/main/index.ts`
- `src/shared/i18n/index.ts`
- `docs/performance-audit.md`
- `electron.vite.config.ts` only if chunk naming/reporting is needed.

### Renderer design

- Keep `Chat` eager because it is the default main view.
- Convert non-default screens to `React.lazy`.
- Keep `visitedViews` to avoid remounting after first visit.
- Wrap lazy panes with one shared `Suspense` fallback using existing loading styles.
- If work item 2 has landed, lazy-load `Skills`, `Memory`, and `Soul` inside the agent workspace instead of from `Layout`.

### Main-process design

Keep IPC handlers registered synchronously, but lazy-load heavy modules inside handlers.

Priority modules:

- `sessions`
- `session-cache`
- `memory`
- optional Claw3D code if work item 5 has not removed it yet.

Do not lazy-load core install/boot checks until measured, because `App.tsx` depends on install status during startup.

### TypeScript audit commands

```bash
npx tsc --noEmit -p tsconfig.node.json --composite false --extendedDiagnostics
npx tsc --noEmit -p tsconfig.web.json --composite false --extendedDiagnostics
```

### Verification commands

```bash
npm run typecheck
npm run test
npm run build
```

### Dependencies

- Audit can start immediately after work item 1.
- Renderer code-splitting should wait until work item 2 stabilizes `Layout` and `Agents`.

### Suggested agent role

Electron performance engineer + TypeScript expert.

### Parallelization

Audit/documentation can run in parallel with work items 2 and 3. Code changes to `Layout.tsx` should not run in parallel with work item 2.

---

## Work item 5 — Retire hidden Claw3D backend/preload API surface

### Goal

After visible Office removal is accepted, remove the remaining Claw3D IPC/preload/backend surface to reduce product bloat, startup imports, and API surface area.

### Done criteria

- `src/main/claw3d.ts` is removed.
- `claw3d-*` IPC handlers are removed.
- `window.hermesAPI.claw3d*` methods and types are removed.
- Tests are updated to no longer require Claw3D preload methods.
- No `Claw3D`, `claw3d`, or Office product references remain in `src`, `README.md`, or e2e scripts except historical docs if intentionally retained.

### Key files

- `src/main/claw3d.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/preload/index.d.ts`
- `tests/preload-api-surface.test.ts`
- `tests/ipc-handlers.test.ts`
- `README.md`
- `scripts/e2e-flow-sweep.mjs`

### Important boundary

Do **not** delete user data such as:

```text
~/.hermes/hermes-office
~/.hermes/claw3d-*
~/.openclaw/claw3d
```

Removing app support should not mutate user filesystem state.

### Dependencies

- Depends on work item 1.
- Prefer after work item 3 if both are editing preload/main IPC files.

### Suggested agent role

Electron IPC/security cleanup engineer.

### Verification commands

```bash
npm run typecheck
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run lint
```

Static validation:

```bash
grep -R "claw3d\|Claw3D\|Office" src README.md scripts docs || true
```

### Parallelization

Can run in parallel with documentation or performance audit work, but coordinate with any branch touching `src/main/index.ts`, `src/preload/index.ts`, or `src/preload/index.d.ts`.

---

## 4. File-by-file impact

### `src/renderer/src/screens/Layout/Layout.tsx`

- Work item 1:
  - Remove `office` from `View`.
  - Remove Office nav item.
  - Remove Office pane.
  - Remove Office import and `Building` import.
- Work item 2:
  - Remove `skills`, `memory`, and `soul` as top-level views.
  - Remove corresponding nav items and panes.
- Work item 4:
  - Add `React.lazy`/`Suspense` for non-default screens.

Ordering: work item 1 before work item 2; work item 4 after both.

### `src/renderer/src/screens/Office/Office.tsx`

- Work item 1:
  - Delete once no longer imported.

### `src/renderer/src/screens/Agents/Agents.tsx`

- Work item 2:
  - Add profile workspace tabs.
  - Render embedded `Skills`, `Memory`, and `Soul`.
  - Preserve existing profile create/delete/select/chat behavior.
- Work item 4:
  - Lazy-load embedded heavy tabs if needed.

### `src/renderer/src/screens/Skills/Skills.tsx`

- Work item 2:
  - Add optional embedded mode.
- Work item 3:
  - Add Import Markdown modal/action.
  - Call `window.hermesAPI.importSkillMarkdown`.
  - Refresh installed list on success.
- Work item 4:
  - Add stale async result guard.

### `src/renderer/src/screens/Memory/Memory.tsx`

- Work item 2:
  - Add optional embedded mode.
- Work item 4:
  - Add stale async result guard for `loadData`.

### `src/renderer/src/screens/Soul/Soul.tsx`

- Work item 2:
  - Add optional embedded mode.
  - Keep autosave behavior unchanged.

### `src/renderer/src/assets/main.css`

- Work item 1:
  - Remove `.office-*` styles.
  - Preserve shared spinner keyframes if used elsewhere.
- Work item 2:
  - Add agent workspace/detail/tab styles.
  - Add embedded variants for Skills/Memory/Soul containers.
- Work item 3:
  - Add import modal/form styles if existing shared modal styles are insufficient.

### `src/renderer/src/assets/icons/index.tsx`

- Work item 1:
  - Remove `Building` export if unused.
- Work item 3:
  - Add import-related icon exports only if using lucide icons not already exported.

### `src/main/skills.ts`

- Work item 3:
  - Add validation helpers.
  - Add Markdown frontmatter normalization.
  - Add `importSkillMarkdown`.
  - Reuse existing `parseSkillFrontmatter` logic; do not duplicate parsing.

### `src/shared/skills.ts`

- Work item 3:
  - New shared request/result types for import API.

### `src/main/index.ts`

- Work item 3:
  - Add `import-skill-markdown` IPC handler.
  - Route local vs SSH.
- Work item 4:
  - Lazy-load measured heavy handlers.
- Work item 5:
  - Remove Claw3D imports and handlers.

### `src/preload/index.ts` and `src/preload/index.d.ts`

- Work item 3:
  - Add `importSkillMarkdown`.
- Work item 5:
  - Remove all `claw3d*` methods/types.

### `src/main/ssh-remote.ts`

- Work item 3:
  - Add SSH parity for Markdown skill import using existing SSH file-write patterns.

Unknown to validate: exact helper names in `ssh-remote.ts`; follow existing `sshWriteSoul`/skill install patterns.

### `src/shared/i18n/index.ts`

- Work item 1:
  - Remove Office namespace imports/resources.
- Work item 4:
  - Audit bundle impact; do not introduce async i18n loading unless measurements justify it.

### Locale files

- `src/shared/i18n/locales/*/navigation.ts`
  - Work item 1: remove `office`.
  - Work item 2: remove top-level `skills`, `memory`, `soul` nav labels if no longer used.
- `src/shared/i18n/locales/*/office.ts`
  - Work item 1: delete.
- `src/shared/i18n/locales/*/agents.ts`
  - Work item 2: add profile workspace tab labels.
- `src/shared/i18n/locales/*/skills.ts`
  - Work item 3: add import modal/action/error strings.

### `README.md`

- Work item 1:
  - Remove Office/Claw3D feature and screen references.
- Work item 5:
  - Remove any remaining hidden Claw3D/API references if present.

### `scripts/e2e-flow-sweep.mjs`

- Work item 1:
  - Remove Office from expected nav labels.
  - Remove Office click/smoke step.
- Work item 2:
  - Update Skills/Memory/Persona checks to go through Profiles/Agents tabs.
- Work item 3:
  - Optionally add a manual import smoke step if the e2e environment can safely write to temporary `HERMES_HOME`.

### Tests

- `tests/ipc-handlers.test.ts`
  - Work item 3: channel parity should include new import channel automatically.
  - Work item 5: remove Claw3D expectations if any are added/derived.
- `tests/preload-api-surface.test.ts`
  - Work item 3: add/verify import method.
  - Work item 5: remove Claw3D legacy requirement.
- New `tests/skills-import.test.ts`
  - Work item 3: validate local import behavior.

---

## 5. Risks and migration

- Office visible removal has no data migration. Existing user Claw3D files should be left untouched.
- Moving Skills/Memory/Persona under Profiles changes navigation muscle memory but not persisted data.
- Manual skill import writes user-provided Markdown to profile-local filesystem paths; strict slug/path validation is required.
- Imported skills may require Hermes gateway restart before the agent runtime sees them. Mercury should show that warning instead of silently restarting long-running gateways.
- Work item 5 removes internal preload APIs. This is acceptable only after confirming no renderer code and no product-supported extension depends on `window.hermesAPI.claw3d*`.

---

## 6. Implementation order

1. **Work item 1: Visible Office/3D removal**  
   Land atomically with README/e2e/i18n updates.

2. **Work item 2: Agent/profile workspace consolidation**  
   Move Skills/Memory/Persona under Profiles/Agents and remove their global nav items.

3. **Work item 3: Manual Markdown skill import**  
   Implement shared types, main/preload/SSH API, tests, then UI inside the profile Skills tab.

4. **Work item 4: Performance audit and quick wins**  
   Start measurement anytime after work item 1; land renderer code-splitting after work item 2 stabilizes.

5. **Work item 5: Hidden Claw3D backend/preload retirement**  
   Land after work item 1 and preferably after work item 3 to avoid preload/main IPC merge conflicts.


---

## 7. Orchestration progress — 2026-05-13

- [x] Parallel A / Work item 1: visible Office/3D UI removal completed. Agent reports `typecheck:web` and targeted i18n/preload IPC tests passed; full typecheck was blocked at that moment by concurrent skill-import edits.
- [x] Parallel B / Work item 3: manual Markdown skill import completed, including shared types, local primitive, SSH parity, IPC/preload API, Skills UI, i18n, and tests. Agent reports targeted tests and `npm run typecheck` passed; full lint still fails on existing unrelated repo-wide issues.
- [x] Parallel C / Work item 4 audit-doc slice: `docs/performance-audit.md` created with baseline TypeScript/build/bundle observations and prioritized quick wins. No source changes from this slice.
- [x] Integration pass: completed. Combined diff inspected; one UI integration issue fixed so manual Markdown import errors render inside the open import modal. Verification completed: `npm run typecheck` passed; targeted skill import / IPC / preload / i18n tests passed; `npm run build` passed. Full `npm run lint` still fails on pre-existing unrelated repo-wide lint issues, while targeted ESLint on changed files has 0 errors (warnings only). Work item 2 and Work item 5 were not started.

> 💡 Continue this plan conversation with ask_oracle(chat_id: "mercury-workstreams-AC4BBC", new_chat: false)
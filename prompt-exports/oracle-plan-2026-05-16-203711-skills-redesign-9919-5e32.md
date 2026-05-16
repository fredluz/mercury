## Final Prompt
<taskname="Skills Redesign"/>
<task>
Redesign the Skills screen so large skill sets are grouped by category into collapsible/expandable category sections. Support category-level bulk enable/disable plus individual skill enable/disable inside each group. Replace the current skill markdown detail modal with an in-screen detail page/panel: markdown content on the left, metadata on the right, including which Agents use the skill and associated scripts/references where feasible. Keep the manual Markdown import modal working. Add focused tests for grouping/collapse, bulk actions, individual actions, and detail metadata using the existing test patterns.
</task>

<architecture>
- Renderer entry point is `src/renderer/src/screens/Skills/Skills.tsx`. It owns tab state (`installed`/`browse`), search/category filtering, selected profile, skill lists, install/uninstall/import state, and currently renders flat grids.
- `src/renderer/src/screens/Skills/components/SkillModals.tsx` currently combines the installed-skill markdown detail overlay and manual Markdown import modal. The requested detail experience should no longer be this modal, but the import modal behavior must remain available.
- Styling is in `src/renderer/src/assets/styles/skills.css`, with shared overlay primitives in `shared-overlays.css` and design tokens/buttons in `foundation.css`.
- Markdown rendering is already available via `src/renderer/src/components/AgentMarkdown.tsx`, including code blocks, copy button, GFM, and safe external-link handling.
- Skill renderer APIs are exposed by `window.hermesAPI` through `src/preload/api/knowledge.ts` and typed in `src/preload/index.d.ts`: `listInstalledSkills(profile?)`, `listBundledSkills()`, `getSkillContent(skillPath)`, `installSkill(identifier, profile?)`, `uninstallSkill(name, profile?)`, `importSkillMarkdown(request, profile?)`.
- Main skill implementation lives in `src/main/skills.ts`; installed skills are directories at `<profileHome>/skills/<category>/<skill>/SKILL.md`, bundled skills are read from `<HERMES_REPO>/skills/<category>/<skill>/SKILL.md`, and install/uninstall shell out to `hermes skills install/uninstall` with `-p <profile>` for non-default profiles.
- IPC routing is in `src/main/ipc/knowledge.ts`; successful skill mutations call `markRuntimeStale(profile, ...)`. SSH mode routes to `src/main/ssh/skills.ts`; pure remote HTTP mode is already gated out of the Skills screen by `Layout` (`RemoteNotice feature="Skills"`).
- Agent/profile data comes from `window.hermesAPI.listProfiles()` in `src/preload/api/navigation.ts` and `src/main/ipc/sessions.ts` -> `src/main/profiles.ts`. User-facing copy should say Agents, while API/runtime variables may remain `profile` for compatibility.
- i18n resources are centralized in `src/shared/i18n/index.ts`; Skills copy currently lives in all four selected locale files under `src/shared/i18n/locales/{en,es,pt-BR,zh-CN}/skills.ts`.
</architecture>

<selected_context>
- `src/renderer/src/screens/Skills/Skills.tsx`: current flat installed/browse UI, search/filter logic, install/uninstall/import handlers, selected profile prop, and current detail state.
- `src/renderer/src/screens/Skills/components/SkillModals.tsx`: current detail modal to replace and import modal to preserve/refactor.
- `src/renderer/src/assets/styles/skills.css`, `shared-overlays.css`, `foundation.css`, `assets/icons/index.tsx`: complete styling and icon/design-token context for grouped sections, toggles, split detail panel, and action buttons.
- `src/renderer/src/components/AgentMarkdown.tsx`: use for the markdown side of the detail panel.
- `src/renderer/src/screens/Layout/Layout.tsx` + `Layout.test.tsx`: Skills receives `profile={activeProfile}` and is remote-gated; test mocking patterns for screen-level renderer tests.
- `src/renderer/src/screens/Sessions/Sessions.test.tsx`, `src/renderer/src/test/setup.ts`, `vitest.config.ts`: Testing Library/Vitest patterns and setup. There is no existing `Skills.test.tsx`; create one if needed.
- `src/shared/i18n/locales/*/skills.ts`, `src/shared/i18n/index.ts`, `index.test.ts`, `I18nProvider.tsx`, `I18nProvider.test.tsx`, `useI18n.ts`: add any new UI strings consistently across locales and preserve fallback/interpolation behavior.
- `src/main/skills.ts`, `src/main/skills/importer.ts`, `src/shared/skills.ts`: local skill contracts and filesystem layout. `InstalledSkill` currently has `name/category/description/path`; `SkillSearchResult` has `name/description/category/source/installed`.
- `src/main/ipc/knowledge.ts`, `src/preload/api/knowledge.ts`, `src/preload/index.d.ts`, `tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`: required files/tests if adding a new metadata API for scripts/references or expanded skill types.
- `src/main/profiles.ts`, `src/main/ipc/sessions.ts`, `src/preload/api/navigation.ts`: profile/Agent list flow usable to derive which Agents have a given skill installed.
- `src/main/ssh/skills.ts`: SSH behavior and `REMOTE:` skill paths; metadata discovery for scripts/references must degrade or route through SSH if implemented beyond renderer-only derivation.
- `docs/subsystems/skills.md`: current subsystem behavior, remote/local differences, import contract, and verification guidance.
- `package.json`: available scripts (`npm run test`, `npm run typecheck`, etc.).
</selected_context>

<relationships>
- `Layout` active profile -> `<Skills profile={activeProfile} />` -> `listInstalledSkills(profile)` / `installSkill(name, profile)` / `uninstallSkill(name, profile)`. This is the selected Agent’s installed/enabled skill set.
- Installed tab today: `installedSkills` -> flat `.skills-grid` -> button card -> `handleViewDetail(skill)` -> `getSkillContent(skill.path)` -> `SkillModals` detail overlay.
- Browse tab today: `bundledSkills` + `installedNames` -> flat `.skills-grid`; install button calls `installSkill(skill.name, profile)`. `BundledSkill.installed` exists but the UI currently derives installed state by lowercased name only.
- Category grouping can be derived from `skill.category` for both installed and bundled collections. Current category pills only filter browse; installed has no category affordance.
- No separate enable/disable flag exists in selected Mercury APIs. Existing user-visible enable/disable behavior likely maps to install/uninstall for the selected Agent unless a backend change introduces richer state.
- Agents using a skill can be derived without new backend state by calling `listProfiles()`, then `listInstalledSkills(profile.name)` for each profile, and matching skill identity. Matching by both category/name is safer than name-only when possible.
- Associated scripts/references are not exposed by the current preload API. Local `src/main/skills.ts` already imports `readdirSync/statSync/readFileSync`, so a main/preload metadata API could inspect directories like `<skill.path>/scripts` and `<skill.path>/references`; SSH mode would need corresponding support or graceful “unavailable” metadata.
- Adding any new IPC/preload method requires updates in `src/main/ipc/knowledge.ts`, `src/preload/api/knowledge.ts`, `src/preload/index.d.ts`, and contract tests (`tests/ipc-handlers.test.ts`, `tests/preload-api-surface.test.ts`).
- New Skills UI strings should use `skills.*` i18n keys in all locales, not hardcoded English, except technical values like directory names or `SKILL.md`.
</relationships>

<ambiguities>
- Bulk enable/disable wording: the request says enable/disable, but selected code exposes install/uninstall only. No persisted skill-enabled flag was found in Mercury’s skill API. Decide whether to present install/uninstall as enable/disable in UI or add a richer backend contract.
- Detail metadata for scripts/references is feasible locally from skill directories but not currently exposed to the renderer. For SSH paths (`REMOTE:`), renderer-side path inspection is impossible; implement a backend/SSH route or degrade gracefully.
- Browse-tab detail for uninstalled bundled skills is not currently supported because bundled results have no path and `getSkillContent` requires a skill directory path. Decide whether detail pages apply only to installed skills in V1 or require bundled skill path/content support.
- Skill identity matching across Agents may be ambiguous if two categories contain the same skill name. Prefer category/name matching where the data allows it; note that current install/uninstall APIs take only `name`.
</ambiguities>

## Selection
- Files: 47 total (41 full, 6 codemap)
- Total tokens: 54024 (Auto view)
- Token breakdown: full 51356, codemap 2668

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   └── subsystems/
│       └── skills.md — 2 616 tokens (full)
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   ├── knowledge.ts — 1 922 tokens (full)
│   │   │   └── sessions.ts — 2 134 tokens (full)
│   │   ├── skills/
│   │   │   └── importer.ts — 1 730 tokens (full)
│   │   ├── ssh/
│   │   │   └── skills.ts — 1 819 tokens (full)
│   │   ├── profiles.ts — 1 806 tokens (full)
│   │   └── skills.ts — 1 999 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   ├── knowledge.ts — 797 tokens (full)
│   │   │   └── navigation.ts — 712 tokens (full)
│   │   ├── index.d.ts — 3 745 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── icons/
│   │       │   │   └── index.tsx — 182 tokens (full)
│   │       │   └── styles/
│   │       │       ├── foundation.css — 1 920 tokens (full)
│   │       │       ├── shared-overlays.css — 168 tokens (full)
│   │       │       └── skills.css — 2 083 tokens (full)
│   │       ├── components/
│   │       │   ├── AgentMarkdown.tsx — 1 307 tokens (full)
│   │       │   ├── I18nProvider.test.tsx — 516 tokens (full)
│   │       │   ├── I18nProvider.tsx — 490 tokens (full)
│   │       │   └── useI18n.ts — 143 tokens (full)
│   │       ├── screens/
│   │       │   ├── Chat/
│   │       │   │   └── components/
│   │       │   │       └── ChatActivityGroup.tsx — 760 tokens (full)
│   │       │   ├── Layout/
│   │       │   │   ├── Layout.test.tsx — 1 275 tokens (full)
│   │       │   │   └── Layout.tsx — 4 612 tokens (full)
│   │       │   ├── Sessions/
│   │       │   │   └── Sessions.test.tsx — 1 628 tokens (full)
│   │       │   └── Skills/
│   │       │       ├── components/
│   │       │       │   └── SkillModals.tsx — 1 648 tokens (full)
│   │       │       └── Skills.tsx — 3 379 tokens (full)
│   │       └── test/
│   │           └── setup.ts — 43 tokens (full)
│   └── shared/
│       ├── i18n/
│       │   ├── locales/
│       │   │   ├── en/
│       │   │   │   └── skills.ts — 439 tokens (full)
│       │   │   ├── es/
│       │   │   │   └── skills.ts — 495 tokens (full)
│       │   │   ├── pt-BR/
│       │   │   │   └── skills.ts — 500 tokens (full)
│       │   │   └── zh-CN/
│       │   │       └── skills.ts — 424 tokens (full)
│       │   ├── config.ts — 69 tokens (full)
│       │   ├── index.test.ts — 327 tokens (full)
│       │   ├── index.ts — 1 938 tokens (full)
│       │   └── types.ts — 35 tokens (full)
│       └── skills.ts — 188 tokens (full)
├── tests/
│   ├── ipc-handlers.test.ts — 1 814 tokens (full)
│   ├── preload-api-surface.test.ts — 2 759 tokens (full)
│   └── skills-import.test.ts — 1 370 tokens (full)
├── package.json — 1 202 tokens (full)
└── vitest.config.ts — 126 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── install/
    │   │   └── paths.ts — 672 tokens (auto)
    │   └── ssh-tunnel.ts — 592 tokens (auto)
    └── shared/
        ├── chat-metadata.ts — 466 tokens (auto)
        ├── perf.ts — 203 tokens (auto)
        ├── runtime.ts — 349 tokens (auto)
        └── traces.ts — 386 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `skills-redesign-9919FD` | **Mode**: plan

### Response
## 1. **Summary**

Redesign the Skills screen with a targeted renderer-first refactor plus one additive metadata IPC API. The new UI will group installed and browse skill lists by category into collapsible sections, map “enable/disable” to the existing selected-Agent install/uninstall operations, add category-level bulk actions, and replace the installed skill detail modal with an in-screen split detail panel showing markdown, skill metadata, Agents using the skill, and discovered `scripts/` / `references/` files where available. Manual Markdown import remains a modal. This should be implemented as a localized Skills subsystem change rather than a broad refactor because existing profile-aware install/uninstall/list APIs already model selected-Agent skill membership.

## 2. **Current-state analysis**

### Existing responsibilities and flow

- `src/renderer/src/screens/Layout/Layout.tsx`
  - Owns `activeProfile`.
  - Renders `<Skills profile={activeProfile} />`.
  - Pure remote HTTP mode is already gated with `<RemoteNotice feature="Skills" />`, so Skills screen only needs to support local and SSH modes.

- `src/renderer/src/screens/Skills/Skills.tsx`
  - Owns all Skills screen state:
    - `tab`: `"installed" | "browse"`.
    - `installedSkills`: selected Agent’s installed skills from `listInstalledSkills(profile)`.
    - `bundledSkills`: bundled/browsable skills from `listBundledSkills()`.
    - search/filter state.
    - install/uninstall/import state.
    - current detail modal state: `detailSkill`, `detailContent`.
  - Current installed UI is a flat grid.
  - Current browse UI is a flat grid with category filter pills.
  - Installed detail flow:
    - Card click → `handleViewDetail(skill)` → `window.hermesAPI.getSkillContent(skill.path)` → render modal in `SkillModals`.

- `src/renderer/src/screens/Skills/components/SkillModals.tsx`
  - Currently combines two unrelated modal responsibilities:
    1. Installed skill markdown detail overlay.
    2. Manual Markdown import modal.
  - Requested design removes responsibility 1 but preserves responsibility 2.

- `src/main/skills.ts`
  - `InstalledSkill` has:
    ```ts
    { name: string; category: string; description: string; path: string }
    ```
  - `listInstalledSkills(profile?)` walks:
    ```text
    <profileHome>/skills/<category>/<skill-name>/SKILL.md
    ```
  - `getSkillContent(skillPath)` reads `<skillPath>/SKILL.md`.
  - `installSkill(identifier, profile?)` and `uninstallSkill(name, profile?)` shell out to Hermes CLI.

- `src/main/ipc/knowledge.ts`
  - Routes skill IPC calls.
  - Marks profile runtime stale after successful install/uninstall/import.
  - SSH mode delegates to `src/main/ssh/skills.ts`.

- `src/main/ssh/skills.ts`
  - Installed skill paths are returned with `REMOTE:` prefix.
  - `sshGetSkillContent` strips `REMOTE:` and reads remote `SKILL.md`.
  - It can support metadata discovery with remote directory inspection.

- `src/preload/api/knowledge.ts` and `src/preload/index.d.ts`
  - Expose current Skills APIs to renderer.
  - Any new API must be added in both files and protected by existing preload/API surface tests.

### Reusable code

- Reuse:
  - `AgentMarkdown` for the markdown side of the detail panel.
  - Existing `installSkill` / `uninstallSkill` as enable/disable operations.
  - Existing `listProfiles()` + `listInstalledSkills(profile.name)` to derive Agents using a skill.
  - Existing `getSkillContent(skill.path)` for detail markdown.
  - Existing import implementation and modal state.

### Blocking gaps

- There is no separate persisted “enabled” flag for skills.
  - Therefore, “enabled for selected Agent” must mean “installed in selected Agent profile”.
  - “Disable” must mean uninstall from selected Agent.
  - “Enable” must mean install into selected Agent.
- Scripts/references metadata is not exposed to the renderer.
  - Add a small additive API that inspects `scripts/` and `references/` under a skill directory and degrades gracefully when unavailable.

## 3. **Design**

### 3.1 Skill enable/disable semantics

Use existing install/uninstall semantics; do not introduce a new persisted enabled state.

#### Behavior

- Installed tab:
  - Every listed skill is enabled for the selected Agent.
  - Individual “Disable” calls:
    ```ts
    window.hermesAPI.uninstallSkill(skill.name, profile)
    ```
  - Category “Disable all” calls uninstall for each skill in that category.

- Browse tab:
  - Every bundled skill is grouped by category.
  - A skill is enabled when it matches an installed skill for the selected Agent.
  - Individual “Enable” calls:
    ```ts
    window.hermesAPI.installSkill(skill.name, profile)
    ```
  - Individual “Disable” for already-installed browse rows calls uninstall.
  - Category “Enable all” installs all not-yet-installed skills in that category.
  - Category “Disable all” uninstalls installed skills in that category.

#### Identity matching

Use category + case-insensitive name when possible:

```ts
type SkillIdentity = {
  category: string;
  name: string;
};

function skillKey(skill: SkillIdentity): string {
  return `${skill.category.toLowerCase()}\u0000${skill.name.toLowerCase()}`;
}
```

Fallback for legacy/ambiguous cases:
- Browse installed status should first check `category/name`.
- If not found, optionally fall back to current name-only behavior only for install badge compatibility.
- Bulk uninstall should only operate on exact category/name matches from `installedSkills`.

Rationale: category/name prevents false positives when two categories contain same skill name, while fallback preserves current behavior.

---

### 3.2 Renderer components

#### Modify `src/renderer/src/screens/Skills/Skills.tsx`

Add these local types:

```ts
type SkillListItem =
  | {
      source: "installed";
      name: string;
      category: string;
      description: string;
      path: string;
      enabled: true;
    }
  | {
      source: "bundled";
      name: string;
      category: string;
      description: string;
      sourceLabel: string;
      enabled: boolean;
      installedPath?: string;
    };

type GroupedSkills<T> = Array<{
  category: string;
  skills: T[];
  enabledCount: number;
  totalCount: number;
}>;

type SelectedSkillDetail = {
  identity: SkillIdentity;
  installedSkill: InstalledSkill;
  markdown: string;
  loading: boolean;
  error: string;
  metadata: SkillMetadata | null;
  agents: Array<{ name: string; isSelected: boolean }>;
};
```

Add state:

```ts
const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
const [selectedDetail, setSelectedDetail] = useState<SelectedSkillDetail | null>(null);
const [metadataLoading, setMetadataLoading] = useState(false);
const [agentsUsingSkill, setAgentsUsingSkill] = useState<Record<string, string[]>>({});
const [bulkActionInProgress, setBulkActionInProgress] = useState<string | null>(null);
```

Keep existing:
- `tab`
- search
- loading
- `actionInProgress`
- import states
- `notice`
- `error`

Remove:
- `detailSkill`
- `detailContent`
- detail modal usage from `SkillModals`.

#### New component: `SkillCategorySection`

Location: inline in `Skills.tsx` or new file:

```text
src/renderer/src/screens/Skills/components/SkillCategorySection.tsx
```

Prefer a new file because grouping/action UI is substantial.

Props shape:

```ts
interface SkillCategorySectionProps {
  category: string;
  skills: SkillListItem[];
  collapsed: boolean;
  tab: "installed" | "browse";
  enabledCount: number;
  totalCount: number;
  actionInProgress: string | null;
  bulkActionInProgress: string | null;
  selectedKey: string | null;
  onToggleCollapsed: (category: string) => void;
  onOpenDetail: (skill: SkillListItem) => void;
  onEnableSkill: (skill: SkillListItem) => void;
  onDisableSkill: (skill: SkillListItem) => void;
  onEnableCategory: (category: string, skills: SkillListItem[]) => void;
  onDisableCategory: (category: string, skills: SkillListItem[]) => void;
  t: TFunctionLike;
}
```

Rendered behavior:
- Header shows:
  - chevron icon.
  - category name.
  - count text: `enabledCount / totalCount enabled`.
  - bulk button:
    - Installed tab: `Disable all`.
    - Browse tab:
      - if `enabledCount < totalCount`: `Enable all`.
      - if `enabledCount > 0`: also show `Disable enabled`.
- Body:
  - Hidden when collapsed.
  - Contains rows/cards for each skill.
  - Each row includes:
    - name
    - description
    - enabled/disabled badge
    - individual enable/disable button
    - detail button for installed skills or bundled skills that have `installedPath`.

Detail availability:
- Installed tab: all rows open detail.
- Browse tab:
  - enabled bundled rows can open detail using `installedPath`.
  - uninstalled bundled rows should not open installed detail; show disabled metadata affordance or no detail button.

Rationale: current backend cannot fetch bundled skill content/path reliably in both local and SSH modes.

#### New component: `SkillDetailPanel`

Location:

```text
src/renderer/src/screens/Skills/components/SkillDetailPanel.tsx
```

Props shape:

```ts
interface SkillDetailPanelProps {
  detail: SelectedSkillDetail | null;
  profile?: string;
  onClose: () => void;
  onDisable: (skill: InstalledSkill) => void;
  actionInProgress: string | null;
  t: TFunctionLike;
}
```

Layout:
- In-screen panel, not modal.
- Render inside `Skills.tsx` below header/tabs/search, replacing list body when selected, or as a split area beside list on wide screens.
- To keep implementation deterministic and simpler:
  - Use a “detail page” mode within the Skills screen:
    - Header row: back button + skill name/category.
    - Content split:
      - left: markdown with `AgentMarkdown`.
      - right: metadata aside.

Markdown side:
```tsx
<AgentMarkdown>{detail.markdown}</AgentMarkdown>
```

Metadata side contains:
- Name.
- Category.
- Description.
- Path.
- Enabled for selected Agent.
- Agents using this skill:
  - Derived names from profiles.
  - Empty state: `No Agents currently use this skill`.
- Associated scripts:
  - List relative paths under `scripts/`, if any.
- Associated references:
  - List relative paths under `references/`, if any.
- Metadata unavailable warning if backend returns unavailable.

Actions:
- `Disable for this Agent` button calling existing uninstall flow.
- `Close`/back button returns to grouped list.

#### Refactor `SkillModals.tsx`

Rename or reduce responsibility to import only.

Option A preferred:
- Rename file to:
  ```text
  src/renderer/src/screens/Skills/components/SkillImportModal.tsx
  ```
- Export:
  ```ts
  export function SkillImportModal(props: SkillImportModalProps): React.JSX.Element | null
  ```
- Keep CSS classes for import modal unchanged to reduce style churn.

If avoiding file rename:
- Keep `SkillModals.tsx`, remove detail overlay branch, and rename internal props to reflect import-only responsibility.
- This is less clean but less file churn.

Recommended: create `SkillImportModal.tsx` and delete detail modal logic from `SkillModals.tsx` or leave a thin re-export only if imports need migration.

---

### 3.3 Metadata API

Add an additive backend API for skill metadata.

#### Shared type changes

File:

```text
src/shared/skills.ts
```

Add:

```ts
export type SkillAssociatedFile = {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
};

export type SkillMetadata = {
  path: string;
  scripts: SkillAssociatedFile[];
  references: SkillAssociatedFile[];
  metadataAvailable: boolean;
  unavailableReason?: string;
};
```

No persistence/schema impact.

#### Main local implementation

File:

```text
src/main/skills.ts
```

Add function:

```ts
export function getSkillMetadata(skillPath: string): SkillMetadata
```

Behavior:
1. Resolve `skillPath`.
2. Inspect:
   ```text
   <skillPath>/scripts
   <skillPath>/references
   ```
3. For each existing directory:
   - Return immediate children only, sorted by name.
   - Include files and directories.
   - Do not recurse in V1 to avoid expensive scans on large skill repos.
4. If path missing/unreadable:
   ```ts
   {
     path: skillPath,
     scripts: [],
     references: [],
     metadataAvailable: false,
     unavailableReason: "Skill metadata is unavailable for this skill."
   }
   ```
5. Never throw to IPC for ordinary filesystem errors.

Security boundary:
- This API accepts a path already returned by trusted `listInstalledSkills`.
- Still reject NUL bytes.
- For local mode, do not read file contents, only names/kinds.

#### SSH implementation

File:

```text
src/main/ssh/skills.ts
```

Add:

```ts
export async function sshGetSkillMetadata(
  config: SshConfig,
  skillPath: string,
): Promise<SkillMetadata>
```

Behavior:
- Strip `REMOTE:` prefix.
- Run a small remote Python script that checks `<path>/scripts` and `<path>/references`.
- Return same shape as local.
- On SSH failure, return `metadataAvailable: false` rather than throwing.

#### IPC routing

File:

```text
src/main/ipc/knowledge.ts
```

Add handler:

```ts
ipcMain.handle("get-skill-metadata", async (_event, skillPath: string) => {
  const conn = getConnectionConfig();
  if (conn.mode === "ssh" && conn.ssh) return sshGetSkillMetadata(conn.ssh, skillPath);
  if (conn.mode === "remote") {
    return {
      path: skillPath,
      scripts: [],
      references: [],
      metadataAvailable: false,
      unavailableReason: "Skill metadata is unavailable in remote HTTP mode.",
    };
  }
  return getSkillMetadata(skillPath);
});
```

Remote HTTP is normally gated by `Layout`, but handler should still fail closed/degrade.

#### Preload

File:

```text
src/preload/api/knowledge.ts
```

Add:

```ts
getSkillMetadata: (skillPath: string): Promise<SkillMetadata> =>
  ipcRenderer.invoke("get-skill-metadata", skillPath),
```

File:

```text
src/preload/index.d.ts
```

Add type import and `HermesAPI` method.

---

### 3.4 Agents using skill

Implement renderer derivation; do not add a backend API.

Function in `Skills.tsx`:

```ts
async function loadAgentsUsingSkill(skill: SkillIdentity): Promise<Array<{ name: string; isSelected: boolean }>>
```

Data path:
1. `window.hermesAPI.listProfiles()`
2. For each profile:
   - `window.hermesAPI.listInstalledSkills(profile.name)`
3. Match by category/name.
4. Return matching profiles as Agents.

Concurrency:
- Trigger when opening detail.
- Capture requested skill key/profile in local variables.
- Ignore results if selected detail changed before resolution.

Error behavior:
- If `listProfiles` or one profile’s skill list fails:
  - Show partial results where possible.
  - If total failure, show metadata message: `Agents using this skill could not be loaded`.

Performance:
- This runs only when detail opens.
- Use `Promise.allSettled` so one profile failure does not break all metadata.
- No global polling.

---

### 3.5 Bulk action algorithm

#### Category enable all

Input:
- Category grouped skills.
- `profile`.

Steps:
1. Compute `targets = skills.filter(skill => !skill.enabled)`.
2. If empty, no-op.
3. Set `bulkActionInProgress = category + ":enable"`.
4. For each target, call `installSkill(target.name, profile)`.
5. Use sequential execution, not parallel.

Rationale: Hermes CLI installs may mutate shared profile directories; sequential avoids race/corruption and produces deterministic failure handling.

Failure handling:
- Continue after individual failures or stop?
- Decision: continue, then show summarized error:
  ```text
  Enabled 4 skills. Failed 2: skill-a, skill-b.
  ```
- Reload installed skills after completion regardless.

#### Category disable all

Same pattern using `uninstallSkill(skill.name, profile)` for enabled skills.

#### Individual action

- Set `actionInProgress = skillKey(skill)`.
- Call install/uninstall.
- Reload installed list.
- If currently viewing detail and the skill was disabled:
  - Close detail panel after successful uninstall.
- Show existing `error` area on failure.

---

### 3.6 i18n

Add keys to all locale files:

```text
src/shared/i18n/locales/en/skills.ts
src/shared/i18n/locales/es/skills.ts
src/shared/i18n/locales/pt-BR/skills.ts
src/shared/i18n/locales/zh-CN/skills.ts
```

Required new keys:

```ts
categoryEnabledCount: "{{enabled}}/{{total}} enabled",
enable: "Enable",
disable: "Disable",
enableAll: "Enable all",
disableAll: "Disable all",
disableEnabled: "Disable enabled",
enabledBadge: "Enabled",
disabledBadge: "Disabled",
showCategory: "Show category",
hideCategory: "Hide category",
details: "Details",
backToSkills: "Back to skills",
metadata: "Metadata",
agentsUsingSkill: "Agents using this skill",
noAgentsUsingSkill: "No Agents currently use this skill",
agentsUnavailable: "Agents using this skill could not be loaded.",
associatedScripts: "Associated scripts",
associatedReferences: "References",
noAssociatedScripts: "No scripts found",
noAssociatedReferences: "No references found",
metadataUnavailable: "Additional metadata is unavailable for this skill.",
skillPath: "Path",
selectedAgent: "Selected Agent",
bulkActionFailed: "Some skill actions failed: {{names}}",
bulkActionSucceeded: "Updated {{count}} skills.",
detailUnavailableForBundled: "Install this skill to view its local details.",
```

Tests that mock `t` as identity do not require translated text, but shared i18n consistency should be preserved.

---

### 3.7 Styling

File:

```text
src/renderer/src/assets/styles/skills.css
```

Add sections:

- `.skills-category-list`
- `.skills-category-section`
- `.skills-category-header`
- `.skills-category-title`
- `.skills-category-count`
- `.skills-category-actions`
- `.skills-category-body`
- `.skills-row`
- `.skills-row-main`
- `.skills-row-actions`
- `.skills-badge-enabled`
- `.skills-badge-disabled`
- `.skills-detail-page`
- `.skills-detail-toolbar`
- `.skills-detail-layout`
- `.skills-detail-markdown`
- `.skills-detail-meta`
- `.skills-meta-section`
- `.skills-meta-list`
- `.skills-meta-empty`

Responsive behavior:
- Desktop:
  ```css
  .skills-detail-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
  }
  ```
- Narrow:
  ```css
  @media (max-width: 860px) {
    .skills-detail-layout { grid-template-columns: 1fr; }
  }
  ```

Do not modify `foundation.css` unless a missing token blocks styling.

---

## 4. **File-by-file impact**

### `src/shared/skills.ts`

- Add `SkillAssociatedFile` and `SkillMetadata`.
- Why: typed IPC/preload contract for scripts/references metadata.
- Depends on: metadata API implementation.

### `src/main/skills.ts`

- Import/export `SkillMetadata` type.
- Add local `getSkillMetadata(skillPath)`.
- Add helper to list immediate children of `scripts` and `references`.
- Why: renderer cannot inspect filesystem directly.
- Depends on: shared type.

### `src/main/ssh/skills.ts`

- Add `sshGetSkillMetadata(config, skillPath)`.
- Strip `REMOTE:` prefix like `sshGetSkillContent`.
- Use remote Python/SSH to list immediate children.
- Why: support metadata for SSH skill paths.
- Depends on: shared type and existing SSH transport helpers.

### `src/main/ipc/knowledge.ts`

- Import `getSkillMetadata` and `sshGetSkillMetadata`.
- Add `ipcMain.handle("get-skill-metadata", ...)`.
- Why: expose metadata to renderer.
- Depends on: local/SSH metadata functions.

### `src/preload/api/knowledge.ts`

- Import `SkillMetadata`.
- Add `getSkillMetadata(skillPath)`.
- Why: renderer API surface.

### `src/preload/index.d.ts`

- Import `SkillMetadata`.
- Add method to `HermesAPI`.
- Why: type-safe renderer usage and API surface tests.

### `src/renderer/src/screens/Skills/Skills.tsx`

- Replace flat grids with grouped category rendering.
- Remove detail modal state.
- Add selected detail page/panel state.
- Add grouped derivation helpers.
- Add individual enable/disable handlers.
- Add bulk enable/disable handlers.
- Add detail open flow:
  - get markdown
  - get metadata
  - derive Agents using skill
- Continue to render import modal.
- Why: main feature implementation.
- Depends on: metadata preload API and new components.

### `src/renderer/src/screens/Skills/components/SkillCategorySection.tsx`

- New component.
- Renders collapsible category header, bulk actions, and skill rows.
- Why: keep `Skills.tsx` manageable.

### `src/renderer/src/screens/Skills/components/SkillDetailPanel.tsx`

- New component.
- Renders markdown + metadata in-screen.
- Why: replaces markdown detail modal.

### `src/renderer/src/screens/Skills/components/SkillImportModal.tsx`

- New or refactored component from `SkillModals.tsx`.
- Preserve manual Markdown import modal behavior.
- Remove installed skill detail overlay.
- Why: separate import modal from detail page.

### `src/renderer/src/screens/Skills/components/SkillModals.tsx`

- Either delete if imports are migrated or leave as import-only wrapper.
- Must no longer render detail modal.
- Why: requested modal replacement.

### `src/renderer/src/assets/styles/skills.css`

- Add grouped list, row, badge, bulk action, and detail page styles.
- Remove or leave unused detail modal styles only if not harmful.
- Prefer removing `.skills-detail` styles only after verifying not used by import modal header classes.
- Why: new UI layout.

### `src/renderer/src/assets/icons/index.tsx`

- Add exports if needed:
  - `ChevronRight`
  - `ChevronDown` already exports `ChevronDown`.
  - `Check` already exports.
- If using existing icons only, no change.
- Why: category collapse affordance.

### Locale files

- Add new `skills.*` keys in:
  - `src/shared/i18n/locales/en/skills.ts`
  - `src/shared/i18n/locales/es/skills.ts`
  - `src/shared/i18n/locales/pt-BR/skills.ts`
  - `src/shared/i18n/locales/zh-CN/skills.ts`
- Why: avoid hardcoded UI strings.

### `tests/preload-api-surface.test.ts`

- Add expectations for `getSkillMetadata`.
- Why: new preload method must be declared and implemented.

### `tests/ipc-handlers.test.ts`

- Add `"get-skill-metadata"` to new feature channels or dedicated skill metadata assertion.
- Why: main/preload IPC consistency.

### `tests/skills-import.test.ts`

- Add local metadata test:
  - create imported skill or fixture directory.
  - create `scripts/foo.py` and `references/guide.md`.
  - assert `getSkillMetadata(path)` returns both.
- Why: backend metadata contract.

### `src/renderer/src/screens/Skills/Skills.test.tsx`

Create focused renderer tests.

Test setup:
- Mock `useI18n` like existing tests.
- Mock `AgentMarkdown` to simple component if needed.
- Set `window.hermesAPI` partial with:
  - `listInstalledSkills`
  - `listBundledSkills`
  - `getSkillContent`
  - `getSkillMetadata`
  - `installSkill`
  - `uninstallSkill`
  - `importSkillMarkdown`
  - `listProfiles`

Tests:
1. **Grouping/collapse**
   - Provide installed skills across two categories.
   - Assert category headers render.
   - Click one header collapse button.
   - Assert its skills disappear while other category remains.

2. **Bulk enable**
   - Use browse tab.
   - Provide bundled category with two skills, one already installed.
   - Click `Enable all`.
   - Assert `installSkill` called only for missing skill with selected profile.

3. **Bulk disable**
   - Use installed tab.
   - Category has two installed skills.
   - Click `Disable all`.
   - Assert `uninstallSkill` called for both with selected profile.

4. **Individual actions**
   - Browse tab row for disabled skill → click `Enable` → `installSkill`.
   - Installed tab row → click `Disable` → `uninstallSkill`.

5. **Detail metadata**
   - Click installed skill details.
   - Assert markdown content renders.
   - Assert metadata scripts/references render.
   - Assert `listProfiles` and per-profile `listInstalledSkills` are used.
   - Assert Agents using skill list includes matching Agent.

6. **Import modal still works**
   - Click import button.
   - Fill textarea/name if required.
   - Submit.
   - Assert `importSkillMarkdown` called with existing request shape and profile.

### `docs/subsystems/skills.md`

- Update to document:
  - grouped UI semantics.
  - enable/disable maps to install/uninstall.
  - `getSkillMetadata`.
  - metadata local/SSH degradation.
  - Agents-using derivation via `listProfiles` + `listInstalledSkills`.
- Why: selected docs are part of subsystem contract.

## 5. **Risks and migration**

- No data migration is needed.
- Main UX risk: “Disable” means uninstall. This is acceptable because the current system has no separate enabled flag, but copy should avoid implying reversible hidden state beyond reinstall.
- Skill identity ambiguity remains because install/uninstall accept `name` only. UI matching should use category/name, but mutations still pass `name` to existing APIs. Document this limitation and avoid bulk actions based on name-only fallback.
- SSH metadata may fail due to permissions or missing directories. It must degrade with `metadataAvailable: false`, not break detail view.
- Bulk actions can partially fail. Implement summarized partial failure notice and reload installed skills after every bulk operation.

## 6. **Implementation order**

1. **Add shared metadata types**
   - Update `src/shared/skills.ts`.
   - Compile-only change.

2. **Add local metadata implementation**
   - Update `src/main/skills.ts`.
   - Add/extend `tests/skills-import.test.ts` for `getSkillMetadata`.

3. **Add SSH metadata implementation**
   - Update `src/main/ssh/skills.ts`.
   - Ensure return shape matches local metadata.

4. **Wire IPC/preload**
   - Update:
     - `src/main/ipc/knowledge.ts`
     - `src/preload/api/knowledge.ts`
     - `src/preload/index.d.ts`
   - Update:
     - `tests/ipc-handlers.test.ts`
     - `tests/preload-api-surface.test.ts`
   - This step should land atomically.

5. **Refactor import modal**
   - Extract import-only component.
   - Remove detail modal rendering from `SkillModals.tsx`.
   - Verify manual import still works with existing state.

6. **Add grouped category UI**
   - Add `SkillCategorySection`.
   - Update `Skills.tsx` grouping, collapse state, individual actions.
   - Add grouping/collapse and individual action tests.

7. **Add bulk actions**
   - Implement sequential category enable/disable handlers.
   - Add bulk tests.

8. **Add detail page/panel**
   - Add `SkillDetailPanel`.
   - Implement detail loading in `Skills.tsx`.
   - Add metadata/Agents tests.

9. **Style polish**
   - Update `skills.css`.
   - Verify responsive layout and import modal overlay remains intact.

10. **Add i18n keys**
    - Update all locale skill files.
    - Run shared i18n tests.

11. **Docs update**
    - Update `docs/subsystems/skills.md`.

12. **Verification**
    - Run:
      ```bash
      npm run test -- src/renderer/src/screens/Skills/Skills.test.tsx
      npm run test -- tests/skills-import.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
      npm run typecheck
      ```


> 💡 Continue this plan conversation with ask_oracle(chat_id: "skills-redesign-9919FD", new_chat: false)
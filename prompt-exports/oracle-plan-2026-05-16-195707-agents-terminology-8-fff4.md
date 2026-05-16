## Final Prompt
<taskname="Agents Terminology"/>
<task>
Implement the user-facing terminology rename from "Profiles" to "Agents" across Mercury, with supporting tests. Preserve backend/runtime/storage concepts named `profile` where they represent Hermes profile paths, IPC/API compatibility, runtime identity, session/cache keys, or upstream CLI arguments. This is a UI/product terminology change, not an internal symbol/API rename and not the hidden profile-manager feature.
</task>

<architecture>
- Renderer navigation is owned by `src/renderer/src/screens/Layout/Layout.tsx`: `NAV_ITEMS` already uses view `"agents"`, but labels come from i18n keys such as `navigation.agents`; `Layout` owns `activeProfile` and passes it to profile-scoped screens.
- The Agents screen (`src/renderer/src/screens/Agents/Agents.tsx`) is the existing profile listing/manager UI. It calls `window.hermesAPI.listProfiles/createProfile/deleteProfile/setActiveProfile`, but the visible strings are under `agents.*` i18n keys.
- i18n resources are centralized in `src/shared/i18n/index.ts` and locale modules under `src/shared/i18n/locales/{en,es,pt-BR,zh-CN}`. The main user-facing profile strings found during discovery are in each locale’s `agents.ts` and `navigation.ts`, with additional relevant wording in `skills.ts`, `memory.ts`, `chat.ts`, and some renderer hardcoded text.
- Runtime/profile plumbing remains backend-facing: `src/preload/api/navigation.ts`, `src/preload/index.d.ts`, `src/main/ipc/sessions.ts`, and `src/main/profiles.ts` expose or implement `listProfiles`, `createProfile`, `setActiveProfile`, `ProfileInfo`, and session `profile` fields. Treat these as compatibility/runtime concepts unless changing UI copy or comments is clearly low risk.
- Docs currently mix product-facing language and internal runtime/storage language. Use "Agents are backed by Hermes profiles" wording where needed; keep precise `profile` terminology for Hermes CLI/storage/runtime contracts.
</architecture>

<selected_context>
- `src/renderer/src/screens/Layout/Layout.tsx` + `Layout.test.tsx`: sidebar nav, remote gating, active profile state, `RemoteNotice feature="Profiles"`, and current renderer test pattern.
- `src/renderer/src/screens/Agents/Agents.tsx`: profile card grid/user-facing manager surface; uses `agents.*` labels and internal `ProfileInfo`/`loadProfiles` naming.
- `src/renderer/src/components/RuntimeDiagnosticNotice.tsx`: hardcoded user-facing diagnostics currently say "Selected profile" / "runtime profile" / "selected profile".
- `src/renderer/src/components/RemoteNotice.tsx`: generic remote-mode copy receiving feature names from callers.
- `src/renderer/src/screens/Sessions/Sessions.tsx` + `Sessions.test.tsx`: session rows display profile tags via `formatProfile`; unknown label is hardcoded `unknown profile`. Session `profile` data should remain internal/runtime key.
- `src/renderer/src/screens/Chat/components/ChatHeader.tsx` + test: already displays `Agent: {{profile}}`; test still describes "profile identity" and can be updated if desired.
- `src/shared/i18n/locales/**`: all locale copy selected full. Confirmed current visible "Profiles"/localized equivalents in `agents.title`, `agents.subtitle`, `agents.createFailed`, `agents.actionsLabel`, and `navigation.agents`; `skills.importHelp` says selected profile; memory files include "User Profile" which likely refers to the human user profile, not an Agent.
- `src/shared/i18n/index.ts`, `index.test.ts`, `config.ts`, `types.ts`, renderer I18nProvider files: resource wiring and existing translation tests.
- `src/preload/api/navigation.ts`, `src/preload/index.d.ts`, `src/main/ipc/sessions.ts`, `src/main/profiles.ts`: API/storage compatibility context for preserving profile method names and types.
- `tests/preload-api-surface.test.ts`, `tests/ipc-handlers.test.ts`, `tests/profiles.test.ts`: contract/back-end profile tests; generally should not be rewritten to say Agent unless testing user-facing copy.
- Docs selected: `docs/architecture/overview.md`, `docs/contracts/ipc-preload.md`, `docs/subsystems/storage-and-profiles.md`, `docs/index.md`, `docs/investigations/reliable-profile-runtime-2026-05-16.md`, `docs/investigations/profile-manager-agent-2026-05-16.md` for wording decisions around product Agents vs Hermes profiles.
</selected_context>

<relationships>
- `Layout.NAV_ITEMS[{ view: "agents", labelKey: "navigation.agents" }]` -> locale `navigation.agents` -> sidebar visible label currently "Profiles" in all locales.
- `Layout` remote-only branch for agents -> `<RemoteNotice feature="Profiles" />` -> hardcoded remote notice text. Feature should be user-facing "Agents" while backend limitations may still reference remote Hermes profile support if needed.
- `Agents.tsx` -> `window.hermesAPI.listProfiles()` -> `ipc/sessions.ts` -> `profiles.ts`/SSH profile helpers. UI should say Agents while this call chain can remain `Profiles` internally.
- `Agents.tsx` visible title/subtitle/errors/actions -> locale `agents.*`; edit locale values rather than hardcoding strings.
- `ChatHeader` already maps default profile to `chat.defaultAgent` and displays `chat.agentIdentity`; this is aligned with Agent terminology.
- `Sessions.tsx` shows a session’s backing profile/agent tag. Decide whether visible unknown/labels should say Agent while retaining data field `profile` and tests asserting profile routing.
- `RuntimeDiagnosticNotice` displays runtime identity failures to users; should probably say selected Agent/backing runtime profile rather than only "selected profile".
- Docs and tests may intentionally use `profile` for storage/runtime contract; do not blindly replace identifiers, IPC channel names, Hermes CLI command names, filesystem paths, or test descriptions that are specifically about backend profile mechanics.
</relationships>

<ambiguities>
- "User Profile" in Memory likely means the human user bio/persona (`USER.md`), not the execution identity. It may be acceptable to leave it as Profile; review copy carefully rather than bulk-replacing.
- Localized terms for Agents need judgment: English should be "Agents"; Spanish/Portuguese/Chinese should use the existing locale style for "agent"/"代理" where natural. Preserve placeholders and interpolation.
- Historical investigation docs may intentionally discuss old "profile-first" terminology. If updating docs, distinguish historical/background profile mechanics from current user-facing Agents.
</ambiguities>

## Selection
- Files: 111 total (105 full, 6 codemap)
- Total tokens: 104186 (Auto view)
- Token breakdown: full 101210, codemap 2976

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   ├── architecture/
│   │   └── overview.md — 2 826 tokens (full)
│   ├── contracts/
│   │   └── ipc-preload.md — 4 156 tokens (full)
│   ├── investigations/
│   │   ├── profile-manager-agent-2026-05-16.md — 8 478 tokens (full)
│   │   └── reliable-profile-runtime-2026-05-16.md — 11 677 tokens (full)
│   ├── subsystems/
│   │   └── storage-and-profiles.md — 4 607 tokens (full)
│   └── index.md — 1 000 tokens (full)
├── src/
│   ├── main/
│   │   ├── ipc/
│   │   │   └── sessions.ts — 2 134 tokens (full)
│   │   └── profiles.ts — 1 806 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   └── navigation.ts — 712 tokens (full)
│   │   └── index.d.ts — 3 745 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── components/
│   │       │   ├── I18nProvider.test.tsx — 516 tokens (full)
│   │       │   ├── I18nProvider.tsx — 490 tokens (full)
│   │       │   ├── RemoteNotice.tsx — 138 tokens (full)
│   │       │   ├── RuntimeDiagnosticNotice.tsx — 812 tokens (full)
│   │       │   └── useI18n.ts — 143 tokens (full)
│   │       └── screens/
│   │           ├── Agents/
│   │           │   └── Agents.tsx — 2 730 tokens (full)
│   │           ├── Chat/
│   │           │   └── components/
│   │           │       ├── ChatHeader.test.tsx — 840 tokens (full)
│   │           │       └── ChatHeader.tsx — 1 082 tokens (full)
│   │           ├── Layout/
│   │           │   ├── Layout.test.tsx — 1 164 tokens (full)
│   │           │   └── Layout.tsx — 4 613 tokens (full)
│   │           └── Sessions/
│   │               ├── Sessions.test.tsx — 1 423 tokens (full)
│   │               └── Sessions.tsx — 3 504 tokens (full)
│   └── shared/
│       └── i18n/
│           ├── locales/
│           │   ├── en/
│           │   │   ├── agents.ts — 236 tokens (full)
│           │   │   ├── chat.ts — 676 tokens (full)
│           │   │   ├── common.ts — 348 tokens (full)
│           │   │   ├── constants.ts — 2 248 tokens (full)
│           │   │   ├── errors.ts — 33 tokens (full)
│           │   │   ├── gateway.ts — 70 tokens (full)
│           │   │   ├── install.ts — 147 tokens (full)
│           │   │   ├── memory.ts — 651 tokens (full)
│           │   │   ├── models.ts — 282 tokens (full)
│           │   │   ├── navigation.ts — 75 tokens (full)
│           │   │   ├── providers.ts — 32 tokens (full)
│           │   │   ├── schedules.ts — 470 tokens (full)
│           │   │   ├── sessions.ts — 213 tokens (full)
│           │   │   ├── settings.ts — 938 tokens (full)
│           │   │   ├── setup.ts — 451 tokens (full)
│           │   │   ├── skills.ts — 440 tokens (full)
│           │   │   ├── soul.ts — 130 tokens (full)
│           │   │   ├── tools.ts — 525 tokens (full)
│           │   │   └── welcome.ts — 267 tokens (full)
│           │   ├── es/
│           │   │   ├── agents.ts — 271 tokens (full)
│           │   │   ├── chat.ts — 795 tokens (full)
│           │   │   ├── common.ts — 386 tokens (full)
│           │   │   ├── constants.ts — 2 549 tokens (full)
│           │   │   ├── errors.ts — 38 tokens (full)
│           │   │   ├── gateway.ts — 73 tokens (full)
│           │   │   ├── install.ts — 162 tokens (full)
│           │   │   ├── memory.ts — 775 tokens (full)
│           │   │   ├── models.ts — 330 tokens (full)
│           │   │   ├── navigation.ts — 82 tokens (full)
│           │   │   ├── providers.ts — 34 tokens (full)
│           │   │   ├── schedules.ts — 521 tokens (full)
│           │   │   ├── sessions.ts — 232 tokens (full)
│           │   │   ├── settings.ts — 1 031 tokens (full)
│           │   │   ├── setup.ts — 487 tokens (full)
│           │   │   ├── skills.ts — 495 tokens (full)
│           │   │   ├── soul.ts — 157 tokens (full)
│           │   │   ├── tools.ts — 573 tokens (full)
│           │   │   └── welcome.ts — 290 tokens (full)
│           │   ├── pt-BR/
│           │   │   ├── agents.ts — 259 tokens (full)
│           │   │   ├── chat.ts — 752 tokens (full)
│           │   │   ├── common.ts — 384 tokens (full)
│           │   │   ├── constants.ts — 2 482 tokens (full)
│           │   │   ├── errors.ts — 36 tokens (full)
│           │   │   ├── gateway.ts — 72 tokens (full)
│           │   │   ├── install.ts — 161 tokens (full)
│           │   │   ├── memory.ts — 743 tokens (full)
│           │   │   ├── models.ts — 318 tokens (full)
│           │   │   ├── navigation.ts — 81 tokens (full)
│           │   │   ├── providers.ts — 34 tokens (full)
│           │   │   ├── schedules.ts — 517 tokens (full)
│           │   │   ├── sessions.ts — 231 tokens (full)
│           │   │   ├── settings.ts — 996 tokens (full)
│           │   │   ├── setup.ts — 488 tokens (full)
│           │   │   ├── skills.ts — 500 tokens (full)
│           │   │   ├── soul.ts — 144 tokens (full)
│           │   │   ├── tools.ts — 561 tokens (full)
│           │   │   └── welcome.ts — 290 tokens (full)
│           │   └── zh-CN/
│           │       ├── agents.ts — 244 tokens (full)
│           │       ├── chat.ts — 670 tokens (full)
│           │       ├── common.ts — 354 tokens (full)
│           │       ├── constants.ts — 2 291 tokens (full)
│           │       ├── errors.ts — 34 tokens (full)
│           │       ├── gateway.ts — 65 tokens (full)
│           │       ├── install.ts — 136 tokens (full)
│           │       ├── memory.ts — 641 tokens (full)
│           │       ├── models.ts — 279 tokens (full)
│           │       ├── navigation.ts — 74 tokens (full)
│           │       ├── providers.ts — 29 tokens (full)
│           │       ├── schedules.ts — 460 tokens (full)
│           │       ├── sessions.ts — 204 tokens (full)
│           │       ├── settings.ts — 913 tokens (full)
│           │       ├── setup.ts — 445 tokens (full)
│           │       ├── skills.ts — 426 tokens (full)
│           │       ├── soul.ts — 117 tokens (full)
│           │       ├── tools.ts — 460 tokens (full)
│           │       └── welcome.ts — 260 tokens (full)
│           ├── config.ts — 69 tokens (full)
│           ├── index.test.ts — 248 tokens (full)
│           ├── index.ts — 1 938 tokens (full)
│           └── types.ts — 35 tokens (full)
└── tests/
    ├── ipc-handlers.test.ts — 1 814 tokens (full)
    ├── preload-api-surface.test.ts — 2 759 tokens (full)
    └── profiles.test.ts — 1 087 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   └── install/
    │       └── paths.ts — 672 tokens (auto)
    ├── renderer/
    │   └── src/
    │       └── screens/
    │           └── Chat/
    │               └── types.ts — 900 tokens (auto)
    └── shared/
        ├── chat-metadata.ts — 466 tokens (auto)
        ├── perf.ts — 203 tokens (auto)
        ├── runtime.ts — 349 tokens (auto)
        └── traces.ts — 386 tokens (auto)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `agents-terminology-8132C5` | **Mode**: plan

### Response
## 1. **Summary**

Implement a targeted UI/product terminology rename from “Profiles” to “Agents” while preserving all backend, IPC, storage, runtime, and Hermes CLI concepts named `profile`. This should be a localized copy and renderer-surface change, not an internal symbol rename. The main work is updating i18n values, a few hardcoded renderer strings, and tests that assert user-visible labels; backend contract tests and profile-runtime docs should continue using `profile` where they describe Hermes profile identity.

## 2. **Current-state analysis**

Mercury already has a split between product UI and backend profile plumbing:

- **Renderer navigation** is owned by `src/renderer/src/screens/Layout/Layout.tsx`.
  - The route/view is already named `"agents"`.
  - Sidebar label comes from `navigation.agents`, which currently renders “Profiles” / localized equivalents.
  - `activeProfile`, `currentSessionProfile`, and profile-scoped props are internal state and should remain unchanged.
- **Agents UI** lives in `src/renderer/src/screens/Agents/Agents.tsx`.
  - It calls backend APIs named `listProfiles`, `createProfile`, `deleteProfile`, and `setActiveProfile`.
  - Its visible text comes from `agents.*` locale keys.
  - The local `ProfileInfo` interface and `profiles` state represent backend Hermes profiles and should remain named as-is.
- **Preload/main APIs** expose `profile` names and `listProfiles` APIs:
  - `src/preload/api/navigation.ts`
  - `src/preload/index.d.ts`
  - `src/main/ipc/sessions.ts`
  - `src/main/profiles.ts`
  These are compatibility/runtime/storage contracts and must not be renamed.
- **Runtime diagnostics** in `RuntimeDiagnosticNotice.tsx` currently contain hardcoded user-visible strings such as “Selected profile” and “runtime profile”. These should be adjusted to explain “selected Agent” while still referring to the backing runtime profile where accuracy matters.
- **Sessions UI** displays `session.profile` as a tag and has hardcoded fallback `"unknown profile"`. The data field must remain `profile`; the fallback should become user-facing “unknown agent” or similar.
- **Docs** intentionally distinguish profile storage/runtime from product concepts. Evergreen docs can add/adjust wording such as “Agents are backed by Hermes profiles,” but profile-runtime and storage docs should keep precise `profile` terminology.

This is best solved with a **targeted copy/test update**, not a broader refactor, because the codebase already uses `Agents` as the renderer view and reserves `profile` for backend identity. Renaming internal identifiers would create API churn and risk breaking IPC/preload/session/runtime contracts without improving user-facing terminology.

## 3. **Design**

### A. UI terminology contract

Adopt this terminology rule:

- **User-facing product term:** “Agent”
  - Sidebar label.
  - Agents screen title/subtitle/actions/errors.
  - Remote-mode unavailable feature names.
  - Session row fallback labels.
  - Runtime diagnostic summary/error copy where shown to users.
- **Internal/runtime term:** “profile”
  - `profile` props and state names.
  - `ProfileInfo`.
  - `listProfiles`, `createProfile`, `setActiveProfile`.
  - IPC/preload signatures and tests.
  - Session/cache keys.
  - Hermes CLI/storage/runtime docs.

For mixed contexts, use wording like:

> “Selected Agent does not match the backing runtime profile.”

This preserves technical correctness while avoiding presenting “Profiles” as the product concept.

### B. i18n locale updates

Update locale values only; do not rename keys.

Files:

- `src/shared/i18n/locales/en/navigation.ts`
- `src/shared/i18n/locales/es/navigation.ts`
- `src/shared/i18n/locales/pt-BR/navigation.ts`
- `src/shared/i18n/locales/zh-CN/navigation.ts`
- `src/shared/i18n/locales/en/agents.ts`
- `src/shared/i18n/locales/es/agents.ts`
- `src/shared/i18n/locales/pt-BR/agents.ts`
- `src/shared/i18n/locales/zh-CN/agents.ts`
- `src/shared/i18n/locales/*/skills.ts` for selected-profile import help wording.

Required copy decisions:

#### English

- `navigation.agents`: `"Agents"` instead of `"Profiles"`.
- `agents.title`: `"Agents"`.
- `agents.subtitle`: `"Each agent is an isolated Hermes workspace with its own config, memory, and skills"`.
- `agents.createFailed`: `"Failed to create agent"`.
- `agents.actionsLabel`: `"Agent actions"`.
- `agents.namePlaceholder`: consider `"Agent name (e.g. coder)"` already correct.
- `agents.deleteTitle`: already `"Delete agent"`; keep.
- `skills.importHelp`: change “selected profile” to “selected agent”.

#### Spanish

Use the existing “agente” style:

- `navigation.agents`: `"Agentes"`.
- `agents.title`: `"Agentes"`.
- `agents.subtitle`: replace “perfil” with “agente”.
- `agents.createFailed`: “No se pudo crear el agente”.
- `agents.actionsLabel`: “Acciones del agente”.
- `skills.importHelp`: “agente seleccionado”.

#### Portuguese

Use “Agentes” / “agente”:

- `navigation.agents`: `"Agentes"`.
- `agents.title`: `"Agentes"`.
- `agents.subtitle`: replace “perfil” with “agente”.
- `agents.createFailed`: “Falha ao criar o agente”.
- `agents.actionsLabel`: “Ações do agente”.
- `skills.importHelp`: “agente selecionado”.

#### Chinese

Use “代理” consistently:

- `navigation.agents`: `"代理"`.
- `agents.title`: `"代理"`.
- `agents.subtitle`: replace “档案” wording with “每个代理都是独立的 Hermes 工作区…”.
- `agents.createFailed`: “创建代理失败”.
- `agents.actionsLabel`: “代理操作”.
- `skills.importHelp`: “当前选中的代理”.

Do **not** change Memory’s “User Profile” strings; they refer to the human user profile stored in `USER.md`, not the agent/runtime identity.

### C. Renderer hardcoded copy updates

#### `src/renderer/src/screens/Layout/Layout.tsx`

Change only the user-facing feature passed to `RemoteNotice`:

- Before:
  - `<RemoteNotice feature="Profiles" />`
- After:
  - `<RemoteNotice feature="Agents" />`

Keep:

- `activeProfile`
- `currentSessionProfile`
- `onSelectProfile`
- `ProfileActionView`
- all props named `profile`

These are runtime/storage concepts or existing component contracts.

#### `src/renderer/src/components/RuntimeDiagnosticNotice.tsx`

Update hardcoded messages to use “Agent” for selected user intent and “runtime profile” for backing identity.

Behavior should remain unchanged.

Suggested message contract:

- For mismatch:
  - Current: `Selected profile X does not match runtime profile Y.`
  - New: `Selected Agent X does not match backing runtime profile Y.`
- For unverified:
  - Current: `Runtime identity has not been verified for the selected profile.`
  - New: `Runtime identity has not been verified for the selected Agent.`
- For stale fallback:
  - Existing stale message is generic and can stay.
- `runtimeDiagnosticSummary`:
  - Current includes `requested ${profile} · actual ${actual}`.
  - This is concise technical diagnostic. Either leave it, or change to `agent ${profile} · runtime ${actual}`. Prefer changing to `agent … · runtime …` because this is user-facing tooltip/notice text.

Keep function names and `RuntimeDiagnostic` fields unchanged.

#### `src/renderer/src/screens/Sessions/Sessions.tsx`

Change only the fallback label in `formatProfile`:

- Before: `"unknown profile"`
- After: `"unknown agent"`

Do not rename:

- `CachedSession.profile`
- `SearchResult.profile`
- `currentSessionProfile`
- `sessionRowKey` profile parameter
- `isActiveSession` profile comparison logic

Optional but useful: rename the visible CSS tag concept only if there is visible copy; current class names like `sessions-tag--source` should remain unchanged.

#### `src/renderer/src/components/RemoteNotice.tsx`

No required change if callers pass “Agents”. Its generic text is acceptable:

> `{feature} is not available in remote mode…`

If updating copy, avoid introducing “profile” unless explaining backend limitations. This component currently has no i18n and the task does not require localizing it.

### D. Tests

#### Renderer tests that assert user-visible text

Update tests where expectations currently assert “Profiles” as UI copy.

1. `src/renderer/src/screens/Layout/Layout.test.tsx`
   - Existing test checks sidebar absence for Trace Lab and navigation key labels through mocked `t`.
   - Since `t` returns keys, the nav button name remains `"navigation.agents"` and may not need adjustment.
   - Add or update a test to verify remote-only Agents view renders `Remote Agents` instead of `Remote Profiles` if remote gating is covered. The current mock `RemoteNotice` displays `Remote {feature}`.
   - If adding this, set `isRemoteOnlyMode` mock to `true`, click `navigation.agents`, assert `Remote Agents`.

2. `src/renderer/src/screens/Sessions/Sessions.test.tsx`
   - Existing test data always includes `profile`, so no current assertion for “unknown profile”.
   - Add a small test case with a cached row missing `profile`, then assert the fallback tag is “unknown agent”.
   - Keep existing profile-routing assertions unchanged because they validate the backend/session key behavior.

3. `src/renderer/src/screens/Chat/components/ChatHeader.test.tsx`
   - The copy already says `Agent: Research Agent`.
   - Test description can be updated from “profile identity” to “agent identity” for clarity, but this is non-functional.

4. `src/shared/i18n/index.test.ts`
   - Add assertions for the terminology contract:
     - `t("navigation.agents", "en") === "Agents"`
     - `t("agents.title", "en") === "Agents"`
     - One non-English sample, e.g. Spanish `navigation.agents === "Agentes"` or Chinese `navigation.agents === "代理"`.
   - Preserve existing i18n behavior tests.

#### Tests that should remain profile-oriented

Do **not** rewrite these to “Agent” unless they assert user-visible copy:

- `tests/profiles.test.ts`
- `tests/preload-api-surface.test.ts`
- `tests/ipc-handlers.test.ts`

These validate backend profile discovery and IPC compatibility.

### E. Docs

Keep docs changes minimal and precise.

#### `docs/architecture/overview.md`

In the renderer layout/navigation section, adjust wording to say the UI uses Agents backed by profiles:

- Existing mentions “active profile state”.
- Add/adjust a sentence:
  - “The renderer presents Hermes profiles to users as Agents; internal state and IPC continue to use `profile` for runtime/storage identity.”

Do not rename source anchors.

#### `docs/contracts/ipc-preload.md`

Add a short note near profile APIs:

- `listProfiles`, `createProfile`, etc. remain named for compatibility and Hermes storage/runtime identity.
- Renderer copy should refer to these as Agents.

Do not rename contract method names or channel descriptions where they document API shape.

#### `docs/subsystems/storage-and-profiles.md`

This doc should remain profile-heavy because it documents storage/runtime. Add one clarifying sentence near “Profile scoping” or “Storage isolation vs runtime isolation”:

- “In the UI, these Hermes profiles are presented as Agents; this document uses profile to refer to filesystem/runtime identity.”

#### Historical investigation docs

Do not broadly edit historical docs. If touched at all, add a current-status note only. Because they are historical evidence, changing terminology throughout would reduce their evidentiary value.

## 4. **File-by-file impact**

### `src/shared/i18n/locales/en/navigation.ts`

- Change `agents` value from `"Profiles"` to `"Agents"`.
- Driven by sidebar terminology rename.

### `src/shared/i18n/locales/es/navigation.ts`

- Change `agents` from `"Perfiles"` to `"Agentes"`.

### `src/shared/i18n/locales/pt-BR/navigation.ts`

- Change `agents` from `"Perfis"` to `"Agentes"`.

### `src/shared/i18n/locales/zh-CN/navigation.ts`

- Change `agents` from `"档案"` to `"代理"`.

### `src/shared/i18n/locales/en/agents.ts`

- Update title/subtitle/create failure/actions label to Agent wording.
- Keep key names unchanged.

### `src/shared/i18n/locales/es/agents.ts`

- Replace user-facing “perfil” wording with “agente”.
- Keep placeholders like `{{name}}`.

### `src/shared/i18n/locales/pt-BR/agents.ts`

- Replace user-facing “perfil” wording with “agente”.
- Keep placeholders like `{{name}}`.

### `src/shared/i18n/locales/zh-CN/agents.ts`

- Replace user-facing “档案” wording with “代理”.
- Keep placeholders like `{{name}}`.

### `src/shared/i18n/locales/*/skills.ts`

- Update `importHelp` only:
  - “selected profile” → “selected agent”.
- Do not alter skill runtime/storage comments or function names.

### `src/renderer/src/screens/Layout/Layout.tsx`

- Change `RemoteNotice feature="Profiles"` to `"Agents"`.
- Do not rename state/props/API calls.

### `src/renderer/src/components/RuntimeDiagnosticNotice.tsx`

- Change user-facing diagnostic strings from selected profile to selected Agent/backing runtime profile.
- Keep `profileLabel` name and diagnostic fields.

### `src/renderer/src/screens/Sessions/Sessions.tsx`

- Change `formatProfile` fallback from `"unknown profile"` to `"unknown agent"`.
- Leave profile data flow intact.

### `src/shared/i18n/index.test.ts`

- Add assertions for Agent terminology in the i18n layer.

### `src/renderer/src/screens/Layout/Layout.test.tsx`

- Add/update remote Agents copy assertion if test coverage is expanded.
- Existing mocked key-based nav assertions can remain.

### `src/renderer/src/screens/Sessions/Sessions.test.tsx`

- Add missing-profile fallback test or update existing coverage if present.

### `src/renderer/src/screens/Chat/components/ChatHeader.test.tsx`

- Optional test description-only update from profile identity to agent identity.
- No required behavior change.

### Docs

- `docs/architecture/overview.md`: add UI/backend terminology distinction.
- `docs/contracts/ipc-preload.md`: clarify API names remain profile-based.
- `docs/subsystems/storage-and-profiles.md`: clarify Agents are UI presentation of Hermes profiles.
- Do not bulk-edit historical investigation docs.

## 5. **Risks and migration**

No data migration or API migration is required.

Primary risks:

- **Over-renaming internal contracts:** Avoid renaming `profile` fields/methods because they are part of IPC, session/cache identity, runtime diagnostics, and Hermes CLI semantics.
- **Incorrect localization:** Ensure translated strings preserve placeholders and natural locale-specific Agent terminology.
- **Ambiguous “User Profile”:** Leave Memory’s “User Profile” copy unchanged because it describes the human user profile, not Hermes profile/Agent identity.

Rollback is simple: revert copy/test/doc changes. No persisted schema changes are introduced.

## 6. **Implementation order**

1. **Update locale copy**
   - Modify `navigation.ts`, `agents.ts`, and `skills.ts` in all four locales.
   - Run `src/shared/i18n/index.test.ts` after adding assertions.

2. **Update hardcoded renderer strings**
   - `Layout.tsx`: remote feature name.
   - `RuntimeDiagnosticNotice.tsx`: user-facing diagnostic text.
   - `Sessions.tsx`: fallback label.

3. **Update/add tests**
   - Add i18n terminology assertions.
   - Add Sessions missing-profile fallback assertion.
   - Add Layout remote Agents assertion if desired.
   - Optionally update ChatHeader test description.

4. **Update evergreen docs**
   - Add short terminology notes to architecture, IPC/preload, and storage/profile docs.
   - Do not rewrite historical docs.

5. **Verification**
   - Run targeted tests:
     ```bash
     npm run test -- src/shared/i18n/index.test.ts
     npm run test -- src/renderer/src/screens/Layout/Layout.test.tsx
     npm run test -- src/renderer/src/screens/Sessions/Sessions.test.tsx
     npm run test -- src/renderer/src/screens/Chat/components/ChatHeader.test.tsx
     ```
   - Run contract tests to ensure no API rename occurred:
     ```bash
     npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/profiles.test.ts
     npm run typecheck
     ```


> 💡 Continue this plan conversation with ask_oracle(chat_id: "agents-terminology-8132C5", new_chat: false)
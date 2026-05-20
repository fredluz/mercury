## Final Prompt
<taskname="Role Model Settings"/>

<task>
Implement the role-based Models settings refactor from `specs/role-based-model-settings.md`. Treat the spec as source of truth. Do not preserve Models as a top-level sidebar page: move it behind Settings as a dedicated Models settings view, add role-based defaults for Chat, Plan, Code, Explore, Research, Review, Design, and Image, preserve the saved model library, keep legacy chat model behavior compatible, and make Image resolve to Codex-native `image_gen` capability rather than a public OpenAI Images/API model picker.
</task>

<architecture>
- Persistence today is split between `src/main/models.ts` (`~/.hermes/models.json` saved library with `SavedModel`, `contextWindow`) and `src/main/config.ts` (`config.yaml` legacy `provider/default/base_url`, credential pool, profile paths). `src/main/services/config-service.ts` wraps local vs SSH behavior and marks/restarts stale runtimes on model changes.
- IPC/preload surface is split: `src/main/ipc/config.ts` owns legacy `get-model-config`/`set-model-config`; `src/main/ipc/models.ts` owns saved model CRUD and SSH list fallback; `src/preload/api/config.ts`, `src/preload/api/models.ts`, and `src/preload/index.d.ts` expose renderer APIs. `tests/ipc-handlers.test.ts` and `tests/preload-api-surface.test.ts` enforce channel/method parity.
- SSH parity uses `src/main/ssh/config.ts` for remote config/profile paths/toolsets/model config and `src/main/ssh/runtime.ts` for remote `models.json` read/write helpers. `src/main/ssh-remote.ts` re-exports the SSH surface.
- Chat defaults currently read/write legacy model config through `src/renderer/src/screens/Chat/hooks/useChatModelConfig.ts`, `ModelPicker.tsx`, local `/model` command in `chatCommands.ts`, and runtime send paths `src/main/hermes/chat-api.ts`, `chat-cli.ts`, `gateway.ts`, `title.ts`, and `src/main/services/chat-service.ts`.
- Renderer routing is in `src/renderer/src/screens/Layout/Layout.tsx`: `View` includes `models`, `NAV_ITEMS` includes Models, and `visitedViews` lazy-mounts `<Models />`. Settings renders via `Settings.tsx` plus `SettingsCoreSections.tsx` and `SettingsPreferenceSections.tsx`. The current `Models.tsx` is a saved-model CRUD grid; `models.css` and `settings.css` hold relevant styles.
- Image generation context is in `docs/subsystems/codex-image-generation.md`, `src/main/tools.ts`, `src/main/install/paths.ts`, `src/main/hermes/trace-events.ts`, and `tests/hermes-trace-events.test.ts`. Key rule: Image role is tool/capability based (`image_gen`, usually `image_gen.provider: openai-codex`, Codex OAuth/auth.json), not a text model with image modality metadata.
</architecture>

<selected_context>
specs/role-based-model-settings.md: full spec, requirements, data/API suggestions, migration/fallback rules, image role constraints, tests, acceptance criteria.
docs/subsystems/codex-image-generation.md: canonical Codex-native image generation rules, `image_gen` toolset/provider/auth/artifact contract.
src/main/models.ts, default-models.ts, shared/chat-metadata.ts: saved model library, default seeds, context-window inference.
src/main/config.ts, services/config-service.ts, services/models-service.ts: legacy profile model config, credential pool, local/SSH dispatch, runtime stale/restart behavior.
src/main/ipc/{config,models,chat,index,types}.ts and src/preload/{index,index.d.ts,api/{config,models,chat,index}.ts}: IPC/preload API surfaces to extend while preserving legacy methods.
src/main/ssh/{config,runtime,transport}.ts, src/main/ssh-remote.ts: remote profile paths, toolset/model config, remote `models.json` helpers for SSH parity.
src/main/hermes/{types,chat-api,chat-cli,gateway,title,trace-events,runtime}.ts plus codemap for runtime/manager.ts: runtime purposes, chat/title send paths, trace artifact normalization.
src/main/tools.ts, src/main/install/paths.ts: `image_gen` toolset definition and OAuth/auth credential detection (`hasHermesAuthCredential`).
src/renderer/src/screens/Layout/Layout.tsx and Layout.test.tsx: sidebar nav/routing/lazy-mount behavior and current tests.
src/renderer/src/screens/Settings/* and Models/Models.tsx: Settings composition and current saved-model UI to refactor into a dedicated settings view.
src/renderer/src/screens/Chat/* selected files: chat model picker/config hook, local slash command, send flows, controller integration.
src/renderer/src/constants/*, i18n locale files for en/es/pt-BR/zh-CN models/navigation/settings, styles models.css/settings.css/main.css: UI labels, providers, settings sections, styling.
tests/{ipc-handlers,preload-api-surface,constants,ssh-remote,hermes-trace-events,chat-metadata}.test.ts: existing test patterns and contract guards to update/extend.
</selected_context>

<relationships>
- Layout sidebar `NAV_ITEMS` → `view: "models"` → lazy `<Models />`; Settings currently has no Models entry point.
- Chat model picker → `useChatModelConfig.loadModelConfig()` → `window.hermesAPI.getModelConfig(profile)` + `listModels()`; `selectModel()` → `setModelConfig(provider, model, baseUrl, profile)`.
- Renderer API methods → preload invoke channels → main IPC handlers → services/config-service or models.ts; tests require every preload invoke has a main handler and every preload method has a type declaration.
- Local model persistence: `models.json` saved library is separate from `config.yaml` legacy model config; new role defaults should keep that separation and synthesize Chat fallback from legacy config when no role storage exists.
- SSH model/config flow: renderer/main service calls → `getConnectionConfig().mode === "ssh"` → `sshGetModelConfig`/`sshSetModelConfig` or `sshListModels`; role APIs need equivalent remote read/write behavior.
- Image role availability should combine `image_gen` toolset state (`tools.ts` / `ssh/config.ts`), `image_gen.provider: openai-codex` config, and OAuth/auth credential detection; trace success is `tool.*` plus `artifact.created` from `trace-events.ts`.
</relationships>

<workstreams>
- Backend/storage/API: role taxonomy/types, local + SSH role defaults, resolver/fallbacks, IPC/preload typing, legacy compatibility.
- Runtime integration: Chat role for normal chat/default, keep Code independent, add intent-aware resolution where existing paths know purpose, and ensure Image does not silently use text chat/public image APIs.
- Renderer/UI: route Models through Settings as a dedicated view, render role defaults plus secondary saved-model library, missing-model states, profile/global distinction, i18n/styles.
- Tests: add role taxonomy/storage/fallback tests, IPC/preload tests, Layout/Settings/Models renderer tests, SSH role parity, Chat role compatibility, and Image capability/trace tests.
</workstreams>

<orchestration_progress>
- [x] Work Item 1 — Backend/storage/API foundation completed by agent `B3DFCA7F-EAB2-4A09-BF0E-4F34DDEC649A`.
  - Added shared role taxonomy/types, saved model capabilities, local/SSH role defaults and overrides, role resolver, model role service, IPC/preload API, SSH helpers, and focused tests.
  - Verified by orchestrator: `npx vitest run tests/model-roles.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/ssh-remote.test.ts` passed: 4 files, 268 tests.
- [x] Work Item 2 — Runtime/chat integration completed by agent `631D1440-E558-402D-94EC-E4018DD96634`.
  - Added chat runtime resolver, wired chat API/CLI/title paths to Chat role, updated Chat picker to write profile Chat override, updated `/model` output, and added focused tests.
  - Verified by orchestrator: `npx vitest run tests/chat-role-runtime.test.ts src/renderer/src/screens/Chat/chatCommands.test.ts src/renderer/src/screens/Chat/hooks/useChatController.test.tsx tests/hermes-title.test.ts tests/model-roles.test.ts` passed: 5 files, 38 tests.
- [x] Work Item 3 — Settings/Models renderer refactor completed by agent `8F81AEA8-D379-43F8-AA58-DA6BBC52FA1C`.
  - Removed primary sidebar Models route, added Settings-hosted Models view, refactored Models UI around role defaults/overrides, preserved saved model library, added Image `image_gen` status, i18n, styles, and renderer tests.
  - Verified by orchestrator: `npx vitest run src/renderer/src/screens/Layout/Layout.test.tsx src/renderer/src/screens/Settings/Settings.test.tsx src/renderer/src/screens/Models/Models.test.tsx src/shared/i18n/index.test.ts && npm run typecheck:web` passed: 4 test files, 16 tests, web typecheck.
- [x] Work Item 4 — Integration/final verification completed by agent `3DFB3438-170C-49B4-AC66-FBDFC41BD79E`.
  - Fixed one Chat API verified-runtime guard regression, tightened Image role spec wording, and ran broad verification.
  - Verified by orchestrator: `npm run typecheck && npm run test` passed: node/web/CLI typecheck, 46 test files passed, 2 skipped, 534 tests passed, 2 skipped.
</orchestration_progress>

<ambiguities>
- Spec leaves Chat picker semantics open: preferred v1 is to update active profile’s Chat override, but per-chat override is still an alternative if explicitly documented/displayed.
- Exact built-in Codex `image_gen` availability probe is open: toolset config, skills/app-server capabilities, and/or lightweight probe may be needed.
- Authoritative generated image artifact path is open: `$CODEX_HOME/generated_images`, Hermes cache path, `artifact.created`, or app-server `contentItems`.
- Worktree is dirty with unrelated staged/modified/untracked files; avoid reverting or overwriting unrelated changes.
</ambiguities>

## Selection
- Files: 83 total (74 full, 9 codemap)
- Total tokens: 109048 (Auto view)
- Token breakdown: full 105199, codemap 3849

### Files
### Selected Files
/Users/fredluz/Code/mercury/
├── docs/
│   └── subsystems/
│       └── codex-image-generation.md — 2 851 tokens (full)
├── specs/
│   └── role-based-model-settings.md — 5 580 tokens (full)
├── src/
│   ├── main/
│   │   ├── hermes/
│   │   │   ├── chat-api.ts — 2 237 tokens (full)
│   │   │   ├── chat-cli.ts — 1 803 tokens (full)
│   │   │   ├── gateway.ts — 1 091 tokens (full)
│   │   │   ├── runtime.ts — 92 tokens (full)
│   │   │   ├── title.ts — 1 250 tokens (full)
│   │   │   ├── trace-events.ts — 2 616 tokens (full)
│   │   │   └── types.ts — 775 tokens (full)
│   │   ├── install/
│   │   │   └── paths.ts — 2 378 tokens (full)
│   │   ├── ipc/
│   │   │   ├── chat.ts — 1 015 tokens (full)
│   │   │   ├── config.ts — 892 tokens (full)
│   │   │   ├── index.ts — 233 tokens (full)
│   │   │   ├── models.ts — 339 tokens (full)
│   │   │   └── types.ts — 35 tokens (full)
│   │   ├── services/
│   │   │   ├── chat-service.ts — 3 433 tokens (full)
│   │   │   ├── config-service.ts — 1 756 tokens (full)
│   │   │   └── models-service.ts — 109 tokens (full)
│   │   ├── ssh/
│   │   │   ├── config.ts — 2 703 tokens (full)
│   │   │   ├── runtime.ts — 4 322 tokens (full)
│   │   │   └── transport.ts — 1 881 tokens (full)
│   │   ├── config.ts — 3 211 tokens (full)
│   │   ├── default-models.ts — 492 tokens (full)
│   │   ├── models.ts — 826 tokens (full)
│   │   ├── ssh-remote.ts — 363 tokens (full)
│   │   └── tools.ts — 2 034 tokens (full)
│   ├── preload/
│   │   ├── api/
│   │   │   ├── chat.ts — 825 tokens (full)
│   │   │   ├── config.ts — 761 tokens (full)
│   │   │   ├── index.ts — 109 tokens (full)
│   │   │   └── models.ts — 696 tokens (full)
│   │   ├── index.d.ts — 3 688 tokens (full)
│   │   └── index.ts — 127 tokens (full)
│   ├── renderer/
│   │   └── src/
│   │       ├── assets/
│   │       │   ├── styles/
│   │       │   │   ├── models.css — 1 075 tokens (full)
│   │       │   │   └── settings.css — 1 956 tokens (full)
│   │       │   └── main.css — 284 tokens (full)
│   │       ├── constants/
│   │       │   ├── index.ts — 50 tokens (full)
│   │       │   ├── providers.ts — 1 424 tokens (full)
│   │       │   ├── settings-sections.ts — 1 424 tokens (full)
│   │       │   └── types.ts — 81 tokens (full)
│   │       ├── screens/
│   │       │   ├── Chat/
│   │       │   │   ├── components/
│   │       │   │   │   └── ModelPicker.tsx — 763 tokens (full)
│   │       │   │   ├── hooks/
│   │       │   │   │   ├── chatSendFlows.ts — 1 591 tokens (full)
│   │       │   │   │   ├── useChatController.ts — 3 366 tokens (full)
│   │       │   │   │   └── useChatModelConfig.ts — 1 294 tokens (full)
│   │       │   │   ├── Chat.tsx — 1 463 tokens (full)
│   │       │   │   ├── chatCommands.ts — 1 457 tokens (full)
│   │       │   │   └── types.ts — 851 tokens (full)
│   │       │   ├── Layout/
│   │       │   │   ├── Layout.test.tsx — 1 522 tokens (full)
│   │       │   │   └── Layout.tsx — 4 849 tokens (full)
│   │       │   ├── Models/
│   │       │   │   └── Models.tsx — 3 254 tokens (full)
│   │       │   └── Settings/
│   │       │       ├── components/
│   │       │       │   ├── SettingsCoreSections.tsx — 4 042 tokens (full)
│   │       │       │   └── SettingsPreferenceSections.tsx — 2 358 tokens (full)
│   │       │       └── Settings.tsx — 3 676 tokens (full)
│   │       └── constants.ts — 9 tokens (full)
│   └── shared/
│       ├── i18n/
│       │   ├── locales/
│       │   │   ├── en/
│       │   │   │   ├── models.ts — 282 tokens (full)
│       │   │   │   ├── navigation.ts — 74 tokens (full)
│       │   │   │   └── settings.ts — 996 tokens (full)
│       │   │   ├── es/
│       │   │   │   ├── models.ts — 330 tokens (full)
│       │   │   │   ├── navigation.ts — 81 tokens (full)
│       │   │   │   └── settings.ts — 1 095 tokens (full)
│       │   │   ├── pt-BR/
│       │   │   │   ├── models.ts — 318 tokens (full)
│       │   │   │   ├── navigation.ts — 81 tokens (full)
│       │   │   │   └── settings.ts — 1 061 tokens (full)
│       │   │   └── zh-CN/
│       │   │       ├── models.ts — 279 tokens (full)
│       │   │       ├── navigation.ts — 74 tokens (full)
│       │   │       └── settings.ts — 970 tokens (full)
│       │   ├── index.ts — 1 938 tokens (full)
│       │   └── types.ts — 35 tokens (full)
│       └── chat-metadata.ts — 1 139 tokens (full)
└── tests/
    ├── chat-metadata.test.ts — 534 tokens (full)
    ├── constants.test.ts — 1 846 tokens (full)
    ├── hermes-trace-events.test.ts — 891 tokens (full)
    ├── ipc-handlers.test.ts — 1 877 tokens (full)
    ├── preload-api-surface.test.ts — 3 064 tokens (full)
    └── ssh-remote.test.ts — 922 tokens (full)

### Codemaps
/Users/fredluz/Code/mercury/
└── src/
    ├── main/
    │   ├── hermes/
    │   │   └── runtime/
    │   │       ├── identity.ts — 575 tokens (manual)
    │   │       ├── manager.ts — 1 059 tokens (manual)
    │   │       └── state.ts — 79 tokens (manual)
    │   └── ssh-tunnel.ts — 592 tokens (manual)
    ├── renderer/
    │   └── src/
    │       └── screens/
    │           └── Chat/
    │               └── hooks/
    │                   └── chatPerf.ts — 377 tokens (manual)
    └── shared/
        ├── perf.ts — 203 tokens (manual)
        ├── runtime.ts — 478 tokens (manual)
        ├── skills.ts — 100 tokens (manual)
        └── traces.ts — 386 tokens (manual)


---

## Generated Plan

## Chat Send ✅
- **Chat**: `role-model-settings-FCCD35` | **Mode**: plan

### Response
## 1. **Summary**

Refactor Mercury’s Models experience from a top-level sidebar page into a dedicated Settings-owned Models view, while adding role-based model defaults for `chat`, `plan`, `code`, `explore`, `research`, `review`, `design`, and `image`. This should be a targeted feature refactor around the existing model/config/IPC/UI seams, not a broad runtime rewrite: reuse `models.json` as the saved model library, keep legacy `config.yaml` model behavior compatible, add a separate role-default persistence layer, update chat to resolve through the Chat role, and treat Image as a Codex-native `image_gen` tool capability rather than a text/image API model selection.

## 2. **Current-state analysis**

### Existing responsibilities and data flow

- `src/main/models.ts`
  - Owns local saved model library in `~/.hermes/models.json`.
  - `SavedModel` currently contains:
    - `id`, `name`, `provider`, `model`, `baseUrl`, `createdAt`, `contextWindow?`.
  - Seeds `DEFAULT_MODELS` on first local read.
  - Normalizes `contextWindow` via `inferContextWindow`.

- `src/main/config.ts`
  - Owns legacy profile model config in profile `config.yaml`:
    - `provider`
    - `default`
    - `base_url`
  - `getModelConfig(profile?)` returns `{ provider, model, baseUrl }`.
  - `setModelConfig(...)` mutates `config.yaml`, disables smart routing, enables streaming.
  - Also owns credential pool and auth store helpers.

- `src/main/services/config-service.ts`
  - Wraps local vs SSH config access.
  - `setModelConfigForProfile(...)` marks runtime stale and restarts gateway when needed.
  - This restart/stale behavior must be preserved for Chat role changes because they affect runtime model selection.

- `src/main/ipc/config.ts` and `src/preload/api/config.ts`
  - Expose legacy `get-model-config` / `set-model-config`.
  - Tests enforce main/preload parity.

- `src/main/ipc/models.ts` and `src/preload/api/models.ts`
  - Expose saved model CRUD.
  - Current `add-model`, `remove-model`, and `update-model` are local-only except `list-models`, which uses SSH fallback.
  - SSH write parity for saved models is incomplete today even though `sshSaveModels` exists.

- `src/main/ssh/config.ts`, `src/main/ssh/runtime.ts`, `src/main/ssh-remote.ts`
  - `sshGetModelConfig` / `sshSetModelConfig` operate on remote profile `config.yaml`.
  - `sshListModels` reads `$HOME/.hermes/models.json`.
  - `sshSaveModels` writes `$HOME/.hermes/models.json`.
  - Remote profile paths use `$HOME/.hermes/profiles/<profile>/...`.

- Chat model flow today:
  - Renderer `useChatModelConfig` calls:
    - `window.hermesAPI.getModelConfig(profile)`
    - `window.hermesAPI.listModels()`
  - Chat picker selection calls:
    - `window.hermesAPI.setModelConfig(provider, model, baseUrl, profile)`
  - Runtime send paths use legacy config directly:
    - `chat-api.ts`: `getModelConfig(profile)`
    - `chat-cli.ts`: `getModelConfig(profile)`
    - `title.ts`: `getModelConfig(request.profile)`
  - Local slash `/model` command also calls `getModelConfig`.

- Renderer routing:
  - `Layout.tsx` includes `View = "models"`.
  - `NAV_ITEMS` includes `{ view: "models", icon: Layers, labelKey: "navigation.models" }`.
  - `<Models />` is mounted as a top-level pane.
  - `Settings.tsx` currently renders only core/preference sections and has no nested view route.

- Current `Models.tsx`
  - Saved model CRUD grid only.
  - No role-default UI.
  - It can be reused as the “secondary library” section, but its loading and modal logic should be moved behind the Settings Models view.

- Image generation:
  - `docs/subsystems/codex-image-generation.md` and pasted `$imagegen` skill guidance establish that image generation is a Codex tool capability.
  - `image_gen` exists as a toolset key in `src/main/tools.ts` and `src/main/ssh/config.ts`.
  - `hasHermesAuthCredential(provider)` exists in `src/main/install/paths.ts`, but it only checks local `HERMES_AUTH_FILE`.
  - Trace evidence is already normalized in `src/main/hermes/trace-events.ts`.
  - Blocking point: there is no role resolver or capability resolver that can answer “is Image available via Codex-native image_gen for this profile/connection?”

### Existing code to reuse

- Reuse `SavedModel` and `models.json` for model library.
- Reuse `inferContextWindow` for saved model and role resolution context windows.
- Reuse `getModelConfig` / `setModelConfig` as the legacy compatibility backing for Chat fallback and legacy APIs.
- Reuse `getToolsets` / `sshGetToolsets` to detect `image_gen` enablement.
- Reuse `getConfigValue("image_gen.provider")` style config reads if existing simple parser can read dotted keys; validate this during implementation. If not, add a specific parser.
- Reuse `hasHermesAuthCredential("openai-codex")` locally for Codex OAuth detection.
- Reuse current IPC/preload split and parity tests.

### Hard constraints

- Do not remove legacy `getModelConfig` / `setModelConfig`.
- Do not store API keys or secrets in role defaults.
- Role defaults must be separate from saved model library.
- Malformed role storage must never break startup.
- Chat picker v1 behavior should update the active profile’s Chat override.
- Code role must remain independent from Chat.
- Image role must not silently fall back to public OpenAI Images/Responses API or ordinary text roles.
- Settings must not eagerly load Models state until the user opens the Models settings view.
- SSH mode must support role default read/write parity.

## 3. **Design**

### 3.1 Shared role taxonomy and role data contracts

Add a shared model-role module so main, preload typings, renderer, and tests use one stable taxonomy.

**New file:** `src/shared/model-roles.ts`

**Kind:** shared TypeScript module.

**Exports:**

```ts
type ModelRoleId =
  | "chat"
  | "plan"
  | "code"
  | "explore"
  | "research"
  | "review"
  | "design"
  | "image";

type ModelCapability =
  | "text"
  | "image_input"
  | "codex_image_gen";

type ModelRoleScope = "global" | "profile";

type ImageRoleMode =
  | "codex_builtin_image_gen"
  | "codex_imagegen_skill";

type ModelRoleSelection = {
  role: ModelRoleId;
  modelId?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  contextWindow?: number;
  capabilities?: ModelCapability[];
  imageMode?: ImageRoleMode;
  updatedAt: number;
};

type ModelRoleDefault = ModelRoleSelection & {
  scope: ModelRoleScope;
  profile?: string;
};

type ModelRoleResolutionSource =
  | "profile-override"
  | "global-default"
  | "role-fallback"
  | "legacy-chat-config"
  | "provider-auto"
  | "missing-model"
  | "image-capability";

type ResolvedTextModelRole = {
  role: Exclude<ModelRoleId, "image">;
  kind: "text";
  ok: true;
  source: ModelRoleResolutionSource;
  provider: string;
  model: string;
  baseUrl: string;
  contextWindow: number;
  capabilities: ModelCapability[];
  modelId?: string;
  missingModelId?: string;
};

type ResolvedImageModelRole = {
  role: "image";
  kind: "image";
  ok: boolean;
  source: "image-capability";
  imageMode?: ImageRoleMode;
  provider?: "openai-codex";
  model?: string;
  toolsetEnabled: boolean;
  providerConfigured: boolean;
  credentialAvailable: boolean;
  reason?: string;
};

type ModelRoleResolution =
  | ResolvedTextModelRole
  | ResolvedImageModelRole;
```

**Role metadata:**

Export a stable array:

```ts
MODEL_ROLES = [
  { id: "chat", labelKey: "models.roles.chat.name", descriptionKey: "..." },
  ...
  { id: "image", ... }
] as const
```

**Fallback chains:**

Use explicit chains:

- `chat`: legacy Chat fallback only; no role fallback.
- `plan`: `plan → chat → legacy`.
- `code`: `code → chat → legacy`, but Chat picker never writes Code.
- `explore`: `explore → code → chat → legacy`.
- `research`: `research → chat → legacy`.
- `review`: `review → code → chat → legacy`.
- `design`: `design → chat → legacy`.
- `image`: no text fallback; resolve capability only.

Rationale: this keeps text roles useful before configuration while preserving Code independence.

### 3.2 Extend saved model capabilities without breaking old data

Modify `src/main/models.ts`.

**Change `SavedModel`:**

Add optional capabilities:

```ts
capabilities?: ModelCapability[];
```

**Normalization contract:**

- Existing `models.json` entries without `capabilities` remain valid.
- `normalizeModel` should:
  - infer/retain `contextWindow`.
  - default `capabilities` to `["text"]` for all saved text models.
  - preserve `image_input` if present.
  - never infer `codex_image_gen` from `inputModalities` or model name.
- `addModel(...)` should default to `["text"]`.
- `updateModel(...)` should allow updating `capabilities`.

**Why targeted:** role defaults can refer to saved models by `modelId`, but saved model CRUD should remain simple.

### 3.3 Role persistence service

Add a main-process role persistence layer.

**New file:** `src/main/model-roles.ts`

**Kind:** storage and resolver module.

**Local storage paths:**

- Global defaults:
  - `join(HERMES_HOME, "model-roles.json")`
- Profile overrides:
  - `join(profileHome(profile), "model-roles.json")`

Prefer per-profile files because `profileHome(profile)` is already used for backup/import/profile isolation.

**File schema:**

Each file stores:

```json
{
  "version": 1,
  "defaults": {
    "chat": {
      "role": "chat",
      "modelId": "uuid",
      "provider": "openrouter",
      "model": "anthropic/claude-sonnet-4-20250514",
      "baseUrl": "",
      "contextWindow": 200000,
      "capabilities": ["text"],
      "updatedAt": 1779200000000
    }
  }
}
```

For profile files, use the same shape; the scope is implied by file location. Scope is added to returned objects.

**Functions:**

```ts
readGlobalModelRoleDefaults(): Record<ModelRoleId, ModelRoleSelection | undefined>
writeGlobalModelRoleDefault(role, selection): void

readProfileModelRoleOverrides(profile?): Record<ModelRoleId, ModelRoleSelection | undefined>
writeProfileModelRoleOverride(role, selection, profile?): void
clearProfileModelRoleOverride(role, profile?): boolean

getModelRoleDefaults(profile?): Promise/Sync result shape
resolveModelForRole(role, profile?): ModelRoleResolution
```

Because local file reads are synchronous today, keep local functions synchronous. Service wrapper can be async for SSH parity.

**Malformed storage behavior:**

- Invalid JSON returns empty defaults.
- Unknown role keys are ignored.
- Invalid selection fields are dropped.
- No writes occur on read recovery.
- Tests should assert no throw.

**Selection persistence rules:**

When setting a role from a saved model:

- Persist:
  - `modelId`
  - current `provider`
  - current `model`
  - current `baseUrl`
  - current `contextWindow`
  - current `capabilities`
  - `updatedAt`
- This snapshot allows display/resolution when saved model is later deleted.
- If `modelId` is missing but provider/model present, allow direct config selection for legacy/custom compatibility.

**Missing saved model behavior:**

- If a role references `modelId` that no longer exists:
  - resolution returns the snapshot provider/model if valid, but marks `source: "missing-model"` and includes `missingModelId`.
  - UI shows recoverable “missing saved model” state.
- If snapshot is absent/malformed:
  - continue role fallback chain.

### 3.4 Role resolution service with local/SSH dispatch

Add service layer to keep IPC thin.

**New file:** `src/main/services/model-roles-service.ts`

**Kind:** async service module.

**Responsibilities:**

- Dispatch local vs SSH based on `getConnectionConfig()`.
- Batch-load:
  - saved models
  - global defaults
  - profile overrides
  - legacy model config
  - image capability evidence
- Mark runtime stale/restart only when Chat role or legacy model config effectively changes.

**Core API:**

```ts
listModelRolesForConnection(profile?: string): Promise<ModelRoleListResult>
getModelRoleDefaultsForConnection(profile?: string): Promise<ModelRoleDefaultsResult>
setGlobalModelRoleDefaultForConnection(role, input): Promise<boolean>
setProfileModelRoleOverrideForConnection(role, input, profile?): Promise<boolean>
clearProfileModelRoleOverrideForConnection(role, profile?): Promise<boolean>
resolveModelForRoleForConnection(role, profile?): Promise<ModelRoleResolution>
```

**Result shape for UI batch load:**

```ts
type ModelRoleListResult = {
  roles: Array<{
    id: ModelRoleId;
    nameKey: string;
    descriptionKey: string;
    global?: ModelRoleDefault;
    profileOverride?: ModelRoleDefault;
    resolved: ModelRoleResolution;
  }>;
  savedModels: SavedModel[];
  imageCapability: ResolvedImageModelRole;
};
```

**Legacy compatibility rule:**

- `getModelConfigForProfile(profile)` can remain legacy.
- `setModelConfigForProfile(provider, model, baseUrl, profile)` must be updated to:
  1. Write legacy config as today.
  2. Upsert active profile Chat override to the same provider/model/baseUrl.
  3. Mark/restart runtime once, not twice.
- This preserves existing callers and makes Chat picker changes write Chat override.

**Avoid double restart:**

Implement a lower-level helper in config-service or model-role service that compares previous effective Chat model before/after and triggers stale/restart once.

### 3.5 SSH role persistence

Add SSH helpers in `src/main/ssh/config.ts` or `src/main/ssh/runtime.ts`.

Prefer `src/main/ssh/runtime.ts` for JSON file storage, matching `sshListModels` / `sshSaveModels`.

**New helper paths:**

```ts
remoteModelRolesPath(profile?: string):
  profile && profile !== "default"
    ? "$HOME/.hermes/profiles/<safe>/model-roles.json"
    : "$HOME/.hermes/model-roles.json"
```

Validate profile names using the same safe-profile approach already present in `runtime.ts`.

**New exports:**

```ts
sshReadModelRoleDefaults(config, profile?): Promise<ModelRolesFile>
sshWriteModelRoleDefaults(config, file, profile?): Promise<void>
sshResolveImageCapability(config, profile?): Promise<ResolvedImageModelRole>
```

**SSH saved model CRUD parity:**

Currently `add-model`, `remove-model`, `update-model` are local-only. For the spec’s SSH parity:

- Move saved-model CRUD connection dispatch into `models-service.ts`.
- Add:
  - `addModelForConnection(...)`
  - `removeModelForConnection(id)`
  - `updateModelForConnection(id, fields)`
- For SSH:
  - read via `sshListModels`
  - mutate in memory
  - write via `sshSaveModels`
  - normalize using shared/local normalization helper.

**Dependency note:** extract model normalization functions from `src/main/models.ts` for reuse by SSH service, or export `normalizeSavedModel` and `createSavedModelEntry`.

### 3.6 Image role capability resolution

Do not model Image as a `SavedModel` dropdown.

**Local capability inputs:**

- Toolset enabled:
  - `getToolsets(profile).find(t => t.key === "image_gen")?.enabled`
- Provider configured:
  - read `image_gen.provider` from profile config.
  - Expected primary value: `"openai-codex"`.
- Image model:
  - read `image_gen.model`, optional; default display fallback can be `"gpt-image-2-medium"`.
- Credential:
  - `hasHermesAuthCredential("openai-codex")`
  - additionally check `~/.codex/auth.json` equivalent if not already covered; add helper in `install/paths.ts` if needed.
- Do not treat `model/list.inputModalities` as output image support.

**Local function:**

```ts
resolveLocalImageCapability(profile?): ResolvedImageModelRole
```

**SSH capability inputs:**

- Toolset enabled:
  - `sshGetToolsets(config, profile)`
- Provider configured:
  - `sshGetConfigValue(config, "image_gen.provider", profile)`
- Credentials:
  - Need remote auth detection helper.
  - Add SSH helper that checks existence/content of:
    - `$HOME/.hermes/auth.json`
    - `$HOME/.codex/auth.json`
  - Return boolean only; do not return secret content.

**Resolution behavior:**

- If all required:
  - `ok: true`
  - `imageMode: "codex_builtin_image_gen"`
  - `provider: "openai-codex"`
- Else:
  - `ok: false`
  - `reason` should be one of:
    - `"image_gen toolset is disabled"`
    - `"image_gen.provider is not openai-codex"`
    - `"Codex OAuth credential was not found"`
- Never return a text role fallback.

**Image generation API scope:**

The spec suggests `generateImage` / `editImage`, but the current selected code has no image request UI. For this implementation:
- Add resolver/capability APIs now.
- Do not add public image-generation IPC unless there is a concrete caller in the same change.
- Document that runtime generation continues through Codex/Hermes chat/tool paths and Trace Lab evidence.
- If adding `generateImage` is required by acceptance, implement only a typed capability-gated stub that fails clearly when unavailable and routes to a Codex image turn only when the existing app-server/CLI integration can preserve `tool.*` and `artifact.created`.

### 3.7 IPC and preload API

Extend `src/main/ipc/models.ts`, not `config.ts`, because role defaults conceptually belong with Models.

**New IPC channels:**

- `list-model-roles`
- `get-model-role-defaults`
- `set-global-model-role-default`
- `set-profile-model-role-override`
- `clear-profile-model-role-override`
- `resolve-model-for-role`

**Main handlers:**

```ts
ipcMain.handle("list-model-roles", (_event, profile?: string) => ...)
ipcMain.handle("set-profile-model-role-override", (_event, role, selection, profile?: string) => ...)
```

**Preload methods in `src/preload/api/models.ts`:**

```ts
listModelRoles(profile?: string): Promise<ModelRoleListResult>
getModelRoleDefaults(profile?: string): Promise<ModelRoleDefaultsResult>
setGlobalModelRoleDefault(role, selection): Promise<boolean>
setProfileModelRoleOverride(role, selection, profile?: string): Promise<boolean>
clearProfileModelRoleOverride(role, profile?: string): Promise<boolean>
resolveModelForRole(role, profile?: string): Promise<ModelRoleResolution>
```

**Type declarations in `src/preload/index.d.ts`:**

Import shared model-role types from `../shared/model-roles` and add methods to `HermesAPI`.

**Legacy APIs:**

Keep:
- `getModelConfig`
- `setModelConfig`
- `listModels`
- `addModel`
- `removeModel`
- `updateModel`

Update saved model CRUD handlers to use `models-service.ts` so SSH writes work.

### 3.8 Runtime integration

#### Chat send paths

Modify:

- `src/main/hermes/chat-api.ts`
- `src/main/hermes/chat-cli.ts`
- `src/main/hermes/title.ts`

Replace direct `getModelConfig(profile)` usage with role resolver for `chat`.

**Behavior:**

- `sendMessageViaApi` resolves `chat`.
- If resolver returns text ok:
  - use `resolved.model || "hermes-agent"`.
  - provider/baseUrl are not directly used by API body today, but context remains useful.
- If resolver unexpectedly fails:
  - fallback to legacy `getModelConfig(profile)` to preserve compatibility.

**CLI behavior:**

- Use resolved Chat role to populate `-m`.
- Use resolved provider/baseUrl for custom endpoint env logic.
- Preserve current API key env handling.

#### Title generation

Decision: use Chat role for now, not a separate hidden title role.

- `title.ts` should resolve `chat`.
- Rationale: no title role exists in v1 taxonomy.

#### Intent-aware roles

The selected code has no explicit plan/code/explore/research/review/design runtime callers beyond normal chat. Add the resolver API and update only paths with clear existing intent:

- Normal chat: `chat`.
- Local `/model`: display Chat role resolution.
- Future coding/planning paths can consume `resolveModelForRole`.

Do not invent new agents in this change.

#### Runtime purpose type

Do not expand `RuntimePurpose` for roles unless needed by existing runtime manager. Roles are model-selection concerns, not runtime identity purposes.

### 3.9 Renderer routing and Settings-owned Models view

#### Layout changes

Modify `src/renderer/src/screens/Layout/Layout.tsx`.

- Remove `"models"` from `View`.
- Remove Models import from top-level layout unless used by Settings route.
- Remove Models from `NAV_ITEMS`.
- Remove top-level `visitedViews.has("models")` pane.
- Add a way for Settings to request nested view state:
  - either `Settings` owns internal subview state, or Layout passes an initial subview.
  - For v1, keep it inside Settings.

Update `Layout.test.tsx`:

- Add assertion Models nav is absent.
- Existing mock of `../Models/Models` should be removed unless still needed by Settings mock.
- Settings entry test should live in Settings/Models tests.

#### Settings dedicated Models view

Modify `src/renderer/src/screens/Settings/Settings.tsx`.

Add internal state:

```ts
type SettingsView = "main" | "models";
const [settingsView, setSettingsView] = useState<SettingsView>("main");
```

Behavior:

- Main settings page renders a “Models” entry point near Provider/API/Connection settings.
- Clicking it sets `settingsView = "models"`.
- Models settings view renders dedicated `<ModelsSettings profile={profile} onBack={() => setSettingsView("main")} />`.
- This satisfies “dedicated screen/view, not inline subsection buried inside existing Settings page.”

#### New Models Settings component

Refactor current `src/renderer/src/screens/Models/Models.tsx`.

Recommended structure:

- Keep file path `src/renderer/src/screens/Models/Models.tsx` for minimal import churn.
- Change component into Models settings view with:
  1. Header/back affordance when used under Settings.
  2. Role defaults list.
  3. Secondary saved model library section.

Props:

```ts
interface ModelsProps {
  profile?: string;
  onBack?: () => void;
}
```

Role UI state:

- Load via one batched call:
  - `window.hermesAPI.listModelRoles(profile)`
- Do not call this until component mounts.

Role row display:

Each text role row shows:

- Role name.
- Description.
- Current selected model summary.
- Source badge:
  - `Profile override`
  - `Global default`
  - `Fallback`
  - `Legacy chat config`
  - `Missing saved model`
- Provider/model/base URL/context window.
- “Change model” selector populated from saved models with `capabilities` containing `text`.
- If profile override exists, show “Use global default”.

Image row display:

- No generic text model dropdown.
- Show Codex-native capability state:
  - Available: `image_gen enabled · openai-codex configured · Codex auth found`
  - Unavailable: exact missing reason.
- Show `image_gen` model config if present.
- Provide a shortcut/help text pointing to Tools/config requirements, not saved model selection.
- Optional action: “Refresh capability”.

Saved model library:

- Preserve add/edit/delete/search.
- Update modal to include optional capabilities:
  - Text generation checkbox enabled by default.
  - Image input checkbox optional.
  - Do not allow user to mark `codex_image_gen` for saved models in v1, or show it as reserved/system-only.
- On delete:
  - Do not clear role references automatically.
  - UI should show missing-model state on next role load.

Profile/global selection behavior:

- Role row should offer:
  - “Set for this profile” primary action.
  - “Set global default” secondary action.
- For Chat picker parity:
  - Chat picker changes profile override.
  - Models settings can manage both.

### 3.10 Chat model picker updates

Modify `src/renderer/src/screens/Chat/hooks/useChatModelConfig.ts`.

**Load behavior:**

- Replace `getModelConfig(profile)` with `resolveModelForRole("chat", profile)` for current display.
- Still load `listModels()` for picker options.
- If role resolver returns legacy fallback, display that source if needed only in UI/logical state; the picker UI can remain simple.

**Select behavior:**

- `selectModel(...)` should call:
  - `setProfileModelRoleOverride("chat", selection, profile)`
- To preserve old compatibility, either:
  - the main role override service also writes legacy config for Chat, or
  - `selectModel` calls legacy `setModelConfig`.
- Prefer main service writes both when setting Chat override, so renderer has one call.

**Custom model submit:**

- Set Chat profile override with provider/current base URL.
- If no saved model ID, persist direct provider/model/baseUrl snapshot.

Modify `ModelPicker.tsx` only if signature needs `modelId`; recommended to pass optional `modelId` in `ModelGroup.models`.

Update `src/renderer/src/screens/Chat/types.ts`:

```ts
ModelGroup.models[] includes id?: string
```

### 3.11 Local slash command `/model`

Modify `src/renderer/src/screens/Chat/chatCommands.ts`.

- `/model` should call `resolveModelForRole("chat", profile)`.
- Display:
  - model
  - provider
  - base URL if present
  - source
- If resolver unavailable for backward compatibility, fallback to `getModelConfig`.

### 3.12 i18n

Modify locale files:

- `src/shared/i18n/locales/en/models.ts`
- `es/models.ts`
- `pt-BR/models.ts`
- `zh-CN/models.ts`
- `settings.ts` for each locale.
- `navigation.ts` for each locale.

Navigation:

- Remove or stop using `navigation.models`.
- It can remain in translation files for backward compatibility; tests should not require removal.

English keys to add:

```ts
models.roles.chat.name
models.roles.chat.description
...
models.roleDefaultsTitle
models.roleDefaultsSubtitle
models.modelLibraryTitle
models.changeModel
models.setGlobalDefault
models.setProfileOverride
models.useGlobalDefault
models.source.profileOverride
models.source.globalDefault
models.source.fallback
models.source.legacyChatConfig
models.source.missingModel
models.missingModelTitle
models.missingModelDescription
models.image.available
models.image.unavailable
models.image.codexNativeOnly
models.image.requirements
models.capabilities.text
models.capabilities.imageInput
models.capabilities.codexImageGenReserved
settings.modelsEntryTitle
settings.modelsEntryDescription
settings.openModels
```

For non-English locales, add placeholder translations. Do not leave missing keys.

### 3.13 Styling

Modify:

- `src/renderer/src/assets/styles/models.css`
- possibly `settings.css`

Add styles for:

- `.models-settings-back`
- `.model-roles-list`
- `.model-role-row`
- `.model-role-row-image`
- `.model-role-source-badge`
- `.model-role-summary`
- `.model-role-actions`
- `.model-role-selector`
- `.model-role-missing`
- `.model-role-image-status`
- `.models-library-section`

Avoid dense card grid for roles; use vertical list rows. Existing card grid can remain for saved library.

### 3.14 Tests

#### Unit tests

Add `tests/model-roles.test.ts`.

Cover:

- taxonomy exactly eight stable IDs.
- fallback chains.
- malformed storage returns defaults.
- global persistence read/write.
- profile override shadows global.
- deleted saved model returns missing-model state.
- Chat falls back to legacy config.
- Code is independent from Chat.
- Image role does not fall back to text.
- `inputModalities`/`image_input` does not imply `codex_image_gen`.

#### SSH tests

Extend `tests/ssh-remote.test.ts` or add `tests/ssh-model-roles.test.ts`.

Cover:

- remote model role path for default and named profiles.
- safe profile validation.
- read/write role defaults via SSH helpers.
- image capability remote credential check returns boolean without content.

#### IPC/preload tests

Update:

- `tests/ipc-handlers.test.ts`
- `tests/preload-api-surface.test.ts`

Add required channels/methods:

- `list-model-roles`
- `get-model-role-defaults`
- `set-global-model-role-default`
- `set-profile-model-role-override`
- `clear-profile-model-role-override`
- `resolve-model-for-role`

Ensure every preload invoke has main handler.

#### Renderer tests

Update `Layout.test.tsx`:

- Models sidebar nav absent.
- Settings sidebar nav still present.

Add `ModelsSettings.test.tsx` or similar:

- Settings exposes Models entry point.
- Clicking opens dedicated Models view.
- Role list renders all eight roles.
- Changing role selector calls `setProfileModelRoleOverride`.
- “Use global default” calls clear override.
- Missing model state is visible.
- Saved model CRUD controls still render.
- Image role shows Codex-native availability/unavailability and no text model dropdown.

#### Chat/runtime tests

Add/extend:

- Chat hook tests if existing test harness supports it:
  - load uses `resolveModelForRole("chat")`.
  - selecting model writes Chat profile override.
- Main runtime unit tests:
  - `chat-api.ts` and `chat-cli.ts` use Chat role resolution.
  - legacy fallback preserved when role storage absent.

#### Trace/image tests

Existing `hermes-trace-events.test.ts` already covers artifact evidence. Add model-role image capability tests, not fake generation tests, unless app-server integration exists.

## 4. **File-by-file impact**

### `src/shared/model-roles.ts` — new

- Add shared role IDs, metadata, capabilities, persistence/result types, fallback chain helpers.
- Required by main, preload declarations, renderer, tests.

### `src/shared/chat-metadata.ts`

- No required logic change unless moving capability/context helpers here.
- Keep `inferContextWindow` as the context-window source.

### `src/main/models.ts`

- Extend `SavedModel` with `capabilities?: ModelCapability[]`.
- Export normalization helper for reuse by SSH service.
- Allow `updateModel` to accept `capabilities`.
- Default old/new models to `["text"]`.

### `src/main/default-models.ts`

- Optional: add `capabilities?: ModelCapability[]` to `DefaultModel`.
- Defaults can omit capabilities and be normalized to `["text"]`.

### `src/main/model-roles.ts` — new

- Implement local JSON storage for global/profile role files.
- Implement local role resolution and image capability resolution.
- Reuse `listModels`, `getModelConfig`, `getToolsets`, `getConfigValue`, `profileHome`, `safeWriteFile`.

### `src/main/services/model-roles-service.ts` — new

- Add local/SSH dispatch for role APIs.
- Coordinate Chat override writes with legacy config and runtime stale/restart behavior.

### `src/main/services/config-service.ts`

- Update `setModelConfigForProfile` to sync legacy writes into Chat profile override, or delegate to role service for Chat.
- Avoid duplicate runtime restart.
- Keep public signature unchanged.

### `src/main/services/models-service.ts`

- Expand from list-only to full saved model CRUD with local/SSH dispatch.
- Use `sshSaveModels` for SSH add/update/remove.

### `src/main/config.ts`

- Possibly add helper for reading nested YAML-ish keys like `image_gen.provider` and `image_gen.model` if current `getConfigValue` cannot support them.
- Keep existing `getModelConfig` / `setModelConfig`.

### `src/main/install/paths.ts`

- Add Codex auth detection helper if needed:
  - checks `~/.codex/auth.json`
  - does not expose content.
- Reuse `hasHermesAuthCredential("openai-codex")`.

### `src/main/ssh/runtime.ts`

- Add `remoteModelRolesPath`, SSH read/write role file helpers.
- Add remote Codex auth existence helper.
- Optionally normalize SSH saved models.

### `src/main/ssh/config.ts`

- Reuse `sshGetToolsets` and `sshGetConfigValue`.
- If nested key read is insufficient, add explicit `sshGetImageGenConfig`.

### `src/main/ssh-remote.ts`

- Re-export new SSH role helpers and any saved-model CRUD helpers.

### `src/main/ipc/models.ts`

- Replace direct local CRUD calls with service methods.
- Add role-default IPC handlers.

### `src/main/ipc/config.ts`

- Keep legacy handlers.
- No new role handlers here unless implementation chooses config-service ownership; preferred: models IPC.

### `src/preload/api/models.ts`

- Add role API methods.
- Extend `updateModel` fields to include `capabilities`.

### `src/preload/index.d.ts`

- Import model role types.
- Add role API methods.
- Extend `listModels` return and `updateModel` fields with capabilities.

### `src/main/hermes/chat-api.ts`

- Resolve Chat role instead of direct `getModelConfig`.
- Preserve legacy fallback.

### `src/main/hermes/chat-cli.ts`

- Resolve Chat role for `-m`, provider, and base URL custom endpoint logic.
- Preserve env injection behavior.

### `src/main/hermes/title.ts`

- Resolve Chat role for title model request.
- Preserve fallback title behavior.

### `src/main/hermes/types.ts`

- No required change unless adding future runtime purposes. Prefer no change.

### `src/renderer/src/screens/Layout/Layout.tsx`

- Remove top-level `models` view and nav item.
- Remove top-level `<Models />` pane.
- Settings remains the entry point.

### `src/renderer/src/screens/Layout/Layout.test.tsx`

- Update mocks and assertions:
  - Models nav absent.
  - Settings still reachable.

### `src/renderer/src/screens/Settings/Settings.tsx`

- Add internal settings subview state.
- Add Models entry point on main Settings page.
- Render `<Models profile={profile} onBack={...} />` as dedicated settings view.

### `src/renderer/src/screens/Settings/components/SettingsCoreSections.tsx`

- Add Models entry point near connection/provider-related settings, or expose a callback prop from `Settings.tsx`.
- Prefer passing `onOpenModels` in `values`.

### `src/renderer/src/screens/Models/Models.tsx`

- Refactor into Models settings view:
  - role defaults list first
  - saved model library secondary
  - image capability row
  - profile/global actions
  - missing-model states
- Preserve existing modal CRUD with capability fields.

### `src/renderer/src/screens/Chat/hooks/useChatModelConfig.ts`

- Load current model from `resolveModelForRole("chat", profile)`.
- Select model via `setProfileModelRoleOverride("chat", ...)`.
- Include `modelId` in picker groups.

### `src/renderer/src/screens/Chat/types.ts`

- Extend `ModelGroup.models[]` with `id?: string` and `capabilities?: ModelCapability[]`.

### `src/renderer/src/screens/Chat/components/ModelPicker.tsx`

- Pass `modelId` through selection callback if needed.
- No major UI redesign required.

### `src/renderer/src/screens/Chat/chatCommands.ts`

- `/model` uses `resolveModelForRole("chat", profile)`.
- Fallback to legacy API only if resolver fails.

### `src/shared/i18n/locales/*/models.ts`

- Add role/default/image/missing-source labels.
- Keep existing saved model library strings.

### `src/shared/i18n/locales/*/settings.ts`

- Add Settings Models entry strings.

### `src/shared/i18n/locales/*/navigation.ts`

- `navigation.models` can remain unused.
- Tests should assert UI removal, not translation removal.

### `src/renderer/src/assets/styles/models.css`

- Add role settings layout styles.
- Keep existing saved model library styles.

### `src/renderer/src/assets/styles/settings.css`

- Add Settings entry row/card styles if not using existing section styles.

### `tests/model-roles.test.ts` — new

- Role storage/resolution/fallback/capability tests.

### `tests/ipc-handlers.test.ts`

- Add new role IPC channels to expected new features.
- Keep legacy channels.

### `tests/preload-api-surface.test.ts`

- Add role API methods and type parity checks.

### `tests/constants.test.ts`

- Add role taxonomy constants if exported through renderer constants, or keep role taxonomy tests in `model-roles.test.ts`.
- Update any assertions that assume Models is a nav item if present.

### `tests/ssh-remote.test.ts`

- Add SSH role path/read/write/capability checks.

### `tests/hermes-trace-events.test.ts`

- Keep existing artifact tests.
- Add only if image role introduces new trace event shape.

## 5. **Risks and migration**

### Backward compatibility

- Existing `models.json` remains valid because `capabilities` is optional and defaults to `["text"]`.
- Existing `config.yaml` remains valid and is not mutated on first read.
- Legacy `getModelConfig` / `setModelConfig` remain available.
- On no role file, Chat resolution synthesizes from legacy `getModelConfig(profile)`.
- On Chat picker changes, new code writes profile Chat override and legacy config for compatibility.

### Rollback concerns

- New `model-roles.json` files are additive.
- Old app versions will ignore `model-roles.json`.
- If rollback occurs after Chat picker changes, legacy `config.yaml` has also been updated, so old chat behavior remains correct.

### Data corruption handling

- Malformed role files are ignored as empty.
- Writes use `safeWriteFile`.
- Missing saved model references show recoverable UI and do not crash.

### Image capability risk

- Detecting Codex built-in availability may be imperfect.
- Mitigation:
  - v1 uses conservative requirements: toolset enabled + `image_gen.provider: openai-codex` + auth evidence.
  - If any evidence is missing, Image role is unavailable with a clear reason.
  - Do not claim availability from `inputModalities`.

## 6. **Implementation order**

1. **Add shared role types and tests**
   - Create `src/shared/model-roles.ts`.
   - Add taxonomy/fallback unit tests.
   - This step is independently type-checkable.

2. **Extend `SavedModel` capabilities**
   - Update `models.ts`, preload types, and model CRUD types.
   - Ensure old `models.json` test fixtures still pass.
   - Add tests for default `["text"]`.

3. **Implement local role storage/resolution**
   - Add `src/main/model-roles.ts`.
   - Cover global/profile/malformed/missing/fallback behavior in `tests/model-roles.test.ts`.

4. **Add image capability resolver**
   - Implement local conservative Image resolution.
   - Add tests for:
     - unavailable when tool disabled
     - unavailable when provider not `openai-codex`
     - unavailable when auth missing
     - no text fallback.

5. **Add SSH role storage helpers**
   - Add remote role path/read/write helpers.
   - Re-export from `ssh-remote.ts`.
   - Add SSH unit tests for path safety and read/write shapes.

6. **Create `model-roles-service.ts`**
   - Add connection dispatch.
   - Add role API functions.
   - Add SSH saved model CRUD dispatch in `models-service.ts`.

7. **Wire IPC and preload**
   - Add role handlers in `ipc/models.ts`.
   - Add preload methods and declarations.
   - Update parity tests.
   - This must land atomically with service additions.

8. **Preserve legacy Chat behavior**
   - Update `setModelConfigForProfile` to sync Chat override while preserving legacy config.
   - Add regression tests for legacy APIs.

9. **Update runtime Chat/title model resolution**
   - Modify `chat-api.ts`, `chat-cli.ts`, and `title.ts`.
   - Keep fallback to legacy `getModelConfig`.
   - Add focused runtime tests.

10. **Refactor Layout navigation**
    - Remove top-level Models route/nav/pane.
    - Update `Layout.test.tsx`.

11. **Add Settings Models entry and nested view**
    - Update `Settings.tsx` and `SettingsCoreSections.tsx`.
    - Ensure Models state is not loaded until opened.

12. **Refactor Models UI**
    - Add role list.
    - Add Image capability row.
    - Preserve saved library CRUD.
    - Add capability fields to modal.
    - Add missing-model state.

13. **Update Chat picker**
    - Use Chat role resolver.
    - Selection writes profile Chat override.
    - Update `/model` command.

14. **Add i18n and styles**
    - Add all new keys in all locale files.
    - Add role/list/status styles.

15. **Final test pass**
    - Run typecheck.
    - Run:
      - model role tests
      - IPC/preload parity tests
      - Layout/Settings/Models renderer tests
      - SSH tests
      - chat metadata/runtime tests
      - trace event tests.


> 💡 Continue this plan conversation with ask_oracle(chat_id: "role-model-settings-FCCD35", new_chat: false)
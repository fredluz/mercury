# Spec: Role-Based Model Defaults Settings

Created: Tuesday, May 19, 2026
Status: Superseded by `specs/hermes-inventory-role-chat-picker.md`

## Supersession Note

This May 19 draft captured the first role-defaults design. The May 24 implementation intentionally changed several decisions:

- Provider-served model availability now comes from Hermes inventory, not from a Mercury saved-model library as the source of truth.
- `models.json` remains legacy/manual storage, but it is not seeded and is not canonical for provider models.
- Text role resolution has no cross-role fallback chains. A role resolves only from its own profile override, then its own global default, then unresolved setup-required state.
- Chat role picker changes are per-chat/session role selection, not writes to the active profile's Chat override.
- Legacy profile `config.yaml` provider/default/base URL does not silently satisfy unresolved role-based chat runtime.

Current behavior is documented in [Model roles and provider inventory](../docs/subsystems/model-roles-and-provider-inventory.md). Keep this file as historical design context only.

## Problem Statement

Mercury’s current Models screen is a flat library of saved model definitions that appear in the chat page model picker. That treats every model as interchangeable, but real agent work needs different model defaults for different jobs: chat, planning, implementation, codebase exploration, web research, review, design, and image generation.

Users should be able to configure those role defaults from Settings instead of managing Models as a top-level sidebar destination. This matters because model choice is becoming part of agent orchestration, not just a chat UI label. A planner may need a high-reasoning model, an explorer may need long context and safe read-only behavior, a researcher may need web-oriented capabilities, and an image workflow needs a separate Codex-native `image_gen` tool capability configuration.

## Proposed Solution

Refactor Models from a sidebar model-library page into a dedicated Models settings page opened from the Settings menu. The page should center on role-based defaults while preserving the existing saved-model library as the source of selectable provider/model/base URL entries.

Default role taxonomy for v1:

1. **Chat**: general conversational assistant behavior in the chat surface.
2. **Plan**: strategy, task breakdown, implementation planning, tradeoff analysis.
3. **Code**: coding implementation, edits, routine debugging, test fixes.
4. **Explore**: read-only codebase exploration, file search, architecture mapping.
5. **Research**: online/documentation research and external source gathering.
6. **Review**: code review, security checks, regression risk analysis.
7. **Design**: product/UI design, interaction design, frontend critique.
8. **Image**: Codex-native image generation through the `image_gen` tool capability.

The role model picker should reuse saved models from the current model library. Role defaults are global by default and may be overridden per profile. Existing users should keep their current chat model behavior through migration/fallback: the legacy profile model config becomes the initial **Chat** role behavior for that profile, while Code and other task roles get their own independent defaults. Image must expose Codex-native `image_gen` availability and must not offer generic public image-model choices.

External design inspiration checked for this spec:

- Cline separates Plan and Act workflows and allows different models per mode, which validates a role-specific defaults UI for planning vs implementation.
- Aider’s architect/editor mode validates splitting reasoning/planning from concrete editing.
- OpenCode agents support agent-specific model configuration, descriptions, permissions, and visual presentation, which validates a dedicated role list rather than a generic flat model list.

## Requirements

### Functional

- [ ] Remove Models from the main sidebar navigation.
- [ ] Add a Settings menu item or Settings entry point that opens a dedicated Models settings page.
- [ ] Keep Models as a dedicated screen/view, not an inline subsection buried inside the existing Settings page.
- [ ] Present eight role defaults: Chat, Plan, Code, Explore, Research, Review, Design, Image.
- [ ] Each role must show:
  - [ ] role name,
  - [ ] concise description,
  - [ ] current selected model or fallback state,
  - [ ] provider/model/base URL details for the selected model,
  - [ ] a selector populated from the saved model library.
- [ ] The saved model library must remain manageable: users can add, edit, delete, and search saved models, but it should be secondary to role defaults.
- [ ] Selecting a saved model for a role must persist provider, model ID, base URL, and context window when available.
- [ ] Image role must represent Codex-native image generation capability, not public OpenAI API model selection. If saved model capabilities are extended, distinguish at least text generation, image input, and Codex built-in image generation/tool availability.
- [ ] If a role references a deleted/missing saved model, the UI must show a recoverable “missing model” state and allow selecting a replacement.
- [ ] Existing chat model picker behavior must continue to work.
- [ ] New chats should default to the **Chat** role model unless a per-chat override exists.
- [ ] If a user changes the chat model from the chat picker, Mercury should update the Chat role default or explicitly document and display it as a per-chat override. Preferred v1 behavior: update the active profile’s Chat override for parity with today’s “default model” behavior.
- [ ] Code must be a separate role from Chat and must not be implicitly changed by ordinary chat model selection.
- [ ] Provide a role-resolution helper that callers can use to resolve `chat`, `plan`, `code`, `explore`, `research`, `review`, `design`, or `image` into a provider/model/base URL config.
- [ ] Runtime paths that already know their intent should use the role-resolution helper:
  - [ ] chat/default conversation uses `chat`,
  - [ ] coding implementation agents or commands use `code`,
  - [ ] planning flows use `plan` when available,
  - [ ] codebase exploration agents use `explore` when available,
  - [ ] web/doc lookup agents use `research` when available,
  - [ ] review flows use `review` when available,
  - [ ] UI/design work uses `design` when available,
  - [ ] image generation uses the Image role to select the Codex-native image generation path when available.
- [ ] Codex app-server model discovery should use `model/list` metadata, including `inputModalities`, where available, but Image role availability must primarily come from tool/capability configuration, not modality metadata.
- [ ] Codex image generation must use the Codex built-in `image_gen` tool path, normally invoked through the `$imagegen` skill/workflow, rather than direct public OpenAI Images or Responses API calls.
- [ ] Image role resolution must verify `image_gen` toolset enablement and Codex image provider configuration, especially the existing `image_gen.provider: openai-codex` path when Codex OAuth is available.
- [ ] Image generation through app-server must preserve tool/artifact trace evidence (`tool.*` and `artifact.created`) so Trace Lab can distinguish real image generation from a textual description.
- [ ] Role resolution must fall back safely: profile role override → global role default → role-specific fallback chain → legacy profile model config for Chat compatibility → provider auto/default.
- [ ] Keep SSH mode parity: listing saved models and reading/writing global defaults/profile overrides should work for SSH connections the same way current model listing does.
- [ ] Update English i18n strings and add placeholder keys for existing supported locales if translations are not ready.

### Non-Functional

- [ ] Performance: opening Settings should not eagerly load or render expensive Models state unless the user opens Models.
- [ ] Performance: opening the Models settings page should load saved models and role defaults in one batched async flow where practical.
- [ ] Security: API keys must remain handled by existing env/credential mechanisms. Role defaults must not duplicate or expose secrets.
- [ ] Reliability: malformed role-default storage must not break app startup; Mercury should recover to safe defaults.
- [ ] Backwards compatibility: existing `models.json`, `config.yaml` provider/default/base_url, and existing IPC APIs must continue to work during migration.
- [ ] Accessibility: role selectors and add/edit model controls must be keyboard accessible and labelled.
- [ ] UX: avoid a dense card grid of identical controls. Prefer a clear role list with descriptions, current model summaries, and focused edit controls.

## Test Requirements

- [ ] Unit test: role taxonomy contains exactly Chat, Plan, Code, Explore, Research, Review, Design, Image with stable role IDs.
- [ ] Unit test: global role default persistence reads/writes provider/model/base URL/context window/capabilities for every role.
- [ ] Unit test: profile-scoped overrides shadow global defaults without mutating the global default.
- [ ] Unit test: missing or malformed role-default storage returns fallback defaults without throwing.
- [ ] Unit test: deleting a saved model referenced by a role produces a missing-model resolution state, not a crash.
- [ ] Unit test: text task roles fall back through the expected chain without changing Chat or Code unexpectedly.
- [ ] Unit test: Chat falls back to the legacy profile model config when no role default or override exists.
- [ ] Unit test: Image role recognizes Codex-native image generation support and does not silently fall back to a text role.
- [ ] Unit test: Codex app-server `inputModalities` metadata is not treated as proof of built-in `image_gen` availability.
- [ ] Integration test: IPC/preload exposes get/set role default APIs with typed results.
- [ ] Integration test: SSH connection mode can list models and read/write role defaults using remote storage.
- [ ] Renderer test: Models is no longer rendered as a main sidebar nav item.
- [ ] Renderer test: Settings exposes a Models menu/entry point and opens the dedicated Models settings view.
- [ ] Renderer test: Models page renders all eight roles and their descriptions.
- [ ] Renderer test: changing a role selector calls the persistence API and updates the displayed current model.
- [ ] Renderer test: saved model add/edit/delete still works from the Models settings page.
- [ ] Renderer test: missing-model state is visible and recoverable.
- [ ] Renderer test: Image role settings explain whether Codex-native image generation is available, unavailable, or requires fallback.
- [ ] Image runtime test: image generation requests resolve through the Image role and produce a file/artifact reference via Codex built-in `image_gen`, without using the text chat SSE path or public API endpoints.
- [ ] Codex app-server integration test: an image generation request can be routed to the Codex-native `$imagegen` / built-in `image_gen` workflow and completed with generated image artifact metadata.
- [ ] Config/runtime test: when Codex OAuth is available, Image role resolution detects `image_gen.provider: openai-codex` and does not require `OPENAI_API_KEY`.
- [ ] Chat/runtime test: new chat default resolves through the Chat role.
- [ ] Chat/runtime test: choosing a model in the chat picker updates the active profile’s Chat override or displays a documented per-chat override, depending on final implementation choice.
- [ ] Runtime test: code/implementation paths resolve through Code rather than Chat.
- [ ] Regression test: existing `getModelConfig` / `setModelConfig` behavior remains compatible for callers not yet migrated to roles.

## Out of Scope

- Automatic model benchmarking or quality scoring.
- Automatic recommendations such as “best model for this role.”
- Provider-side text model discovery beyond the current saved model library.
- Redesigning provider API-key management.
- Redesigning agent profiles, permissions, skills, or memory.
- Building new web research, code exploration, review, or design agents as part of this spec.
- Full image editor UX, image history management, gallery/library features, or advanced asset workflows.
- New non-Codex image provider adapters unless they fit the same Image role/tool abstraction.
- Full locale translation quality pass beyond adding required keys/placeholders.
- Billing/cost controls per role.

## Technical Notes

- Relevant existing code:
  - `src/renderer/src/screens/Layout/Layout.tsx`: owns sidebar nav, view routing, lazy view mounting.
  - `src/renderer/src/screens/Settings/Settings.tsx`: current Settings screen and state aggregation.
  - `src/renderer/src/screens/Models/Models.tsx`: current saved model library UI.
  - `src/renderer/src/screens/Chat/hooks/useChatModelConfig.ts`: current chat model picker/config hook.
  - `src/main/models.ts`: local saved model library backed by `~/.hermes/models.json`.
  - `src/main/ipc/models.ts`: model IPC handlers.
  - `src/preload/api/models.ts` and `src/preload/index.d.ts`: renderer API surface.
  - `src/main/config.ts`: legacy profile model config reads/writes `provider`, `default`, and `base_url` from `config.yaml`.
  - `src/main/services/config-service.ts`: profile/SSH-aware model config service and runtime stale marking.
  - `src/main/ssh/runtime.ts`: remote `models.json` support.
- Suggested data model:
  - `ModelRoleId = "chat" | "plan" | "code" | "explore" | "research" | "review" | "design" | "image"`.
  - `ModelCapability = "text" | "image_input" | "codex_image_gen"`.
  - `SavedModel.capabilities?: ModelCapability[]` or an equivalent capability/modality field.
  - `ModelRoleDefault = { role: ModelRoleId; modelId?: string; provider?: string; model?: string; baseUrl?: string; contextWindow?: number; capabilities?: ModelCapability[]; imageMode?: "codex_builtin_image_gen" | "codex_imagegen_skill"; scope: "global" | "profile"; profile?: string; updatedAt: number }`.
  - Store role defaults separately from the model library so saved model CRUD remains simple.
- Suggested storage:
  - Local global defaults: `~/.hermes/model-roles.json`.
  - Local profile overrides: either `~/.hermes/profiles/<profile>/model-roles.json` or a profile-keyed `overrides` object in the global file. Prefer the option that best matches existing profile backup/import behavior.
  - SSH global defaults: `$HOME/.hermes/model-roles.json`, mirroring current `$HOME/.hermes/models.json` behavior.
  - SSH profile overrides: mirror the chosen local profile override shape on the remote host.
- Suggested API additions:
  - `listModelRoles(profile?)` returns role metadata plus resolved defaults and override/global source info.
  - `getModelRoleDefaults(profile?)` returns global defaults, active profile overrides, and resolved fallback info.
  - `setGlobalModelRoleDefault(role, modelId | model config)` persists a global role selection.
  - `setProfileModelRoleOverride(role, modelId | model config, profile)` persists a profile-specific override.
  - `clearProfileModelRoleOverride(role, profile)` returns that role to the global default.
  - `resolveModelForRole(role, profile?)` returns provider/model/baseUrl/contextWindow/capabilities/imageMode and fallback source for text roles, while Image resolves to a Codex-native image-generation capability state.
  - `generateImage(request, profile?)` uses the resolved Image role to launch or route a Codex `$imagegen` / built-in `image_gen` turn and returns generated image artifact metadata.
  - `editImage(request, profile?)` uses the resolved Image role to launch or route a Codex `$imagegen` / built-in `image_gen` edit flow and returns edited image artifact metadata.
  - If app-server dynamic tools are used as a wrapper, initialize with experimental API support, register a non-reserved image-generation tool, handle `item/tool/call`, and return image artifact content through `contentItems` with `inputImage` plus `success`.
- Migration/fallback strategy:
  - Do not mutate existing `config.yaml` on first read.
  - If no role-default file exists, synthesize Chat from `getModelConfig(profile)` for compatibility.
  - If the user changes the chat picker, write an active profile Chat override unless per-chat override semantics are implemented.
  - Code remains a distinct role and should be seeded from a sensible global coding default, not from ordinary chat changes.
  - Non-image text roles can fall back through Code or Chat depending on the role-specific fallback chain.
  - Existing `setModelConfig` should either continue writing legacy config while updating Chat, or delegate to Chat while maintaining legacy config for compatibility.
- UI structure suggestion:
  - Settings screen gets a “Models” entry point near Provider/API settings.
  - Dedicated Models settings view has a header, role-default list, and a secondary “Model library” area for add/edit/delete.
  - The role list should visually distinguish global defaults from profile overrides and offer “Use global default” for overridden roles.
  - Image role UI should not present ordinary text models as image generators. It should show Codex-native image generation availability and any fallback state instead of a generic text model dropdown.
  - Each role row should include an action like “Change model” rather than opening a modal as the first thought for every interaction.
- Codex-native image generation integration notes:
  - Do not implement Mercury image generation by calling public OpenAI Images or Responses API endpoints directly.
  - Codex’s intended image path is the built-in `image_gen` tool, normally driven through the `$imagegen` skill/workflow.
  - OpenAI’s Codex use-case docs describe “ImageGen” as a Codex skill/plugin for generating visual concepts, UI mockups, asset directions, and variants with `gpt-image-2` before Codex implements the selected direction.
  - The upstream Codex `imagegen` skill states that the default preferred mode is built-in `image_gen`, does not require `OPENAI_API_KEY`, saves generated files under `$CODEX_HOME/generated_images/...`, and only falls back to a bundled CLI/API script after explicit user confirmation.
  - Built-in image generation should be treated as a Codex session/tool capability, not as a provider/model entry equivalent to OpenRouter/OpenAI chat models.
  - Mercury already has relevant local concepts: `image_gen` is a toolset key, trace hardening config can write `image_gen.provider: openai-codex`, Codex/Hermes OAuth can supply the `openai-codex` provider without an API key, and trace normalization already extracts image artifacts from `image_gen`/image tool progress paths.
  - Mercury should integrate by launching/routing a Codex image-generation turn or app-server capability that can invoke `$imagegen` / `image_gen`, then capture the produced artifact path from `$CODEX_HOME/generated_images/...`, Hermes image cache paths, or the Codex turn output and copy/move it into the project when needed.
  - Codex app-server dynamic tools are an available JSON-RPC wrapper pattern: with `experimentalApi` enabled, `dynamicTools` can trigger `item/tool/call`, and clients can return image content as `contentItems` with `inputImage`. Do not use a reserved namespace such as `image_gen` for custom dynamic tools.
  - The implementation must handle unavailable built-in image generation with a clear capability error. It must not silently fall back to API mode.
  - References checked: Codex idea-to-proof-of-concept use case (`https://developers.openai.com/codex/use-cases/idea-to-proof-of-concept`), upstream Codex `imagegen` skill (`https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md`), Codex app-server dynamic tool protocol (`https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md`), and Codex SDK docs (`https://developers.openai.com/codex/sdk`).
  - Local Mercury evidence checked: `scripts/trace-lab-hardening/hermes-home.mjs`, `scripts/trace-lab-hardening/credentials.mjs`, `src/main/hermes/trace-events.ts`, `tests/hermes-trace-events.test.ts`, and `docs/testing/contract-tests.md`.
- Design constraints:
  - Product UI, restrained theme, match current Mercury settings styles.
  - Avoid gradient text, decorative glassmorphism, and repetitive identical card grids.

## Open Questions

- [ ] How exactly can Mercury detect built-in Codex `image_gen` availability from the app-server/CLI session before showing the Image role as enabled: toolset config, skills list, app-server capabilities, or a lightweight probe?
- [ ] Should chat picker changes always create/update a profile Chat override, or should Mercury add explicit per-chat temporary overrides in the same release?
- [ ] What output should Mercury treat as the authoritative generated image artifact path: `$CODEX_HOME/generated_images/...`, Hermes cache path, `artifact.created`, or app-server `contentItems`?

## Acceptance Criteria

- Models no longer appears as a top-level sidebar item.
- Settings contains a Models menu/entry point that opens a dedicated Models settings page.
- The Models settings page displays Chat, Plan, Code, Explore, Research, Review, Design, and Image role defaults.
- Each role can be assigned a global saved-model default and may be overridden per profile.
- Existing saved model library functionality still works.
- Existing chat model selection still works and new chats resolve their default through the Chat role path.
- Code is independently configurable from Chat.
- Image role configuration uses Codex-native image generation availability, not a generic text-provider model dropdown.
- Codex image generation has a documented integration path through `$imagegen` / built-in `image_gen`, including artifact capture from `$CODEX_HOME/generated_images/...` or Codex turn output.
- Role resolution has safe fallback behavior and does not crash on missing/malformed storage.
- SSH mode supports the same global default/profile override behavior as local mode.
- Required TypeScript/preload IPC surfaces are typed.
- Tests listed in Test Requirements are implemented or intentionally deferred with reviewer approval.

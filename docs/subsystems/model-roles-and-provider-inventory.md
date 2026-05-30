# Agent model configuration and provider inventory

Mercury no longer has the legacy role-based model system. Each Hermes profile/agent has one direct model binding stored in that profile's `config.yaml`:

- `model.provider`
- `model.default`
- `model.base_url`

Runtime chat and title generation read that direct agent configuration through `src/main/services/config-service.ts#getModelConfigForProfile`. If provider or model is missing, Mercury fails before transport with guidance to configure the agent model.

Provider inventory is the source for model selection UI:

- Inventory service: `src/main/services/hermes-model-inventory-service.ts`
- Model service: `src/main/services/models-service.ts`
- Manual saved-model storage and mutation helpers: `src/main/models.ts`
- Renderer connected-provider filtering: `src/renderer/src/modelInventory.ts`
- IPC/preload model library methods: `listModels`, `addModel`, `removeModel`, `updateModel`
- Direct config methods: `getModelConfig`, `setModelConfig`

`listModels` now returns the Hermes model inventory for the current connection via `listModelsForConnection()`. The add/remove/update IPC methods still operate on the legacy/manual saved-model store for compatibility. `src/main/models.ts` normalizes manual entries with inferred context windows and normalized capability arrays, and deduplicates additions by `(provider, model)`.

## Connected provider inventory

The renderer filters inventory models to providers Mercury can actually use before it shows provider/model choices. `src/renderer/src/modelInventory.ts#getConnectedProviderIds` builds the connected provider set from:

- The LLM provider fields in `SETTINGS_SECTIONS[0]`.
- A non-empty profile env value for that provider's API key.
- At least one credential-pool entry for that provider id.
- `openai-codex` when `getCodexAuthStatus(profile).hasHermesAuth` is true.
- Optional explicit provider ids passed as `includeProviders`, used to keep the currently configured provider visible while editing an existing agent.

The env-key to provider-id mapping is:

| Env key | Provider id |
| --- | --- |
| `OPENROUTER_API_KEY` | `openrouter` |
| `OPENAI_API_KEY` | `openai` |
| `ANTHROPIC_API_KEY` | `anthropic` |
| `GROQ_API_KEY` | `groq` |
| `GLM_API_KEY` | `zai` |
| `KIMI_API_KEY` | `kimi` |
| `MINIMAX_API_KEY` | `minimax` |
| `MINIMAX_CN_API_KEY` | `minimax-cn` |
| `OPENCODE_ZEN_API_KEY` | `opencode-zen` |
| `OPENCODE_GO_API_KEY` | `opencode-go` |
| `HF_TOKEN` | `huggingface` |
| `DEEPSEEK_API_KEY` | `deepseek` |
| `TOGETHER_API_KEY` | `together` |
| `FIREWORKS_API_KEY` | `fireworks` |
| `CEREBRAS_API_KEY` | `cerebras` |
| `MISTRAL_API_KEY` | `mistral` |
| `PERPLEXITY_API_KEY` | `perplexity` |
| `CUSTOM_API_KEY` | `custom` |
| `GOOGLE_API_KEY` | `google` |
| `XAI_API_KEY` | `xai` |

`filterInventoryToConnectedProviders()` keeps only inventory entries whose `provider` is in that connected set, then deduplicates by `(provider, model)`.

## Model picker behavior

The chat header model picker in `src/renderer/src/screens/Chat/components/ModelPicker.tsx` is now a display-only button that opens agent model configuration. It no longer owns inventory loading or provider selection logic.

Agent model configuration lives in `src/renderer/src/components/AgentModelConfigModal.tsx`. When opened for a profile, the modal loads:

- `listModels()`
- `getEnv(profile)`
- `getCredentialPool()`
- `getCodexAuthStatus(profile)`

It filters the inventory to connected providers, passes the existing profile provider through `includeProviders`, and then adds the current `(provider, model)` as a synthetic inventory entry if it is missing. This preserves editability for older or manually configured agents while preventing disconnected providers from appearing as new choices. The provider dropdown is populated from the filtered inventory; the model dropdown is then limited to models for the selected provider. Saving calls `setModelConfig(provider, model, selected.baseUrl || "", profile)`.

New-agent creation in `src/renderer/src/screens/Agents/Agents.tsx` uses the same connected-provider filter, but it checks the `default` profile because new profiles clone config/API keys from `default`. The create form only offers providers and models present in that filtered default-profile inventory. After profile creation, Mercury writes the selected model config to the new profile with `setModelConfig`.

## Provider screen and Codex state

The Providers screen derives normal connected cards from the same env-key/provider-id mapping. A provider is connected there when its profile env key is non-empty or its credential pool has at least one entry. Providers without either remain available to configure, but are not treated as connected and are filtered out of model selection.

`openai-codex` is not keyed by an API-key env field. The Providers screen uses `useCodexAuthFlow()` and `getCodexAuthStatus(profile)` for its Codex card. Codex is connected only when `hasHermesAuth` is true, which means Hermes' auth store contains the `openai-codex` provider. A local Codex CLI login alone is reported as `hasCodexCliAuth`, but does not make the provider connected for Hermes or for model-picker filtering.

Completing Codex device auth writes Hermes Codex tokens, configures the selected profile to `provider: openai-codex`, `model: gpt-5.5`, and adds a manual saved-model entry named `Codex app server` for compatibility. Because `getConnectedProviderIds()` includes `openai-codex` from `hasHermesAuth`, Codex inventory models become selectable once Hermes auth is present.

The Models settings page, role assignment IPC channels, role files, and per-session selected-role persistence have been removed. Existing `model-roles.json` files are ignored as inert legacy data.

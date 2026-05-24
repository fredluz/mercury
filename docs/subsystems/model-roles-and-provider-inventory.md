# Agent model configuration and provider inventory

Mercury no longer has the legacy role-based model system. Each Hermes profile/agent has one direct model binding stored in that profile's `config.yaml`:

- `model.provider`
- `model.default`
- `model.base_url`

Runtime chat and title generation read that direct agent configuration through `src/main/services/config-service.ts#getModelConfigForProfile`. If provider or model is missing, Mercury fails before transport with guidance to configure the agent model.

Provider inventory remains available for model selection UI and manual model library compatibility:

- Inventory service: `src/main/services/hermes-model-inventory-service.ts`
- Model service and manual saved models: `src/main/services/models-service.ts`, `src/main/models.ts`
- IPC/preload model library methods: `listModels`, `addModel`, `removeModel`, `updateModel`
- Direct config methods: `getModelConfig`, `setModelConfig`

The Models settings page, role assignment IPC channels, role files, and per-session selected-role persistence have been removed. Existing `model-roles.json` files are ignored as inert legacy data.

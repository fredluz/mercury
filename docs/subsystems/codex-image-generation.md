# Codex Image Generation

This document is the canonical Mercury guide for Codex-backed image generation. It describes how `image_gen` is configured, how credentials are discovered, how generated image artifacts are traced, and what not to do.

## Source anchors

- Toolset registry: `src/main/tools.ts`
- SSH toolset registry: `src/main/ssh/config.ts`
- Tool UI labels: `src/shared/i18n/locales/*/tools.ts`
- Chat dispatch and trace callbacks: `src/main/ipc/chat.ts`, `src/main/hermes/gateway.ts`, `src/main/hermes/chat-api.ts`
- Trace normalization: `src/main/hermes/trace-events.ts`
- Trace schema: `src/shared/traces.ts`, [Trace schema contract](../contracts/trace-schema.md)
- Trace artifact tests: `tests/hermes-trace-events.test.ts`, `tests/trace-store.test.ts`
- Real-app harness config: `scripts/trace-lab-hardening/hermes-home.mjs`, `scripts/trace-lab-hardening/credentials.mjs`, `scripts/trace-lab-hardening/constants.mjs`, `scripts/trace-lab-hardening/scenarios.mjs`
- Contract test documentation: [Contract tests](../testing/contract-tests.md)
- Codex built-in image guidance: `${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/SKILL.md`
- Upstream references: [Codex ImageGen use case](https://developers.openai.com/codex/use-cases/idea-to-proof-of-concept), [openai/codex imagegen skill](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md), [Codex app-server protocol](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)

## Mental model

Mercury image generation is a **Codex/Hermes tool capability**, not a normal chat-model picker option and not a direct public OpenAI Images API integration.

The happy path is:

1. The selected profile has the `image_gen` toolset enabled.
2. The profile config has an `image_gen` provider, usually `openai-codex` for Codex-backed generation.
3. The user asks the agent to generate an actual image, not merely describe one.
4. Hermes/Codex invokes the image generation tool.
5. The tool returns a real image artifact path or URL.
6. Mercury records visible `tool.*` evidence and an `artifact.created` event with `artifactType: "image"`.

Do not treat `image_gen` as “pick an OpenRouter/OpenAI chat model that can make images.” The Image role in model settings should resolve to this Codex-native tool capability.

## Configuration

### Toolset enablement

`image_gen` is a first-class toolset key in `src/main/tools.ts` and `src/main/ssh/config.ts`.

It must be present under the active execution platform in profile `config.yaml`, for example:

```yaml
platform_toolsets:
  cli:
    - terminal
    - file
    - code_execution
    - image_gen
  api_server:
    - terminal
    - file
    - code_execution
    - image_gen
```

The Tools UI toggles toolsets by mutating the same profile configuration. If image generation is unavailable, first check whether `image_gen` is enabled for the platform being used by the active runtime.

### Codex provider binding

For Codex-backed runs, profile `config.yaml` should include:

```yaml
image_gen:
  provider: openai-codex
  model: gpt-image-2-medium
```

The model field is the image backend selection used by the image generation provider. It is separate from the chat model and should not be conflated with Chat, Code, Plan, or other text-role defaults.

The trace hardening harness writes this configuration when Codex image credentials are available. See `scripts/trace-lab-hardening/hermes-home.mjs`.

### Credentials

For Codex-backed image generation, prefer Codex/Hermes OAuth, not `OPENAI_API_KEY`:

- `hermes auth codex`
- existing `~/.hermes/auth.json` with an `openai-codex` provider
- existing `~/.codex/auth.json` ChatGPT/Codex login

The harness discovers those credentials in `scripts/trace-lab-hardening/credentials.mjs` and sets `imageGenProvider: "openai-codex"` when available.

`FAL_KEY` is optional for non-Codex backends only. It is not required for the `openai-codex` path.

## Codex built-in imagegen behavior

The installed Codex `$imagegen` skill is the best local reference for how Codex expects image generation to be used.

Key rules from `${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/SKILL.md`:

- Use the built-in `image_gen` tool by default for normal image generation and edits.
- Built-in mode does not require `OPENAI_API_KEY`.
- Generated images are saved under `$CODEX_HOME/generated_images/...` by default.
- If the image is project-bound, copy or move the selected final artifact into the workspace before finishing.
- Do not rely on a destination-path argument to the built-in tool. Generate first, then copy/move.
- Do not silently switch to CLI/API fallback. The fallback requires explicit user confirmation and usually requires `OPENAI_API_KEY`.
- Transparent-image requests should use built-in image generation with a chroma-key background first, then local background removal. True native transparency fallback is opt-in.

Mercury should mirror these rules in product behavior: built-in Codex path first, explicit failure if unavailable, no silent public-API fallback.

## Runtime flow

### Chat/API-server path

The renderer sends chat through `window.hermesAPI.sendMessage(...)`. Main IPC creates a trace run and dispatches through `src/main/hermes/gateway.ts`.

Current executable transports are:

- Local API server: `src/main/hermes/chat-api.ts` with a verified `api` runtime handle
- SSH API server: the same API transport with a verified `ssh-api` runtime handle

Local chat/title no longer use a Hermes CLI fallback transport; unverified or unavailable API runtimes fail explicitly before image generation can run.

Image generation should surface as tool activity inside those runs. The user prompt must require a real image tool result, for example:

```text
Use the image_generate tool to generate an actual tiny harmless abstract blue circle image. Do not merely describe the image. After the tool returns, include the image artifact path in your final answer.
```

The harness uses that pattern in `scripts/trace-lab-hardening/scenarios.mjs` so failures are explicit rather than silently passing with prose.

### Codex app-server dynamic tools

Codex app-server supports dynamic tools through JSON-RPC when experimental APIs are enabled. A client can register `dynamicTools`, receive `item/tool/call`, and return `contentItems` such as `inputImage` plus `success`.

Use this only as an app-server wrapper/integration pattern. The default Mercury image-generation behavior should remain the Codex-native `image_gen` / `$imagegen` path.

If Mercury registers custom dynamic tools, do not use reserved namespaces such as `image_gen`. Treat app-server `model/list` `inputModalities` as picker/input metadata only; it does not prove that output image generation is available.

## Trace and artifact contract

Image generation is only considered successful when Mercury records real artifact evidence.

Expected trace evidence:

- `tool.started`, `tool.progress`, `tool.completed`, or `tool.failed` for an image tool name such as `image_gen`, `image_generate`, or `generate_image`.
- `artifact.created` with metadata containing:
  - `artifactType: "image"`
  - either `path` or `url`
  - source metadata when available.

`src/main/hermes/trace-events.ts` extracts image artifacts from structured tool progress payloads and from text containing returned image paths. `tests/hermes-trace-events.test.ts` verifies extraction from Codex app-server image tool progress paths such as:

```text
/tmp/hermes/cache/images/openai_codex_gpt-image-2-low_20260514.png
```

Trace Lab and contract tests must not accept “I generated an image” prose as success. They must require image tool evidence and `artifact.created`.

## Verification

For focused trace/artifact behavior, run:

```bash
npm run test -- tests/hermes-trace-events.test.ts tests/trace-store.test.ts
```

For broader chat/IPC/preload behavior, run:

```bash
npm run test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts tests/chat-ipc-lifecycle.test.ts tests/chat-metadata.test.ts tests/hermes-title.test.ts
npm run typecheck
```

For real app-path image validation with credentials:

```bash
npm run build
npm run e2e:trace-lab-hardening
```

The real-app harness intentionally stops with a blocker if no usable credentials are available. Do not make fake traces to satisfy the image scenario.

`TRACE_LAB_E2E_SKIP_IMAGE=1` is allowed only for reduced local validation. Do not use it for release hardening or any change that claims to validate image generation.

## Troubleshooting

### The agent describes an image instead of generating one

Check that the prompt explicitly asks for an actual image tool result and an artifact path. Then verify:

- `image_gen` is enabled for the active platform toolset.
- `image_gen.provider: openai-codex` exists for Codex-backed runs.
- Codex/Hermes OAuth credentials are present.
- The active runtime is using the profile whose config you inspected.
- Trace output contains image `tool.*` evidence.

### Tool unavailable or provider unavailable

Expected behavior is a clear tool/provider failure, not a fallback to prose and not a silent public API fallback.

Check:

- `~/.hermes/auth.json` has `openai-codex`, or `~/.codex/auth.json` exists.
- The gateway/runtime has been restarted after config/tool changes when required.
- The selected profile has the same config used by the UI or CLI path.
- `image_gen` appears in `platform_toolsets` for the active platform.

### Generated image exists but Trace Lab does not show an artifact

Check:

- The tool returned a path or URL in a field recognized by `src/main/hermes/trace-events.ts`: `image`, `url`, `path`, `artifact`, `output`, `result.image`, `result.url`, or `result.path`.
- The normalized event type is `artifact.created`.
- Metadata has `artifactType: "image"` and either `path` or `url`.
- `tests/hermes-trace-events.test.ts` still covers the returned path shape.

### Project asset was left under `$CODEX_HOME`

This is only acceptable for preview/brainstorming. If the image is referenced by the project, move or copy it into the workspace and update consuming code/docs to point at the workspace path.

## Do not do these

- Do not implement the normal Codex image path by calling public OpenAI Images or Responses API endpoints directly.
- Do not require `OPENAI_API_KEY` for the built-in Codex path.
- Do not treat `model/list` `inputModalities` as proof of output image generation support.
- Do not accept a text-only answer as image generation success.
- Do not leave project-bound assets only under `$CODEX_HOME/generated_images/...`.
- Do not silently fall back to CLI/API image generation.
- Do not describe the tool as “DALL-E” in new docs; use Codex `image_gen` / `$imagegen` language.

## Related docs

- [Chat and tracing](chat-and-tracing.md)
- [Trace schema contract](../contracts/trace-schema.md)
- [Contract tests](../testing/contract-tests.md)
- [Skills subsystem](skills.md)

# Memory

This document explains how Mercury and Hermes memory work today, how profile isolation is enforced, how agents add new memories, and how to verify that a runtime is using the selected profile's memory.

## Source anchors

Mercury source:

- Local memory file helpers: `src/main/memory.ts`
- Persona/SOUL file helpers: `src/main/soul.ts`
- Profile home resolution: `src/main/utils.ts`
- Knowledge IPC boundary: `src/main/ipc/knowledge.ts`
- Preload knowledge API: `src/preload/api/knowledge.ts`, `src/preload/index.d.ts`
- Renderer memory UI: `src/renderer/src/screens/Memory/Memory.tsx`
- Renderer slash commands: `src/renderer/src/screens/Chat/chatCommands.ts`
- Hermes runtime/profile selection: `src/main/hermes/runtime.ts`, `src/main/hermes/chat-cli.ts`, `src/main/hermes/chat-api.ts`, `src/main/hermes/gateway.ts`
- SSH memory helpers: `src/main/ssh/memory-soul.ts`

Hermes upstream runtime source, installed under the user's Hermes checkout:

- Profile override: `~/.hermes/hermes-agent/hermes_cli/main.py` (`_apply_profile_override()`)
- Agent memory setup/dispatch: `~/.hermes/hermes-agent/run_agent.py`
- Built-in memory tool: `~/.hermes/hermes-agent/tools/memory_tool.py`

## Mental model

Mercury presents Hermes profiles as **Agents** in the UI, but the storage and runtime identity boundary is still named `profile` in code.

Memory is therefore **profile-scoped**:

- `default` profile uses the base Hermes home.
- Named profiles use a profile-specific home under the base Hermes home.
- Mercury does not maintain a separate agent-memory database outside Hermes profile homes.

In local mode:

```text
default profile:
  <HERMES_HOME>/memories/MEMORY.md
  <HERMES_HOME>/memories/USER.md
  <HERMES_HOME>/SOUL.md

named profile:
  <HERMES_HOME>/profiles/<profile>/memories/MEMORY.md
  <HERMES_HOME>/profiles/<profile>/memories/USER.md
  <HERMES_HOME>/profiles/<profile>/SOUL.md
```

In SSH mode, the same shape is used remotely:

```text
default profile:
  ~/.hermes/memories/MEMORY.md
  ~/.hermes/memories/USER.md
  ~/.hermes/SOUL.md

named profile:
  ~/.hermes/profiles/<profile>/memories/MEMORY.md
  ~/.hermes/profiles/<profile>/memories/USER.md
  ~/.hermes/profiles/<profile>/SOUL.md
```

## Memory files

Hermes has two built-in memory files:

| File | Meaning | Mercury owner |
| --- | --- | --- |
| `MEMORY.md` | Agent's durable personal notes: environment facts, project conventions, tool quirks, lessons learned. | `src/main/memory.ts` |
| `USER.md` | Durable user profile: preferences, communication style, expectations, workflow habits. | `src/main/memory.ts` |

Mercury's local memory helper behavior:

- `readMemory(profile)` reads `MEMORY.md`, `USER.md`, and session/message stats from the profile's `state.db`.
- `addMemoryEntry(content, profile)` appends a trimmed entry to `MEMORY.md`.
- `updateMemoryEntry(index, content, profile)` replaces a parsed memory entry by index.
- `removeMemoryEntry(index, profile)` removes a parsed memory entry by index.
- `writeUserProfile(content, profile)` replaces `USER.md`.
- `MEMORY.md` entries are separated by the exact delimiter `\n§\n`.
- Mercury enforces a `2200` character limit for `MEMORY.md` and `1375` for `USER.md`.

Hermes' own memory tool uses the same built-in file concept, but it owns its own file locking, threat scanning, and tool-call response shape.

## How the Memory UI writes memories

The user-facing Memory screen writes through Mercury IPC:

```text
Memory.tsx
  -> window.hermesAPI.addMemoryEntry(content, profile)
  -> preload knowledge API
  -> ipc/knowledge.ts "add-memory-entry"
  -> local addMemoryEntry(content, profile) or SSH sshAddMemoryEntry(..., profile)
  -> <profileHome>/memories/MEMORY.md
```

Successful memory, user profile, SOUL, tool, or skill mutations call `markRuntimeStale(profile, ...)`. This prevents Mercury from silently trusting an already-verified API runtime after profile context changed.

## How agents add memories themselves

Agents do **not** add memories through Mercury's `addMemoryEntry()` IPC handler.

Autonomous agent memory writes happen inside Hermes:

1. Mercury launches or resolves a Hermes runtime for a selected profile.
2. For CLI execution, named profiles are launched as:

   ```text
   hermes -p <profile> chat ...
   ```

   or, for a headless one-shot test:

   ```text
   hermes -p <profile> -t memory -z "..."
   ```

3. Hermes' `_apply_profile_override()` pre-parses `-p` / `--profile` before most modules import and sets `HERMES_HOME` to the selected profile home.
4. Hermes constructs an agent. If memory is enabled, it creates a `MemoryStore` from `tools.memory_tool`.
5. The agent can call the `memory` tool.
6. The memory tool writes to:

   ```text
   get_hermes_home()/memories/MEMORY.md
   get_hermes_home()/memories/USER.md
   ```

Because `get_hermes_home()` resolves from the profile-adjusted `HERMES_HOME`, an agent launched with `hermes -p alpha ...` writes built-in memories under `profiles/alpha`, not the default profile.

## Runtime memory snapshot behavior

Hermes built-in memory is loaded into the agent context as a snapshot at session start.

Important consequence:

- A mid-session memory tool write is durable immediately on disk.
- The same session's system-prompt memory snapshot is not rewritten mid-session.
- New sessions see the updated memory.
- Tool responses can show live state after a write even though the system prompt snapshot remains stable for the current session.

This behavior preserves prompt-prefix caching and avoids changing the system prompt during a run.

## External memory providers

Hermes can also use an external memory provider configured under `memory.provider` in the selected profile's `config.yaml`.

Mercury exposes provider discovery/configuration in the Memory screen, but actual provider reads/writes are performed by Hermes at runtime.

For isolation, external providers must scope their operations by the selected Hermes profile/session/user identity. Hermes passes provider initialization metadata such as `hermes_home`, session id, platform, and agent context. Provider-specific isolation should be verified separately if changing provider integration.

## What has been verified

### Mercury runtime tests

The following Mercury tests passed during the memory isolation review:

```bash
npm test -- tests/hermes-runtime.test.ts tests/hermes-title.test.ts tests/ssh-remote.test.ts tests/reliable-profile-runtime-contract.test.ts
```

Observed result:

```text
Test Files  4 passed (4)
Tests       33 passed (33)
```

These tests prove Mercury constructs profile-aware runtime handles, CLI commands, diagnostics, and SSH verification paths. They do not by themselves prove Hermes' own memory tool writes to the selected profile.

### Hermes built-in memory reset smoke test

A temp-home smoke test created default, alpha, and beta memory canaries, then ran:

```bash
HERMES_HOME="$TMP_HOME" hermes -p "$P1" memory reset --target memory --yes
```

Observed result:

```text
memories/MEMORY.md=DEFAULT_SECRET_CANARY
profiles/<alpha>/memories/MEMORY.md=<missing>
profiles/<beta>/memories/MEMORY.md=B_SECRET_CANARY
```

Conclusion: `hermes -p <profile> memory reset` touched only the selected profile's built-in memory.

### Direct Hermes memory tool probe

A direct Python probe used Hermes' installed virtualenv, set `HERMES_HOME` to a temp profile home, constructed `MemoryStore`, and called:

```python
memory_tool(action="add", target="memory", content="A_TOOL_WRITE_CANARY", store=store)
```

Observed result: the canary appeared only in that profile's `memories/MEMORY.md`.

Conclusion: Hermes' built-in memory tool writes to the current `HERMES_HOME` only.

### Real model call

A real headless Hermes model call was run against a temp profile with seeded provider/model/auth config:

```bash
HERMES_HOME="$TMP_HOME" hermes -p "$P1" -t memory -z "$PROMPT"
```

The prompt instructed the model to use the memory tool to save a unique canary and then reply `DONE`.

Observed result:

```text
DONE
Hermes exit status: 0

memories/MEMORY.md=DEFAULT_DO_NOT_TOUCH
profiles/<alpha>/memories/MEMORY.md=REAL_MODEL_MEMORY_CANARY_33103_1778963454
profiles/<beta>/memories/MEMORY.md=BETA_DO_NOT_TOUCH
```

Conclusion: for actual `hermes -p <profile>` CLI model execution, autonomous memory-tool writes go only to the selected profile's built-in memory.

## Verification recipe

Use this recipe when changing profile runtime launch, memory tooling, or context loading.

1. Create a temporary Hermes home.
2. Create two temporary profiles.
3. Seed default and beta with canary memories.
4. Copy provider/model/auth config into only the selected temp profile if an actual model call is needed.
5. Run a headless profile-scoped Hermes call that must use the memory tool.
6. Assert the canary appears only in the selected profile's `MEMORY.md`.

Example skeleton:

```bash
TMP_HOME="$(mktemp -d -t mercury-hermes-memory-proof)"
P1="probe_alpha_$$"
P2="probe_beta_$$"
CANARY="REAL_MODEL_MEMORY_CANARY_${$}_$(date +%s)"

HERMES_HOME="$TMP_HOME" hermes profile create "$P1"
HERMES_HOME="$TMP_HOME" hermes profile create "$P2"

mkdir -p "$TMP_HOME/memories" "$TMP_HOME/profiles/$P2/memories"
printf 'DEFAULT_DO_NOT_TOUCH\n' > "$TMP_HOME/memories/MEMORY.md"
printf 'BETA_DO_NOT_TOUCH\n' > "$TMP_HOME/profiles/$P2/memories/MEMORY.md"

# Seed the selected temp profile with local model/provider config without printing secrets.
for name in config.yaml .env auth.json models.json; do
  if [ -f "$HOME/.hermes/$name" ]; then
    cp "$HOME/.hermes/$name" "$TMP_HOME/profiles/$P1/$name"
  fi
done

PROMPT="Use the memory tool to add this exact memory entry to your agent memory: $CANARY . Do not write to the user profile. After the memory tool succeeds, reply with only DONE."
HERMES_HOME="$TMP_HOME" hermes -p "$P1" -t memory -z "$PROMPT"

grep -q "$CANARY" "$TMP_HOME/profiles/$P1/memories/MEMORY.md"
! grep -q "$CANARY" "$TMP_HOME/memories/MEMORY.md"
! grep -q "$CANARY" "$TMP_HOME/profiles/$P2/memories/MEMORY.md"
```

Clean up generated profile aliases after tests if profile creation created wrappers in `~/.local/bin`:

```bash
rm -f "$HOME/.local/bin/$P1" "$HOME/.local/bin/$P2"
rm -rf "$TMP_HOME"
```

## Current caveats and risks

- **Profile identity remains optional in many Mercury APIs.** Omitted or `default` profile maps to the shared base `HERMES_HOME`.
- **Mercury relies on verified runtime identity for API/gateway paths.** `hermes -p <profile>` memory behavior is proven, but Mercury must still ensure the runtime it talks to is actually the requested profile.
- **Pure remote HTTP mode is different.** If a remote API has no profile selector or identity proof, Mercury cannot prove that the selected local profile corresponds to the remote runtime's memory.
- **Knowledge IPC should fail closed in remote-only contexts.** UI gates filesystem-backed screens in remote mode, but non-UI callers and slash commands should not accidentally read or mutate local memory while chatting with a remote runtime.
- **Profile names should be validated before path construction.** Current path construction relies on callers passing safe profile names; filesystem and SSH helpers should reject path separators, `..`, NULs, and other unsafe profile names centrally.
- **External memory providers need provider-specific isolation checks.** Built-in `MEMORY.md` behavior is verified. Provider backends can have their own namespace/session/user semantics.

## Related docs

- [Storage and profiles](subsystems/storage-and-profiles.md)
- [Connection modes](subsystems/connection-modes.md)
- [Chat and tracing](subsystems/chat-and-tracing.md)
- [IPC and preload contract](contracts/ipc-preload.md)
- Historical context: [Profile Tools, Skills, and Memory Isolation](investigations/profile-tools-skills-memory-isolation-2026-05-16.md)

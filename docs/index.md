# Mercury Documentation Index

This index is the stable entrypoint for Mercury documentation. It separates evergreen reference material, which should track current source behavior, from historical evidence, which preserves investigations, audits, reports, and plans from a specific point in time.

## Evergreen reference

Use evergreen docs first when you need to understand or change Mercury. These pages should be kept current with source changes and should name the source files and tests that anchor the documented behavior.

### Architecture

- [Architecture overview](architecture/overview.md) — Electron main/preload/renderer, Node CLI adapter, shared service boundaries, app startup/shutdown, subsystem ownership, and brand asset generation flow.
- [Brand source](../brand/README.md) — canonical Mercury logo source and `npm run brand:generate` / `npm run brand:check` instructions for generated app and docs icons.

### Contracts

- [IPC and preload contract](contracts/ipc-preload.md) — `window.hermesAPI`, preload fragments, IPC handlers, event channels, and change rules.
- [CLI contract and command reference](contracts/cli.md) — Node `mercury` entrypoint, command taxonomy, global flags, JSON/NDJSON output envelopes, exit codes, connection-mode behavior, and parity with `window.hermesAPI`.
- [Trace schema](contracts/trace-schema.md) — trace events, run lifecycle, trace storage, and skill-training derivation.

### Subsystems

- [Connection modes](subsystems/connection-modes.md) — local, remote HTTP, SSH, gateway, tunnel, and capability-gating behavior.
- [Chat and tracing](subsystems/chat-and-tracing.md) — renderer chat flow, streaming events, Hermes dispatch, abort/completion handling, and trace persistence.
- [Storage and profiles](subsystems/storage-and-profiles.md) — `HERMES_HOME`, profile scoping, persistent files, sessions, memory, soul, models, and backups/imports.
- [Memory](memory.md) — built-in and provider memory behavior, profile isolation, autonomous agent memory writes, and verification recipes.
- [Skills](subsystems/skills.md) — skill listing, content, install/uninstall, Markdown import, local/SSH/remote behavior, and restart warnings.

### Testing

- [Contract tests](testing/contract-tests.md) — IPC/preload parity, CLI contract/parity, preload API surface, trace-store, skill import, session-cache sync, and docs guard tests.
- [Performance benchmarks](testing/performance-benchmarks.md) — local opt-in perf scripts, telemetry flags, artifact paths, and measured-evidence rules.

## Historical evidence

Historical evidence can explain why decisions were made or what was observed during a dated investigation. Treat these files as context, not as the primary source of current behavior. Verify current behavior against evergreen docs and source before making changes.

### Investigations

- [Docs depth parity investigation](investigations/docs-depth-parity-2026-05-13.md)
- [Large-file split investigation](investigations/large-file-split-2026-05-13.md)

### Audits and E2E reports

- [Performance audit](performance-audit.md)
- [E2E flow sweep report](e2e-flow-sweep-report.md)
- [OpenCode Go DeepSeek E2E report](e2e-opencode-go-deepseek.md)
- [Trace Lab skill evolution report](labs-e2e/trace-lab-skill-evolution-report.md)
- [50-response UI sweep report](usage-sweep/50-response-ui-sweep-report.md)

### Visual and product direction

- [Hermes product spec](hermes-product-spec.md)
- [Trace Lab visual direction](trace-lab-visual-direction.md)

### Branch and task plans

- [Windows WinGet/Fedora RPM release design](superpowers/specs/2026-04-30-windows-winget-fedora-rpm-release-design.md)
- [Windows WinGet/Fedora RPM release plan](superpowers/plans/2026-04-30-windows-winget-fedora-rpm-release.md)

## How future agents should use these docs

1. Start with the [Architecture overview](architecture/overview.md).
2. Read the relevant contract or subsystem docs before changing IPC/preload, CLI commands, shared services, shared schemas, storage, connection modes, user-visible workflows, or contract tests.
3. Use historical evidence only for dated context and prior findings.
4. Verify behavior against source and run the checks listed by the relevant docs before submitting changes.

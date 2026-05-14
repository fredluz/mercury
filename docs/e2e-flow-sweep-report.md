# Mercury Flow Sweep E2E

Date: 2026-05-12T16:26:04.607Z

## Configuration

- Provider: OpenCode Go
- Model: deepseek-v4-flash
- Harness: Electron launched through Playwright against a temporary isolated `HERMES_HOME`.
- Credential source: local OpenCode auth copied into the temporary home at runtime only; no key is written to the repository.

## Results

- PASS: Boots into Chat with isolated configured Hermes home (/var/folders/yl/6991_2tx48j101frnnd3fl6m0000gn/T/hermes-desktop-flow-e2e-b4BRTF)
- PASS: Sidebar exposes all first-class desktop surfaces
- PASS: OpenCode Go DeepSeek model is active in Chat (deepseek-v4-flash)
- PASS: Chat sends a real model request and receives the expected reply
- PASS: Trace store contains a completed run on disk (bca058f8-4e3a-4349-89b2-9287f75fa425)
- PASS: Trace Lab lists the completed chat run with timeline and inspector
- PASS: Sessions renders and accepts search input
- PASS: Profiles can create a local agent profile
- PASS: Models renders searchable OpenCode Go DeepSeek entries
- PASS: Providers exposes OpenCode Go configuration
- PASS: Skills renders installed/browse surfaces
- PASS: Persona editor renders
- PASS: Memory supports adding a local memory entry
- PASS: Tools renders toolset cards
- PASS: Schedules opens and closes the create-task modal
- PASS: Gateway renders status and platform cards
- PASS: Office renders without blocking the rest of the app
- PASS: Settings renders and switches connection modes

## Artifacts

- Screenshot: [docs/assets/hermes-desktop-flow-sweep.png](assets/hermes-desktop-flow-sweep.png)
- Temporary Hermes home used for this run: `/var/folders/yl/6991_2tx48j101frnnd3fl6m0000gn/T/hermes-desktop-flow-e2e-b4BRTF`

## Notes

- This sweep exercises the real chat path, Trace Lab persistence, and the main desktop surfaces.
- Schedules, Gateway, Office, provider credential mutations, and external service actions are rendered or opened but not triggered when doing so would start long-running processes or call unrelated services.

# Investigation: Profile Manager Agent and Profile-First Mercury

## Summary
Investigation in progress. The goal is to determine how Mercury can become profile-first: launch into a dedicated profile manager agent, present recent/profile recommendations, and route the user into isolated profile runtimes for task-specific work.

## Symptoms
- Current Mercury has profile concepts, but the app opens into a normal active profile/chat flow (`New Chat`, `Agent: Default`) rather than a profile-selection or profile-manager experience.
- The desired launch experience includes a persistent/special "profile manager" agent that helps choose an existing profile or create a new one for the user's task.
- The UI should also expose a menu/list of recent profiles to quickly pick from.
- User-provided screenshots show Skills, Memory, Tools, Persona, Gateway, and related controls still exposed as global sidebar destinations. Desired design: once these are per-agent/profile, they should be accessed through the existing agent/profile menu button on each profile card, not through global sidebar items.
- Profiles grid already shows per-profile action buttons/icons on cards, suggesting a natural place to move profile-scoped Skills/Memory/Tools/Persona/Gateway controls.
- The earlier investigation found profile-backed storage is mostly isolated, but runtime gateway/API isolation is incomplete and must be solved for profile-first UX to be trustworthy.

## Background / Prior Research
- Prior report: `/Users/fredluz/Code/mercury/docs/investigations/profile-tools-skills-memory-isolation-2026-05-16.md`.
- Prior conclusion: local storage/UI for tools, skills, memory, and SOUL is mostly profile-scoped, but API/gateway runtime is not reliably profile-scoped. A profile-first UX depends on fixing runtime profile propagation.
- Upstream Hermes profile model: profiles are intended as separate state homes selected by `hermes -p <profile> <command>`, sticky active profile, or profile aliases. Each profile should have separate config, `.env`, skills, memory, sessions, SOUL, and gateway state.
- External upstream check found profile commands: `hermes profile list|use|create|delete|show|alias|rename|export|import|install|update|info`. Clone behavior is via `hermes profile create <name> --clone`, `--clone-all`, or `--clone-from <profile>`.
- Upstream sticky active profile is file-based (`~/.hermes/active_profile`), while aliases are generated wrappers like `~/.local/bin/<profile>` executing `hermes -p <profile> ...`.
- Upstream profile metadata is operational rather than recommendation-rich: model/provider, gateway state, env presence, skill count, alias path, distribution metadata. No built-in profile manager/recommender agent or per-profile description/last-used scoring was found.
- Upstream gateway constraints: per-profile gateway launch is supported via `hermes -p <profile> gateway ...` or aliases, but profiles cannot simultaneously use the same messaging bot token.
- Impeccable context loader found no `PRODUCT.md` or `DESIGN.md`; this report therefore avoids brand-specific visual styling and focuses on architecture, product flow, and implementation seams.

## Investigator Findings
<!-- Pair investigator appends structured analysis here: file:line refs, evidence, conclusions. -->

## Investigation Log

### Phase 1 - Initial Assessment
**Hypothesis:** Mercury already has enough profile CRUD/session/UI infrastructure to support a profile-first launcher, but needs a first-class launch mode, recent-profile ranking, a special profile manager agent/profile, and runtime profile isolation before routing to task profiles.
**Findings:** Prior investigation confirms profile runtime isolation is prerequisite work. User screenshots add a key UX requirement: global sidebar entries for Skills/Memory/Tools/Persona/Gateway should be removed or demoted once those become profile-specific, with profile card/agent-menu access replacing them. Need current-workspace investigation of launch flow, Layout activeProfile handling, Agents/Profile screens, Sessions recency data, chat routing, profile creation APIs, onboarding/Welcome/Setup surfaces, sidebar navigation, and docs.
**Evidence:** Prior report, upstream Hermes profile docs, and user-provided screenshots of Chat, Skills, Memory, and Profiles screens.
**Conclusion:** Proceed with context_builder, then pair investigation.

## Root Cause
Pending investigation.

## Recommendations
Pending investigation.

## Preventive Measures
Pending investigation.

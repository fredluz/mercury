# Projects Feature — State Machine

## Navigation States

```
                         ┌─────────────────────────────────────┐
                         │            APP SHELL                │
                         │                                     │
                         │  Sidebar: Chat | Sessions |         │
                         │  Projects | Providers | Settings    │
                         └──────────┬──────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
        ┌──────────┐         ┌────────────┐        ┌───────────┐
        │   CHAT   │         │  PROJECTS  │        │ (others)  │
        │          │         │    LIST    │        │           │
        └────┬─────┘         └─────┬──────┘        └───────────┘
             │                     │
             │                     ▼
             │              ┌─────────────┐
             │              │   PROJECT   │
             │              │   DETAIL    │◄────── scrollable page
             │              │             │        with sections
             │              │ ┌─────────┐ │
             │              │ │ Agents  │ │
             │              │ │ grid    │─┼──────────┐
             │              │ ├─────────┤ │          │
             │              │ │ Skills  │ │          ▼
             │              │ ├─────────┤ │   ┌─────────────┐
             │              │ │ Tools   │ │   │   AGENT     │
             │              │ ├─────────┤ │   │   DETAIL    │◄── scrollable
             │              │ │ Memory  │ │   │             │
             │              │ ├─────────┤ │   │ ┌─────────┐ │
             │              │ │ Gateway │ │   │ │ Skills  │ │
             │              │ ├─────────┤ │   │ ├─────────┤ │
             │              │ │Schedule │ │   │ │ Tools   │ │
             │              │ └─────────┘ │   │ ├─────────┤ │
             │              └─────────────┘   │ │ Soul    │ │
             │                                │ ├─────────┤ │
             │                                │ │ Memory  │ │
             │                                │ ├─────────┤ │
             │                                │ │ Model   │ │
             │                                │ └─────────┘ │
             │                                └──────┬──────┘
             │                                       │
             │              ┌────────────────────────┘
             │              │ "Chat with this agent"
             ▼              ▼
        ┌──────────────────────┐
        │     CHAT SCREEN      │
        │                      │
        │  ┌────────┐ ┌─────┐ │
        │  │  Chat  │ │     │ │
        │  │Sidebar │ │ MSG │ │
        │  │        │ │AREA │ │
        │  │chrono  │ │     │ │
        │  │by proj │ │     │ │
        │  │by agent│ │     │ │
        │  └────────┘ └─────┘ │
        │  [Project ▼][Agent▼]│ ◄── dropdowns in header/composer
        └──────────────────────┘
```

## Chat Session State Machine

```
         ┌──────────┐
         │ NEW CHAT │
         └────┬─────┘
              │ defaults to Mercury Agent (no project)
              ▼
     ┌─────────────────┐    user selects      ┌──────────────────┐
     │ MERCURY AGENT   │───────────────────►  │  PROJECT+AGENT   │
     │ (no project)    │    project+agent      │    SELECTED      │
     └────────┬────────┘    from dropdown      └────────┬─────────┘
              │                                         │
              │ user sends message                      │ user sends message
              ▼                                         ▼
     ┌─────────────────┐                       ┌──────────────────┐
     │    STREAMING     │                       │    STREAMING     │
     │                  │                       │                  │
     │ mercury skills   │                       │ effective config:│
     │ no project ctx   │                       │ agent skills     │
     │                  │                       │ + project skills │
     │                  │                       │ - overrides      │
     │                  │                       │ + project memory │
     │                  │                       │ cwd = project dir│
     └────────┬─────────┘                       └────────┬─────────┘
              │                                          │
              │ response complete                        │ response complete
              ▼                                          ▼
     ┌─────────────────┐                       ┌──────────────────┐
     │      IDLE        │                       │      IDLE        │
     │                  │                       │                  │
     │ awaiting input   │                       │ awaiting input   │
     │ can switch agent │                       │ can switch agent │
     │ can switch proj  │                       │ can switch proj  │
     └─────────────────┘                       └──────────────────┘
```

## Project Lifecycle

```
     ┌──────────┐    user creates     ┌──────────────┐
     │  (none)  │────────────────────►│   CREATED     │
     └──────────┘                     │               │
                                      │ name          │
                                      │ working dir   │
                                      └───────┬───────┘
                                              │
                          ┌───────────────────┬┴──────────────────┐
                          ▼                   ▼                   ▼
                   ┌────────────┐     ┌─────────────┐    ┌──────────────┐
                   │ ADD SKILLS │     │  ADD AGENTS  │    │ CONFIGURE    │
                   │ & TOOLS    │     │              │    │ GATEWAY      │
                   │ (defaults) │     │ create new   │    │              │
                   └────────────┘     │ or assign    │    │ per-platform │
                                      │ existing     │    │ credentials  │
                                      └──────────────┘    └──────────────┘
                                              │
                                              ▼
                                      ┌──────────────┐
                                      │    ACTIVE     │
                                      │               │
                                      │ agents run    │
                                      │ gateway live  │
                                      │ sessions      │
                                      │ accumulate    │
                                      └──────────────┘
```

## Agent-in-Project Lifecycle

```
     ┌──────────────────┐
     │ AGENT EXISTS     │  (free-floating or in other projects)
     │ (Hermes profile) │
     └────────┬─────────┘
              │ assigned to project
              ▼
     ┌──────────────────┐
     │ MEMBER           │
     │                  │
     │ inherits project │
     │ skills & tools   │
     │ receives project │
     │ memory           │
     └────────┬─────────┘
              │ user customizes for this project
              ▼
     ┌──────────────────┐
     │ MEMBER +         │
     │ OVERRIDES        │
     │                  │
     │ per-item adds    │
     │ per-item removes │
     │ scoped to this   │
     │ project only     │
     └────────┬─────────┘
              │ removed from project
              ▼
     ┌──────────────────┐
     │ AGENT EXISTS     │  (overrides for this project discarded)
     │ (unchanged)      │
     └──────────────────┘
```

## Config Composition (at chat launch)

```
     ┌─────────────┐     ┌──────────────┐
     │   AGENT     │     │   PROJECT    │
     │             │     │              │
     │ skills: [A] │     │ skills: [X]  │
     │ tools:  [B] │     │ tools:  [Y]  │
     │ soul        │     │ memory       │
     │ memory      │     │ working dir  │
     │ USER.md     │     │              │
     └──────┬──────┘     └──────┬───────┘
            │                   │
            │   ┌───────────┐   │
            └──►│  MERCURY  │◄──┘
                │ COMPOSER  │
                │           │
                │ overrides:│
                │  +adds    │
                │  -removes │
                └─────┬─────┘
                      │
                      ▼
              ┌───────────────┐
              │ EFFECTIVE     │
              │ CONFIG        │
              │               │
              │ skills: A+X-R │
              │ tools:  B+Y-R │
              │ soul: agent   │
              │ memory: proj  │
              │  + agent      │
              │  + USER.md    │
              │ cwd: project  │
              └───────────────┘
```

## Chat Sidebar State

```
     ┌─────────────────────────┐
     │     CHAT SIDEBAR        │
     │                         │
     │  Grouping toggle:       │
     │  [Chronological]        │
     │  [By Project]           │
     │  [By Agent]             │
     │                         │
     │  Shows ALL sessions     │
     │  across ALL projects    │
     │  and free-floating      │
     │  agents                 │
     │                         │
     │  ● = actively streaming │
     │                         │
     │  Click any session to   │
     │  switch to it (loads    │
     │  the right project +    │
     │  agent context)         │
     └─────────────────────────┘
```

## Gateway State Machine (per project)

```
     ┌────────────────┐
     │ NOT CONFIGURED │
     └───────┬────────┘
             │ user enables platform + enters credentials
             ▼
     ┌────────────────┐
     │   CONFIGURED   │
     │   (stopped)    │
     └───────┬────────┘
             │ start
             ▼
     ┌────────────────┐     agent selection    ┌─────────────────┐
     │    RUNNING     │◄───────────────────────│ PLATFORM USER   │
     │                │     via inline buttons │ (e.g. Telegram) │
     │ routing msgs   │───────────────────────►│                 │
     │ to selected    │     responses from     │ picks agent     │
     │ agent          │     active agent       │ within project  │
     └───────┬────────┘                        └─────────────────┘
             │ stop
             ▼
     ┌────────────────┐
     │   CONFIGURED   │
     │   (stopped)    │
     └────────────────┘
```

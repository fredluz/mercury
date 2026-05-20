# Idea: Workspace-Based Sidebar

Captured: Tuesday, May 19 2026
Status: Parked (potentially overscoped for current Mercury goals)

## Core Concept

Replace the flat nav sidebar (Chat, Sessions, Agents, Models, etc.) with a **workspace-oriented** sidebar. Each workspace is a topic/project/directory context that groups conversations and agents together.

## Key Design Points

**Sidebar becomes a workspace list:**
- Each entry is a workspace (e.g., "Mercury Sidebar Refactor", "MACX Exocortex", "Tax Docs")
- Names auto-generated from first interaction, like ChatGPT conversation titles but at workspace level
- Toggle button to switch between workspace list and the current flat nav menu
- Global sessions still accessible from the flat nav view

**Workspace sidebar (when inside a workspace):**
- Shows agents currently running in that workspace
- Workspace name/icon at top — clickable to switch workspaces
- Button for previous workspace sessions/history
- Agents can be added/removed dynamically

**Main area = split view:**
- Multiple agents run side-by-side in split panes (like terminal splits)
- Adding a new agent splits the area for another terminal-style pane
- When an agent spawns a sub-agent, it also splits into the view

**Persistence:**
- Workspaces persist across sessions (reopen Mercury, your workspaces are there)

## Why It Was Parked

Mercury is a frontend for Hermes. This idea introduces workspace management, multi-agent orchestration UI, and split-pane layout — which is a significant UX layer on top of the current architecture. Worth revisiting when Mercury's core is more stable or when multi-agent workflows become the primary use case.

## Technical Notes (from codebase analysis)

Current architecture that would need to change:
- `Layout.tsx` manages a single `View` state and single chat session
- State is lifted (no store) — would need a workspace store (zustand or similar)
- Single `Chat` component with one message stream — would need per-pane chat instances
- Sessions are profile-scoped in SQLite — would need workspace-scoped grouping
- `NAV_ITEMS` array defines the flat sidebar — would become dynamic workspace list

# Design Handoff: Daily Strip

The daily strip is a vertical sidebar on the left side of the Schedules page. It shows agents that recur every single day, ordered chronologically. This is the user's "daily rhythm."

## Dimensions

- **Width**: 200px, fixed
- **Padding**: 16px 12px
- **Background**: `var(--bg-secondary)` at 50% mix with `var(--bg-primary)` — use `color-mix(in srgb, var(--bg-secondary) 50%, var(--bg-primary))`
- **Border-right**: 1px solid `var(--border)`
- **Overflow-y**: auto with custom scrollbar (`.scrollbar` styles)
- **Height**: fills from below the header bar to the bottom of the window

## Section Header

- **Text**: "DAILY"
- **Font**: 11px, weight 600, `var(--text-muted)`, uppercase
- **Letter-spacing**: 0.8px
- **Margin-bottom**: 12px

## Now Indicator

A horizontal line showing the current time, positioned vertically based on the current hour relative to the list.

- **Line**: full width of the strip, 1px height, `var(--accent)` color
- **Label**: "Now" — 9px, weight 600, `var(--accent-text)`, positioned left-aligned on the line
- **Dot**: 6px circle, `var(--accent)`, solid fill, positioned at the left end of the line
- **Updates**: every 60 seconds (re-positions between schedule entries)
- **Behavior**: if current time is before all daily schedules, sits at the top. If after all, sits at the bottom. Otherwise, positioned between the last-passed and next-upcoming entries.

## Schedule Entry (Daily Card)

Each daily-recurring agent is a compact horizontal card.

### Layout

```
┌─────────────────────────────────┐
│  09:00   Morning Briefing    ◉  │
│          Summarize inbox     ⏻  │
└─────────────────────────────────┘
```

- **Height**: 52px
- **Padding**: 8px 10px
- **Background**: `var(--bg-primary)`
- **Border**: 1px solid `var(--border)`
- **Border-radius**: `var(--radius-md)` (10px)
- **Margin-bottom**: 6px
- **Cursor**: pointer
- **Layout**: CSS grid — `grid-template-columns: auto 1fr auto; grid-template-rows: auto auto`

### Content

#### Time (top-left)
- **Font**: 14px, weight 700, `var(--text-primary)`
- **Format**: HH:MM (24h) or h:MM AM/PM (locale-dependent)
- **Grid**: column 1, row 1

#### Agent Name (top-center)
- **Font**: 13px, weight 600, `var(--text-primary)`
- **Overflow**: ellipsis if wider than available space
- **Grid**: column 2, row 1
- **Margin-left**: 8px

#### Description (bottom-center)
- **Font**: 11px, weight 400, `var(--text-muted)`
- **Single line**: ellipsis overflow
- **Grid**: column 2, row 2
- **Margin-left**: 8px

#### Status Dot (top-right)
- **Size**: 8px circle
- **Grid**: column 3, row 1, align-self center
- **Colors**:
  - Active, next upcoming: `var(--accent)` (solid)
  - Active, already ran today successfully: `var(--success)`
  - Active, ran today with failure: `var(--error)`
  - Active, not yet run today: `var(--text-muted)` at 40% opacity
  - Currently running: `var(--accent)` with pulse animation (see animations doc)

#### Toggle Switch (bottom-right)
- **Size**: 34px x 18px
- **Grid**: column 3, row 2, align-self center
- **On state**: `var(--accent)` background, white thumb (right-aligned)
- **Off state**: `var(--bg-tertiary)` background, `var(--text-muted)` thumb (left-aligned)
- **Thumb**: 14px circle, 2px inset from edges
- **Transition**: 200ms ease — thumb position and background color
- **Click**: fires pause (if on) or resume (if off) IPC call. Does NOT expand the card.
- **Stop propagation**: clicking the toggle must not trigger card expand.

### States

#### Default
- As described above

#### Hover
- **Border**: `var(--border-bright)`
- **Background**: `var(--bg-secondary)`
- **Transition**: 150ms

#### Next Upcoming (the very next daily run)
- **Border-left**: 2px solid `var(--accent)` (replaces the 1px left border)
- **Background**: `var(--accent-subtle)` — very subtle accent tint

#### Past (ran earlier today)
- **Opacity**: 0.6 on the entire card
- **Status dot**: shows success (green) or failure (red)

#### Expanded
See card expansion spec in `04-schedule-card.md`. The card expands inline within the daily strip, pushing cards below it down.

## Empty State (no daily schedules)

If the user has no daily-recurring schedules:

- **Strip still visible** (it's a permanent layout element)
- **Content**: centered vertically
  - Icon: Repeat from lucide, 24px, `var(--text-muted)` at 30%
  - Text: "No daily agents" — 12px, `var(--text-muted)`
  - Subtext: "Daily schedules appear here" — 11px, `var(--text-muted)` at 70%

## Overflow (many daily agents)

If there are more daily agents than fit in the visible height:

- Vertical scroll with custom scrollbar (same as app-wide scrollbar styling)
- The "Now" indicator scrolls with the list
- No sticky elements within the strip

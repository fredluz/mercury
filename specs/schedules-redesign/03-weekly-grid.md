# Design Handoff: Weekly Grid

The weekly grid is the default main view. Seven day-columns showing all non-daily schedules placed in their respective days. This is the operational "what's happening this week" view.

## Layout

```
┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐
│ Mon  │ Tue  │ Wed  │ Thu  │ Fri  │ Sat  │ Sun  │
│  19  │  20  │  21  │  22  │  23  │  24  │  25  │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│      │      │      │      │      │      │      │
│ card │ card │      │ card │      │      │ card │
│      │ card │      │      │      │      │      │
│      │      │      │ card │      │      │      │
│      │      │      │      │      │      │      │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┘
```

- **Display**: CSS grid, `grid-template-columns: repeat(7, 1fr)`
- **Gap**: 0 (columns separated by borders, not gaps)
- **Height**: fills available space (flex: 1), overflow-y auto on each column

## Column Header

Each of the 7 columns has a header showing the day name and date.

- **Height**: 40px
- **Padding**: 0 8px
- **Border-bottom**: 1px solid `var(--border)`
- **Border-right**: 1px solid `var(--border)` (except last column)
- **Background**: transparent
- **Layout**: flex, `align-items: center`, `justify-content: center`, `flex-direction: column`

### Day Name
- **Font**: 11px, weight 600, uppercase, `var(--text-muted)`
- **Letter-spacing**: 0.5px
- **Text**: "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"

### Date Number
- **Font**: 14px, weight 700, `var(--text-primary)`
- **Text**: day of month, e.g., "19", "20"

### Today Column Header
- **Date number**: displayed inside a circle
  - Circle: 28px, `var(--accent)` background, white text
  - Border-radius: 50%
  - Display: flex, align-items center, justify-content center
- **Day name**: `var(--accent-text)` instead of `var(--text-muted)`

### Past Day Header
- **Date number**: `var(--text-muted)` instead of `var(--text-primary)`
- **Day name**: `var(--text-muted)` at 60% opacity

## Column Body

Below each header, the column body holds schedule cards stacked vertically.

- **Padding**: 8px 6px
- **Border-right**: 1px solid `var(--border)` (except last column)
- **Overflow-y**: auto (each column scrolls independently)
- **Min-height**: 200px (prevents columns from collapsing when empty)
- **Gap**: 6px between cards

### Today Column Body
- **Background**: `var(--accent-subtle)` — very faint accent tint
  - Dark theme: `rgba(200, 153, 61, 0.04)`
  - Light theme: `rgba(196, 144, 53, 0.04)`

### Past Day Column Body
- **Opacity**: 0.5 on the entire column body

## Schedule Card (in grid — collapsed)

Cards inside the weekly grid are a COMPACT variant of the schedule card. They show less than the daily strip cards because space is constrained.

```
┌─────────────────────┐
│ 14:30               │
│ Invoice Agent       │
│ Bill client monthly │
└─────────────────────┘
```

- **Width**: 100% (fills column)
- **Padding**: 8px 8px
- **Background**: `var(--bg-primary)`
- **Border**: 1px solid `var(--border)`
- **Border-radius**: `var(--radius-sm)` (6px — smaller than daily strip)
- **Cursor**: pointer
- **Layout**: flex column

### Time
- **Font**: 13px, weight 700, `var(--text-primary)`
- **Margin-bottom**: 2px

### Agent Name
- **Font**: 12px, weight 600, `var(--text-primary)`
- **Single line**: ellipsis overflow

### Description
- **Font**: 11px, weight 400, `var(--text-muted)`
- **Single line**: ellipsis overflow
- **Margin-top**: 1px

### Status Indicator
- **Position**: absolute, top-right corner of the card, 6px inset
- **Size**: 6px circle
- **Colors**: same rules as daily strip status dot

### Schedule Type Badge (for one-shots and monthly)
Shown below the description to distinguish from weekly-recurring items.

- **Font**: 10px, weight 600, uppercase, letter-spacing 0.3px
- **Padding**: 2px 6px
- **Border-radius**: 4px
- **Margin-top**: 4px
- **Variants**:
  - One-shot: `var(--accent-text)` text, `var(--accent-subtle)` background, text "ONCE"
  - Monthly: `var(--text-muted)` text, `var(--bg-tertiary)` background, text "MONTHLY"
  - Weekly: no badge shown (it's the default in this view)

### Hover State
- **Border**: `var(--border-bright)`
- **Background**: `var(--bg-secondary)`
- **Transition**: 150ms

### Expanded State
When clicked, the card expands inline within its column. See `04-schedule-card.md` for the full expanded layout. The expanded card may overflow the column width — allow it to spill over neighboring columns with a z-index of 10 and a drop shadow.

- **Expanded width**: min(100%, 320px). If the column is narrower than 320px, the card expills rightward.
- **Box-shadow** (expanded): `0 8px 32px rgba(0, 0, 0, 0.18)` (dark) / `0 8px 32px rgba(0, 0, 0, 0.08)` (light)
- **Z-index**: 10

## Empty Column

When a day has no schedules:

- **Center vertically**: a single em-dash "—"
- **Font**: 14px, `var(--text-muted)` at 30%
- **No hover state**

## Week Navigation

The header bar does not include week navigation arrows. The grid always shows the current week (Monday through Sunday of the current week). Past days are dimmed.

Rationale: schedules are patterns, not one-off calendar events. The user cares about "what's my week look like" not "what happened 3 weeks ago." One-shot schedules in the past auto-complete and leave the grid.

## Overflow: Many Cards in One Day

If a day column has more than ~5-6 cards (overflowing visible height):

- The column body scrolls vertically (overflow-y auto)
- A subtle gradient fade at the bottom edge (16px, from transparent to column background) indicates more content below
- Scroll indicator: thin `var(--accent)` line at the bottom of the column, 2px, only visible when scrollable

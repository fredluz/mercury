# Design Handoff: Animations, Transitions & Edge Cases

Every animation in the Schedules redesign specified in one place. No animation should exceed 300ms. All use the Mercury design system's existing `var(--transition)` (150ms ease) as baseline.

## Easing Functions

| Name        | Value                          | Use For                        |
|-------------|--------------------------------|--------------------------------|
| standard    | cubic-bezier(0.4, 0, 0.2, 1)  | Most transitions               |
| decelerate  | cubic-bezier(0, 0, 0.2, 1)    | Elements entering the screen   |
| accelerate  | cubic-bezier(0.4, 0, 1, 1)    | Elements leaving the screen    |
| spring      | cubic-bezier(0.34, 1.56, 0.64, 1) | Toggle switches, bouncy pops |

## Card Expand / Collapse

The signature interaction of this page. Must feel snappy and physical.

### Expand
- **Duration**: 250ms
- **Easing**: standard
- **Properties animated**:
  - `max-height`: from collapsed height (52px daily / ~68px grid) to auto
    - Implementation: animate to a known max (500px) and use `overflow: hidden`, then switch to `max-height: none` after animation completes
  - `box-shadow`: from none to expanded shadow
- **Inner content** (sections 2–6 from card spec):
  - Fade in: 150ms, easing decelerate, **delayed 100ms** (waits for height to partially expand)
  - No transform — pure opacity fade
- **Sibling cards**: pushed down by the expanding height
  - Their movement is implicit (layout reflow), not explicitly animated
  - Add `transition: transform 200ms standard` on sibling cards to smooth the push

### Collapse
- **Duration**: 200ms (slightly faster than expand — feels more responsive)
- **Easing**: standard
- **Inner content**: fades out first, 100ms, accelerate
- **Height reduction**: starts after 50ms delay, 150ms, standard easing
- **Shadow**: fades out in sync with height, 150ms

### Only One Expanded
When card A is expanded and user clicks card B:
- Card A collapses (200ms)
- Card B expands (250ms, delayed 50ms from A's collapse start)
- Net effect: A starts closing, B starts opening almost immediately, overlapping

## Toggle Switch

- **Duration**: 200ms
- **Easing**: spring (for the thumb position), standard (for background color)
- **Properties**:
  - Thumb `transform: translateX()` — from 0 to (track-width - thumb-size - inset*2)
  - Background-color — from `var(--bg-tertiary)` to `var(--accent)` or vice versa
- **Thumb scale on press**: 1.0 → 1.1 while mousedown/touchstart, back to 1.0 on release

## View Toggle (Week ↔ Month)

- **Duration**: 200ms
- **Easing**: standard
- **Effect**: cross-fade
  - Outgoing view: opacity 1 → 0, 150ms
  - Incoming view: opacity 0 → 1, 150ms, delayed 50ms
- **Segmented control**: active indicator slides between positions
  - `transform: translateX()`, 200ms, spring easing

## Full-Screen Create/Edit Transitions

### Opening
1. Current schedules content: slides out left
   - `transform: translateX(0)` → `translateX(-40px)`
   - `opacity: 1` → `0`
   - Duration: 120ms, accelerate
2. Create view: slides in from right
   - `transform: translateX(40px)` → `translateX(0)`
   - `opacity: 0` → `1`
   - Duration: 180ms, decelerate, **delayed 60ms**
3. Header bar: cross-fade content (150ms, standard)

### Closing
- Reverse of opening: create slides out right, schedules slides in from left
- Same durations and easings reversed

## Page Load (Stagger Animation)

When the Schedules page first loads with data:

- **Column headers**: fade in simultaneously, 200ms, decelerate
- **Schedule cards**: stagger in
  - Each card: `opacity: 0 → 1`, `transform: translateY(8px) → translateY(0)`
  - Duration: 180ms per card, decelerate
  - Stagger delay: 30ms between cards
  - Order: top-to-bottom within each column, columns left-to-right
  - Max stagger: cap at 15 cards (450ms total), remaining cards appear instantly
- **Daily strip cards**: stagger independently (same spec, 30ms intervals)

## Clock Face Animations

### Number Selection
- **Selected number background**: scale from 0 to 1, 150ms, spring
- **Previously selected**: scale from 1 to 0, 100ms, standard
- **Clock hand rotation**: `transform: rotate()`, 150ms, standard

### Stage Transition (Hours → Minutes)
- **Hours ring**: fade out, 150ms, accelerate
- **Minutes ring**: fade in, 150ms, decelerate, delayed 100ms
- **Stage indicator**: active number color change, 150ms

## Day Detail Panel (Month Calendar)

### Opening
- Panel: `max-height: 0` → `max-height: 300px`, 200ms, decelerate
- Content: fade in, 150ms, delayed 100ms

### Closing
- Content: fade out, 100ms, accelerate
- Panel: `max-height: 300px` → `max-height: 0`, 150ms, standard, delayed 50ms

## Status Dot Pulse (Running Now)

For schedules currently executing:

```css
@keyframes statusPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.4); }
}
```
- **Duration**: 1.5s
- **Iteration**: infinite
- **Timing**: ease-in-out

## Skeleton Shimmer (Loading State)

```css
@keyframes shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: 200px 0; }
}
```
- **Gradient**: `linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-elevated) 50%, var(--bg-tertiary) 75%)`
- **Background-size**: 400px 100%
- **Duration**: 1.5s
- **Iteration**: infinite
- **Timing**: linear

## Now Indicator Update

The "Now" line in the daily strip repositions every 60 seconds:
- **Movement**: `transform: translateY()`, 300ms, standard
- **No flash or fade** — just a smooth slide to the new position

## Error Banner

- **Enter**: slide down from 0 height + fade in, 200ms, decelerate
- **Exit (dismiss)**: fade out + slide up, 150ms, accelerate

---

# Edge Cases

## Many Schedules (>20 per day in grid)

- Column becomes scrollable (overflow-y: auto)
- Bottom gradient fade indicator (16px, transparent → column background)
- Consider: if any column has >8 items, all columns should be the same scrollable height (use the tallest column's height as the min-height for all)

## Many Daily Agents (>10)

- Daily strip scrolls vertically
- Now indicator scrolls with content (not sticky)
- Bottom scroll fade indicator (same pattern as grid columns)

## Very Long Agent Name

- **Collapsed card**: truncate with ellipsis
- **Expanded card**: full name wraps to multiple lines
- **Weekly grid compact card**: truncate at ~15 characters + ellipsis
- **Title attribute**: full name on hover (browser native tooltip)

## Very Long Prompt

- **Expanded card**: max 4 lines, overflow-y auto within the prompt box
- **Create/edit view**: textarea grows up to max-height 200px, then scrolls

## Schedule Currently Running

- Status dot: pulsing animation (see above)
- Card: subtle `var(--accent)` left-border (2px)
- Expanded card: "Running..." badge in metadata row, refreshes status on 5s interval

## Failed Last Run

- Status dot: solid `var(--error)` (red)
- Card: NO border change (keep it subtle — the dot is enough)
- Expanded card: error message in `var(--error-bg)` box within the run history
- Run history item: "Failed" badge with error tooltip on hover

## No Internet / Backend Unreachable

- Show error banner: "Unable to connect to Hermes" — 13px, `var(--error)`
- All action buttons disabled
- Retry button in banner
- Stale data (last loaded schedules) remains visible but dimmed (60% opacity)

## Timezone Edge Cases

- All times displayed in user's local timezone
- If the system timezone changes while the page is open: times update on next loadJobs() call
- One-shot schedules: show timezone abbreviation next to the time in expanded view (e.g., "10:00 AM WEST")

## First-Time Experience

When a user opens Schedules for the first time (0 schedules):
- Empty state (see page-layout spec)
- Daily strip is hidden (no daily section header, no border)
- After creating their first schedule: daily strip appears or stays hidden depending on whether it's a daily schedule

## Window Resize

- Weekly grid columns are `1fr` — they resize proportionally
- Daily strip is fixed at 200px — does not resize
- Below 900px content width: weekly grid columns may become very narrow (< 80px)
  - At this point: collapse day names to single letter ("M", "T", "W"...)
  - Date numbers remain
- Below 700px content width: not a supported breakpoint (Electron window has a minimum size)

## Dark ↔ Light Theme Switch

- All CSS variable changes are inherited automatically
- No explicit animation on theme switch (the app handles this globally)
- Clock face: verify the number ring is legible in both themes (accent on bg-secondary must have sufficient contrast)

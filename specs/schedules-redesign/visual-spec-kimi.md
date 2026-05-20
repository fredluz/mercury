# Mercury Schedules Redesign — Visual Implementation Spec

**Version:** 1.0
**Date:** Wednesday, May 20, 2026
**Scope:** Pixel-level implementation handoff for the complete Schedules page redesign + Dashboard "While You Were Away" surface
**Author:** Kimi (Visual Spec)
**Source Specs:** `00-spec.md` through `08-dashboard-completed-runs.md`
**Design System:** Warm Mercury Design System (foundation.css, v2026-05)

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Token Reference](#2-token-reference)
3. [Iconography](#3-iconography)
4. [Z-Index Stacking](#4-z-index-stacking)
5. [Page Header](#5-page-header)
6. [Daily Strip](#6-daily-strip)
7. [Weekly Grid](#7-weekly-grid)
8. [Month Calendar](#8-month-calendar)
9. [Schedule Card](#9-schedule-card)
10. [Full-Screen Create / Edit View](#10-full-screen-create--edit-view)
11. [Clock Face Picker](#11-clock-face-picker)
12. [Day / Date / Month Selectors](#12-day--date--month-selectors)
13. [Delivery, Skills & Context Controls](#13-delivery-skills--context-controls)
14. [Conversation-Created Schedule Context](#14-conversation-created-schedule-context)
15. [Dashboard — "While You Were Away"](#15-dashboard--while-you-were-away)
16. [States](#16-states)
17. [Dark / Light Theme Behavior](#17-dark--light-theme-behavior)
18. [Animation Timing](#18-animation-timing)
19. [Accessibility](#19-accessibility)

---

## 1. Design Principles

- **No new color tokens.** Every surface uses existing `var(--*)` tokens from `foundation.css`.
- **Animations ≤ 300ms.** Snappy, never sluggish. All easing values are explicit.
- **Inline expansion.** Cards expand in-place; no modal dialogs for detail.
- **Full-screen for creation.** The create/edit flow replaces the entire content area, like Google Calendar event creation.
- **Daily strip is persistent.** It remains visible in both Week and Month views.
- **One expanded card at a time.** Expanding Card B collapses Card A automatically.
- **Graceful overflow.** 20+ cards per day, 10+ daily agents, very long names — all handled without layout breakage.

---

## 2. Token Reference

### Typography

| Token | Value |
|-------|-------|
| `--font-sans` | `"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif` |
| `--font-mono` | `"SF Mono", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace` |
| Base size | 14px |
| Line-height | 1.6 (body), 1.5 (compact UI), 1 (buttons) |

### Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `6px` | Grid cards, small pills, inputs |
| `--radius-md` | `10px` | Daily cards, expanded cards, panels, modals |
| `--radius-lg` | `14px` | Modals, large containers |
| `--radius-xl` | `20px` | App chrome |

### Transition Baseline

| Token | Value | Usage |
|-------|-------|-------|
| `--transition` | `150ms ease` | Default hover, focus, border changes |

### Dark Theme Colors

| Token | Hex / Value | Usage |
|-------|-------------|-------|
| `--bg-primary` | `#151210` | Page background |
| `--bg-secondary` | `#1d1815` | Cards, panels, secondary surfaces |
| `--bg-tertiary` | `#28211d` | Pill containers, hover states, tertiary surfaces |
| `--bg-elevated` | `#302722` | Active pills, elevated cards |
| `--bg-hover` | `#382e28` | Hover backgrounds |
| `--bg-active` | `#433730` | Pressed/active states |
| `--accent` | `#c8993d` | Primary action, selection, active indicators |
| `--accent-hover` | `#ddb25d` | Accent hover state |
| `--accent-subtle` | `rgba(200, 153, 61, 0.18)` | Subtle accent tint (today column, selected cells) |
| `--accent-text` | `#f0cf8d` | Text on accent backgrounds, links |
| `--text-primary` | `#f6efe6` | Headings, primary text |
| `--text-secondary` | `#d2c5b6` | Body text, secondary labels |
| `--text-muted` | `#a79684` | Placeholders, hints, disabled text |
| `--text-tertiary` | `#8d7c6a` | Tertiary labels |
| `--border` | `rgba(232, 218, 201, 0.08)` | Default borders |
| `--border-bright` | `rgba(232, 218, 201, 0.16)` | Hover borders, focused borders |
| `--border-focus` | `#d3a24a` | Focus ring color |
| `--success` | `#4ade80` | Success states |
| `--success-bg` | `rgba(74, 222, 128, 0.12)` | Success tint backgrounds |
| `--error` | `#f87171` | Error states |
| `--error-bg` | `rgba(248, 113, 113, 0.12)` | Error tint backgrounds |
| `--warning` | `#fbbf24` | Warning states |
| `--warning-bg` | `rgba(251, 191, 36, 0.14)` | Warning tint backgrounds |

### Light Theme Colors

| Token | Hex / Value |
|-------|-------------|
| `--bg-primary` | `#fffdf9` |
| `--bg-secondary` | `#faf5ed` |
| `--bg-tertiary` | `#f4ecdf` |
| `--bg-elevated` | `#efe3d2` |
| `--bg-hover` | `#f7efe3` |
| `--bg-active` | `#ecdfcc` |
| `--accent` | `#c49035` |
| `--accent-hover` | `#a97822` |
| `--accent-subtle` | `rgba(196, 144, 53, 0.14)` |
| `--accent-text` | `#7e5614` |
| `--text-primary` | `#191613` |
| `--text-secondary` | `#5f5448` |
| `--text-muted` | `#958675` |
| `--text-tertiary` | `#a19180` |
| `--border` | `#eadfce` |
| `--border-bright` | `#decfbb` |
| `--border-focus` | `#c49035` |
| `--success` | `#15803d` |
| `--success-bg` | `rgba(21, 128, 61, 0.08)` |
| `--error` | `#c2410c` |
| `--error-bg` | `rgba(194, 65, 12, 0.08)` |
| `--warning` | `#b7791f` |
| `--warning-bg` | `rgba(183, 121, 31, 0.1)` |

### Easing Definitions

| Name | Value | Usage |
|------|-------|-------|
| `standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Most transitions, height, opacity |
| `decelerate` | `cubic-bezier(0, 0, 0.2, 1)` | Elements entering screen |
| `accelerate` | `cubic-bezier(0.4, 0, 1, 1)` | Elements leaving screen |
| `spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Toggle switches, bouncy pops |

---

## 3. Iconography

All icons are from **Lucide React**. Sizes are explicit per component.

| Icon | Size | Context |
|------|------|---------|
| `Plus` | 14px | "New Schedule" button |
| `ChevronDown` | 12px | Card collapse chevron, dropdown triggers |
| `ChevronLeft` | 16px | Month nav back, create/edit back |
| `ChevronRight` | 12px | Run history arrow, month nav forward |
| `CalendarClock` | 48px | Empty state (schedules) |
| `Repeat` | 24px | Empty state (daily strip) |
| `Pencil` | 12px | Edit button in expanded card |
| `Zap` | 12px | "Run Now" button |
| `Trash` | 14px | Delete button (icon only) |
| `Check` | 10px | Checkbox checkmark (month calendar) |
| `Monitor` | 10px / 14px | Delivery target: Local |
| `MessageCircle` | 14px | Delivery target: Telegram |
| `Hash` | 14px | Delivery target: Discord, Slack |
| `Phone` | 14px | Delivery target: WhatsApp |
| `Shield` | 14px | Delivery target: Signal |
| `Grid` | 14px | Delivery target: Matrix |
| `Mail` | 14px | Delivery target: Email |
| `Smartphone` | 14px | Delivery target: SMS |
| `Globe` | 14px | Delivery target: Webhook |
| `Search` | 14px | Agent search input |
| `Info` | 12px | Cron preview info |
| `X` | 14px | Day detail panel close, error banner dismiss |

---

## 4. Z-Index Stacking

| Layer | Z-Index | Element |
|-------|---------|---------|
| Drag region | 1000 | Window chrome |
| Modal overlay | 100 | `.skills-detail-overlay` |
| Dropdowns | 20 | Agent picker, skill picker |
| Expanded card (grid) | 10 | Spills over neighboring columns |
| Base content | 1–5 | Cards, headers, strips |

---

## 5. Page Header

### Dimensions & Position

- **Height:** 56px
- **Padding:** 0 32px
- **Background:** transparent (inherits page background)
- **Border-bottom:** 1px solid `var(--border)`
- **Layout:** flexbox, `align-items: center`, `justify-content: space-between`

### Left Zone — Title

- **Text:** "Schedules"
- **Font:** 20px, weight 700, `var(--text-primary)`
- **No subtitle.** The view toggle provides context.

### Center Zone — View Toggle (Segmented Control)

- **Container:**
  - Background: `var(--bg-tertiary)`
  - Border-radius: `var(--radius-sm)` (6px)
  - Padding: 2px
  - Display: inline-flex

- **Each Segment:**
  - Width: 72px
  - Height: 32px
  - Font: 13px, weight 600
  - Border-radius: `var(--radius-sm)` (6px)
  - Text-align: center
  - **Inactive:** transparent background, `var(--text-secondary)` text
  - **Active:** `var(--bg-elevated)` background, `var(--text-primary)` text
  - **Hover (inactive):** `var(--text-primary)` text
  - **Transition:** background 150ms ease, color 150ms ease

- **Active indicator slide:** `transform: translateX()`, 200ms, `spring` easing

### Right Zone — Action Button

- **"+ New Schedule" button:**
  - Class: `.btn .btn-primary`
  - Icon: `Plus` (lucide), 14px, left of text, gap 8px
  - Text: "New Schedule"
  - Padding: 10px 24px
  - Border-radius: `var(--radius-md)`

### Create/Edit Mode Header (Modified)

When in create/edit mode, the header transforms:

- **Left:**
  - Back button: `ChevronLeft` (16px) + "Back" text
  - Font: 14px, weight 500, `var(--text-secondary)`
  - Hover: `var(--text-primary)`, `var(--bg-tertiary)` background
  - Gap between icon and text: 6px
  - Gap between back button and title: 12px
  - Title: "New Schedule" (create) or "Edit Schedule" (edit)
  - Title font: 16px, weight 700, `var(--text-primary)`

- **Center:** Empty (view toggle hidden)

- **Right:**
  - "Cancel": `.btn .btn-ghost`
  - "Save": `.btn .btn-primary`
    - Create mode: "Create Schedule"
    - Edit mode: "Save Changes"
    - Disabled until required fields valid (agent + time)
    - While saving: shows `.loading-spinner` (14px) replacing text

---

## 6. Daily Strip

### Container

- **Width:** 200px, fixed, `flex-shrink: 0`
- **Padding:** 16px 12px
- **Background:** `color-mix(in srgb, var(--bg-secondary) 50%, var(--bg-primary))`
- **Border-right:** 1px solid `var(--border)`
- **Overflow-y:** auto (uses `.scrollbar` styles)
- **Height:** fills from below header to bottom of viewport

### Section Header

- **Text:** "DAILY"
- **Font:** 11px, weight 600, `var(--text-muted)`, uppercase
- **Letter-spacing:** 0.8px
- **Margin-bottom:** 12px

### Now Indicator

- **Line:**
  - Width: 100% of strip content area
  - Height: 1px
  - Background: `var(--accent)`
  - Positioned vertically between the last-passed and next-upcoming schedule entries
  - If before all entries: at top. If after all: at bottom.

- **Label:**
  - Text: "Now"
  - Font: 9px, weight 600, `var(--accent-text)`
  - Positioned left-aligned on the line

- **Dot:**
  - Size: 6px circle
  - Background: `var(--accent)`, solid fill
  - Positioned at left end of the line

- **Update interval:** every 60 seconds
- **Movement animation:** `transform: translateY()`, 300ms, `standard` easing

### Daily Schedule Entry (Collapsed)

- **Height:** 52px
- **Padding:** 8px 10px
- **Background:** `var(--bg-primary)`
- **Border:** 1px solid `var(--border)`
- **Border-radius:** `var(--radius-md)` (10px)
- **Margin-bottom:** 6px
- **Cursor:** pointer
- **Layout:** CSS grid — `grid-template-columns: auto 1fr auto; grid-template-rows: auto auto`

#### Content Grid Placement

| Element | Grid Column | Grid Row | Specs |
|---------|-------------|----------|-------|
| Time | 1 | 1 | 14px, weight 700, `var(--text-primary)`, HH:MM or locale format |
| Agent Name | 2 | 1 | 13px, weight 600, `var(--text-primary)`, ellipsis overflow, margin-left 8px |
| Description | 2 | 2 | 11px, weight 400, `var(--text-muted)`, single line ellipsis, margin-left 8px |
| Status Dot | 3 | 1 | 8px circle, align-self center |
| Toggle Switch | 3 | 2 | 34px × 18px, align-self center |

#### Status Dot Colors

| State | Color |
|-------|-------|
| Active, next upcoming | `var(--accent)` solid |
| Active, ran today successfully | `var(--success)` |
| Active, ran today with failure | `var(--error)` |
| Active, not yet run today | `var(--text-muted)` at 40% opacity |
| Currently running | `var(--accent)` with `statusPulse` animation |

#### Toggle Switch

- **Track:** 34px wide × 18px tall, `var(--radius-sm` border-radius (fully rounded pill)
- **On state:** `var(--accent)` background
- **Off state:** `var(--bg-tertiary)` background
- **Thumb:** 14px circle, 2px inset from edges
  - On: white, right-aligned
  - Off: `var(--text-muted)`, left-aligned
- **Transition:** 200ms `spring` easing (thumb position), `standard` (background color)
- **Thumb press scale:** 1.0 → 1.1 while pressed
- **Click behavior:** fires pause/resume IPC. **Does NOT expand card.** `stopPropagation()` required.

### Daily Entry States

| State | Visual Treatment |
|-------|------------------|
| **Default** | As above |
| **Hover** | Border: `var(--border-bright)`, Background: `var(--bg-secondary)`, Transition: 150ms |
| **Next Upcoming** | Border-left: 2px solid `var(--accent)`, Background: `var(--accent-subtle)` |
| **Past (ran earlier)** | Opacity: 0.6 on entire card. Status dot shows success/failure. |
| **Expanded** | See §9 Schedule Card. Expands inline, pushing cards below down. |
| **Paused** | Opacity: 0.5. Toggle off. No "Trigger Now" in expanded state. |

### Empty State (No Daily Schedules)

- Strip still visible (permanent layout element)
- Content centered vertically:
  - Icon: `Repeat` (lucide), 24px, `var(--text-muted)` at 30%
  - Text: "No daily agents" — 12px, `var(--text-muted)`
  - Subtext: "Daily schedules appear here" — 11px, `var(--text-muted)` at 70%

### Overflow (Many Daily Agents)

- Vertical scroll with `.scrollbar` styling
- Now indicator scrolls with content (not sticky)
- Bottom scroll fade indicator: 16px gradient from transparent to strip background

---

## 7. Weekly Grid

### Container

- **Display:** CSS grid
- **Grid:** `grid-template-columns: repeat(7, 1fr)`
- **Gap:** 0 (columns separated by borders, not gaps)
- **Height:** fills available space (`flex: 1`), `overflow-y: auto`

### Column Header

- **Height:** 40px
- **Padding:** 0 8px
- **Border-bottom:** 1px solid `var(--border)`
- **Border-right:** 1px solid `var(--border)` (except last column)
- **Background:** transparent
- **Layout:** flex, `align-items: center`, `justify-content: center`, `flex-direction: column`

#### Day Name

- **Font:** 11px, weight 600, uppercase, `var(--text-muted)`
- **Letter-spacing:** 0.5px
- **Text:** "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"

#### Date Number

- **Font:** 14px, weight 700, `var(--text-primary)`
- **Text:** day of month (e.g., "19", "20")

#### Today Column Header

- **Date number** displayed inside a circle:
  - Circle: 28px diameter
  - Background: `var(--accent)`
  - Text: white, 14px, weight 700
  - Border-radius: 50%
  - Display: flex, align-items center, justify-content center
- **Day name:** `var(--accent-text)` instead of `var(--text-muted)`

#### Past Day Header

- **Date number:** `var(--text-muted)` instead of `var(--text-primary)`
- **Day name:** `var(--text-muted)` at 60% opacity

### Column Body

- **Padding:** 8px 6px
- **Border-right:** 1px solid `var(--border)` (except last column)
- **Overflow-y:** auto (each column scrolls independently)
- **Min-height:** 200px
- **Gap:** 6px between cards

#### Today Column Body

- **Background:** `var(--accent-subtle)`
  - Dark: `rgba(200, 153, 61, 0.04)`
  - Light: `rgba(196, 144, 53, 0.04)`

#### Past Day Column Body

- **Opacity:** 0.5 on the entire column body

### Weekly Grid Schedule Card (Collapsed Compact)

- **Width:** 100% (fills column)
- **Padding:** 8px 8px
- **Background:** `var(--bg-primary)`
- **Border:** 1px solid `var(--border)`
- **Border-radius:** `var(--radius-sm)` (6px)
- **Cursor:** pointer
- **Layout:** flex column
- **Position:** relative (for status dot absolute positioning)

#### Content

| Element | Specs |
|---------|-------|
| Time | 13px, weight 700, `var(--text-primary)`, margin-bottom 2px |
| Agent Name | 12px, weight 600, `var(--text-primary)`, single line ellipsis |
| Description | 11px, weight 400, `var(--text-muted)`, single line ellipsis, margin-top 1px |
| Status Dot | Absolute, top-right, 6px inset, 6px circle (same color rules as daily strip) |

#### Schedule Type Badge

- **Position:** below description
- **Font:** 10px, weight 600, uppercase, letter-spacing 0.3px
- **Padding:** 2px 6px
- **Border-radius:** 4px
- **Margin-top:** 4px

| Type | Text | Text Color | Background |
|------|------|------------|------------|
| One-shot | "ONCE" | `var(--accent-text)` | `var(--accent-subtle)` |
| Monthly | "MONTHLY" | `var(--text-muted)` | `var(--bg-tertiary)` |
| Weekly | (no badge) | — | — |

#### Hover State

- **Border:** `var(--border-bright)`
- **Background:** `var(--bg-secondary)`
- **Transition:** 150ms

#### Expanded State (in Grid)

- **Width:** `min(100%, 320px)`
- **If column < 320px:** card spills rightward over neighboring columns
- **Box-shadow:**
  - Dark: `0 8px 32px rgba(0, 0, 0, 0.18)`
  - Light: `0 8px 32px rgba(0, 0, 0, 0.08)`
- **Z-index:** 10
- See §9 for full expanded card spec.

### Empty Column

- **Content:** em-dash "—"
- **Font:** 14px, `var(--text-muted)` at 30%
- **Centered vertically**
- **No hover state**

### Overflow: Many Cards in One Day

- Column body scrolls vertically (`overflow-y: auto`)
- Bottom gradient fade: 16px, transparent → column background
- Scroll indicator: thin `var(--accent)` line at bottom of column, 2px height, only visible when scrollable

---

## 8. Month Calendar

### Month Navigation Bar

- **Height:** 44px
- **Padding:** 0 8px
- **Layout:** flex row, `align-items: center`, `justify-content: space-between`
- **Background:** transparent
- **Border-bottom:** 1px solid `var(--border)`

#### Left: Month Navigation

- **Previous arrow:** `ChevronLeft`, 16px, `var(--text-secondary)`, btn-ghost styling, 24×24px hit area
- **Month/Year label:** "May 2026" — 15px, weight 700, `var(--text-primary)`
- **Next arrow:** `ChevronRight`, 16px, `var(--text-secondary)`, btn-ghost styling
- **Gap:** 12px between arrows and label
- **Hover on arrows:** `var(--text-primary)`, `var(--bg-tertiary)` background

#### Right: Show Daily Toggle

- **Layout:** flex row, gap 6px, align-items center
- **Checkbox:**
  - Unchecked: 16×16px, `var(--bg-primary)` background, 1px `var(--border-bright)` border, `var(--radius-sm)` corners
  - Checked: `var(--accent)` background, white `Check` icon (10px), `var(--radius-sm)` corners
  - Transition: 150ms
- **Label:** "Show daily" — 12px, weight 500, `var(--text-secondary)`
- **Default:** unchecked
- **Effect:** reveals daily schedules as dots/cards in calendar

### Day-of-Week Header Row

- **Height:** 28px
- **Grid:** `grid-template-columns: repeat(7, 1fr)`
- **Each cell:** centered text
  - Font: 11px, weight 600, uppercase, `var(--text-muted)`, letter-spacing 0.5px
  - Text: "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"
- **Border-bottom:** 1px solid `var(--border)`

### Calendar Grid

- **Grid:** `grid-template-columns: repeat(7, 1fr)`, `grid-template-rows: repeat(auto, 1fr)`
- **Rows:** 5 or 6 depending on month
- **Cell height:** flexible, min-height 64px

#### Day Cell

- **Padding:** 4px
- **Border-right:** 1px solid `var(--border)` (except last column)
- **Border-bottom:** 1px solid `var(--border)` (except last row)
- **Cursor:** pointer
- **Background:** transparent

##### Date Number

- **Position:** top-left, 4px inset
- **Font:** 13px, weight 600, `var(--text-primary)`

##### Today's Date Number

- **Circle:** 24px diameter, `var(--accent)` background, white text
- **Border-radius:** 50%
- **Centered within the 24px circle**

##### Past Date Number

- **Color:** `var(--text-muted)` at 60%

##### Outside-Month Dates

- **Color:** `var(--text-muted)` at 25%
- **Schedule dots:** not shown

##### Schedule Dots

- **Position:** below date number, centered horizontally
- **Margin-top:** 4px from date number
- **Layout:** flex row, gap 3px, centered
- **Each dot:** 6px circle, `var(--accent)` fill
- **Max visible:** 3 dots. If >3 schedules: 3 dots + "+N" text
  - "+N" text: 9px, weight 600, `var(--text-muted)`, inline with dots
- **One-shot dot:** `var(--accent)` with ring outline (border: 1.5px solid `var(--accent)`, transparent fill)

#### Day Cell States

| State | Treatment |
|-------|-----------|
| **Default** | As above |
| **Hover** | Background: `var(--bg-secondary)`, Transition: 100ms |
| **Selected** | Background: `var(--accent-subtle)`, Border: 1px solid `var(--accent)` at 30% opacity. Opens Day Detail Panel. |
| **Today** | Background: `var(--accent-subtle)` at 50% of normal intensity |

### Day Detail Panel

Appears below the calendar grid when a day is clicked.

- **Position:** below calendar grid, full width of main area
- **Height:** auto, max 300px with scroll
- **Padding:** 16px
- **Background:** `var(--bg-primary)`
- **Border-top:** 1px solid `var(--border-bright)`

#### Panel Header

- **Text:** "Thursday, May 1" — full date with day of week
- **Font:** 14px, weight 600, `var(--text-primary)`
- **Close button:** `X` (lucide), 14px, `var(--text-muted)`, btn-ghost, top-right
- **Margin-bottom:** 12px

#### Panel Content

- **Layout:** flex column, gap 6px
- **Cards:** same as weekly grid compact cards but full-width (max 480px)
- **Cards clickable:** expand inline within panel

#### Empty Day

- **Text:** "No schedules on this day" — 13px, `var(--text-muted)`, centered

---

## 9. Schedule Card

### Interaction: Expand / Collapse

- **Click on card** (anywhere except toggle switch): expands inline
- **Click on expanded card header:** collapses
- **Only one expanded at a time:** expanding Card B collapses Card A
- **Keyboard:** Enter/Space when focused expands/collapses. Escape collapses.

### Expanded Card Container

- **Background:** `var(--bg-primary)`
- **Border:** 1px solid `var(--border-bright)`
- **Border-radius:** `var(--radius-md)` (10px)
- **Padding:** 0 (sections have own padding)
- **Width:**
  - Daily strip: fills strip width (200px − 24px padding = 176px)
  - Weekly grid: `min(100%, 320px)`, z-index 10, may spill rightward
- **Box-shadow:**
  - Dark: `0 4px 20px rgba(0, 0, 0, 0.12)`
  - Light: `0 4px 20px rgba(0, 0, 0, 0.06)`

### Section 1: Header (Clickable to Collapse)

- **Padding:** 10px 12px
- **Border-bottom:** 1px solid `var(--border)`
- **Cursor:** pointer
- **Hover:** `var(--bg-secondary)` background
- **Layout:** same as collapsed card + collapse indicator

- **Collapse chevron:**
  - Icon: `ChevronDown`, 12px, `var(--text-muted)`
  - Position: left of the time
  - Rotated 180° when expanded (points up, indicating "click to collapse")

### Section 2: Prompt

- **Padding:** 12px
- **Label:** "PROMPT"
  - Font: 10px, weight 600, uppercase, `var(--text-muted)`
  - Letter-spacing: 0.5px
  - Margin-bottom: 4px

- **Content box:**
  - Background: `var(--bg-secondary)`
  - Padding: 8px 10px
  - Border-radius: `var(--radius-sm)`
  - Font: 12px, weight 400, `var(--text-secondary)`, line-height 1.5
  - Max-height: 72px (≈4 lines)
  - Overflow-y: auto if longer

### Section 3: Metadata Row

- **Padding:** 0 12px
- **Layout:** flex row, gap 16px, flex-wrap wrap
- **Each item:** flex column, gap 2px

| Item | Label Style | Value Style |
|------|-------------|-------------|
| Label | 10px, weight 600, uppercase, `var(--text-muted)`, letter-spacing 0.3px | — |
| Value | — | 12px, weight 500, `var(--text-primary)` |

**Items:**
- **Agent:** profile name (e.g., "hermes-daily")
- **Harness:** model name (e.g., "Claude 4.6")
- **Delivery:** target names joined by comma. "Local" shown with `Monitor` icon (10px). Other platforms show their respective icons.

### Section 4: Skills

- **Padding:** 12px
- **Label:** "SKILLS" — same label style as Prompt
- **Skills list:** horizontal flex, wrap, gap 4px

- **Each skill pill:**
  - Font: 11px, weight 500, `var(--text-secondary)`
  - Padding: 3px 8px
  - Background: `var(--bg-tertiary)`
  - Border-radius: 12px (fully rounded)
  - Border: 1px solid `var(--border)`

- **If no skills:** "No skills" — 11px, italic, `var(--text-muted)`

### Section 5: Recent Runs

- **Padding:** 12px
- **Label:** "RECENT RUNS" — same label style
- **Container:**
  - Border: 1px solid `var(--border)`
  - Border-radius: `var(--radius-sm)`
  - Overflow: hidden
- **Max items:** 5 most recent
- **If >5:** "View all in Trace Lab →" link at bottom
  - Font: 12px, weight 500, `var(--accent-text)`

#### Run Item

- **Height:** 36px
- **Padding:** 0 10px
- **Layout:** flex row, `align-items: center`, gap 8px
- **Border-bottom:** 1px solid `var(--border)` (except last)
- **Cursor:** pointer

| Element | Specs |
|---------|-------|
| Timestamp | 12px, weight 500, `var(--text-secondary)`, width 100px, flex-shrink 0. Format: "Today 09:01", "Yesterday 09:00", "Mon 09:01", or "May 15 09:01" |
| Status Badge | 6px circle + text, flex row gap 4px, width 80px, flex-shrink 0 |
| Duration | 11px, weight 400, `var(--text-muted)`, flex 1. Format: "2m 14s" |
| Arrow | `ChevronRight`, 12px, `var(--text-muted)`, flex-shrink 0 |

**Status badge variants:**
- **Success:** `var(--success)` dot + "Success" in 11px, weight 500, `var(--success)`
- **Failed:** `var(--error)` dot + "Failed" in 11px, weight 500, `var(--error)`
- **Running:** `var(--accent)` dot with pulse + "Running..." in 11px, weight 500, `var(--accent-text)`

#### Run Item Hover

- **Background:** `var(--bg-secondary)`
- **Arrow icon:** `var(--text-primary)`
- **Transition:** 100ms

#### Run Item Click

- Navigates to Trace Lab view, opening the specific trace run entry
- Passes the run's trace ID

### Section 6: Action Bar

- **Padding:** 12px
- **Border-top:** 1px solid `var(--border)`
- **Layout:** flex row, `justify-content: space-between`, `align-items: center`

#### Left Actions

- **"Edit" button:**
  - Class: `.btn .btn-secondary .btn-sm`
  - Icon: `Pencil`, 12px
  - Text: "Edit"
  - Opens full-screen edit view

- **"Trigger Now" button:**
  - Class: `.btn .btn-primary .btn-sm`
  - Icon: `Zap`, 12px
  - Text: "Run Now"
  - Fires `triggerCronJob` IPC
  - Shows brief "Triggered" toast
  - Disabled while in progress (shows spinner)

#### Right Action

- **"Delete" button:**
  - Class: `.btn-ghost`
  - Icon: `Trash`, 14px
  - No text (icon only)
  - Hover: `var(--error)` text
  - Click: shows delete confirmation modal (`.skills-detail-overlay` + `.schedules-modal-sm`)

### One-Shot Schedule (Expanded Variant)

Same layout as standard expanded card, with these additions:

- **Header:** small "ONCE" badge next to the time (same badge spec as weekly grid)
- **Metadata row:** adds "Scheduled For" item showing exact date/time
- **No Recent Runs section** (if hasn't run yet): instead show "Scheduled to run on [date]" centered text, 13px, `var(--text-secondary)`
- **After completion:** card background gets subtle `var(--success-bg)` tint

### Paused Schedule (Expanded Variant)

- **Entire card:** 50% opacity
- **Toggle switch:** off position
- **No "Trigger Now" button** in action bar
- **Status dot:** `var(--text-muted)` at 30%

---

## 10. Full-Screen Create / Edit View

### Entry Transitions

#### Opening
1. Current content: `translateX(0) → translateX(-40px)`, `opacity: 1 → 0`, 120ms, `accelerate`
2. Create view: `translateX(40px) → translateX(0)`, `opacity: 0 → 1`, 180ms, `decelerate`, delayed 60ms
3. Header bar: cross-fade content, 150ms, `standard`

#### Closing
- Reverse of opening. Same durations/easings reversed.

### Form Container

- **Max-width:** 640px
- **Margin:** 0 auto
- **Padding:** 32px 24px
- **Overflow-y:** auto
- **Sections separated by:** 28px gap

### Section Label Style (Shared)

- **Font:** 11px, weight 600, uppercase, `var(--text-muted)`
- **Letter-spacing:** 0.8px
- **Margin-bottom:** 8px

---

### Section 1: Agent Selection

#### Searchable Dropdown

- **Default state:** `.input` styling
  - Placeholder: "Select an agent..." — `var(--text-muted)`
  - Height: 44px
  - Icon: `ChevronDown`, 14px, `var(--text-muted)`, right side

#### Dropdown Open State

- **Trigger:** click on input
- **Container:**
  - Positioned below input, full width
  - Max-height: 240px, overflow-y auto
  - Background: `var(--bg-primary)`
  - Border: 1px solid `var(--border-bright)`
  - Border-radius: `var(--radius-md)`
  - Box-shadow:
    - Dark: `0 8px 24px rgba(0, 0, 0, 0.12)`
    - Light: `0 8px 24px rgba(0, 0, 0, 0.06)`
  - Z-index: 20

#### Search Input (Inside Dropdown)

- **Sticky at top**
- **Padding:** 10px 12px
- **Border-bottom:** 1px solid `var(--border)`
- **Icon:** `Search`, 14px, `var(--text-muted)`, left
- **Input:** 13px, no border, transparent background
- **Placeholder:** "Search agents..."

#### Agent Option

- **Height:** 48px
- **Padding:** 8px 12px
- **Layout:** flex row, gap 10px, align-items center
- **Hover:** `var(--bg-secondary)` background
- **Selected:** `var(--accent-subtle)` background, `Check` icon on right

##### Agent Avatar

- **Size:** 32px circle
- **Background:** `var(--bg-tertiary)`
- **Content:** first letter of agent name, 14px, weight 600, `var(--text-primary)`, centered
- **Border-radius:** 50%

##### Agent Info

- **Name:** 13px, weight 600, `var(--text-primary)`
- **Description:** 11px, weight 400, `var(--text-muted)`, single line, ellipsis

---

### Section 2: Schedule Type

#### Type Pills

- **Container:**
  - Display: flex row
  - Background: `var(--bg-tertiary)`
  - Border-radius: `var(--radius-sm)`
  - Padding: 2px

- **Each pill:**
  - Equal flex
  - Height: 36px
  - Font: 13px, weight 600
  - **Active:** `var(--bg-elevated)` background, `var(--text-primary)` text
  - **Inactive:** transparent, `var(--text-secondary)` text
  - **Hover (inactive):** `var(--text-primary)` text
  - **Transition:** 150ms

| Pill | Label | Visible Controls When Selected |
|------|-------|-------------------------------|
| once | Once | Date picker + clock face |
| daily | Daily | Clock face only |
| weekly | Weekly | Day-of-week selector + clock face |
| monthly | Monthly | Day-of-month grid + clock face |
| custom | Custom | Cron expression input + human preview |

---

### Section 3: Time Configuration

#### Layout (Types with Clock Face + Secondary Picker)

- **Display:** flex row, gap 32px, flex-wrap wrap
- **Clock face:** left side, 220px wide
- **Secondary picker:** right side, flex 1, min-width 200px

---

## 11. Clock Face Picker

### Stage Indicator (Above Clock)

- **Layout:** flex row, centered, gap 4px
- **Hours display:** 28px, weight 700
  - Active stage: `var(--text-primary)`
  - Inactive stage: `var(--text-muted)`, cursor pointer, click switches stage
- **Colon separator:** 28px, weight 700, `var(--text-muted)`
- **Minutes display:** same as hours
- **Margin-bottom:** 16px

### Clock Face Container

- **Size:** 220px × 220px
- **Background:** `var(--bg-secondary)`
- **Border:** 1px solid `var(--border)`
- **Border-radius:** 50%
- **Position:** relative

### Number Ring

- **12 positions**, evenly spaced around circle
- **Each number:**
  - Font: 14px, weight 500, `var(--text-primary)`
  - Hit area: 36px circle, transparent background
  - Positioned at radius 80px from center

#### Selected Number

- **Background:** `var(--accent)` circle, 36px diameter
- **Text:** white, weight 700
- **Transition:** background 150ms

### Clock Hand

- **Line from center to selected number:**
  - Width: 2px
  - Color: `var(--accent)`
  - Transition: `transform` 150ms (rotates to selected number)
- **Center dot:** 6px circle, `var(--accent)`, solid

### Inner Ring (24h Mode Only)

- **Numbers:** 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 00
- **Positioned at radius:** 52px from center
- **Font:** 12px, weight 500, `var(--text-muted)`
- **Selected:** same accent treatment as outer ring

### AM/PM Toggle (12h Mode Only)

- **Position:** below clock face, centered
- **Layout:** two buttons side by side
  - Each: 40px wide, 28px tall, 12px font, weight 600
  - **Active:** `var(--accent)` background, white text
  - **Inactive:** `var(--bg-tertiary)` background, `var(--text-secondary)` text
  - **Border-radius:** left button rounds left corners, right button rounds right corners
- **Margin-top:** 12px

### Interactions

- **Click:** select a number. If in hours stage, auto-advance to minutes after 200ms delay.
- **Drag:** finger/mouse drag around ring to select. Visual hand follows drag.

### Clock Face Animations

- **Selected number background:** scale 0 → 1, 150ms, `spring`
- **Previously selected:** scale 1 → 0, 100ms, `standard`
- **Clock hand rotation:** `transform: rotate()`, 150ms, `standard`
- **Hours → Minutes stage:**
  - Hours ring: fade out, 150ms, `accelerate`
  - Minutes ring: fade in, 150ms, `decelerate`, delayed 100ms
  - Stage indicator: color change, 150ms

---

## 12. Day / Date / Month Selectors

### Day-of-Week Selector (Weekly Type)

- **Layout:** flex row, gap 6px
- **7 circular buttons:** one per day

#### Day Button

- **Size:** 36px circle
- **Font:** 12px, weight 600
- **Labels:** "M", "T", "W", "T", "F", "S", "S"
- **Unselected:** `var(--bg-tertiary)` background, `var(--text-secondary)` text, 1px `var(--border)` border
- **Selected:** `var(--accent)` background, white text, no border
- **Hover (unselected):** `var(--border-bright)` border, `var(--text-primary)` text
- **Transition:** 150ms
- **Multi-select:** clicking toggles individual days

#### Quick-Select Links

- **Layout:** flex row, gap 12px, below day buttons
- **"Weekdays":** 11px, weight 500, `var(--accent-text)`, underline on hover. Click: selects Mon–Fri.
- **"Weekends":** same styling. Click: selects Sat–Sun.
- **"Every day":** same styling. Click: selects all 7.
  - If all 7 selected: show hint "Tip: use Daily type instead" — 10px, `var(--text-muted)`, italic

### Date Picker (Once Type)

- **Size:** fills right side of time configuration area
- **Style:** mini calendar (same grid as month calendar, smaller cells)
- **Cell size:** 32px × 32px
- **Font:** 12px
- **Navigation:** `< Month >` arrows at top
- **Today:** accent circle on date number
- **Selected date:** `var(--accent)` fill on cell, white text
- **Past dates:** disabled (dimmed, not clickable)
- **Hover:** `var(--bg-tertiary)` background

### Day-of-Month Grid (Monthly Type)

- **Grid:** `grid-template-columns: repeat(7, 1fr)`, gap 4px
- **Each cell:**
  - Size: 32px × 32px
  - Font: 12px, weight 500, `var(--text-primary)`
  - Border-radius: `var(--radius-sm)`
  - Hover: `var(--bg-tertiary)` background
  - Selected: `var(--accent)` background, white text
- **Single select:** only one day chosen
- **Note below grid:** "Months without day 31 will use the last day" — 10px, `var(--text-muted)`, italic

### Custom Cron Input

- **Input:** `.input` styling, full width
  - Placeholder: "0 9 * * 1-5"
  - Font: `var(--font-mono)`, 14px
- **Preview below input:**
  - Text: "Runs at 09:00 on weekdays" — 12px, `var(--text-secondary)`
  - Icon: `Info`, 12px, `var(--text-muted)`, left of text
  - Invalid expression: "Invalid cron expression" in `var(--error)`, 12px

---

## 13. Delivery, Skills & Context Controls

### Section 4: Prompt (Create/Edit)

- **Label:** "PROMPT" — standard section label
- **Textarea:**
  - Classes: `.input` + `.schedules-textarea`
  - Min-height: 80px (4 lines)
  - Max-height: 200px
  - Resize: vertical
  - Font: 13px, `var(--text-primary)`, line-height 1.6
  - Placeholder: "What should this agent do?" — `var(--text-muted)`
- **Hint (when empty + agent has default):** "Leave empty to use the agent's default prompt" — 11px, `var(--text-muted)`, margin-top 4px

### Section 5: Skills (Create/Edit)

- **Label:** "SKILLS" — standard section label
- **Skills list:** flex column, gap 6px

#### Skill Row

- **Height:** 36px
- **Layout:** flex row, `align-items: center`, `justify-content: space-between`
- **Padding:** 0 8px
- **Border-bottom:** 1px solid `var(--border)` (except last)

| Element | Specs |
|---------|-------|
| Skill Name | 13px, weight 500, `var(--text-primary)` |
| Source Tag | "(default)" or "(added)" — 11px, `var(--text-muted)`, italic |
| Toggle | 34px × 18px (same as card toggle). Default skills: on. Added skills: on. |

#### Add Skill Button

- **Class:** `.btn-ghost`
- **Icon:** `Plus`, 12px
- **Text:** "Add Skill" — 12px, weight 500
- **Click:** opens dropdown of available skills not already in list
  - Same dropdown styling as agent picker but simpler (no avatar)

### Section 6: Delivery (Create/Edit)

- **Label:** "DELIVER TO" — standard section label
- **Delivery grid:** flex row, flex-wrap, gap 6px

#### Delivery Chip

- **Height:** 32px
- **Padding:** 0 12px
- **Border-radius:** 16px (fully rounded)
- **Font:** 12px, weight 500
- **Layout:** flex row, gap 6px, align-items center

| State | Background | Border | Text | Icon |
|-------|------------|--------|------|------|
| Unselected | `var(--bg-tertiary)` | 1px solid `var(--border)` | `var(--text-secondary)` | 14px, `var(--text-muted)` |
| Selected | `var(--accent-subtle)` | 1px solid `var(--accent)` at 40% opacity | `var(--accent-text)` | 14px, `var(--accent-text)` |
| Hover (unselected) | — | `var(--border-bright)` | `var(--text-primary)` | — |

#### Delivery Target Order & Icons

1. **Local** — `Monitor`
2. **Telegram** — `MessageCircle`
3. **Discord** — `Hash`
4. **Slack** — `Hash`
5. **WhatsApp** — `Phone`
6. **Signal** — `Shield`
7. **Matrix** — `Grid`
8. **Email** — `Mail`
9. **SMS** — `Smartphone`
10. **Webhook** — `Globe`

- **"Local" is selected by default**
- **Multiple selections allowed**

### Section 7: Name (Create/Edit)

- **Label:** "NAME" — standard section label
- **Input:** `.input`, height 44px, font 14px, weight 500, `var(--text-primary)`
- **Auto-generated value:** "[Agent Name] — [Schedule Description]"
  - Example: "Morning Briefing — Daily at 09:00"
  - Example: "Invoice Agent — Monthly on the 1st at 14:30"
  - Example: "Tax Reminder — May 30, 2026 at 10:00"
- **Editable:** user can clear and type custom name
- **Auto-update logic:**
  - Track `nameManuallyEdited` boolean
  - If NOT manually edited: regenerate on agent/schedule change
  - If manually edited: never overwrite
  - Clearing field resets to auto-generate mode

### Validation

| Field Error | Visual | Message |
|-------------|--------|---------|
| Agent missing | `var(--error)` border | "Select an agent" — 11px, `var(--error)`, margin-top 4px |
| Weekly no days | `var(--error)` border | "Select at least one day" |
| Once in past | `var(--error)` border | "Scheduled time must be in the future" |
| Invalid cron | `var(--error)` border | "Invalid cron expression" |

- Save button disabled until all required fields pass

### Unsaved Changes Warning

- **Overlay:** `.skills-detail-overlay`
- **Modal:** 320px max-width, centered
  - Title: "Discard changes?" — 15px, weight 700, `var(--text-primary)`
  - Text: "Your schedule hasn't been saved." — 13px, `var(--text-secondary)`
  - Buttons: "Keep Editing" (`.btn .btn-secondary`) + "Discard" (`.btn .btn-danger`)
- **Escape key:** closes modal (keeps editing)

---

## 14. Conversation-Created Schedule Context

When a schedule is created from a conversation (chat → "schedule this"), the card and expanded view show a **context affordance** indicating its origin.

### Collapsed Card Indicator

- **Position:** below the description, above any type badge
- **Layout:** flex row, gap 4px, align-items center
- **Icon:** `MessageCircle`, 10px, `var(--accent-text)`
- **Text:** "From chat" — 10px, weight 500, `var(--accent-text)`
- **Background:** `var(--accent-subtle)`
- **Padding:** 1px 6px
- **Border-radius:** 4px
- **Margin-top:** 2px

### Expanded Card Context Section

- **Position:** between Metadata Row and Skills section
- **Label:** "CREATED FROM" — standard 10px label style
- **Content:**
  - Icon: `MessageCircle`, 12px, `var(--accent-text)`
  - Text: truncated conversation preview (first 60 chars) — 12px, `var(--text-secondary)`
  - Link: "Open conversation →" — 11px, `var(--accent-text)`, clickable
  - Click: navigates to the originating chat session

### Create/Edit View Context

- If editing a conversation-created schedule:
  - Show a read-only banner at top of form:
    - Background: `var(--accent-subtle)`
    - Border: 1px solid `var(--accent)` at 20% opacity
    - Padding: 8px 12px
    - Border-radius: `var(--radius-sm)`
    - Content: `MessageCircle` icon (12px) + "Created from conversation" — 12px, `var(--accent-text)`
  - The agent selection is **locked** (dropdown disabled, shows selected agent)
  - The prompt field is **pre-filled** with the conversation-derived prompt and marked as manually edited

---

## 15. Dashboard — "While You Were Away"

This lives on Mercury's main/home screen, NOT on the Schedules page.

### Visibility Logic

- **Shown when:** completed scheduled runs exist since user's last active session
- **Hidden when:** no new completions, or all dismissed
- **"Last active":** most recent user-initiated chat message timestamp, or last dismissal time

### Section Container

- **Margin:** 0 20px
- **Background:** `var(--bg-secondary)`
- **Border:** 1px solid `var(--border)`
- **Border-radius:** `var(--radius-md)`
- **Overflow:** hidden

### Section Header

- **Padding:** 16px 20px 8px
- **Layout:** flex row, justify-content space-between, align-items center
- **Title:** "While You Were Away" — 15px, weight 700, `var(--text-primary)`
- **"Mark all read":** 12px, weight 500, `var(--accent-text)`, cursor pointer, underline on hover
  - Click: dismisses entire section, stores dismissal timestamp

### Run List

- **Container:** see Section Container above

#### Run Item

- **Height:** auto (two lines)
- **Padding:** 10px 14px
- **Border-bottom:** 1px solid `var(--border)` (except last)
- **Cursor:** pointer
- **Layout:** two rows

##### Row 1 (Main Info)

- **Layout:** flex row, align-items center, justify-content space-between

**Left side:** flex row, gap 8px
- Status dot: 6px circle, `var(--success)` or `var(--error)`
- Time: 12px, weight 600, `var(--text-secondary)` — "09:01" or "Yesterday 09:01"
- Schedule name: 13px, weight 600, `var(--text-primary)`

**Right side:** flex row, gap 12px
- Status text: 11px, weight 600
  - Success: `var(--success)`, text "Success"
  - Failed: `var(--error)`, text "Failed"
- Duration: 11px, weight 400, `var(--text-muted)`, format "2m 14s"

##### Row 2 (Summary)

- **Margin-top:** 4px
- **Margin-left:** 14px (aligned past the dot)
- **Font:** 12px, weight 400, `var(--text-muted)`, line-height 1.4
- **Single line:** ellipsis overflow
- **Content:** one-line summary of what the run did

### Run Item States

| State | Treatment |
|-------|-----------|
| **Default** | As above |
| **Hover** | Background: `var(--bg-tertiary)`, Transition: 100ms |
| **Click** | Navigates to Trace Lab entry |
| **Failed** | Left border: 2px solid `var(--error)`. Summary text: `var(--error)`. |

### Footer

- **Padding:** 8px 20px 16px
- **Font:** 12px, weight 500, `var(--text-muted)`
- **Content:** "[N] runs completed · [M] failed"
  - Failed count only shown if > 0
  - Failed count in `var(--error)`

### Max Items

- **Default visible:** 5 most recent
- **If >5:** "Show N more" link below list
  - Font: 12px, weight 500, `var(--accent-text)`, cursor pointer
  - Click: expands to show all (max-height 400px, overflow-y auto)

---

## 16. States

### Empty State (No Schedules At All)

- **Daily strip:** hidden entirely (`flex: 0`, no border)
- **Main area:** centered empty state
  - Icon: `CalendarClock`, 48px, `var(--text-muted)` at 40% opacity
  - Title: "No schedules yet" — 16px, weight 600, `var(--text-secondary)`
  - Subtitle: "Schedule your agents to run automatically" — 13px, `var(--text-muted)`
  - CTA: "Create Schedule" — `.btn .btn-primary`, margin-top 16px
  - All centered vertically and horizontally

### Loading State

- **Daily strip area:** 3 skeleton rectangles (140px × 44px), 8px gap
- **Main area:** 7 column headers rendered, 2 skeleton cards per column (random heights 40–56px)
- **Shimmer animation:**
  ```css
  @keyframes shimmer {
    0% { background-position: -200px 0; }
    100% { background-position: 200px 0; }
  }
  ```
  - Gradient: `linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-elevated) 50%, var(--bg-tertiary) 75%)`
  - Background-size: 400px 100%
  - Duration: 1.5s, infinite, linear

### Error State

- **Banner:** full width below header bar, 44px tall
  - Background: `var(--error-bg)`
  - Text: 13px, `var(--error)`, "Failed to load schedules"
  - Right side: "Retry" link in `var(--error)`, underline on hover
  - X dismiss button: `X`, 14px, `var(--error)`, btn-ghost
  - Fade-in: 200ms, `decelerate`
  - Exit (dismiss): fade out + slide up, 150ms, `accelerate`

### Running State

- **Status dot:** `statusPulse` animation
  ```css
  @keyframes statusPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.4); }
  }
  ```
  - Duration: 1.5s, infinite, ease-in-out
- **Card:** subtle `var(--accent)` left-border (2px)
- **Expanded card:** "Running..." badge in metadata row
- **Status refresh:** every 5 seconds

### Paused State

- **Card opacity:** 0.5
- **Toggle switch:** off position
- **Status dot:** `var(--text-muted)` at 30%
- **Expanded card:** no "Trigger Now" button
- **Action:** toggle switch fires resume IPC

### Completed State (One-Shot)

- **Card background:** subtle `var(--success-bg)` tint
- **Status dot:** `var(--success)`
- **Expanded card:** shows completion result in run history (or "Scheduled to run on [date]" if not yet run)
- **Weekly grid:** may be hidden (one-shots auto-complete and leave grid); persist in month view

### Overflow States

#### Many Schedules (>20 per day in grid)

- Column scrollable (`overflow-y: auto`)
- Bottom gradient fade: 16px, transparent → column background
- If any column has >8 items, all columns sync to tallest column's height

#### Many Daily Agents (>10)

- Daily strip scrolls vertically
- Now indicator scrolls with content
- Bottom scroll fade indicator (same pattern)

#### Very Long Agent Name

- **Collapsed card:** truncate with ellipsis
- **Expanded card:** full name wraps to multiple lines
- **Weekly grid compact:** truncate at ~15 chars + ellipsis
- **Title attribute:** full name on hover (native tooltip)

#### Very Long Prompt

- **Expanded card:** max 4 lines, overflow-y auto within prompt box
- **Create/edit view:** textarea grows to max 200px, then scrolls

---

## 17. Dark / Light Theme Behavior

- **All colors via CSS custom properties.** No hardcoded hex values in component styles.
- **Theme switch:** inherited globally from Mercury's theme system. No explicit animation on switch.
- **Tokens that shift meaning:**

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--accent-subtle` | `rgba(200,153,61,0.18)` | `rgba(196,144,53,0.14)` | Today column, selected cells |
| `--accent-text` | `#f0cf8d` | `#7e5614` | Links, active text |
| `--success` | `#4ade80` | `#15803d` | Success indicators |
| `--error` | `#f87171` | `#c2410c` | Error indicators |
| `--border` | `rgba(232,218,201,0.08)` | `#eadfce` | Default borders |

- **Shadows:**
  - Dark theme: stronger shadows (higher alpha)
  - Light theme: softer shadows (lower alpha)
  - See individual component specs for exact values

- **Clock face:** verify number ring legibility in both themes. Accent on `bg-secondary` must pass WCAG AA contrast.

---

## 18. Animation Timing

### Master Rules

- **No animation exceeds 300ms.**
- **Default transition:** `var(--transition)` = 150ms ease
- **Use explicit easing values** from §2 Token Reference.

### Animation Reference Table

| Animation | Duration | Easing | Delay | Properties |
|-----------|----------|--------|-------|------------|
| Card expand | 250ms | standard | — | max-height, box-shadow |
| Card expand content fade-in | 150ms | decelerate | 100ms | opacity |
| Card collapse | 200ms | standard | — | max-height, box-shadow |
| Card collapse content fade-out | 100ms | accelerate | — | opacity |
| Card A→B switch | A: 200ms, B: 250ms | standard | B delayed 50ms | height, opacity |
| Toggle switch thumb | 200ms | spring | — | transform: translateX |
| Toggle switch bg | 200ms | standard | — | background-color |
| Toggle thumb press | — | — | — | scale 1.0→1.1 |
| View toggle (Week↔Month) | 200ms | standard | — | opacity cross-fade |
| Segmented indicator slide | 200ms | spring | — | transform: translateX |
| Create view open (content out) | 120ms | accelerate | — | translateX, opacity |
| Create view open (form in) | 180ms | decelerate | 60ms | translateX, opacity |
| Create view header cross-fade | 150ms | standard | — | opacity |
| Page load column headers | 200ms | decelerate | — | opacity |
| Page load card stagger | 180ms | decelerate | 30ms × index | opacity, translateY(8px→0) |
| Max stagger cap | — | — | 450ms (15 cards) | remaining appear instantly |
| Daily strip card stagger | 180ms | decelerate | 30ms × index | opacity, translateY |
| Clock number select | 150ms | spring | — | transform: scale |
| Clock number deselect | 100ms | standard | — | transform: scale |
| Clock hand rotation | 150ms | standard | — | transform: rotate |
| Clock stage transition (out) | 150ms | accelerate | — | opacity |
| Clock stage transition (in) | 150ms | decelerate | 100ms | opacity |
| Day detail panel open | 200ms | decelerate | — | max-height |
| Day detail content fade-in | 150ms | decelerate | 100ms | opacity |
| Day detail panel close | 150ms | standard | 50ms | max-height |
| Day detail content fade-out | 100ms | accelerate | — | opacity |
| Status dot pulse | 1500ms | ease-in-out | — | opacity, scale (infinite) |
| Skeleton shimmer | 1500ms | linear | — | background-position (infinite) |
| Now indicator reposition | 300ms | standard | — | transform: translateY |
| Error banner enter | 200ms | decelerate | — | height, opacity |
| Error banner exit | 150ms | accelerate | — | height, opacity |
| Dashboard section appear | 250ms | decelerate | — | translateY(-20px), opacity |
| Dashboard item stagger | — | — | 40ms × index | opacity, translateY |
| Dashboard dismiss | 200ms | standard | — | height, opacity |
| Hover states | 150ms | ease | — | background, border, color |
| Card hover | 150ms | ease | — | border, background |
| Run item hover | 100ms | ease | — | background, color |
| Day cell hover | 100ms | ease | — | background |
| Checkbox transition | 150ms | ease | — | background, border |
| Button hover | `var(--transition)` | ease | — | background, color |
| Input focus | `var(--transition)` | ease | — | border-color |

### Cross-Fade Pattern (Week ↔ Month)

```
Outgoing: opacity 1 → 0, 150ms
Incoming: opacity 0 → 1, 150ms, delayed 50ms
```

### Card Expand Implementation Notes

```css
/* Collapsed */
.schedule-card {
  max-height: 52px; /* daily */ or 68px /* grid */
  overflow: hidden;
  transition: max-height 250ms cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Expanded */
.schedule-card.expanded {
  max-height: 500px; /* animate to known max */
  overflow: hidden;
}

/* After animation completes, switch to: */
.schedule-card.expanded.animation-done {
  max-height: none;
  overflow: visible;
}

/* Inner content fade */
.card-content-inner {
  opacity: 0;
  transition: opacity 150ms cubic-bezier(0, 0, 0.2, 1);
}

.schedule-card.expanded .card-content-inner {
  opacity: 1;
  transition-delay: 100ms;
}
```

### Sibling Card Push

```css
.schedule-card {
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 19. Accessibility

### Keyboard Navigation

| Key | Action |
|-----|--------|
| Tab | Move focus between interactive elements |
| Enter / Space | Expand focused card, activate buttons, select pills |
| Escape | Collapse expanded card, close dropdowns, close modals |
| Arrow keys | Navigate within dropdowns, clock face numbers, day-of-week buttons |

### Focus Indicators

- All interactive elements use `:focus-visible` with `outline: 2px solid var(--border-focus)`, `outline-offset: 2px`
- Clock face numbers: `var(--accent)` background when focused (same as selected)
- Day-of-week buttons: `var(--accent)` background when focused
- Cards: `var(--border-focus)` outline when focused

### Screen Reader

- **Expanded card:** `aria-expanded="true"` on card container
- **Toggle switch:** `role="switch"`, `aria-checked` true/false
- **View toggle:** `role="radiogroup"`, each segment `role="radio"`
- **Run history items:** `role="listitem"`, each clickable with `aria-label="View trace for [schedule name] run on [date]"`
- **Status dots:** `aria-label` describing state ("Running", "Success", "Failed", "Paused")
- **Loading skeletons:** `aria-busy="true"`, `aria-label="Loading schedules"`
- **Error banner:** `role="alert"`, `aria-live="polite"`

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Color Contrast

- All text on `var(--bg-primary)` / `var(--bg-secondary)` passes WCAG AA (4.5:1 minimum)
- `var(--accent)` on `var(--bg-secondary)` verified in both themes
- `var(--text-muted)` on `var(--bg-primary)` is decorative only (not primary content)

---

## Appendix A: Component Inventory

| Component | File(s) | Notes |
|-----------|---------|-------|
| `ScheduleHeader` | New | Title, view toggle, action button |
| `DailyStrip` | New | Sidebar with now indicator, daily entries |
| `DailyEntry` | New | Compact card for daily strip |
| `WeeklyGrid` | New | 7-column grid |
| `DayColumn` | New | Single column with header + cards |
| `MonthCalendar` | New | Full calendar grid |
| `CalendarDayCell` | New | Individual day cell with dots |
| `DayDetailPanel` | New | Slide-out panel below calendar |
| `ScheduleCard` | Refactor existing | Collapsed + expanded states |
| `ScheduleCardExpanded` | New | Inline expanded content |
| `RunHistoryItem` | New | Single run entry in expanded card |
| `CreateEditView` | New | Full-screen form |
| `AgentPicker` | New | Searchable dropdown with avatars |
| `ScheduleTypePills` | Refactor existing | Reuse `.schedules-freq-pills` pattern |
| `ClockFace` | New | Android-style time picker |
| `DayOfWeekSelector` | New | 7 circular buttons + quick-select |
| `DatePicker` | New | Mini calendar for one-shot |
| `DayOfMonthGrid` | New | 1–31 grid for monthly |
| `CronInput` | New | Raw cron + human preview |
| `SkillsList` | New | Toggleable skill rows |
| `DeliveryGrid` | New | Platform chip selectors |
| `AutoNameInput` | New | Auto-generated name with manual override |
| `ToggleSwitch` | New / Extract | Reusable 34×18px switch |
| `StatusDot` | New | 6–8px dot with pulse animation |
| `SkeletonCard` | New | Shimmer loading placeholder |
| `EmptyState` | New | Centered icon + text + CTA |
| `ErrorBanner` | New | Slide-down error with retry |
| `WhileYouWereAway` | New | Dashboard widget |
| `DashboardRunItem` | New | Single run in dashboard widget |

---

## Appendix B: Breakpoints

| Width | Behavior |
|-------|----------|
| ≥ 900px content | Full layout (200px strip + 7 columns) |
| < 900px content | Day names collapse to "M", "T", "W", "T", "F", "S", "S". Date numbers remain. |
| < 700px content | Not supported (Electron window has minimum size) |
| < 800px total | Minimum supported content width |

---

## Appendix C: Data Requirements

### Schedule Object (Frontend)

```typescript
interface Schedule {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  prompt: string;
  cronExpression: string;
  frequency: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
  deliveryTargets: DeliveryTarget[];
  skills: string[];
  harness: string;
  isPaused: boolean;
  isOneShot: boolean;
  createdFromConversation?: {
    sessionId: string;
    preview: string;
  };
  nextRunAt?: Date;
  lastRunAt?: Date;
  lastRunStatus?: 'success' | 'failed' | 'running';
  recentRuns: Run[];
}

interface Run {
  id: string;
  traceId: string;
  startedAt: Date;
  endedAt?: Date;
  status: 'success' | 'failed' | 'running';
  durationMs: number;
  summary?: string;
}

type DeliveryTarget = 'local' | 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'signal' | 'matrix' | 'email' | 'sms' | 'webhook';
```

### API Requirements

- `loadJobs()` — returns all schedules
- `pauseJob(id)` / `resumeJob(id)` — toggle schedule
- `triggerCronJob(id)` — one-off run
- `deleteJob(id)` — delete schedule
- `createJob(data)` / `updateJob(id, data)` — CRUD
- `getRunsSince(timestamp)` — for "While You Were Away" dashboard

---

*End of Visual Implementation Spec*

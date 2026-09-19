---
name: Profit Tracker
description: A reseller profit tracker with three user-selectable UI styles switched at runtime via a data-attribute token system.
colors:
  neon-bg-base: "#0b0b0b"
  neon-bg-surface: "#121212"
  neon-bg-elevated: "#1a1a1a"
  neon-bg-hover: "#232323"
  neon-border: "rgba(255,255,255,0.04)"
  neon-text-primary: "#d0d0d0"
  neon-text-secondary: "#6e6e6e"
  neon-text-muted: "#404040"
  neon-accent-copper: "#cc7a45"
  neon-green: "#6e9e6e"
  neon-red: "#9e5555"
  glass-bg-base: "#111315"
  glass-bg-surface: "rgba(24,26,28,0.78)"
  glass-border: "rgba(255,255,255,0.07)"
  glass-text-primary: "#e8e2d6"
  glass-text-secondary: "rgba(232,226,214,0.52)"
  glass-accent: "#d8a65a"
  glass-green: "#8faf82"
  glass-red: "#c98374"
  impeccable-bg-base: "#0a0a0b"
  impeccable-bg-surface: "#101012"
  impeccable-bg-elevated: "#161618"
  impeccable-bg-hover: "#1c1c1f"
  impeccable-border: "rgba(255,255,255,0.08)"
  impeccable-border-hover: "rgba(255,255,255,0.14)"
  impeccable-text-primary: "#f2f2f0"
  impeccable-text-secondary: "#9a9a9f"
  impeccable-text-muted: "#5c5c61"
  impeccable-accent: "#f2f2f0"
  impeccable-accent-bg: "rgba(255,255,255,0.06)"
  impeccable-green: "#46a758"
  impeccable-green-bg: "rgba(70,167,88,0.12)"
  impeccable-red: "#e5484d"
  impeccable-red-bg: "rgba(229,72,77,0.12)"
  impeccable-amber: "#f5a623"
  impeccable-amber-bg: "rgba(245,166,35,0.12)"
  impeccable-info: "#3b82f6"
  impeccable-info-bg: "rgba(59,130,246,0.12)"
typography:
  neon-body:
    fontFamily: "Inter, sans-serif"
  glass-body:
    fontFamily: "Inter, sans-serif"
  impeccable-body:
    fontFamily: "Geist Sans, Inter, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  impeccable-mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontWeight: 500
rounded:
  legacy-card: "16px"
  legacy-workspace: "9px"
  impeccable-sm: "4px"
  impeccable-md: "6px"
  impeccable-lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
components:
  button-primary-impeccable:
    backgroundColor: "{colors.impeccable-accent}"
    textColor: "{colors.impeccable-bg-base}"
    rounded: "{rounded.impeccable-md}"
    padding: "8px 16px"
    typography: "{typography.impeccable-body}"
  button-secondary-impeccable:
    backgroundColor: "transparent"
    textColor: "{colors.impeccable-text-primary}"
    rounded: "{rounded.impeccable-md}"
    padding: "8px 16px"
    typography: "{typography.impeccable-body}"
  input-impeccable:
    backgroundColor: "{colors.impeccable-bg-surface}"
    textColor: "{colors.impeccable-text-primary}"
    rounded: "{rounded.impeccable-sm}"
    padding: "6px 10px"
    typography: "{typography.impeccable-body}"
  nav-item-selected-impeccable:
    backgroundColor: "{colors.impeccable-accent-bg}"
    textColor: "{colors.impeccable-accent}"
    padding: "10px 12px"
    typography: "{typography.impeccable-body}"
  monetary-value-impeccable:
    textColor: "{colors.impeccable-text-primary}"
    typography: "{typography.impeccable-mono}"
---

# Design System: Profit Tracker

## Overview

**Creative North Star: "One product, three coats of paint" — a shared React/Tailwind app that lets each user pick the visual language they work in, without any style owning the other two.**

Profit Tracker is a dense financial productivity tool (purchase batches, linked sales, cashback, expenses, tax prep) for resellers. Its visual system is not one design language — it's a runtime switcher between three, selected under Settings → Appearance and persisted client-side. All three read from the same routed pages and the same component tree; the difference is almost entirely CSS custom-property values plus, in a handful of files, an explicit `uiStyle` branch.

- **Neon Dark** (`neon-dark`, default) — a black, dense dashboard with a selectable saturated accent color (Copper/Arctic/Jade/Dusk/Signal). This is the original, incumbent system. It stays exactly as implemented.
- **Glassmorphism Brown** (`glassmorphism-brown`) — a warm, translucent, blurred-glass interface with brown/amber tones and its own bespoke sidebar (a floating rounded dock, not the default sidebar shape). Also incumbent. It stays exactly as implemented.
- **Impeccable** (`impeccable`) — approved, not yet implemented. A flat, monochrome, dark productivity interface inspired primarily by shadcn/ui, secondarily by Linear and Vercel. This document is its specification.

**Key Characteristics:**
- Three selectable, mutually exclusive UI styles, switched by a single `data-ui-style` attribute on `<html>`.
- Neon Dark's five accent color themes (`data-theme`) apply **only** to Neon Dark.
- Impeccable is monochrome-only: near-black backgrounds, near-white foreground, color reserved for profit/loss/warning/informational semantics — never a user-selectable accent hue.
- No IA change across styles: same routes, same components, same data. Only surface treatment differs.

## Colors

Each style defines its own closed palette; none of the three share token values, only token *names* (`--bg-base`, `--text-primary`, etc.) via CSS custom properties re-scoped per `data-ui-style`/`data-theme`.

### Neon Dark (incumbent — do not change)
- **Base surface** (`#0b0b0b` bg-base / `#121212` bg-surface / `#1a1a1a` bg-elevated): the black dashboard body.
- **Accent** (`#cc7a45` Copper, default; Arctic/Jade/Dusk/Signal selectable): saturated, used for active nav, primary actions, chart highlight.
- **Text** (`#d0d0d0` primary / `#6e6e6e` secondary / `#404040` muted).
- Full accent variants are defined in `selvora-app/src/index.css:57-200`; treat that file as the source of truth for exact values, not this summary.

### Glassmorphism Brown (incumbent — do not change)
- **Base surface** (`#111315` bg-base, `rgba(24,26,28,0.78)` translucent bg-surface with backdrop blur).
- **Accent** (`#d8a65a` warm gold).
- **Text** (`#e8e2d6` primary, low-opacity variants for secondary/muted).
- Defined in `selvora-app/src/index.css:38-54, 202-227`.

### Impeccable (approved specification)
- **Near-black surfaces**: `#0a0a0b` base, `#101012` surface (sidebar/header/inputs), `#161618` elevated (dialogs/dropdowns/popovers/tooltips), `#1c1c1f` hover.
- **Near-white text**: `#f2f2f0` primary, `#9a9a9f` secondary (neutral gray), `#5c5c61` muted (metadata/labels).
- **Accent is monochrome, not a hue**: `#f2f2f0` (near-white) — used for primary filled buttons (near-black text on near-white fill) and the selected-nav state (near-white text + `rgba(255,255,255,0.06)` wash + left border bar). This is the mechanism behind "black/white primary controls."
- **Semantic-only color**: green `#46a758` / bg `rgba(70,167,88,0.12)` for profit and success; red `#e5484d` / bg `rgba(229,72,77,0.12)` for loss, destructive actions, and errors; amber `#f5a623` / bg `rgba(245,166,35,0.12)` for warnings; blue `#3b82f6` / bg `rgba(59,130,246,0.12)` reserved for rare informational states.
- **Borders**: `rgba(255,255,255,0.08)` default, `rgba(255,255,255,0.14)` on hover — this is the primary structuring device (see Elevation & Depth).

### The Isolated Palette Rule.
Impeccable never reads the Copper/Arctic/Jade/Dusk/Signal accent tokens. Its `:root[data-ui-style="impeccable"]` block is placed **after** the `data-theme` blocks in `index.css` so it wins the cascade regardless of whichever `colorTheme` happens to be stored in `localStorage` — the same technique `glassmorphism-brown`'s override block already uses against `data-theme`.

## Typography

**Neon Dark / Glassmorphism Brown body font:** Inter (unchanged — `selvora-app/src/index.css:1`).

**Impeccable body font:** Geist Sans, loaded the same way Inter is now (an additional `@import` in `index.css`), scoped to `.impeccable-workspace` and the sidebar/header when that style is active — never applied globally, so it cannot bleed into the other two styles.

**Impeccable technical font:** Geist Mono, `font-variant-numeric: tabular-nums`, applied selectively to dollar amounts, percentages, IDs/reference numbers, and table dates — never to full rows or labels.

**Character:** compact and information-dense, matching the app's existing `font-size: 95%` root sizing rather than Neon Dark's larger display headers.

### Hierarchy (Impeccable)
- **Page title** (600, 20px): route/page headers.
- **Section label** (600, 11px, uppercase, tracked): reuses the existing `.section-title` mechanism.
- **Body** (400–500, 13px): default interface text.
- **Secondary / metadata** (400, 12px, `--text-secondary`): timestamps, helper text.
- **Micro label** (500, 11px, `--text-muted`): field labels, table headers.
- **Monetary — primary total** (600, 16–18px, Geist Mono): dashboard totals, stat cards.
- **Monetary — row-level** (500, 13–14px, Geist Mono): table/list amounts.

### Named Rules
**The Selective Mono Rule.** Geist Mono is for scannable numeric/technical values only — dollar amounts, percentages, IDs, reference numbers. The interface is never fully monospace.

## Layout

Grid, routing, breakpoints, and component boundaries are identical across all three styles — this is a styling switcher, not a layout switcher. Sidebar collapse behavior, the mobile hamburger/overlay mechanic, and responsive breakpoints in `Shell.jsx`/`Sidebar.jsx` are shared code paths; Impeccable reuses them exactly, only flattening chrome (no blur, no gradient) at each state.

**Impeccable spacing** uses a 4px base grid (`4/8/12/16/24/32`): tight row/table padding (`8–12px` vertical) for density, `24–32px` gaps between sections so grouping reads from spacing and borders rather than card backgrounds.

## Elevation & Depth

**Neon Dark** uses flat cards with soft `box-shadow` glow on selected elements (`.card-glow`) and a hover lift (`.card-hover { transform: translateY(-2px) }`). **Glassmorphism Brown** is genuinely layered: `backdrop-filter: blur()`, translucent surfaces, soft ambient shadows (`0 12px 32px rgba(0,0,0,0.28)`) on its floating sidebar dock. Both stay as implemented.

**Impeccable is flat by default, always.** No shadow at rest, no hover lift, no glow, no blur. Depth is conveyed by border and background-value steps only (`--bg-base` → `--bg-surface` → `--bg-elevated` → `--bg-hover`), not by shadow. The single exception is a hairline lift (`0 1px 2px rgba(0,0,0,0.24)`) reserved for floating layers only: dropdowns, dialogs, tooltips, popovers, toasts.

### Shadow Vocabulary (Impeccable)
- **Flat surface** (no shadow): page background, sidebar, header, sections, rows, inputs, buttons — everything at rest.
- **Floating hairline** (`box-shadow: 0 1px 2px rgba(0,0,0,0.24)`): dialogs, dropdowns, tooltips, popovers, toasts only.

### Named Rules
**The Flat-At-Rest Rule.** If it isn't floating above the page (dialog, dropdown, tooltip, popover, toast), it has no shadow. No exceptions, no "just a little" ambient glow.

## Shapes

**Neon Dark / Glassmorphism Brown**: predominantly `rounded-lg`/`rounded-xl`/`rounded-2xl` (8–16px) on cards, retrofit to a flatter 9px inside `.carbon-workspace` surfaces. Unchanged.

**Impeccable**: a restrained three-step scale — `4px` (inputs, badges, chips), `6px` (buttons, grouped sections), `8px` (dialogs, dropdowns, tooltips). Nothing at the `rounded-2xl` (16px) scale the other two themes use.

## Components

### Workspace Architecture (read this before touching any theme code)

Style selection flows through one mechanism, reused by all three styles — **do not invent a second theming system**:

1. `UI_STYLE_OPTIONS` in `selvora-app/src/hooks/useUiPreferences.js` lists the three style ids (`neon-dark`, `glassmorphism-brown`, `impeccable`) and persists the selection to `localStorage` under `ui_preferences`.
2. `applyColorTheme()` in the same file sets two attributes on `document.documentElement`: `data-theme` (Neon Dark's accent color only) and `data-ui-style` (the active style).
3. `selvora-app/src/index.css` defines CSS custom properties per style, keyed off those attributes: `:root { ... }` (Neon Dark base), `:root[data-theme="..."]` (accent variants, Neon Dark only), `:root[data-ui-style="glassmorphism-brown"]`, and — new — `:root[data-ui-style="impeccable"]`.
4. `Shell.jsx` picks a **workspace wrapper class** on the main content container based on `preferences.style`, and that class is what retrofits literal, hard-coded Tailwind utility classes on individual pages (e.g. `bg-[#12121A]`, `text-purple-400`, `shadow-...`) into the active CSS variables via attribute-selector overrides (`[class*="..."]`) in `index.css`.

**The three workspace classes are siblings, not a hierarchy:**

- `.carbon-workspace` — Neon Dark's override block (`index.css:276-539`). Unchanged.
- `.glass-workspace` — Glassmorphism Brown's override block (`index.css:541-670+`). Unchanged.
- `.impeccable-workspace` — **new**, Impeccable's own override block. It must be written as an independent block, not layered on top of or sharing rules with `.carbon-workspace`.

### The No-Inheritance Rule.
Impeccable must not inherit `.carbon-workspace`'s override rules, even though both are "non-glass." They are visually related by coincidence of one being the historical default, not by design relationship. A future edit to Neon Dark's overrides (e.g. adjusting its hover lift or card radius) must never silently change Impeccable, and vice versa. `Shell.jsx`'s current `isCarbonWorkspace = !isGlass` boolean is a **two-way** assumption baked as a boolean; it must become an explicit three-way selection (`neon-dark` → `carbon-workspace`, `glassmorphism-brown` → `glass-workspace`, `impeccable` → `impeccable-workspace`) so Impeccable can never silently fall back to Neon Dark's class by default.

### Elsewhere in the app, no branch changes are needed.
`Sidebar.jsx`, `Dashboard.jsx`, `StatCard`, `PipelineCard`, and the chart components all gate their special-case JSX on `uiStyle === 'glassmorphism-brown'` specifically. Since `'impeccable'` is neither `'glassmorphism-brown'` nor unhandled, it falls through to each component's existing default/Neon-Dark JSX branch automatically — that default branch is either already `var()`-driven (Sidebar) or gets re-skinned by the new `.impeccable-workspace` CSS rules (pages using literal Tailwind color classes). **Prefer token/CSS changes first.** Only introduce Impeccable-specific JSX branches (a third `if`/ternary arm, a new prop) when a CSS-only override inside `.impeccable-workspace` genuinely cannot achieve the approved look — e.g., the one approved exception below.

### The CSS-First Rule.
Before adding an `if (uiStyle === 'impeccable')` branch anywhere, exhaust what `.impeccable-workspace [class*="..."]` overrides and `:root[data-ui-style="impeccable"]` token values can achieve. JSX branches are the expensive, hard-to-maintain path; token/CSS overrides are the cheap, safe one.

### Approved structural exception: the stat-card grid wrapper
Dashboard's stat-card grid renders each `StatCard` as an independently chromed card. Impeccable's "sections/rows over cards" direction needs these visually grouped into one bordered section with internal dividers rather than floating individually. A pure CSS retrofit cannot fully achieve this for a `grid` of independent elements, so one shared bordered wrapper `<div>` around the stat-card grid is approved — **conditionally rendered only when `preferences.style === 'impeccable'`**, changing nothing about Neon Dark's or Glassmorphism Brown's DOM, data, or component props.

### Buttons
- **Shape:** 6px radius (`{rounded.impeccable-md}`).
- **Primary:** solid `--accent` (near-white) fill, near-black text, 8px/16px padding — the "black/white primary controls" mandate.
- **Secondary/Ghost:** transparent fill, 1px `--border-default`, `--text-primary` text.
- **Destructive:** `--red` text/border only, not a filled red button — reserved for genuinely destructive confirmations.
- **Hover/Focus:** 100–150ms background/border transition; focus ring is a 1–2px solid ring at `--text-primary`/`--accent` opacity with 2px offset, no glow.

### Cards / Containers (Impeccable)
- **Corner style:** 6px.
- **Background:** matches page background (`--bg-base`/`--bg-surface`) — no elevation lift for static cards.
- **Shadow strategy:** none (see Elevation & Depth). The stat-card grid uses the approved shared wrapper + internal 1px dividers instead of per-card chrome.
- **Border:** 1px `--border-default`.
- **Internal padding:** 12–16px.

### Inputs / Fields (Impeccable)
- **Style:** `--bg-surface` fill, 1px `--border-default`, 4px radius.
- **Focus:** 1px solid ring shift toward `--text-primary`, no glow.
- **Error:** 1px `--red`-tinted border on the field, `--red` helper text — never a full red background fill.

### Tables / Transaction Rows (Impeccable)
Dense, 1px `--border-default` row dividers (no zebra striping by default — alternating fills compete with the "quiet secondary metadata" mandate). Right-aligned Geist Mono numeric columns. Hover = `--bg-hover` background only, no scale/shadow.

### Navigation (Impeccable)
Reuses the existing non-glass `Sidebar.jsx` DOM as-is — already `var()`-driven. Selected item: near-white text + `--accent-bg` wash + left border bar (the existing mechanism, resolving to neutral tokens instead of a hue). Section labels stay 11px uppercase tracked, `--text-muted`. Mobile: same collapse/overlay mechanic, flattened chrome (no blur, no gradient).

### Tabs, Badges, Dialogs, Dropdowns, Tooltips (Impeccable)
- **Tabs:** underline-style (1–2px `--accent` underline on active), not pill/background tabs.
- **Badges:** flat, 4px radius, semantic `-bg` background + matching text color + low-opacity matching border.
- **Dialogs / Dropdowns / Tooltips:** `--bg-elevated`, 1px `--border-default`, 8px radius, hairline shadow only (see Elevation & Depth).

### Charts (Impeccable)
Grayscale series by default (`--chart-2..4` stepped neutral grays); the profit/loss series specifically uses `--green`/`--red`, not a rotating rainbow assignment. Gridlines at `--border-default` opacity. No gradient area fills, no drop-shadow on chart elements.

## Do's and Don'ts

### Do:
- **Do** reuse the existing `data-ui-style`/`data-theme` attribute + CSS custom property mechanism for every Impeccable value — no new theming system.
- **Do** place `:root[data-ui-style="impeccable"]` after the `data-theme` blocks in `index.css` so it always wins the cascade regardless of stored `colorTheme` (The Isolated Palette Rule).
- **Do** give Impeccable its own `.impeccable-workspace` override block, independent from `.carbon-workspace` (The No-Inheritance Rule).
- **Do** exhaust token/CSS overrides before adding any `uiStyle === 'impeccable'` JSX branch (The CSS-First Rule).
- **Do** reserve color for profit (green), loss/destructive/error (red), warning (amber), and rare informational (blue) states only.
- **Do** use Geist Mono selectively for scannable numeric/technical values (The Selective Mono Rule).
- **Do** keep shadows to the floating-layer hairline only; everything else is flat at rest (The Flat-At-Rest Rule).

### Don't:
- **Don't** modify any Neon Dark token, class, or component branch (`:root { ... }`, `data-theme="..."` blocks, `.carbon-workspace`, `Sidebar.jsx`'s default branch).
- **Don't** modify any Glassmorphism Brown token, class, or component branch (`--glass-*` tokens, `data-ui-style="glassmorphism-brown"`, `.glass-workspace`, `Sidebar.jsx`'s glass branch).
- **Don't** let the Copper/Arctic/Jade/Dusk/Signal accent picker affect Impeccable, and don't show that picker for Impeccable (it's already gated to `style === 'neon-dark'` in `UiPreferences.jsx` — keep it that way).
- **Don't** add card shadows, hover lift (`translateY`), glow, gradients, backdrop-blur, or decorative blobs anywhere inside `.impeccable-workspace`.
- **Don't** use a filled/saturated color for anything that isn't a profit/loss/warning/informational signal.
- **Don't** apply Geist Mono to the whole interface — labels, headers, and body text stay Geist Sans.
- **Don't** introduce a light-mode variant of Impeccable; it is dark-mode-only for now.
- **Don't** restructure routes, remove features, or change dashboard functionality while implementing this theme — it is a visual style only.

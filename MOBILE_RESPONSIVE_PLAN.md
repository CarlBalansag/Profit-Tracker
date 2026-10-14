# Mobile Responsive Pass — Progress Tracker

**Branch:** `feature/mobile-responsive-ui`
**Worktree:** `C:\Users\Carl\Desktop\Projects\selvora_clone-mobile-responsive` (main repo stays untouched at `C:\Users\Carl\Desktop\Projects\selvora_clone`)
**Dev server:** `cd selvora-app && npm run dev` (Vite, deps already installed in this worktree)
**Task ledger row:** `TASKS.md` on `main` has a row for `feature/mobile-responsive-ui` — remove it when this merges.

This file is the single source of truth for resuming this work across sessions. When you pick this back up: read this file top to bottom, find the first unchecked `[ ]`, and continue there. Check boxes off (`[x]`) only after the page/component has been verified with Playwright at mobile widths AND desktop (1440px) regression-checked.

## Ground rules (do not violate)

- No business logic, API, schema, or desktop visual design changes. CSS/layout/responsive-structure only.
- Preserve every feature on mobile — if a desktop layout can't fit, convert it (card list instead of wide table, horizontal scroll, accordion, etc.) rather than hiding functionality.
- Test at: 320, 375, 390, 430, 768, 1024, then 1440 regression.
- Tailwind breakpoints in this app: `sm`=640, `md`=768, `lg`=1024, `xl`=1280, `3xl`=custom (check `tailwind.config` if used — app uses Tailwind v4 CSS-first config, check `index.css` `@theme` block if present).
- Commit in small, logical chunks on this branch as pages/components are finished — don't wait for the whole thing to be done to commit.
- Bump version + changelog entry (`selvora-app/src/data/changelog.js`) once at the end of this effort (or per logical milestone if the user wants incremental releases) per AGENTS.md rule 8 — this is a user-visible behavior change (mobile now works), so it qualifies.

## Baseline findings from initial code audit (2026-10-13)

- `Shell.jsx` / `Sidebar.jsx` **already have** hamburger + slide-out drawer scaffolding for mobile (`lg:hidden` header with menu button, `isOpen`/`translate-x-full` overlay, backdrop). Both the default `neon-dark` theme sidebar and the `glassmorphism-brown` theme dock have mobile-hidden/show logic already wired up.
  - Do NOT rebuild this from scratch. Audit first — confirm it actually works correctly at each breakpoint (no overflow, overlay z-index right, drawer closes on nav, touch target sizes ok) and fix bugs rather than replacing the pattern.
- Tailwind v4 + `clsx` used throughout; some custom CSS files also exist (`index.css` 885 lines, `App.css` 184 lines, plus per-feature `.css` files for ScheduleC, Header, Sidebar, UI). ~22 existing `@media` usages across 9 files — some responsive groundwork already exists, don't assume a blank slate.
- MCP tooling: `.mcp.json` added in this worktree with `playwright` (`@playwright/mcp`) and `chrome-devtools` (`chrome-devtools-mcp`) servers, both via `npx -y ...`. Restart/reload the Claude Code session in this worktree if the tools don't show up as available yet.

## Phase 0 — Audit (do this first, keep it cheap)

Goal: find real problems, not guess at them. Use Playwright MCP to load each page at 375px and 1440px, screenshot to a local scratch folder (not inline in chat), and note overflow/broken nav/unreadable text/overlapping elements. Batch pages together in one browser session (reuse the session, don't restart per page) to save tokens.

- [ ] Start dev server, confirm it boots in this worktree
- [ ] Playwright: walk all routes below at 375px width, screenshot + note issues per page in the table below (one pass, concise notes only)
- [ ] Playwright: spot-check the same routes at 1440px to confirm nothing is currently broken on desktop (baseline before any edits)
- [ ] Fill in "Known issues" column below from audit before starting Phase 1/2 fixes

## Phase 1 — Shared components (fix once, benefits every page)

| Component | File | Status | Known issues (fill in during audit) |
|---|---|---|---|
| Shell / mobile header | `src/components/Layout/Shell.jsx` | [ ] | |
| Sidebar (neon-dark drawer) | `src/components/Layout/Sidebar.jsx` | [ ] | |
| Sidebar (glassmorphism dock) | `src/components/Layout/Sidebar.jsx` (glass branch) | [ ] | |
| Table (shared data table) | `src/components/UI/Table.jsx` | [ ] | Likely needs horizontal-scroll or card-view fallback on narrow screens |
| StatCard | `src/components/UI/StatCard.jsx` | [ ] | |
| ActionFormModal | `src/components/UI/ActionFormModal.jsx` | [ ] | Modal sizing/positioning on small viewports |
| ConfirmDialog | `src/components/UI/ConfirmDialog.jsx` | [ ] | |
| ContextualActions | `src/components/UI/ContextualActions.jsx` | [ ] | |
| MoreActionsMenu | `src/components/UI/MoreActionsMenu.jsx` | [ ] | Dropdown positioning near screen edges |
| MarkPaidModal | `src/components/UI/MarkPaidModal.jsx` | [ ] | |
| QuickStatusSelect / StatusPipeline | `src/components/UI/QuickStatusSelect.jsx`, `StatusPipeline.jsx` | [ ] | |
| TransactionDetailModal | `src/components/TransactionDetailModal.jsx` | [ ] | |
| VersionHistoryModal | `src/components/VersionHistoryModal.jsx` | [ ] | |
| DashboardSettingsModal | `src/components/DashboardSettingsModal.jsx` | [ ] | |
| Charts (recharts wrappers) | `src/components/Dashboard/MonthlyProfitSpendChart.jsx`, `ProfitRevenueTrendChart.jsx` | [ ] | Recharts `ResponsiveContainer` behavior on narrow widths |
| Calendar event modal/popover | `src/components/Calendar/CalendarEventModal.jsx`, `CalendarEventPopover.jsx` | [ ] | FullCalendar mobile rendering |
| Settings sub-forms | `src/components/Settings/*.jsx` (Accounts, Cashouts, Marketplaces, Vendors, PaymentMethods, CustomCardModal, ApiKeys, QuickAddModal, UiPreferences, ScheduleCSettings) | [ ] | |
| Auth screens | `src/components/Auth/*.jsx` (FirebaseLoginForm, FirebaseAccount, ServerWakeUpScreen) | [ ] | |
| Tutorial overlay | `src/components/Tutorial/SpotlightOverlay.jsx` | [ ] | Spotlight coordinate math may break on small screens |

## Phase 2 — Pages (route → file)

| Route | Page file | Status | Known issues |
|---|---|---|---|
| `/login` | `src/pages/Login.jsx` | [ ] | |
| `/` | `src/pages/Dashboard.jsx` | [ ] | |
| `/add-transaction` | `src/pages/AddTransaction.jsx` | [ ] | |
| `/add-sale` | `src/pages/AddSale.jsx` | [ ] | |
| `/transactions` | `src/pages/Transactions.jsx` | [ ] | |
| `/inventory` | `src/pages/Inventory.jsx` | [ ] | |
| `/shipping` | `src/pages/Shipping.jsx` | [ ] | |
| `/statuses` | `src/pages/Statuses.jsx` | [ ] | |
| `/expenses` | `src/pages/Expenses.jsx` | [ ] | |
| `/schedule-c` (flagged) | `src/pages/ScheduleC.jsx` | [ ] | |
| `/receipts` | `src/pages/Receipts.jsx` | [ ] | |
| `/invoices` (unrouted currently — check `App.jsx`) | `src/pages/Invoices.jsx` | [ ] | |
| `/analytics` | `src/pages/Analytics.jsx` | [ ] | Chart-heavy, likely the hardest page |
| `/cashflow` | `src/pages/CashFlow.jsx` | [ ] | |
| `/creditcard` | `src/pages/CreditCard.jsx` | [ ] | |
| `/settings` | `src/pages/Settings.jsx` | [ ] | Many tabs/sub-panels, test each tab |
| `/tax-exempt` | `src/pages/TaxExempt.jsx` | [ ] | |
| `/guide` | `src/pages/Guide.jsx` | [ ] | |
| `/goals` | `src/pages/Goals.jsx` | [ ] | |
| `/calendar` | `src/pages/Calendar.jsx` | [ ] | FullCalendar — known hard case on mobile, may need agenda/list view |
| (not routed in `App.jsx`) | `src/pages/Forecast.jsx` | [ ] | Confirm if dead code or pending feature before touching |

## Phase 3 — Final verification pass

- [ ] Re-walk every route above at 320, 375, 390, 430, 768, 1024, 1440 in one pass, screenshot diffed against Phase 0 baseline
- [ ] No horizontal scroll on `<body>` anywhere (check via DevTools `document.documentElement.scrollWidth` vs `innerWidth`)
- [ ] All modals usable (open/close/submit) at 375px
- [ ] Sidebar drawer open/close + nav works at 375px and collapses correctly back to desktop at 1024px+
- [ ] Forms: no input causes horizontal overflow, labels/buttons remain tappable (min ~44px touch target)
- [ ] `npm run lint` and `npm run build` clean in `selvora-app/`
- [ ] `npm run test` (vitest) still passes — this task shouldn't touch logic, so existing tests should be unaffected; investigate any new failure
- [ ] Desktop regression screenshot pass at 1440px confirms no visual change from Phase 0 baseline

## Session resume checklist

1. `cd C:\Users\Carl\Desktop\Projects\selvora_clone-mobile-responsive`
2. `git status` / `git log --oneline -5` to see what's already committed on this branch
3. Re-open this file, find first unchecked box
4. If Playwright/Chrome DevTools MCP tools aren't available in this session, they're configured in `.mcp.json` at the worktree root — may need session restart to pick up
5. Continue from there

## Merge checklist (when Phase 3 is fully checked off)

1. Version bump + changelog entry in `selvora-app/src/data/changelog.js` (compute `+0.01` from `main`'s current top entry at merge time, not when this branch started)
2. Final `npm run lint && npm run build && npm run test` clean
3. Merge `feature/mobile-responsive-ui` into `main`
4. Remove this task's row from `TASKS.md` on `main`
5. Remove the worktree: `git worktree remove ../selvora_clone-mobile-responsive` (from the main repo) after merge

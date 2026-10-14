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

- [x] Start dev server, confirm it boots in this worktree — also had to bring up `selvora-api` (Prisma generate, `NODE_ENV=development` + `FRONTEND_URL=http://localhost:5174` in local `.env` only) to get past the Firebase login gate. See "Environment setup notes" below.
- [x] Playwright: walk all routes below at 375px width, screenshot + note issues per page in the table below (one pass, concise notes only) — all routes covered except `/schedule-c` (feature-flagged off, redirects to `/`) and `Forecast.jsx` (unrouted, not audited)
- [ ] Playwright: spot-check the same routes at 1440px to confirm nothing is currently broken on desktop (baseline before any edits) — only 3 of ~19 routes spot-checked so far (AddTransaction, CreditCard, Settings), to confirm the bugs found are mobile-only. Remaining routes not yet spot-checked.
- [x] Fill in "Known issues" column below from audit before starting Phase 1/2 fixes — first pass done; not yet exhaustive (didn't open every modal, every Settings sub-tab, or test 320/390/430/768/1024 widths yet)

### Environment setup notes (for next session / resume)

- `selvora-app/.env.local` and `selvora-api/.env` are already present in this worktree, copied from production. **`selvora-api/.env` was production config** (`NODE_ENV=production`, live Neon DB, live Firebase service account, `FRONTEND_URL=https://profittracker.carltechs.com`) — confirmed with the user before touching it.
- Changed locally (gitignored, worktree-only, never commit): `FRONTEND_URL=http://localhost:5174` (Vite picked 5174, not 5173 — port was already in use) and `NODE_ENV=development`. Production mode has a hard guard in `selvora-api/services/firebase.js:10` that refuses to boot at all unless `FRONTEND_URL` is HTTPS, and separately sets cookies `Secure`+`SameSite=None` which Chrome won't store over plain HTTP — so `NODE_ENV=development` is required for any local login testing against this backend.
- Despite `NODE_ENV=development` setting `ssl: false` explicitly on the session-store Postgres pool (`selvora-api/index.js:85`), it still connected fine to Neon — the connection string's own `sslmode=require` took effect regardless.
- To start both servers: `cd selvora-api && npm install && npx prisma generate && npm run start` (port 3000), then `cd selvora-app && npm run dev` (port 5173 or next free port — check `FRONTEND_URL` matches whatever port Vite actually picks).
- This points at the real dev/production database — be careful not to create/edit/delete real records during audits; this pass has been read-only/view-only.

## Phase 1 — Shared components (fix once, benefits every page)

| Component | File | Status | Known issues (fill in during audit) |
|---|---|---|---|
| Shell / mobile header | `src/components/Layout/Shell.jsx` | [ ] | |
| Sidebar (neon-dark drawer) | `src/components/Layout/Sidebar.jsx` | [ ] | **Fixed:** drawer wasn't auto-closing after clicking a nav link. Added an `onClick` handler on the `<aside>` (event delegation: closes `isOpen` when the click target is inside an `<a>`) so it closes on any nav-link tap without touching every `NavItem` call site. Verified at 375px (closes correctly) and 1440px (no regression — `isOpen` doesn't affect desktop layout anyway via `lg:static lg:translate-x-0`). Other breakpoints (320/390/430/768/1024) not yet swept. |
| Sidebar (glassmorphism dock) | `src/components/Layout/Sidebar.jsx` (glass branch) | [ ] | Same close-on-nav-click fix applied and verified: switched theme to Glassmorphism Brown via Settings → Appearance, confirmed at 375px the icon dock opens and auto-closes correctly on nav-link tap. Switched back to Neon Dark (default) afterward. |
| Table (shared data table) | `src/components/UI/Table.jsx` | [ ] | Already uses the horizontal-scroll pattern on narrow screens (confirmed on Receipts, Dashboard Recent Sales, Expenses, Tax Exempt, Analytics Recent Sales) — functional, consistent with the plan's allowed patterns. Not converted to card-view; would be a larger, more opinionated change than this pass's bug-fix scope. Receipts specifically only shows 1 of 5 columns before needing to scroll — the most cramped instance, still usable. |
| StatCard | `src/components/UI/StatCard.jsx` | [ ] | Used all over (Dashboard, Transactions, Inventory, Expenses, Tax Exempt, CashFlow) — clean everywhere checked. |
| ActionFormModal | `src/components/UI/ActionFormModal.jsx` | [ ] | Checked via "Add Expense" at 375px — clean. Centered, fields stack into sane pairs, good touch targets, Cancel/Submit buttons always visible. |
| ConfirmDialog | `src/components/UI/ConfirmDialog.jsx` | [ ] | Checked via Expenses row "Delete" at 375px — clean. Centered, legible, good touch targets. |
| ContextualActions | `src/components/UI/ContextualActions.jsx` | [ ] | Not yet specifically isolated/tested. |
| MoreActionsMenu | `src/components/UI/MoreActionsMenu.jsx` | [ ] | Checked via Statuses "More actions" (⋮) at 375px — clean, dropdown positions correctly near the trigger, not clipped off-screen. |
| MarkPaidModal | `src/components/UI/MarkPaidModal.jsx` | [ ] | Checked via Statuses "Mark Paid…" at 375px — clean. |
| QuickStatusSelect / StatusPipeline | `src/components/UI/QuickStatusSelect.jsx`, `StatusPipeline.jsx` | [ ] | `StatusPipeline.jsx` reviewed as part of the Dashboard "faded tiles" re-investigation — its own `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` is already responsive; used standalone (not via Dashboard's separate `PipelineCard`) on the Statuses page column headers, clean at 375px. |
| TransactionDetailModal | `src/components/TransactionDetailModal.jsx` | [ ] | Checked the inline edit modal (expand icon on a Transactions row) at 375px — clean, internal scroll, 2-column field pairs collapse sensibly, Cancel/Update always visible. (Didn't separately find/test a distinct read-only "TransactionDetailModal" view if one exists apart from the edit form — the expand icon opened the edit form directly.) |
| VersionHistoryModal | `src/components/VersionHistoryModal.jsx` | [ ] | Not yet tested (opens from the "v0.64" sidebar button). |
| DashboardSettingsModal | `src/components/DashboardSettingsModal.jsx` | [ ] | Checked at 375px — clean. Long scrollable list (time frame, section toggles, reorderable card/column lists) with sticky Cancel/Save footer, good touch targets on the up/down reorder and visibility-toggle icon buttons. |
| Charts (recharts wrappers) | `src/components/Dashboard/MonthlyProfitSpendChart.jsx`, `ProfitRevenueTrendChart.jsx` | [ ] | Recharts `ResponsiveContainer` behavior on narrow widths |
| Calendar event modal/popover | `src/components/Calendar/CalendarEventModal.jsx`, `CalendarEventPopover.jsx` | [ ] | FullCalendar mobile rendering |
| Settings sub-forms | `src/components/Settings/*.jsx` (Accounts, Cashouts, Marketplaces, Vendors, PaymentMethods, CustomCardModal, ApiKeys, QuickAddModal, UiPreferences, ScheduleCSettings) | [ ] | **Bug found and fixed:** `PaymentMethods.jsx`'s "Card Intelligence" banner had a 3-tile stat row (`flex gap-4`, each tile `min-w-30`/120px) with no `overflow-x-auto` of its own — at 375px the 3rd tile ("Perks · Active") got clipped at the viewport edge. Fixed by adding `overflow-x-auto` + `flex-shrink-0` to the row/tiles, same pattern as the Analytics tab-strip fix. Verified at 375px (scrolls locally, no clipping) and 1440px (unchanged). Accounts, Vendors, Marketplaces, Cashouts sub-pages all clean at 375px. Not yet checked: ApiKeys, CustomCardModal, QuickAddModal, ScheduleCSettings (schedule-c flag is off). |
| Auth screens | `src/components/Auth/*.jsx` (FirebaseLoginForm, FirebaseAccount, ServerWakeUpScreen) | [ ] | |
| Tutorial overlay | `src/components/Tutorial/SpotlightOverlay.jsx` | [ ] | Spotlight coordinate math may break on small screens |

## Phase 2 — Pages (route → file)

| Route | Page file | Status | Known issues |
|---|---|---|---|
| `/login` | `src/pages/Login.jsx` | [ ] | Audited at 375px and 1440px, clean at both. Not yet checked at other mobile widths. |
| `/` | `src/pages/Dashboard.jsx` | [x] | Corrected after re-investigation: no overlap bug. The faded Status Pipeline tiles are intentional (`PipelineCard` applies `opacity-30` to zero-count tiles by design, confirmed present at 1440px too). "Recent Sales" `<table>` already scrolls correctly inside its own `overflow-x-auto` wrapper, same pattern as Receipts — confirmed via screenshot after scrolling the correct inner container (`h-full overflow-auto theme-scrollbar`, nested inside `.carbon-workspace`). No fix needed. |
| `/add-transaction` | `src/pages/AddTransaction.jsx` | [ ] | **Fixed:** Tax/Shipping Cost/Fees grid and Payment Method/Cashback Rate/Cashback Amount grid (second instance of the same `grid-cols-3` bug, found while fixing the first) both changed to `grid-cols-1 sm:grid-cols-3`. Verified at 375px (stacks cleanly, full `$0.00` visible) and 1440px (unchanged, still 3-up) — also re-confirmed under the Glassmorphism Brown theme. Other breakpoints not yet swept. |
| `/add-sale` | `src/pages/AddSale.jsx` | [ ] | Clean at 375px (card list) and 1440px. |
| `/transactions` | `src/pages/Transactions.jsx` | [ ] | Mostly clean at 375px; filter chip labels truncate ("All Payment Metho...", "Search produ...") — acceptable, not breaking layout. Clean at 1440px. Didn't scroll through full list/table below the fold yet at 375px. |
| `/inventory` | `src/pages/Inventory.jsx` | [ ] | Clean at 375px (stat cards + search, fold only) and 1440px. |
| `/shipping` | `src/pages/Shipping.jsx` | [ ] | Clean at 375px. At 1440px, the Outbound Shipping table scrolls horizontally even at full desktop width (6 columns incl. long carrier/tracking text) — pre-existing behavior, not touched by any mobile edit, not a regression. |
| `/statuses` | `src/pages/Statuses.jsx` | [ ] | Clean at 375px (kanban-style cards stack fine) and 1440px (3-column board). |
| `/expenses` | `src/pages/Expenses.jsx` | [ ] | Clean at 375px and 1440px. |
| `/schedule-c` (flagged) | `src/pages/ScheduleC.jsx` | [ ] | `SCHEDULE_C_ENABLED` is off — route redirects to `/`. Not auditable until flag is on; skipped. |
| `/receipts` | `src/pages/Receipts.jsx` | [ ] | Table is cramped at 375px — only the "Item" column visible, horizontal scroll needed for the rest ("Type" column barely visible). Functional but a card-view candidate. Confirmed clean/full-width at 1440px (all 5 columns visible, no scroll needed) — clipping is mobile-only. |
| `/invoices` | `src/pages/Invoices.jsx` | [ ] | Now routed in `App.jsx` (plan's old note that it was unrouted is stale). Clean at 375px and 1440px (empty state). **Note (not a mobile issue, FYI only):** no sidebar nav link exists for this page at any width — only reachable by direct URL. Out of scope to fix. |
| `/analytics` | `src/pages/Analytics.jsx` | [ ] | Chart renders fine visually at 375px despite a transient Recharts console warning (`width(-1) height(-1)` before ResizeObserver settles) — not a visible bug. All 5 tabs (Breakdowns, Channels, Payments, Recent Sales) checked at 375px by scrolling to the bottom of each — all clean. **Bug found and fixed:** the tab-pill strip (5 buttons, `flex-1`, no `overflow-x-auto` of its own) overflowed at 375px with no local scroll container, so clicking the off-screen "Recent Sales" tab triggered the browser's native focus-scroll-into-view on the nearest scrollable ancestor — which was the whole page's `.carbon-workspace`, not the tab strip — dragging the entire page horizontally and clipping unrelated content left of the viewport. Fixed by adding `overflow-x-auto` to the tab strip and `min-w-[110px] whitespace-nowrap` to each tab button, so the strip scrolls independently. Verified via direct click at 375px (no more page shift, tab strip has its own scrollbar) and regression-checked at 1440px (unchanged — tabs still fill evenly, nothing to scroll there). Checked codebase for the same exact pattern elsewhere (`grep` for the tab-button classes) — only match was unrouted dead code (`Forecast.jsx`), not fixed. |
| `/cashflow` | `src/pages/CashFlow.jsx` | [ ] | Clean at 375px and 1440px. |
| `/creditcard` | `src/pages/CreditCard.jsx` | [ ] | **Fixed:** topbar changed from fixed `height: 52` to `minHeight: 52` + `flexWrap: 'wrap'` + `rowGap: 8`, so the badge pills drop to their own row instead of overlapping the title/month-nav when space is tight. Verified at 375px (clean, legible) and 1440px (unchanged, single row). |
| `/settings` | `src/pages/Settings.jsx` | [ ] | Profile, Data, AI Assistant, Appearance tabs all clean at 375px. "Change Firebase password" panel renders above the "Settings" heading/tabs — confirmed this ordering also exists at 1440px, so it's pre-existing structure, not a mobile regression; left alone. **Unrelated pre-existing bug found (not fixed, out of scope — CSS-only task, this is a React logic bug):** opening Settings → Appearance logs 3 console errors — "Encountered two children with the same key" (`#c9a84a`, `#4aaa78`, `#c9a04a`) — in the Color Theme picker, likely `src/components/Settings/UiPreferences.jsx` mapping `COLOR_THEME_OPTIONS` with a non-unique key (possibly a duplicate hex value used as the `key` prop). Reproduction: navigate to `/settings`, click "Appearance" tab, check console. Data Setup sub-pages (Payment Methods, Vendors, Accounts, Marketplaces, Cashouts) all checked — see Phase 1 row for `Settings/*.jsx`. |
| `/tax-exempt` | `src/pages/TaxExempt.jsx` | [ ] | Minor: "Tax Exempt" heading + "All Years"/"All Quarters" filter buttons wrap awkwardly at 375px (buttons drop to their own line) — cramped but not broken. Rest of page (stat cards) clean. Clean at 1440px. |
| `/guide` | `src/pages/Guide.jsx` | [ ] | Clean at 375px and 1440px. |
| `/goals` | `src/pages/Goals.jsx` | [ ] | Clean at 375px and 1440px. |
| `/calendar` | `src/pages/Calendar.jsx` | [ ] | Month grid itself renders well at 375px. **Fixed:** the "+N more" link was using FullCalendar's own built-in `moreLinkClick="popover"`, which bypassed the app's existing well-built `CalendarEventPopover` component (a proper centered modal, already wired up for `eventClick`) and rendered FullCalendar's unstyled native popover instead — pinned near the clicked cell with no mobile awareness, overlapping the fixed "Add Event" button and clipping off-screen. Changed `moreLinkClick` to a custom handler (`handleMoreLinkClick`, using a new `toDateStr` helper) that reuses the same popover component `eventClick` already uses. Verified at 375px (centered, scrollable, fully legible, closeable) and 1440px (same, arguably nicer than FullCalendar's old native popover there too). Week view not yet tested. |
| (not routed in `App.jsx`) | `src/pages/Forecast.jsx` | [ ] | Confirmed still unrouted — not audited, per plan instruction to confirm before touching. |

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

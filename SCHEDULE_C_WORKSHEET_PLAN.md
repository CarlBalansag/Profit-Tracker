# Schedule C: full Part I–V worksheet + visual redesign

## Context

The Schedule C feature currently only covers a slice of Part II (8 expense categories mapping to 6 of the ~20 real IRS expense lines), and the page is a single flat, text-heavy list. The user wants it expanded toward a real, navigable Part I–V worksheet — using existing Sales/Inventory data where possible, new tables where the data genuinely doesn't exist yet — plus a full Part II category taxonomy, and a visual redesign that cuts the copy density, styled consistently with the rest of the (not-yet-Impeccable-redesigned) app rather than committing to the Impeccable-only component library.

Grounding from exploration:
- `tax_category` lives inside `Expense.tax_details` (JSONB) — expanding the category list is pure app-code, no migration.
- `services/finance.js` (`shared/decimalFinance.mjs`) already has `isRealizedSale`, `batchCost`, `sumMoney`/`subtractMoney` — Part I gross receipts and Part III purchases must reuse these, not reimplement.
- `services/currencyWrite.js`/`currencyFields.js` implement the Float→Decimal dual-write — that pattern exists only because of legacy Float data. New tables have no legacy data, so their money columns should be native `Decimal` from the start.
- Version-checked updates (`routes/expenses.js:78-79`: compound `where: { id, user_id, tax_version }` + `{ increment: 1 }`) and `services/ownership.js`'s `requireOwned` are the concurrency/tenant-isolation conventions every new table and route must follow.
- Theme tokens (`--bg-surface`, `--border-default`, `--text-secondary`, `--accent`, `--bg-elevated`, `--accent-bg`) are defined per accent/theme variant in `profit-tracker-app/src/index.css` and are the safe, theme-agnostic vocabulary to style with — confirmed present across every variant.
- An abandoned, untracked `profit-tracker-app/src/pages/ScheduleC.css` (only in the main checkout, not the worktree, not any commit) already builds a card/stat/category-grid/status-pill system on exactly these tokens. It predates the current JSX and was never wired in, but its structure is a legitimate starting point to recover and extend — not something to build from zero.
- `src/pages/Settings.jsx` already has the tab housing this feature links to (`state={{ tab: 'tax' }}`) — untouched by this work.

## Phase 1 — Expand the Part II category taxonomy (no migration)

Extend `taxCategories` in `shared/scheduleC.mjs` and the matching zod enum in `profit-tracker-api/validation/scheduleC.js` from 8 to the full IRS Part II line set: Car/truck (9), Contract labor (11), Depreciation (13), Employee benefits (14), Insurance (15), Interest–mortgage (16a), Interest–other (16b), Pension (19), Rent–vehicles/equipment (20a), Rent–other property (20b), Repairs/maintenance (21), Taxes/licenses (23), Travel (24a), Meals (24b), Utilities (25), Wages (26) — alongside the 8 existing ones. Each gets `{ id, label, line2025 }` like today. Meals gets a short UI note about the IRS 50% limit rather than special-cased calculation logic — the existing `business_use`/`business_percent` mechanism already handles partial-eligibility percentages.

Files: `shared/scheduleC.mjs`, `profit-tracker-api/validation/scheduleC.js`, matching test updates in `profit-tracker-api/test/scheduleC.test.mjs`.

## Phase 2 — New tables for what genuinely isn't tracked (one additive migration)

Three new Decimal-native tables, each with `id`, `user_id` (FK to `User`, `requireOwned`-checked), `year Int`, a `version Int @default(0)` for optimistic concurrency, and `@@unique([user_id, year])` (or per-vehicle, indexed) — following the `Expense.tax_version` pattern exactly:

- **`ScheduleCYearDetail`** — one row per user per tax year: `other_income_decimal` (Part I line 6), `inventory_method` (Part III line 33), `beginning_inventory_decimal`, `cost_of_labor_decimal`, `materials_supplies_decimal`, `other_costs_decimal`, `ending_inventory_override_decimal`. Purchases (line 36) stay derived from `Inventory`, not stored — avoids duplicating source-of-truth data.
- **`ScheduleCVehicle`** — one row per vehicle per year: `description`, `placed_in_service_date`, `business_miles`, `commuting_miles`, `total_miles`, `method` (`standard_mileage`|`actual_expenses`), `actual_expenses_decimal`. Feeds Part IV.
- **`ScheduleCHomeOffice`** — one row per user per year: `method` (`simplified`|`actual`), `business_sqft`, `home_sqft`, `actual_expenses_decimal`. Feeds Form 8829 → Schedule C line 30.

Register each table's money fields in `services/currencyFields.js` only if we later need historical reconciliation tooling — since these are new Decimal-only columns with no Float counterpart, skip `currencyWrite.js` entirely for them and write Decimal values directly.

Files: new `profit-tracker-api/prisma/migrations/<timestamp>_schedule_c_worksheet_detail/migration.sql`, `prisma/schema.prisma`.

## Phase 3 — Backend: routes, validation, and Part I/III calculation

- New validation schemas (`profit-tracker-api/validation/scheduleC.js`) for the three new tables, mirroring `taxDetails`'s `.strict()` + `superRefine` style.
- New CRUD routes (extend `routes/scheduleC.js`) for year-detail/vehicle/home-office, each using `req.user`-based auth (matching today's fixed `req.user` check), `requireOwned`, and the compound-`where` version-checked update pattern.
- Extend `services/scheduleC.js`'s `expenseWorksheet` (or add sibling functions) to compute:
  - **Part I**: gross receipts = `sumMoney` over realized (`isRealizedSale`) Sales' `unit_price × quantity` in the year; returns/allowances from non-realized sales; other income from `ScheduleCYearDetail`.
  - **Part III**: purchases = `sumMoney` of `batchCost(inventory)` for Inventory purchased in the year (reusing `finance.js`, not reimplementing); combined with the manually-entered `ScheduleCYearDetail` fields for the rest of the COGS formula. Beginning/ending inventory value stays a **manual entry** (with the current live inventory value shown as a reference number, not a true historical reconstruction) — true point-in-time valuation is a materially harder, separate task, not part of this scope.
- Extend the `/api/schedule-c` response contract with `partI` and `partIII` sections alongside the existing `groups`/`rows` (Part II).

Files: `profit-tracker-api/routes/scheduleC.js`, `profit-tracker-api/services/scheduleC.js`, `profit-tracker-api/validation/scheduleC.js`, new tests in `profit-tracker-api/test/scheduleC.test.mjs`.

## Phase 4 — Frontend: Part I–V structure

Restructure `profit-tracker-app/src/pages/ScheduleC.jsx` from one flat page into sectioned navigation: **Part I Income** (mostly computed, one input for other income), **Part II Expenses** (today's worksheet, recategorized), **Part III Cost of Goods Sold** (computed purchases + new manual-entry form), **Part IV Vehicle Information** (CRUD list for `ScheduleCVehicle`), **Part V / Other Expenses detail** (itemized breakdown of the existing 27b "other" bucket), plus a **Home Office (Form 8829)** section. New forms follow the existing `TaxEditor` modal pattern (version-checked save, `requireSuccessfulResponse`).

Files: `profit-tracker-app/src/pages/ScheduleC.jsx`, new `profit-tracker-app/src/components/ScheduleC/VehicleForm.jsx`, `YearDetailForm.jsx`, `HomeOfficeForm.jsx`; extend `ExpenseTaxFields.jsx` only if the category list change requires it.

## Phase 5 — Visual redesign (theme-agnostic)

Recover the abandoned `ScheduleC.css` from the main checkout as the starting point (its `sc-stat`/`sc-panel`/`sc-category-grid`/`sc-status-*` classes already use the correct shared tokens), extend it with classes for the new Part-navigation shell and the three new forms, and replace `ExpenseTaxFields.jsx`/`ScheduleCSettings.jsx`'s hardcoded literals (`bg-[#16181d]`, `text-purple-300`) with the same shared tokens so the whole feature actually responds to the user's selected theme/accent instead of being hardcoded. Directly address "too much text": convert long inline paragraphs (the top disclaimer, the "unknown payment dates" note, etc.) into the existing collapsible-disclosure pattern (`sc-guidance`/`<details>`) already present in the recovered CSS, and shorten remaining copy to short labels + icons where the meaning is otherwise obvious.

Files: `profit-tracker-app/src/pages/ScheduleC.css` (recovered + extended), `ScheduleC.jsx`, `ExpenseTaxFields.jsx`, `ScheduleCSettings.jsx`.

## Verification

- API: `npm test` in `profit-tracker-api` (new + existing Schedule C tests), Prisma migration validated against a fresh disposable DB (`npx prisma migrate diff` / the existing migration-chain test pattern), `npx prisma validate`.
- Frontend: `npm test`, `npm run lint`, `npm run build` in `profit-tracker-app`.
- Manual: run both dev servers locally (as already set up in `profittracker_qa_integration`) against production-shaped data, walk through creating a vehicle entry, a year-detail entry, and confirm Part I/II/III totals render and a printed/PDF export still works.
- Explicitly confirm the page still renders correctly under all 3 themes (neon-dark, glassmorphism-brown, impeccable) given the theme-agnostic decision — spot check by switching themes in Settings.

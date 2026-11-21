# Schedule C tax planning expansion: audit, research and plan

Status: **Phase 1 (research and audit) is done. This plan needs your review before any code is written.**
Date: 2026-11-21. Audited against `origin/main` at `134c5cd` (What's New 1.46). Note: this checkout is on `feat-buyer-info-tip`, which is 83 commits behind local `main`. Local `main` is in turn 15 commits behind `origin/main`.

---

## 1. Codebase audit: what exists today

### 1.1 Schedule C section (reuse and extend)

| Piece | File | What it does today |
|---|---|---|
| Page | `profit-tracker-app/src/pages/ScheduleC.jsx` (88 lines) | Part II expense worksheet for one tax year. It has category cards, a review queue, a duplicate warning, CSV/JSON export and print-to-PDF. |
| Review modal | `components/ScheduleC/ExpenseTaxFields.jsx` | Captures per-expense `tax_details`: business / mixed % / personal, payee, purpose, category, paid status and date, payment evidence, and a "reviewed" checkbox. |
| Shared contract | `shared/scheduleC.mjs` | 8 tax categories with **2025** line numbers, plus `taxReviewIssues()`. |
| Service | `profit-tracker-api/services/scheduleC.js` | `expenseWorksheet()`. It works in integer cents and on a cash basis, counting only reviewed expenses. It adds sale shipping labels and platform fees automatically (lines 27b and 10), flags manual expenses that duplicate a sale cost (same amount within 7 days), and reports refunds to buyers as line 2. Purchase tax, inbound shipping and purchase fees are deliberately left out of Part II because they belong to COGS. |
| Route | `routes/scheduleC.js` | `GET /api/schedule-c?year=`, scoped by `user_id`. It requires `schedule_c_enabled`. |
| Toggle | `routes/preferences.js` and `components/Settings/ScheduleCSettings.jsx` | Per-user `User.schedule_c_enabled`. Changes are written to the Activity log. A global kill switch lives in `config/features.js`. |
| Optimistic lock | `Expense.tax_version` | Already prevents lost updates to the tax details. |

**Verdict:** the foundation is sound: cents math, ownership checks, no double counting of sale costs, and honest labeling. Everything new should grow out of this page and service, not sit beside them.

### 1.2 Data already available, so users never re-enter it

| Need | Existing source |
|---|---|
| Gross receipts | `Sales.unit_price × quantity` for realized sales (`isRealizedSale`) |
| Returns and allowances | `Refund` rows with `sale_id` (dated) |
| COGS | `batchCost()` / `allocatedCost()` in `shared/finance.mjs` and `services/decimalFinance.js`. This is per-batch specific identification that already includes tax, inbound shipping and fees, less gift cards and store refunds. |
| Ending inventory | Can be rebuilt as of any date from `purchase_date`, `sale_date`, `refunded_qty`, `restored_qty`, `cancelled_at` and refund dates |
| Fees and labels | `Sales.commission_fee`, `Sales.sale_shipping` (the seller's label cost) |
| Sales tax collected | `Sales.sale_tax_collected`, `taxable`, `customer_tax_exempt`; purchase-side `tax_exempt` |
| Cashback | `inventoryCashback()` from card rates (`PaymentMethod`, OpenCard catalog) |
| Expenses | `Expense` (with `tax_details`, `external_id` dedupe) and `RecurringExpense` (weekly / biweekly / monthly) |
| Receipts | `receipt_url` on Inventory and Expense (Cloudinary), plus `Attachment` (sale and purchase only) |
| Payout timing | `Sales.paid_at`, `paid_amount`, `payout_date`, `payout_short_amount` |
| Personal-account money | `PaymentMethod.is_personal` and the "Owner Reimbursement" expenses |
| Audit trail | `ActivityLog` (with undo), `ChangeLog`, `McpWriteLog` |
| Background jobs | Pattern in `services/cashouts/syncScheduler.js`: an external cron hits a secret-protected endpoint |
| Calendar | `CalendarEvent` and an ICS feed (`services/calendarFeed.js`), which can carry tax deadlines |
| Versioned external dataset | Card catalog pattern: bundled snapshot, monthly refresh, corrections file (`scripts/refreshCardCatalog.js`). This is a good template for tax rules. |
| Prior design notes | `FuturePlans.txt` §3.1–3.7 already sketch Parts I–V, Form 8829, vehicle, assets and the tax profile. This plan uses them. |

### 1.3 Gaps and conflicts with the spec

1. **There is no beginner/advanced mode.** No such setting exists anywhere in the app (searched app, API and shared code). The spec says to reuse it. *Proposal:* add one per-user preference, "Show tax math: Simple / Detailed", stored in `User.accounting_preferences` JSON. Tax pages use it first, and other pages can adopt it later.
2. **There is no notification system on `main`.** Settings has a disabled "Notifications · Soon" tab. The closest thing is the unpushed **To-Do / Action Center** (`feat-todos` + `feat-reminders`). Its phase 3 plans web push via `web-push` and VAPID, which is free. *Proposal:* tax alerts become To-Do items (derived, snoozable, deduplicated by design). Deadlines also go on the Calendar and ICS feed. Push comes when To-Do phase 3 lands. **This creates a dependency: tax alerts wait until To-Do is merged.**
3. **Receipts are publicly reachable.** `cloudinary.uploader.upload` uses the default public `upload` type, so anyone holding a receipt URL can open it. For tax documents this should change to `type: 'authenticated'` (private) with short-lived signed URLs served through an ownership-checked API route. That needs no new service.
4. **Expense attachments.** `Attachment.entity_type` only allows `sale` and `purchase`, and expenses have a single `receipt_url`. Multiple receipts or invoices per expense means extending `Attachment` to `expense`.
5. **Category taxonomy.** There are 8 tax categories, all pinned to the 2025 form (`mapping_year: 2025`). The expense `category` codes (`SHIPPING_SUPPLIES`, `SOFTWARE`, `MEMBERSHIP`, `PROXY`, `CREDIT_CARD_FEE`, `OTHER`) are a separate list and are not mapped to tax categories.
6. **Recurring expenses** support only weekly, biweekly and monthly. They have no price history (editing the amount rewrites the meaning of the series) and no cancellation date separate from `end_date` and `active`.
7. **Gift-card cost basis (accounting complication).** `gift_card_amount` ("Gift Card Used") is subtracted from cost, which treats the gift card as free money. If the gift card was **bought** (often at a discount), the true cost basis is what was paid for it. Today COGS is understated, and taxable profit overstated, by the gift card's purchase price. This needs a decision; see the questions in §7.
8. **Cashback is counted in "net profit".** `saleEconomics().netProfit = grossProfit + cashback`. For tax purposes, rewards earned on purchases are generally treated as a **reduction of purchase price (a rebate)**, not income (rebate principle; Rev. Rul. 76-96). So the tax view must not add cashback as income. It can reduce cost basis or simply be left out. A reconciliation line will explain the gap between "App profit" and "Tax profit". Sign-up bonuses that require spending are generally treated the same way. Bank-account bonuses (reported on 1099-INT) are income, but they are non-business income and not Schedule C.
9. **Shipping charged to buyers.** `Sales.sale_shipping` is the *seller's label cost*, so any buyer-paid shipping must already be inside `unit_price`. That works for gross receipts, but the UI should say so.
10. **The Tax Exempt page** already handles resale and exemption logic (QA-13 and QA-14 fixed). Sales tax treatment should reuse its flags.

### 1.4 Privacy and security posture today

- Every route filters by `req.user.id`. Ownership helpers live in `services/ownership.js`.
- Admins are an email list (`routes/invites.js`, `ADMIN_EMAILS`), and there are no admin data-browsing endpoints. Keep it that way: **no admin route will ever read tax profiles.** Rule-review admin screens only touch rule data.
- Sentry is installed, so tax payloads must be scrubbed from breadcrumbs and errors (add a `beforeSend` filter for `/api/tax/*` bodies).

---

## 2. Research findings (authoritative sources)

### 2.1 Federal figures verified for tax year 2026 (law as amended by the 2025 reconciliation act, "OBBBA")

| Item | 2026 value | Source |
|---|---|---|
| Standard deduction | $16,100 single / MFS, $32,200 MFJ, $24,150 HoH; +$1,650 aged/blind (+$2,050 unmarried) | Rev. Proc. 2025-32; IRB 2025-45 |
| Brackets | 10–37%. 10% up to $12,400 single / $24,800 MFJ; 37% above $640,600 single / $768,700 MFJ | IRS Working Families Tax Cuts page; Rev. Proc. 2025-32 |
| SALT cap | $40,400, phasing down above $505,000 MAGI | Pub. 505 (2026) |
| Social Security wage base | $184,500 (12.4% SE OASDI) | SSA contribution and benefit base |
| SE tax | 92.35% of net SE earnings × (12.4% up to the wage base, reduced by W-2 SS wages) + 2.9% Medicare; $400 filing floor; deduct half of SE tax | Schedule SE instructions |
| Additional Medicare tax | 0.9% over $200k single / $250k MFJ / $125k MFS (not indexed) | Form 8959 |
| QBI (§199A) | 20%, now permanent. Threshold $201,750 (single etc.) / $403,500 MFJ; phase-in ranges $75k / $150k (confirm in final table). **New $400 minimum deduction** when QBI ≥ $1,000 | Draft 2026 Form 8995 instructions; Rev. Proc. 2025-32 |
| Estimated tax | Due Apr 15, Jun 15, Sep 15, Jan 15. Safe harbor: 90% of current-year tax, or 100% of prior-year tax (110% if prior AGI > $150k, or $75k MFS). Under-$1,000 exception | Pub. 505 (2026); Form 1040-ES (2026) |
| Mileage | **72.5¢ before Jul 1, 2026; 76¢ from Jul 1, 2026** (a rare mid-year change) | IRS newsroom; Notice 2026-10 and the July revision |
| Section 179 | $2,560,000 limit, phase-out from $4,090,000; SUV $32,000 | Pub. 946 / IRS |
| Bonus depreciation | 100%, permanent for property acquired after Jan 19, 2025 | Notice 2026-11; Topic 704 |
| De minimis safe harbor | $2,500 per item or invoice (no audited financial statements) | Pub. 334; tangible property regulations |
| Small business taxpayer test (§448(c)) | Average gross receipts ≤ $32M (2026) / $31M (2025). This unlocks the §471(c) inventory exception | Rev. Proc. 2025-32 (verify); secondary sources agree |
| 1099-K | Back to **> $20,000 and > 200 transactions** for payment apps and marketplaces, retroactively. Payment-card 1099-Ks have no threshold. Income is taxable whether or not a form is issued | IRS 1099-K FAQs; IR-2025-107 |
| Other info returns (1099-NEC/MISC) | $2,000 threshold for tax years after 2025 | IRS 1099-K FAQ page |

**Key accounting rule for resellers:** cash spent on inventory is **not** deductible when paid. Even small businesses using the §471(c) exception ("non-incidental materials and supplies") deduct an item only **in the year it is provided to the customer** (Pub. 334). So COGS is cost of the units sold, and ending inventory is carried forward. The app's per-batch specific identification fits this directly.

### 2.2 States

- **9 states have no broad individual income tax in 2026:** AK, FL, NV, NH (interest and dividends tax repealed from 2025), SD, TN, TX, WA, WY. WA has a capital-gains-only tax, which is out of scope for Schedule C.
- **Flat-rate states** (about 14, including AZ, CO, GA, ID, IL, IN, IA, KY, LA, MI, MS, NC, PA, UT) are simple, but each has its own base, exemptions and conformity choices.
- **Estimated payment schedules really do differ.** California is **30% / 40% / 0% / 30%** (Apr 15, Jun 15, no September payment, Jan 15), per FTB 540-ES instructions. Other states have different thresholds (for example CA $500), different safe-harbor rules (CA limits the prior-year safe harbor for AGI ≥ $1M), and some states do not conform to federal QBI or bonus depreciation.
- **Local income taxes** (NYC, Yonkers, Maryland counties, Ohio and Pennsylvania municipalities, Indiana counties, and others) matter for resellers in those places. Maryland county tax is mandatory and significant. These will be **explicitly flagged as not included** at first, except Maryland county and NYC as later additions.

### 2.3 Free and open-source engines and data

| Option | License | Coverage | Fit |
|---|---|---|---|
| **PolicyEngine-US** (Python) | **AGPL-3.0** | Federal plus all 50 states and DC, current years, with parameters cited to statute | The best oracle available. As a runtime dependency it has problems: it needs a Python service (Render free tier has 512 MB, and PolicyEngine needs far more), and AGPL obligations apply when it runs as a network service. Its hosted API would send users' personal finances to a third party, which the privacy rules forbid. **Use it offline as a test oracle with synthetic data only.** |
| **Tax-Calculator** (PSLmodels, Python) | **CC0** | Federal income and payroll tax | A good federal cross-check oracle. Its permissive license means parameters can be compared freely. |
| **NBER TAXSIM-35 / taxsim.js (WASM)** | Free to use | Federal through 2023; state laws dated | **Too stale** for 2025–2026. Historical cross-checks only. |
| **IRS Direct File / Fact Graph** (Scala) | Public repository (license to confirm; reportedly CC0). Archived, not production-ready | Federal, limited scope | Reference only. |
| Commercial tax APIs | Paid | – | Excluded by the spec. |

**Recommendation:** build a **small deterministic JavaScript engine in `shared/tax/`** (it runs in both browser and API, like `shared/finance.mjs`). Its parameters live in **versioned JSON rule files with source URLs, effective dates and last-verified dates**. Validate it three ways: (1) IRS worked examples and worksheets (Pub. 505 worksheets, Form 1040-ES worksheet, Schedule SE, Form 8995) as the **primary** truth; (2) a dev-only script that runs PolicyEngine-US and Tax-Calculator on synthetic households and writes fixture files; (3) hand-built bracket-boundary tests. This keeps zero runtime cost, keeps data private, and avoids AGPL at runtime. The engine can also run **in the browser without saving anything**, which meets the "estimate without permanently saving" requirement.

### 2.4 OCR, exports and libraries

- **OCR:** **Tesseract.js** (Apache-2.0) runs as WebAssembly **in the browser**, so receipt images never leave the device. It must be lazy-loaded and opt-in, followed by heuristic parsing of total, date and vendor, which the user confirms. Accuracy on crumpled thermal receipts is moderate, so OCR results are always suggestions. A server-side OCR service is not recommended because of RAM and privacy.
- **Excel:** **ExcelJS** (MIT), lazy-loaded on the client.
- **PDF:** keep the existing print stylesheet (zero dependencies) for v1. Add **pdfmake** (MIT) only if a fixed-layout accountant packet is needed.
- **Money math:** the existing `Decimal` / cents helpers are enough. No accounting library is needed.

---

## 3. Recommended architecture

```
shared/tax/
  rules/2025/federal.json, rules/2026/federal.json      ← versioned params + sources + verified dates
  rules/2026/states/CA.json … (one file per state)      ← status: verified | partial | unsupported
  engine/federal.mjs   (income tax, std ded, brackets, CTC/ODC)
  engine/se.mjs        (Schedule SE incl. W-2 wage-base interaction)
  engine/qbi.mjs       (simplified path; above-threshold = flagged/limited)
  engine/state.mjs     (generic: none | flat | brackets, + per-state hooks)
  engine/estimates.mjs (required annual payment, safe harbor, per-jurisdiction schedule)
  engine/compute.mjs   (with-business vs without-business → incremental business tax)
  scheduleC.mjs        (expanded categories with per-year line maps)

profit-tracker-api/services/tax/
  scheduleCBooks.js    (Part I, II, III from records; ending-inventory reconstruction)
  reconcile.js         (app profit ↔ tax profit ↔ cash; 1099-K reconciliation)
  forecast.js          (YTD, run-rate, recent-trend, user target, seasonal)
  snapshots.js         (finalize / revise / compare)
routes/tax.js          (/api/tax/* — all user-scoped, Sentry-scrubbed)
```

**Core calculation (deterministic):**
1. Build the tax return twice: **without** business income and **with** Schedule C net profit, including SE tax, the ½ SE deduction, QBI and state tax.
2. Additional business tax = total(with) − total(without). Effective business rate = that ÷ net profit (shown as "n/a" when profit ≤ 0).
3. Report marginal rate (by finite difference, +$100 of profit), effective rate overall, and effective business rate as separate, labeled numbers.
4. Every result carries an `assumptions[]` and `limitations[]` list plus the rule-set version used, so the UI can show "how this was calculated" and "what this does not include".
5. An unsupported situation (an unsupported state, above-threshold QBI with complex factors, AMT exposure, EITC) produces an **explicit limitation**. It never silently returns a wrong number.

**Three estimation modes:** Personalized (engine) · Flat % (user's) · Conservative (engine result + adjustable buffer, or the safe-harbor amount, whichever is higher).

**Tax rules lifecycle (hybrid):**
- Rule files live in git. **"Publish" means a reviewed pull request merge**: you are the admin reviewer, CI runs the validation tests, and rollback is `git revert`. This reuses the workflow you already have, with no admin UI to build first.
- A scheduled **rule checker** (the same external-cron plus secret pattern as cash-out sync, or a free GitHub Action) fetches a list of official source URLs, hashes them, and opens an admin To-Do or issue when a page changes. It **never edits rules**.
- Every finalized report stores the rule version it used, so new rules cannot silently change finalized history.

---

## 4. Database migration plan (additive only; no existing column changes meaning)

| New model | Purpose | Notes |
|---|---|---|
| `TaxProfile` | Per user and tax year: state, filing status, non-business income, W-2 wages and SS wages, withholding (fed/state), dependents (counts only), other SE income, prior-year tax and AGI, reserve %, buffer %, estimation mode, `save_details` flag | Optional fields are nullable. No SSN, names or DOB (only an "age 65+" boolean). The user can delete it. |
| `TaxYearSettings` | Per user and year: accounting method (cash), inventory method, revenue timing policy (sale date vs payout date), beginning-inventory override, other income | Also stores `finalized_at`. |
| `TaxPayment` | Estimated or extension payments: jurisdiction (`US`, `CA`, …), tax year, period, amount, paid date, reference | The payment history. |
| `TaxReserveEntry` | Ledger of money **set aside** or **released**, kept apart from payments | Never an expense; excluded from every profit total. |
| `TaxScenario` | Saved what-if inputs (JSON) | Never touches records. |
| `TaxReportSnapshot` | Immutable finalized report JSON plus rule version, input hash, revision number and reason | Amendments are new revisions; earlier ones are never mutated. |
| `BusinessAsset` | Equipment register: cost, placed-in-service date, business %, treatment (de minimis / §179 / bonus / MACRS later) | Phase 8. |
| `MileageTrip` | Date, miles, purpose, optional links | Phase 8. The rate comes from rules by date (the mid-2026 split). |
| `HomeOffice` | Per year: simplified method (sq ft, months) | Phase 8. Form 8829 actual method later. |
| `InventoryAdjustment` | Personal withdrawal, lost, damaged or donated units with a date | Keeps those units out of COGS correctly. |
| `RecurringExpensePrice` | Price history with an effective-from date | Plus a `cancelled_at` column on `RecurringExpense`, and quarterly and annual frequencies. |
| `Attachment` | Allow `entity_type = 'expense'`; private storage | Validation change only. |
| `Expense.tax_details` (JSON) | Add `suggested_category`, `suggestion_reason`, `category_source: auto\|user` | No column change. |

Every migration is additive SQL under `prisma/migrations/`. Render runs `migrate deploy` on build, so nothing is run by hand at push time. Testing uses local Postgres with synthetic data only.

---

## 5. Phased implementation plan

Each phase is **one branch, one TASKS.md claim, QA, then held for your batch push**, per CLAUDE.md and AGENTS.md.

| # | Phase | Delivers | Depends on |
|---|---|---|---|
| 1 | Research and audit | **This document** | – |
| 2 | Tax engine and rules | `shared/tax/` for 2025 and 2026 federal, SE and QBI (simplified path), CTC/ODC. States: the 9 no-tax states plus flat states first, then progressive states in batches, each marked verified, partial or unsupported. IRS-example tests plus oracle fixtures. No UI. | – |
| 3 | Schedule C books (Parts I–III) | Gross receipts, returns, COGS with beginning and ending inventory rebuilt as of Dec 31, an expanded Part II category map with per-year line numbers, reconciliation (app profit vs tax profit vs cash; cashback; gift cards; sales tax; year-end payout cutoff; 1099-K comparison input) | Phase 2 (line maps only) |
| 4 | Profile, setup and overview | Guided first-time setup (state, filing status, non-business income, year). Optional progressive fields with "why we ask" notes. The "don't save" mode. A Schedule C overview that answers the 7 questions, with expandable math. The Simple/Detailed preference. | 2, 3 |
| 5 | Expense classification and documents | Rule-based auto-categorization (category code plus vendor keywords), review queue, business %, private attachments on expenses, missing-receipt list, duplicate detection beyond sale costs (same vendor, amount and date; `external_id`), recurring improvements, opt-in in-browser OCR | 3 |
| 6 | Forecasting and reserves | YTD vs projected year-end (run-rate, recent 90 days, user target, seasonal), labeled actual vs projected. Reserve ledger. Cash Flow panel (recommended, set aside, paid, shortfall, coverage %) | 4 |
| 7 | Estimated payments and alerts | Federal and per-state schedules from rules, safe-harbor targets, payment tracking and history, Calendar/ICS deadlines, To-Do alerts (deadline, low reserve, missing receipts, uncategorized, estimate moved more than X%, rule update) with per-alert toggles | 6; **To-Do merged** |
| 8 | What-if, deduction discovery, assets, mileage, home office | Scenarios through the real engine, with a separate simplified 10% teaching example. Discovery checks with "why, docs needed, limits, IRS link", never auto-claimed. Equipment register, mileage log, simplified home office | 4, 5 |
| 9 | Reports and tax years | Line-by-line worksheet (labeled "preparation aid, not a filed return"), accountant packet (print-to-PDF), CSV, Excel, drill-down to records, finalize and revise with audit history, year-over-year, the rule-update checker | 3–8 |
| 10 | Polish and final QA | Mobile pass (AGENTS.md mobile rules), accessibility, dark mode, full regression | all |

**Suggested scope for v1 (Phases 2–4, about 3 branches):** this gives a correct, explainable "how much might I owe and how much to save" answer built from the existing books. Phases 5–9 then add depth.

---

## 6. Testing strategy

- **Engine unit tests (Vitest, `shared/tax`)**: all 5 filing statuses; bracket boundaries at ±$1; zero profit, a loss, and a loss offsetting other income; SE floor ($400 / 92.35%); the SS wage-base cap with and without W-2 wages; Additional Medicare tax; QBI below, in and above the phase-in plus the $400 minimum; CTC phase-out; prior-year safe harbor at 100% and 110%; incomplete profiles producing limitations, not numbers.
- **States:** a table-driven test per state (all 50 plus DC). No-tax states return 0. Unsupported states return a limitation. Verified states are checked against that state's own worksheet example or the PolicyEngine fixture.
- **Ground truth:** IRS published examples first. Oracle fixtures come from PolicyEngine and Tax-Calculator, never from AI-written expectations.
- **Books (API, Vitest and Prisma test DB):** multi-unit batches, partial sales, refunds both ways, returns that restock, cancelled and voided sales, gift cards, cashback, Dec 31 / Jan 1 boundaries, inventory adjustments, duplicate expenses, mixed-use %, recurring price changes.
- **Isolation:** user B can never read or change user A's profiles, payments, scenarios, snapshots or attachments (each route tested with a foreign ID).
- **Cross-screen consistency:** Schedule C gross profit matches Dashboard and Analytics after the documented reconciliation lines.
- **Browser QA** of every UI phase in the preview harness, including phone widths.

---

## 7. Decisions needed from you

1. **Beginner/advanced mode does not exist.** OK to add a single "Simple / Detailed" preference (tax pages first)?
2. **Alerts:** OK to build tax alerts on top of the To-Do branch, so Phase 7 waits for To-Do to merge?
3. **Gift cards:** should purchases record what a gift card *cost you* (a new optional field), so COGS is right? Or should gift cards stay "free" in the books, with a tax-view warning?
4. **Revenue timing on the cash method:** count a sale in the year of the **sale date** (matches 1099-K and is the simplest) or the **payout date** (strict constructive receipt)? I recommend sale date, plus a year-end cutoff report of late-December sales paid in January.
5. **Receipts privacy:** OK to move new tax documents (and, later, existing receipts) to private Cloudinary storage with signed links?
6. **State scope for v1:** 9 no-tax states + flat-tax states + the 5–10 states you and your users actually live in, fully verified, with the rest marked "not yet supported" until done? Or all 50 at once (much longer before anything ships)?

## 8. Known limitations (by design)

- Not a filing service. Worksheets are preparation aids.
- No AMT, NIIT, EITC, foreign income, multi-state residency, part-year residency, or local taxes in v1. Each shows an explicit "not included" note.
- QBI above the threshold is limited or flagged until the asset register exists (sole proprietors with no W-2 employees get little or no QBI above the range anyway).
- Accrual method and LIFO are not supported. Cash method with specific identification only.
- Tax-year 2027 parameters are not published yet. 2027 runs in "planning" mode using 2026 rules, labeled unverified.

## 9. Sources

- Rev. Proc. 2025-32: https://www.irs.gov/pub/irs-drop/rp-25-32.pdf · IRB 2025-45: https://www.irs.gov/irb/2025-45_IRB
- IRS Working Families Tax Cuts (brackets): https://www.irs.gov/newsroom/working-families-tax-cuts-individuals-and-workers
- Pub. 505 (2026): https://www.irs.gov/publications/p505 · Form 1040-ES (2026): https://www.irs.gov/pub/irs-pdf/f1040es.pdf · Estimated tax FAQ: https://www.irs.gov/faqs/estimated-tax
- SSA wage base: https://www.ssa.gov/oact/COLA/cbb.html
- Mileage 2026: https://www.irs.gov/tax-professionals/standard-mileage-rates · https://www.irs.gov/pub/irs-drop/n-26-10.pdf
- QBI draft Form 8995 instructions: https://www.irs.gov/pub/irs-dft/i8995--dft.pdf
- Depreciation: https://www.irs.gov/publications/p946 · https://www.irs.gov/taxtopics/tc704 · https://www.irs.gov/newsroom/treasury-irs-issue-guidance-on-the-additional-first-year-depreciation-deduction-amended-as-part-of-the-one-big-beautiful-bill
- Pub. 334 (inventory, de minimis): https://www.irs.gov/pub/irs-pdf/p334.pdf · Tangible property regulations: https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations
- 1099-K: https://www.irs.gov/newsroom/form-1099-k-faqs-common-situations · https://www.irs.gov/businesses/understanding-your-form-1099-k
- Schedule C instructions: https://www.irs.gov/instructions/i1040sc
- California 540-ES: https://www.ftb.ca.gov/pay/estimated-tax-payments.html · https://www.ftb.ca.gov/forms/2026/2026-540-es-instructions.html
- PolicyEngine-US: https://github.com/policyengine/policyengine-us · Tax-Calculator: https://pypi.org/project/taxcalc/ · TAXSIM-35: https://taxsim.nber.org/taxsim35 · Direct File: https://github.com/IRS-Public/direct-file · Tesseract.js: https://github.com/naptha/tesseract.js

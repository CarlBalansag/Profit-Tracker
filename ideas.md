add more into Expenses like store, taxes, convert make it work with schedule C plan thats in the works, also add payment method to work with credit card payments

figure out heiracy of statuses so we can add automations
for example when shipping outbound gets delivered change status to waiting for payment.

reciept to work with google drive to store pngs work in progress not important




ISSUES: URGENT

## 1. Dashboard and Transactions show different total cost

**Update 2026-10-01: already fixed, confirmed via `Audit` branch.** Not by a dedicated patch -- the currency migration's Task 7 rewrite of `routes/analytics.js` happened to replace the old totalCost computation with one that sums every inventory row in the window unconditionally (no status or sales-presence filter), which eliminates this exact exclusion. Verified directly: adding a COMPLETED purchase with no sale and `qty_on_hand: 0` now correctly adds its full cost to `stats.totalCost` and `stats.transactionCount`. Locked in with 7 new tests in `test/analyticsOrphanedPurchase.test.mjs` covering every lifecycle status.

- Dashboard: **$14,013.05** across 32 purchases.
- Transactions: **$14,052.02** across 33 records.
- Difference: **$38.97**.
- The missing amount matches the **Topps Chrome Value** purchase marked `COMPLETED` without an attached sale.
- Likely cause: the Dashboard aggregation excludes a purchase in a sold lifecycle state, while Transactions still counts its purchase cost.
- Work needed: count every inventory purchase consistently, regardless of sale status, or prevent purchase records without a sale from being marked `COMPLETED`.

## 2. Pages use different definitions of inventory value

**Update 2026-10-01: already fixed, confirmed via `Audit` branch.** Inventory.jsx now imports the same `allocatedCost()` from `shared/finance.mjs` that the backend's `inventoryValue` uses (landed cost: merchandise + allocated tax + inbound shipping + fees − gift card) -- likely from the branch-consolidation effort's shared-formula work. Verified by computing Inventory's figure directly from a real `GET /api/inventory` response and comparing it to `GET /api/analytics/dashboard`'s `inventoryValue` for the same data: they're identical (`test/inventoryValueConsistency.test.mjs`), including a sanity check that the fixture's tax/shipping/fees/gift-card are non-trivial, so a merchandise-only regression would be caught.

- Dashboard and Analytics: **$1,822.46**.
- Inventory: **$1,765.23**.
- Difference: **$57.23**.
- Inventory uses merchandise cost only: `unit purchase cost × quantity on hand`.
- Dashboard and Analytics include allocated sales tax and inbound shipping, producing landed cost.
- Work needed: use one inventory-value formula everywhere, or clearly label the figures as **Merchandise Cost** and **Landed Cost**.

## 3. Inventory, sales, and status quantities are confusing

**Update 2026-10-01: data-integrity bug fixed via `Audit` branch; labeling clarity improved.** "Some sale rows still have PURCHASED as their status" was a real, reproducible gap: both `createSale`/`updateSale` and the Transactions inline-edit status dropdown accepted any string, including inventory-only statuses. Sales' status is now a strict 8-value enum (`SOLD`, `SHIPPED_OUT`, `AUTHENTICATION`, `PAID`, `COMPLETED`, `RETURNED`, `DISPUTED`, `CANCELLED`) rejected at the API layer (`validation/schemas.js`), and the Transactions dropdown only offers that list for sale rows. Inventory's status intentionally keeps the full 15-value union, since it legitimately uses every value (confirmed by existing tests -- a purchase can be directly marked `COMPLETED` or `CANCELLED` with no sale). The "Pipeline Sold: 3 vs Units sold: 48" distinction itself was not a bug -- they're different, legitimate metrics (current-stage snapshot vs. cumulative period total) -- so the Dashboard's Status Pipeline section now has an explanatory caption plus a per-card tooltip, and the ambiguous "Sold" glass-theme tile was renamed "Units Sold" with a tooltip. Analytics' "Sales Count" tile was already unambiguously labeled ("N sales").

- Inventory quantity: **29** total units currently on hand.
- Pipeline `On Hand`: **24** units whose exact status is `On Hand`.
- The other five inventory units are four marked `PURCHASED` and one marked `COMPLETED`.
- Units sold: **48**, calculated by summing quantities across sale records.
- Sales count: **21**, representing the number of sale records rather than units.
- Pipeline `Sold`: **3**, counting only quantities whose current status is exactly `SOLD`; it excludes `SHIPPED_OUT`, `COMPLETED`, and other statuses.
- Some sale rows still have `PURCHASED` as their status.
- Work needed: standardize lifecycle statuses and clearly distinguish **records**, **units**, **inventory on hand**, and **all sold units** in labels and tooltips.

## 4. Tax Exempt profit does not visibly explain deductions

**Update 2026-10-01: fixed via `Audit` branch.** Added a "Fees & Shipping" summary card (`TaxExempt.jsx`) showing the combined commission-fee + sale-shipping deduction as its own negative line item between Exempt COGS and Exempt Profit, so the formula's full chain (Revenue → COGS → Fees & Shipping → Profit) is now visible at a glance instead of folded silently into one number. Did not add per-row fee/shipping columns to the sales table below -- the work-needed text offered either option, and adding more columns to an already-wide table would conflict with issue #11's overflow fix (handled separately, same pass).

- Revenue: **$8,134.00**.
- COGS: **$7,263.95**.
- Revenue minus COGS: **$870.05**.
- Displayed profit: **$857.15**.
- Difference: **$12.90** in combined platform commission fees and outbound sale shipping.
- Current formula: `revenue − COGS − commission fees − sale shipping`.
- A hover tooltip mentions the formula, but the visible summary and sales table do not show the $12.90 deduction.
- Work needed: display commission fees and sale shipping as separate summary values or show an explicit deductions line.

## 5. Card Tracker shows two different “Keep” amounts

**Update 2026-10-01: fixed via `Audit` branch.** Relabeled the header pill to "All Cards · Keep $X" and the selected-card bottom-bar pill to "This Card · Keep $X" (`CreditCard.jsx`), plus added a hover tooltip to each spelling out the exact scope, matching the exact fix suggested in "Work needed" below.

- Header: **Keep $55.13**.
- Selected-card summary: **Keep $35.74**.
- The header is the total cashback to keep across all active cards for the selected month.
- The lower summary is only for the selected card, Amex Blue Cash Everyday.
- Work needed: label the scopes explicitly, such as **All Cards — Keep $55.13** and **Selected Card — Keep $35.74**.

## 6. Goal target and progress behavior are inconsistent

- Dashboard, filtered to `All Time`, shows a **$1,000** Net Profit goal.
- Goals defaults to `30 Days` and shows a **$100** Net Profit goal.
- For `All Time`, the Dashboard selects the largest configured target among 7-day, 30-day, and YTD goals rather than displaying a true all-time target.
- Progress is capped with `Math.min(100, current / target × 100)`, so the displayed percentage never exceeds 100%.
- Example: **$1,256.92 / $1,000 = about 126%**, but the Dashboard displays 100%.
- Work needed: show the active goal period clearly, define proper All Time behavior, and cap only the visual bar/ring while displaying the real percentage.

## 7. Payment Methods always shows zero spend

- All nine cards show **$0 limit** and **$0 spend** even though transactions contain card spending.
- The frontend explicitly initializes `totalSpend` and `availableSpend` to `0`, so spend cannot display a real value.
- Credit limit is read from the saved `credit_limit`; missing or null limits become zero.
- Work needed: calculate or fetch spend per payment method, reuse the Card Tracker aggregation where appropriate, and verify that credit limits are saved and returned correctly.

## 8. Sign-in and verification flow is unreliable

**Update 2026-10-01: fixed via `Audit` branch.** A dedicated `ServerWakeUpScreen` component (already built, wired into `AuthContext.jsx`) already retries the *initial* `/auth/me` check with progress and a distinguishable failed state, but that same retry logic didn't cover the sign-in form's own network calls -- `authRequest()` (`services/firebaseAuth.js`) made a single attempt with no retry, and a non-JSON/network failure (the exact shape of a cold Render backend) surfaced immediately as "Could not reach sign-in" on the very first click. It now retries up to 3 times with backoff on a network-level failure or a non-JSON response, while a real parsed error response (invalid credentials, etc.) still fails immediately with no retry -- correctly distinguishing an unavailable server from a genuine auth failure. Separately, "the user must click Continue before entering the application" is fixed: `FirebaseLoginForm.jsx` now polls silently every 4s for verification status while waiting (verifying happens in a different tab, so the client SDK never learns about it on its own) and auto-advances once verified, with the manual "Continue after verification" button kept as an immediate fallback. 6 new tests (`FirebaseLoginForm.test.jsx`, `firebaseAuthRequest.test.js`) cover both fixes, including that a transient background-poll failure never surfaces as a user-facing error. Full suite green: 79 frontend tests, build passes.

- After completing verification, the user must click **Continue** before entering the application.
- The first sign-in attempt displayed **“Could not reach sign-in.”**
- The extra Continue step makes the verification flow feel incomplete or stalled.
- The initial connection failure may be related to the backend waking from free-hosting sleep, a timeout, session propagation, or insufficient retry handling.
- Work needed: automatically continue after successful verification when safe, show clear progress, retry transient startup failures, and distinguish an unavailable server from invalid credentials.

## 9. Accounts shows zero accounts for every vendor

**Update 2026-10-01: root cause found and fixed via `Audit` branch.** Queried production directly: `Platform.type` values are correctly cased (`Vendor`/`Marketplace`/`Cashout`, 24/10/15 rows) and the vendor/account relationship join itself is correct -- the real finding is that the `Account` table has **zero rows in the entire database**. Tracing why: `AddAccountModal`'s submit handler (`Accounts.jsx`) only acted `if (res.ok)` and otherwise did nothing -- no error toast, no visible failure, modal just sat there. A user whose account-creation request failed (validation error, ownership check, anything) would see no feedback at all and have no way to know it didn't save, which plausibly explains why real accounts were never successfully created. Fixed to use `requireSuccessfulResponse` + a toast, matching the pattern already used for deletes in the same file. See #10 for the broader silent-failure pattern this was one instance of.

- The Accounts area shows **0 accounts** on all **12 vendors**.
- This may mean account records are not being loaded, vendor-to-account relationships are not being returned or joined correctly, or the displayed count is using the wrong field.
- Work needed: inspect the Accounts API response, verify vendor/account relationship data, and confirm that each vendor card counts the correct linked records.

## 10. Several pages fail silently and log console errors

**Update 2026-10-01: fixed via `Audit` branch for every page named here.** Without a live browser this session couldn't directly observe console/network errors, but static analysis found the same silent-failure shape repeated across all five pages: a failed fetch was caught and `console.error`'d with no visible UI feedback at all.
- Vendors, Marketplaces, Cashouts: both the main platform-list load and every "Add"/"Quick Add" modal silently did nothing on failure (the "Edit" modals and deletes were already fixed earlier, per QA-21/QA-23 in `qa/QA_REPORT.md`). All three now show a visible retry state on a failed load and a toast on a failed add.
- Accounts: same pattern, plus the specific root-cause bug described in #9.
- Dashboard: `useDashboard()` (TanStack Query) already retried once automatically but the component never read `isError`/`error`, so a load failure rendered a silently empty dashboard. Now shows a visible retry state.

5 new tests (`vendorMarketplaceErrorHandling.test.jsx`) cover Vendors/Marketplaces/Accounts list-load failure and add failure. Dashboard's fix has no dedicated test (the page has no existing test file to extend) -- verified by code inspection against the same `isError`/`refetch` pattern TanStack Query exposes, consistent with how other pages in this app already handle query errors.

- Vendors, Accounts, Marketplaces, Cashouts, and the Dashboard all produce errors in the browser developer console.
- No visible error message appears in the application, so users cannot tell that requests or components are failing.
- Work needed: capture and classify the console and network errors on each page, fix their root causes, and add visible error states with retry controls instead of silently continuing with empty or partial data.

## 11. Transactions and outbound Shipping tables overflow the screen

- The Transactions table is wider than the available viewport and gets cut off.
- The outbound Shipping table has the same problem.
- Important columns and row actions may be inaccessible without an obvious horizontal scrolling method.
- Work needed: add a clearly usable horizontal scroll container, freeze important columns or actions, hide lower-priority columns at smaller widths, and provide a responsive card or compact-table layout for narrow screens.

## 12. Receipt and inbound tracking data is incomplete

- All **36 records** are missing receipts.
- **32 inbound shipments** have no tracking number.
- This may be missing historical data rather than a calculation defect, but it prevents receipt coverage and shipping status features from being useful.
- Work needed: verify whether existing receipt and tracking data failed to migrate or load, provide bulk remediation tools, flag missing data during entry, and avoid treating unavailable historical data as a silent success.

## Suggested priority

1. Fix Payment Methods spend aggregation.
2. Fix goal percentage clipping and period labeling.
3. Fix the `COMPLETED` purchase omitted from Dashboard total cost.
4. Standardize inventory-value formulas and labels.
5. Clarify record counts, unit counts, and lifecycle status counts.
6. Expose Tax Exempt deductions visibly.
7. Clarify Card Tracker’s all-card versus selected-card scope.
8. Fix silent console/API failures and add visible error handling.
9. Repair or verify vendor account relationships and counts.
10. Stabilize the sign-in and post-verification flow.
11. Fix responsive overflow in Transactions and outbound Shipping.
12. Audit missing receipt and inbound tracking data, then add remediation tools.

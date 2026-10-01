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

- Dashboard and Analytics: **$1,822.46**.
- Inventory: **$1,765.23**.
- Difference: **$57.23**.
- Inventory uses merchandise cost only: `unit purchase cost × quantity on hand`.
- Dashboard and Analytics include allocated sales tax and inbound shipping, producing landed cost.
- Work needed: use one inventory-value formula everywhere, or clearly label the figures as **Merchandise Cost** and **Landed Cost**.

## 3. Inventory, sales, and status quantities are confusing

- Inventory quantity: **29** total units currently on hand.
- Pipeline `On Hand`: **24** units whose exact status is `On Hand`.
- The other five inventory units are four marked `PURCHASED` and one marked `COMPLETED`.
- Units sold: **48**, calculated by summing quantities across sale records.
- Sales count: **21**, representing the number of sale records rather than units.
- Pipeline `Sold`: **3**, counting only quantities whose current status is exactly `SOLD`; it excludes `SHIPPED_OUT`, `COMPLETED`, and other statuses.
- Some sale rows still have `PURCHASED` as their status.
- Work needed: standardize lifecycle statuses and clearly distinguish **records**, **units**, **inventory on hand**, and **all sold units** in labels and tooltips.

## 4. Tax Exempt profit does not visibly explain deductions

- Revenue: **$8,134.00**.
- COGS: **$7,263.95**.
- Revenue minus COGS: **$870.05**.
- Displayed profit: **$857.15**.
- Difference: **$12.90** in combined platform commission fees and outbound sale shipping.
- Current formula: `revenue − COGS − commission fees − sale shipping`.
- A hover tooltip mentions the formula, but the visible summary and sales table do not show the $12.90 deduction.
- Work needed: display commission fees and sale shipping as separate summary values or show an explicit deductions line.

## 5. Card Tracker shows two different “Keep” amounts

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

- After completing verification, the user must click **Continue** before entering the application.
- The first sign-in attempt displayed **“Could not reach sign-in.”**
- The extra Continue step makes the verification flow feel incomplete or stalled.
- The initial connection failure may be related to the backend waking from free-hosting sleep, a timeout, session propagation, or insufficient retry handling.
- Work needed: automatically continue after successful verification when safe, show clear progress, retry transient startup failures, and distinguish an unavailable server from invalid credentials.

## 9. Accounts shows zero accounts for every vendor

- The Accounts area shows **0 accounts** on all **12 vendors**.
- This may mean account records are not being loaded, vendor-to-account relationships are not being returned or joined correctly, or the displayed count is using the wrong field.
- Work needed: inspect the Accounts API response, verify vendor/account relationship data, and confirm that each vendor card counts the correct linked records.

## 10. Several pages fail silently and log console errors

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

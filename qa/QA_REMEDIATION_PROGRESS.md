# QA Remediation Progress

Historical per-task checks follow. Current committed status, final regression totals and remaining limitations are in [QA_RECONCILIATION.md](QA_RECONCILIATION.md); old pending-push notes below describe the state at that time.

This log records fixes made after the 2026-09-10 audit in `QA_REPORT.md`. Each entry is intentionally limited to one QA finding and its focused validation.

## QA-23 — Failed mutations shown as successful locally

Status: **Fixed locally; pending the next requested commit/push**

### Change

- Added a shared frontend response guard that throws on a non-success HTTP response and preserves the API error message when available.
- Updated expense deletion, recurring-expense pause/resume and deletion, vendor deletion, marketplace deletion, cashout-group deletion, payment-method deletion, and account deletion to change local state only after a successful response.
- Added visible success and failure notifications. A failed request now leaves the item and its state unchanged on screen.

### Focused QA

- Response guard tests cover a successful response, a JSON API error, and a non-JSON server error.
- Frontend test suite: 4 files, 9 tests passed.
- Production frontend build passed.
- `git diff --check` passed.

## QA-24 — Receipt amounts omit purchase costs

Status: **Fixed locally; pending the next requested commit/push**

### Change

- Receipt inventory totals now use the full purchase basis: unit cost × quantity, plus sales tax, inbound shipping, and fees, minus gift-card value.

### Focused QA

- Receipt route regression test verifies the fixture purchase totals $520 rather than its $500 item-only subtotal.
- API test suite: 14 files, 37 tests passed.
- Prisma schema validation and `git diff --check` passed.

## QA-18 — Goals accept invalid targets and coerce string false to true

Status: **Fixed locally; pending the next requested commit/push**

### Change

- Added typed create/update goal validation for supported metrics and non-negative finite targets.
- Converts boolean and string boolean input deliberately, so JSON `"false"` stores `false` rather than becoming truthy through JavaScript coercion.
- Preserves intentional clearing of an optional target with an empty value.

### Focused QA

- Goal tests reject negative, non-numeric, and unsupported-metric payloads before writing records.
- Goal tests verify `"false"` on create and `"true"` on update, including a cleared target.
- API test suite: 14 files, 36 tests passed.
- Prisma schema validation and production frontend build passed.
- `git diff --check` passed.

### Known unrelated checks

- Targeted lint still reports pre-existing errors in `Expenses.jsx` and `PaymentMethods.jsx` (state update inside an effect, unused variable, and function declaration order). They were present outside this focused change and remain for QA-25 quality-gate cleanup.
- The production build still warns about a pre-existing duplicate `commission_fee` key in `AddTransaction.jsx`, also tracked by QA-25.

## QA-16 — Add Transaction receipt selection is discarded

Status: **Fixed locally; pending the next requested commit/push**

### Change

- Connected Add Transaction to the existing authenticated receipt attachment endpoint after the inventory record is created.
- The form now reflects the actual one-receipt-per-transaction database contract. It accepts JPEG, PNG, WebP, GIF, and PDF files up to 5 MB, and rejects unsupported or oversized files before creating a transaction.
- If receipt attachment fails after the transaction is saved, the page remains open and retains the created inventory ID. Retrying uploads the receipt to the saved transaction without creating a duplicate purchase.
- Updated the visible receipt instructions to match the supported types, size limit, and single-receipt behavior.

### Focused QA

- Receipt helper tests cover unsupported/oversized files, a successful attachment, an attachment failure, and retry after an attachment failure without a second inventory POST.
- Frontend test suite: 5 files, 13 tests passed.
- API test suite: 12 files, 30 tests passed, including receipt ownership/upload safety tests.
- Production frontend build passed.
- `git diff --check` passed.

### Known unrelated checks

- The production build still warns about a pre-existing duplicate `commission_fee` key in `AddTransaction.jsx`, tracked by QA-25.

## QA-17 — Calendar validation and subscription URL

Status: **Fixed locally; pending the next requested commit/push**

### Change

- Applied the existing calendar-event validation layer to create and update routes.
- Added strict real-calendar-date validation, supported-color validation, and date-range validation. Partial updates are also checked against the existing start/end dates.
- Confirmed and documented the current stable subscription design: the feed is published as a private Cloudinary ICS file, so it does not depend on an undocumented `BACKEND_URL` value.

### Focused QA

- Calendar tests reject February 31, reversed create/update ranges, unsupported colors, and a partial start-date update after the existing end date.
- Calendar tests accept a valid leap-day event and verify the generated subscription URL is Cloudinary-hosted rather than `localhost`.
- API test suite: 13 files, 34 tests passed.
- Prisma schema validation passed.
- Production frontend build passed.
- `git diff --check` passed.

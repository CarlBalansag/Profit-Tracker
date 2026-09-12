# QA checkpoint and execution record

Checkpoint prepared September 11, 2026 (America/Los_Angeles), before the next QA fixes.
This is a recovery baseline, not a declaration that all application behavior is correct.

## Baseline checks

- API: 14 test files, 37 tests passed.
- Frontend: 6 test files, 15 tests passed, including the existing local expense insights changes.
- Prisma schema validation passed; no migrations or live database writes performed.
- Frontend production/PWA build passed; large bundle warning remains.
- Frontend lint failed. Its findings are pending QA-25 work.
- Documentation local links and tracked archive preservation were checked during the documentation cleanup.
- Browser workflows, real PostgreSQL concurrency, Discord OAuth and Cloudinary transfers were not revalidated at this checkpoint.
- probe-results.json is retained as an existing historical artifact; assertions in the old bug-reproduction runner can become obsolete after fixes. It is not the baseline pass/fail authority.

## Sequential work

Each task requires focused regression checks and an affected-flow QA pass before starting the next.
Commit each completed task separately and record precise coverage and remaining limitations here.

| Order | Finding | Status |
|---|---|---|
| 1 | QA-22: intentional clearing of optional account fields | Fixed; focused API regression passed |
| 2 | QA-21: Vendor/Marketplace editing | Fixed; focused browser/frontend/API QA passed |
| 3 | QA-06: consistent financial calculations | Fixed core calculations; focused regression passed |
| 4 | QA-19: Buyer/Invoice ownership | Fixed in code; isolated SQL/API regression passed; hosted migration not applied |
| 5 | QA-20: inactive controls and unfinished workflows | Fixed/clearly disabled per scope; focused regression passed |
| 6 | QA-15: staged currency precision migration | Stages 1–7 implemented and locally verified; hosted cutover/legacy cleanup deferred |
| 7 | QA-25: quality gates, coverage and finding reconciliation | Lint and regression gates implemented; native CI verification and reconciliation in progress |
| 8 | Overall regression across all changes and all 25 findings | Pending |

A finding that has partial safeguards is not closed until its affected paths and relevant scenarios have been checked.
Existing user changes in Expenses and project documentation are part of this checkpoint; editor files and npm caches are excluded.
No deployment is authorized. A Git push must not trigger production or preview hosting.

## QA-22 completed

Changed only optional account update semantics: omitted email/username/notes preserve existing values; empty strings or null clear them.
Ownership, platform association and required-name validation are preserved.

- 13 focused API regression tests passed: individual/all-field clearing, read persistence, repeated clearing, partial/empty updates, restoring values, invalid inputs, missing/foreign/unauthenticated IDs, injected write failure and retry, create/delete.
- Full backend suite: 15 files, 50 tests passed after the fix.
- Node syntax check and git diff --check passed.
- Each request uses the actual account router and validation with isolated fixture data. No live records were written.
- The existing Accounts browser screen has create/delete only, so no browser edit/cancel flow was changed. Cancel has no update request to exercise for this API-only fix.
- Database concurrency is not relevant to independent optional field assignments; real PostgreSQL execution was not tested for this change.
- Git checkpoint 54c4721 was pushed to origin/codex/qa-checkpoint after the user confirmed the branch is excluded from hosting.

## QA-21 completed

Connected Vendor and Marketplace pencil buttons to a shared edit form for name/address/notes and marketplace fee percentage. Existing IDs, tax flags and historical sale commissions are preserved. Successful edits refresh local lists and affected queries. Failed saves retain drafts; pending saves reject duplicate submit/dismissal.

- 13 frontend regression cases passed: existing values, optional-field clearing, Cancel/close/Escape, invalid names/fees, HTTP failure and retry, duplicate submissions, Vendor fee preservation and both parent pencil/list refresh flows.
- 9 API regression cases passed: linked inventory/accounts and historical sale preservation, partial/empty/repeated edits, invalid input, foreign/missing/unauthenticated records, database failure and retry.
- Full API suite: 59 tests passed. Full frontend suite: 28 tests passed.
- Browser fixture: Vendor rename/notes save and reopen; cancelled draft did not replace saved name. Marketplace fee updated to 7.5 and notes cleared successfully.
- Targeted lint on all changed components/tests passed. Production/PWA build passed with existing large-chunk warning. git diff --check passed.
- QA used disposable in-memory records; no live database or external-service writes. Real PostgreSQL and cross-tab browser refresh are not verified by this fixture.

## QA-06 completed for current implemented financial flows

Added shared/finance.mjs for batch/allocated costs, stored-rate cashback, sale economics and realized summaries. Express reporting imports the same module as React. Removed preset-only cashback fallback in the ledger and preview-only tax/shipping switches. Expanded editor rate now derives from the selected stored payment method/vendor instead of an unpersisted custom rate. Partial-sale previews include fees and allocate cashback; editor realized summaries exclude unsold batch cost and cancelled/returned/disputed sales. Inventory totals/rows use allocated full cost. Analytics cost breakdown does not count purchase tax twice and includes outbound shipping. Purchase/sale saves refresh related queries.

- 5 shared-helper fixtures passed: overhead/gifts, partial and split sales, excluded statuses, numeric/empty inputs, stored raw/parsed rates, expiry, malformed data and immutability.
- 4 API report consistency fixtures passed: analytics/Cash Flow/credit-card/receipt totals, multiple purchases/split sales, repeated reads, stored overrides and empty records.
- 5 frontend screen regressions passed: Inventory allocated value, Add Sale fees, Add Transaction partial-sale/cashback preview, editor partial-sale and cancelled summaries.
- Full backend suite: 68 tests passed; full frontend suite: 33 tests passed. Production/PWA build passed with existing bundle warning.
- Browser fixture confirmed ledger batch cost 520, sold cost 208, remaining cost 312 and realized profit 69.16; Inventory matched remaining 312.
- Changed Add Transaction/Inventory/detail and new screen tests pass targeted lint; old Add Sale/Transactions/Analytics lint failures remain QA-25 work.
- Form validation, attachment failure/retry, ownership and write rollback coverage remains in the passing baseline suites. This task changes calculations/cache refresh, not database money types or concurrent write contracts.
- No live database, OAuth or Cloudinary calls were exercised. Tax reporting definitions and business overhead remain separate metrics; fixed-precision migration is QA-15.

## QA-19 completed in code

Added required User ownership and indexes to Buyer/Invoice. Invoice's composite Buyer foreign key enforces a matching owner. Sale create/update validate owned Buyer IDs and preserve omitted Buyer IDs while supporting intentional clearing. Migration infers only unambiguous linked-sale owners and rolls back for orphan/conflicting historical ownership.

- Read-only configured database counts: 0 Buyers, 0 Invoices. No hosted migrations or writes performed.
- 4 API regression cases passed: owned create/update/partial preservation, missing/foreign rejection without stock writes, intentional clearing.
- 4 isolated PostgreSQL-engine SQL cases passed: empty migration/required owner/composite ownership constraint, unambiguous backfill, orphan rollback, conflicting-owner rollback. PGlite is a dev-only migration test dependency; it does not prove multi-connection concurrency.
- Full API suite: 76 tests passed. Prisma schema validation and Node syntax check passed; git diff --check passed.
- Default client generation is blocked by a DLL loaded in a pre-existing local API process. The schema generated successfully to a temporary output without restarting the user's server. Production/development deployment requires normal client generation and the reviewed migration before this new schema runs against a database.
- Prisma auto-install unexpectedly created a user-root package/modules during temporary generation. Verified they were new Prisma-only files and moved them into the temporary QA recovery directory; no existing user files were removed or moved. Automatic deletion review rejected cleanup, so reversible relocation was used successfully.
- Browser changes are not part of this schema/API task. Invoice functionality is still QA-20 work.

## QA-20 completed for agreed scope

User requested unfinished features be clearly disabled. Invoices creation/search/status, Notifications and unsupported Tax Rules/Buyers export categories now say unavailable. Unrouted Forecast prototype actions are disabled. Settings selection controls, selected JSON export, ZIP receipts export, Transactions CSV, filtered Inventory export/search, Add Inventory navigation, Inventory transaction/batch actions, Analytics report JSON and Dashboard SVG share-card downloads are connected. Ledger pagination uses 25 rows per page; exports cover all filtered rows, and header selection covers only the visible page.

- 14 frontend regression cases passed: selected/empty/unavailable exports, authentication/failure/malformed responses, failure/retry/duplicate submit, CSV quoting/formula protection, financial allocations/cancelled sales, SVG XML validity, ZIP deduplication/safe filenames/no external credentials/size limits/empty archives, pagination/filter reset/page selection and Inventory/invoice controls.
- 2 API regression cases passed: every export data source applies ownership filtering; export reads do not generate recurring expenses; unauthenticated requests rejected.
- Full API: 78 tests passed. Full frontend: 47 tests passed. Production/PWA build and focused lint for new utilities/forms/tests/Inventory/Invoices passed. Existing broader lint remains QA-25.
- Browser fixture: Inventory opens existing edit form and Cancel closes it; Settings deselect disables export, select restores it, JSON and ZIP without receipts prepare downloads successfully. Real Cloudinary receipt transfer and OS file-save completion are not exercised; archive contents and failure paths are tested with mocked responses.
- Exports use current owned API data, not a database-wide transaction snapshot; concurrent edits during separate reads can change records. ZIP fails explicitly before downloading on receipt failures; download size capped at 50 MB. No import feature added. No hosted changes.

## QA-15 stages 1–7 implemented and verified locally

Audited all 21 Float fields; added nullable NUMERIC(19,2) money and NUMERIC(9,6) rate companions with reversible backfill and compatibility triggers. Purchase, sale and supporting write flows validate precision, preserve omitted fields and dual-write companions. Shared Decimal arithmetic now drives reports, receipt/calendar costs, screen totals and allocations. Cumulative quantity boundaries conserve cents across split sales and remaining inventory. API clients can request exact currency strings; exports retain normalized strings while the display adapter supports existing forms.

- Full backend suite: 113 tests passed, including precision parsing, additive migration rollback, dual-write validation/ownership/failure/retry, response contracts, cent allocations, cancelled-sale offsets and cross-report consistency.
- Full frontend suite: 51 tests passed, including exact-response adapters, exports and split-cent Inventory/Add Sale previews.
- Prisma validation and default client generation passed. Production build passed with the existing large-bundle warning.
- Read-only configured-data projection: 516 field comparisons in a disposable PGlite staging copy; zero mismatches or invalid historical values. Redacted results: CURRENCY_STAGING_QA.json. This is not a full production database clone or a native multi-connection concurrency test.
- Browser fixture cent edit: remaining Inventory value $312.03; Transactions batch cost $520.05, sold cost $208.02 and realized profit $69.14.
- No hosted migrations/writes. Stage 8 requires a production verification window before making companions required or removing original columns. Numeric compatibility totals are limited below one trillion; an excessive server total fails explicitly. No import feature exists. Full lint is the next QA-25 task.

## QA-25 local quality gates

Resolved frontend lint errors without turning off the React Hooks rules. Modal forms initialize when mounted and reset by selected record; notes derive fetched defaults while preserving user drafts. Tutorial animation tracking stops on unmount. Context hooks/step definitions are separate from provider components. Removed unused code and corrected the JSX Icon argument exception in the existing unused-variable rule.

- Frontend lint passes with --max-warnings 0. Frontend suite: 56 tests passed; an additional Add Sale asynchronous-note regression passed in the focused 7-test financial-screen suite.
- API: 114 tests passed, including a fresh database applying all 16 checked-in migrations in order. Three native PostgreSQL integration cases are explicitly skipped locally without QA_DATABASE_URL.
- Production/PWA build passes; existing bundle-size warning remains.
- Browser fixture: Settings navigation and payment-method loading work; Custom Card draft is discarded on Cancel/reopen. No external service or live record writes.
- Added GitHub Actions gates for API tests, Prisma schema/migrations, frontend tests, lint and build, with disposable PostgreSQL service integration tests. These tests guard their database destination and never fall back to application DATABASE_URL. Remote workflow execution is not yet verified.
- Finding reconciliation identified a possible QA-04 concurrent-edit gap: quantity deltas are computed from a sale read outside the transaction. Two edits can both apply the same delta. Reproduce with two concurrent PUTs changing one sale from quantity 2 to 3; check stock + sales against purchased quantity. A concurrent inventory quantity edit has a related stale-read risk (QA-10). Affected files: routes/sales.js and routes/inventory.js. Separate focused tasks follow this quality-gate change.

## QA-04 reconciliation: conflicting sale edits and atomic deletion

Reproduced the stale sale quantity read using a barrier before two concurrent edits. Sale updates now conditionally claim that quantity version inside the transaction; stale requests return 409 without applying stock changes. Only supplied fields are written, preserving independent concurrent status/price edits. Inventory deletion uses the database foreign-key cascade in one operation instead of deleting sales first.

- Seven atomic mutation fixtures passed: concurrent stale edit, overlapping independent fields, edit failure/rollback/retry/repeated quantity, create rollback, oversized edit, concurrent stock claim and delete failure/history preservation/retry.
- Focused API checks: 20 tests passed including decimal sales, report consistency and tenant ownership. Full API suite before the deletion case: 117 passed; no frontend behavior changed.
- Fixture transactions serialize snapshots so a failed request cannot overwrite another fixture transaction's committed result. This tests application decisions, not native PostgreSQL isolation. Added native concurrent-edit coverage; four native cases remain skipped locally until a disposable PostgreSQL service is available.
- No hosted writes or deployment. QA-10 concurrent inventory quantity updates remain a separate next task.

## QA-10 reconciliation: concurrent purchase quantity changes

Purchase-quantity edits now conditionally match the purchased/on-hand quantities used by their validation read, then update and return the record inside one transaction. A sale committed after that read causes a 409 instead of being overwritten. Money-only edits remain partial writes.

- 20 focused API tests passed: purchased quantity below sold units, recalculation, a sale between read/write, reload/retry, failure preservation, repeated edits, exact purchase fields, immediate-sale rollback, partial preservation and report consistency.
- Added the same paused-read/new-sale/retry case to native PostgreSQL integration coverage; the new case awaits the next CI run.
- The earlier QA-25 CI run 34708368309 passed every gate, including all migrations and the initial three native database tests. Current sale/inventory concurrency additions require a new run. No live/hosted database changes.

## QA-03 reconciliation: expanded editor saves one atomic transaction

Added a validated transaction-wide inventory edit endpoint. It checks ownership of the purchase, every linked sale and every supplied related ID; validates final combined quantities; serializes against stock changes; and saves purchase plus sales in one database transaction. The expanded editor sends one request, checks failure responses and keeps its draft for retry. Pending saves block duplicate submission and dismissal. The expand icon is now an accessible button.

- Eight API cases passed: combined purchase/multiple-sale quantity reductions, exact writes, omitted/empty fields, repeated save, later-sale rollback/retry, overselling/precision/duplicate IDs/inconsistent stock, ownership and authentication.
- Two UI cases passed: one combined request, preserved draft on failure/retry, purchase fields/optional dates, pending duplicate/dismissal protection. Browser fixture unchanged save preserved $520 total cost, $69.16 realized profit, vendor/card/status and closed successfully.
- Full local API: 128 passed, six native cases skipped locally. Full frontend: 59 passed. Zero-warning lint and production/PWA build passed. Added native transaction-wide rollback/retry coverage for the next CI run.
- CI run 34708538284 on the previous checkpoint passed all gates, including five native PostgreSQL cases for sale and inventory concurrent edits. No hosted migrations, live data writes or deployment.
- Reconciliation separately found inline BUY editing sends remaining units as total purchased units, and inline sale saves still use separate requests. Those are the next focused QA-02 task; they are not changed in this expanded-editor task.

## QA-02 reconciliation: inline edits preserve batches and save atomically

Inline BUY quantity edits now add already-sold units when calculating total purchased quantity. Existing sale edits save purchase relationships and sale fields together through the atomic endpoint; failure retains the draft. Optional inline sale creation is supported by that same endpoint and rolls back with purchase updates on failure. Payout clearing is explicit null. Purchase status is preserved.

- Four frontend cases passed: unchanged partial BUY batch/relationships, remaining quantity changes, combined SALE payload/failure preservation, invalid fractional quantity rejected before request. Related pagination/selection tests pass. Zero-warning lint passes.
- Ten transaction-wide API cases passed, including optional sale create, duplicate repeat rejection, sale-create rollback/retry and prior combined-edit/ownership cases. Seven atomic sale cases also pass.
- Browser unchanged BUY save preserved three remaining units, $312 remaining basis, full $520 batch basis and $69.16 realized profit; store/card/status remained present.
- CI run 34708764255 passed all gates on the preceding QA-03 commit, including all six native PostgreSQL cases. This inline change awaits the next CI run. No hosted changes.

## QA-12 reconciliation: generation rollback and partial date validation

Recurring templates, generated occurrences and generation markers now save in one transaction for create/update. Read-triggered generation uses a transaction per template. Partial date edits validate against the saved counterpart date. Existing month-end clamping and unique occurrence constraint remain in place.

- Ten focused API tests passed: month-end dates, marker-failure rollback of template/occurrences, retry/repeated reads, partial end-date rejection, exact amounts, partial updates, ownership and read-only export behavior.
- Added a native concurrent-generation/month-end/pause/resume regression to the next CI run. This uses the real unique constraint; fixture tests alone do not prove duplicate protection under native concurrency.
- No hosted migrations, live data writes or deployment. Additional QA-23 card modal failures and QA-15 Settings total arithmetic were recorded during reconciliation and remain separate next tasks.

## QA-15 reconciliation: Payment Methods summary

Payment Methods credit-limit and tracked-spend summaries now use shared Decimal sums. Added a screen regression for $0.10 + $0.20 = $0.30. This closes the additional Settings arithmetic path identified during reconciliation; final hosted legacy-column cleanup remains deferred.

## QA-23 reconciliation: card form failures and list refresh

Card create/edit callbacks now check HTTP responses and propagate failure to the modal. Forms await success before closing, preserve failed drafts, and block duplicate saves/dismissal while pending. Quick Add removes successfully saved cards from the retry selection and refreshes partial successes. Card edits preserve credit limits and normalize Credit/Debit types for existing report contracts. Successful deletes refresh the local list; failed deletes retain it.

- Five focused form/parent regressions passed: save failure/retry and preserved limits/type, failed/successful delete list consistency, modal draft preservation, pending duplicate/dismissal protection and partial Quick Add retry without duplicates. Existing five modal-lifecycle cases also pass. Zero-warning lint passes.
- No API/database contracts changed; ownership and write validation remain covered by existing API tests. No live data writes, deployment or external-service interactions.
- A separate QA-12 delete failure path was found: generated expense deletion precedes template deletion. Preserve the existing requested delete behavior but make both operations atomic in the next focused task.

## QA-12 reconciliation: recurring deletion

Deleting a recurring template and its generated expenses now uses one transaction. Failure at template deletion preserves generated history. The existing API behavior still deletes generated entries on success; updated project context to distinguish it from the schema's SetNull relationship.

- Focused recurring API suite: five cases passed, including failed delete preservation, successful retry, repeated-delete 404 and prior generation/date checks. No frontend behavior or hosted data changed.

## QA-04 reconciliation: deleting a SALE preserves its purchase

Added owned, atomic sale deletion: delete the selected quantity version and restore its stock in one transaction. Ledger SALE actions use that endpoint; BUY actions retain explicit purchase-plus-linked-sales deletion scope. Bulk delete deduplicates selected purchase/sale combinations, explains cascade scope, retains failed selections for retry and blocks duplicate submission. Successful deletes refresh related totals.

- 24 focused API cases passed: selected sale/sibling preservation, stock restoration, failed restoration rollback/retry, repeated deletion, ownership/authentication, prior atomic edits and financial/transaction-wide consistency.
- 11 focused frontend cases passed: sale endpoint routing, bulk deduplication/cascade warning, cancellation, failure selection preservation/retry and existing edit/pagination checks. Zero-warning lint passes; production/PWA build passes.
- Added native concurrent sale-deletion coverage to verify stock restores once. This awaits the next CI run. All mutations used disposable fixtures; no hosted changes.

## QA-11 reconciliation: exact receipt size and production parser coverage

The fixture and application now share the production 7 MiB JSON parser. Receipt byte-size validation accounts for base64 padding, accepts exactly 5 MiB and rejects malformed/empty base64 before upload. Ownership checks still run before external upload.

- Ten API cases passed: 150 KiB and exact 5 MiB requests, one-byte-over rejection with existing attachment preservation, empty/malformed/unsupported input, owned/foreign upload behavior and full purchase receipt cost.
- Cloudinary is mocked. Real transfer, OS file saving and remote-file rollback on a later database failure are not exercised. No live data or remote-file writes.

## QA-13 reconciliation coverage

Added two Tax Exempt screen regressions. Customer-exempt/non-taxable sales from ordinarily taxed purchases remain visible; selected-year/quarter percentage denominators use the same period; unrelated taxed sales are excluded; empty periods show finite zero totals. Both cases pass. This is coverage of the existing fix, with no additional product behavior change.

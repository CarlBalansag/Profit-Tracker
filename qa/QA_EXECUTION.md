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
| 6 | QA-15: staged currency precision migration | Pending |
| 7 | QA-25: quality gates, coverage and finding reconciliation | Pending |
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

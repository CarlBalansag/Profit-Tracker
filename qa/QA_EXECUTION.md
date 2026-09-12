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
| 3 | QA-06: consistent financial calculations | Pending |
| 4 | QA-19: Buyer/Invoice ownership | Pending |
| 5 | QA-20: inactive controls and unfinished workflows | Pending |
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

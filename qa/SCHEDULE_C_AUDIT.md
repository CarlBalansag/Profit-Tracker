# Schedule C QA audit

Date: September 12, 2026, America/Los_Angeles.

Outcome: ordinary workflows and totals pass existing checks, but three frontend issues were reproduced. No application fixes or real database writes were made. Temporary reproduction tests were removed after recording the results.

**Update 2026-09-30**: SC-03 is fixed (`selvora-app/src/hooks/useModalKeyboard.js`, applied to the Schedule C `TaxEditor` and every other modal app-wide during branch consolidation). SC-01 and SC-02 are moot, not fixed: the current `ScheduleC.jsx` no longer embeds an inline `ReceiptUpload` component at all — the page now links out to the separate `/receipts` page ("Attach supporting receipts through Receipts") instead, per the later redesign described in `qa/SCHEDULE_C_REVIEW_QA.md`. The specific refresh/state-clearing race those findings described can no longer occur because that code path was removed, not patched.

## Confirmed findings

### SC-01 — Receipt upload completion discards an open tax draft (high)

Affected: `selvora-app/src/pages/ScheduleC.jsx`, `ReceiptUpload` upload success callback and worksheet `refresh`.

Reproduction: begin uploading a receipt; while the request is pending, open another expense's inline tax editor and type a missing payee; complete the upload. The editor closes and the unsaved payee disappears. No tax PUT occurs. Reproduced with a delayed request in a temporary frontend test.

Cause: upload completion calls the shared `refresh`, which clears `editing` and replaces the rendered worksheet. Starting an editor is blocked by another editor, but not by an already-running upload.

Proposed fix: coordinate in-flight actions and preserve tax draft state during attachment refresh. At minimum prevent opening a tax editor while an upload is pending; do not allow a refresh to silently discard a draft.

### SC-02 — Uploading one receipt clears another selected file (medium)

Affected: `selvora-app/src/pages/ScheduleC.jsx`, per-row `ReceiptUpload` local state and full-report refresh.

Reproduction: select a receipt for Tape and another for Boxes; upload Boxes. Tape's selected file and cancel-selection control disappear after the report refresh. Reproduced in a temporary frontend test. Uploaded records remain saved; the lost file must be selected again.

Proposed fix: retain selected files by expense ID across report reloads or update the successful attachment in place instead of unmounting every upload form.

### SC-03 — Tax-details dialog lacks keyboard lifecycle handling (medium)

Affected: `selvora-app/src/pages/ScheduleC.jsx`, modal `TaxEditor`.

Reproduction: open Review from Supporting records. In the live browser, focus remains outside the dialog. In a temporary frontend test, pressing Escape leaves the dialog open. The component also contains no focus trap or focus restoration logic; keyboard focus trapping was not separately exercised in the live browser.

Proposed fix: use the project's modal lifecycle conventions: move focus inside, contain keyboard focus, restore focus on close, and handle Escape while respecting the pending-save guard.

## Passed checks

- Existing full frontend suite: 85 tests passed; relevant API Schedule C and receipt-safety suites: 21 tests passed. Lint and production build passed with the existing bundle-size warning.
- Three temporary reproduction tests confirmed the findings above; passing these tests means the bugs were observed, not that the bugs are fixed.
- Independent integer-cent sums matched reviewed-row amounts and category totals for 2025 ($128.55), 2026 ($1,885.57), and 2030 ($0.00). Pending and missing-attachment counts matched contributing records. Paid dates matched the chosen year and excluded records contributed zero.
- API rejected decimal, malformed, oversized, and repeated year parameters with 400; unauthenticated request returned 401. Owner isolation, stale-version updates, invalid uploads, duplicate save guards, failure preservation and retry were exercised by the existing relevant API/frontend suites.
- Existing frontend tests exercised opt-in, empty filters, draft saves, invalid reviewed claims, failed requests, retries, cancellations, page boundaries, filter/category/year reset and complete exports beyond the visible page.
- Browser inspected at 1569 px width: no horizontal page overflow, eight category cards, 11 review records, nine missing-receipt records, and nine visible supporting records on page three. Opened and canceled the modal without modifying data. Narrow-screen checks from the preceding change were at 319 px; that size was not repeated in this audit.

## Suggested improvements

1. Fix SC-01 and SC-02 before expanding upload functionality.
2. Add clear save/upload success feedback and specific field validation messages.
3. Add supporting-record search and sorting; consider a page-size selector when users have larger histories.
4. Offer a single action workspace with Needs review / Missing receipts tabs and compact expandable expense rows to further reduce visible text.
5. Make records with unknown payment dates visibly distinct so their appearance across selected years is understandable.
6. Add attachment preview/replacement from Schedule C and keep Google Drive as a separate integration.

## Unverified limits

Cloudinary is mocked in the local preview; actual hosted uploads, native browser file selection and native PDF output were not exercised. Printing all off-page records has a CSS rule, but closed supporting-record disclosures require a native print check to confirm their evidence appears. No tax-law review, new tax-year form mapping verification, or complete Schedule C/income/COGS audit was performed; this audit concerns the implemented paid-expense worksheet.

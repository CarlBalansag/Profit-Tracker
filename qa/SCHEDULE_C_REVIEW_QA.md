# Schedule C review and attachment sections

Date: September 12, 2026 (local time).

Scope: Schedule C worksheet frontend only. No API, schema, migration, storage-provider, or financial calculation changes.

- Added a dedicated pending-expense section listing individual review issues and an inline editor using the existing tax-details validation and version-checked expense update.
- Added a dedicated missing-receipt section using the existing authenticated receipt attachment route and shared file validation. Its rows match the worksheet's documentation count: personal and unpaid expenses are excluded.
- Summary buttons scroll to their respective sections. Supporting-record filters and exports remain available. Action sections are omitted from printing.

## Verification

- Frontend: all 84 tests passed; lint passed; production build passed (existing bundle-size warning).
- API regression checks: 21 Schedule C and receipt-safety tests passed, including ownership/authentication, invalid uploads, stale updates, and preserving prior attachments after failed operations.
- New frontend coverage: complete pending fields inline, mark reviewed, remove completed row from queue; selected-year and excluded-row behavior; empty, unsupported, and oversized uploads; cancel selection; failed-upload retry with retained file; duplicate submission and cancellation guards during upload; refresh attachment gaps after success.
- Browser against the isolated in-memory preview: completed a pending advertising expense inline; confirmed queue count changed from 11 to 10 and the row left the queue; canceled another inline editor; confirmed upload without file displays a useful validation message.
- Real routes against the isolated fixture: attachment reduced the missing count by one and appeared in Receipts; reviewed total and pending count stayed unchanged. Restored the original tax draft and removed the temporary attachment after verification. Preview returned to $1,885.57, 11 pending entries, and 9 missing attachments.

## Limits

The preview mocks Cloudinary. Actual remote upload and the native browser file picker were not exercised; file selection/upload behavior was covered by frontend tests and the real API route. Google Drive remains a separate integration and is not presented as a functioning action. No hosting deployment or real database writes were performed.

## Visual redesign

Compared the existing Schedule C and Expenses pages visually. Applied the site's theme variables, rounded surface cards, icon treatments and category bars. Moved the expense overview above the review lists; placed review and attachment tasks in two responsive panels with scrollable lists, compact issue badges, and expandable supporting-record details. Review progress describes expense-record review, not filing readiness. Amounts, tax mapping, request bodies, and exports were preserved.

Focused Schedule C regression suite: all 10 tests passed after the redesign; lint and production build passed. Browser checked at a 319 px viewport: no horizontal page overflow, 3 overview cards, all 8 categories, 11 review records, and 9 missing-receipt records remained accessible. Opened/canceled an inline editor, selected Supplies, and confirmed the selected category and supporting-record filter matched with 5 records. The final desktop layout and native PDF printing were not visually exercised at this viewport.

Text-reduction follow-up: removed repeated descriptions and per-receipt format notices, shortened labels and the planning banner, retained explanatory rules under About this worksheet, and showed two review issues per expense with additional issues in a native expandable disclosure. Kept unique accessible names for shortened review and file-selection controls. The 10 Schedule C tests, lint, and build passed; browser inspection confirmed all review and attachment records remained present and showed the shortened supporting-record controls.

Supporting-record pagination: added 10 records per page, range/page counts, Previous/Next boundary controls, page-one resets on filter/category/year changes, and clamping when fewer records remain. Navigation is disabled while a tax editor is open. Exports retain their existing full-worksheet scope; printing includes hidden off-page supporting records. All 11 Schedule C tests, lint, and build passed. New regression coverage includes 23 records, first/middle/last pages, Previous, category and status changes, empty filters, year reset, and an exported record beyond the visible page. Browser with 29 current-year records: verified 9 visible records on page 3, disabled Next, then Supplies reset to page 1 with 5 records. Native PDF output was not exercised.

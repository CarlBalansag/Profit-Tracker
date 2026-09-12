# Current QA status

Verified September 12, 2026. This is the current status of the 25 findings in the historical [audit](QA_REPORT.md). Detailed changes and focused checks are recorded in [QA_EXECUTION.md](QA_EXECUTION.md) and [QA_REMEDIATION_PROGRESS.md](QA_REMEDIATION_PROGRESS.md).

All requested code fixes are implemented and regression checks passed. QA-15's production cutover remains deferred. The ownership and currency migrations are checked in and tested on disposable databases, but have not been applied to hosted data. No deployment was performed.

| Finding | Resolution and evidence |
|---|---|
| QA-01 partial updates | Update validation no longer injects create defaults. Schema and HTTP regressions cover omitted fields, partial updates and deliberate clearing. |
| QA-02 inline editor | Related IDs are returned and preserved. Remaining BUY units are converted to total purchased units; SALE and purchase edits save atomically. Seven UI cases, transaction API coverage and unchanged browser save passed. |
| QA-03 expanded editor | Purchase status, fees, gift card, relationships and optional fields are preserved. One transaction saves purchase and multiple sales; failures retain drafts. Ten transaction API cases, two UI cases, browser save and native rollback/retry coverage passed. |
| QA-04 atomic sales | Create/edit/delete use transactions, inventory locks and quantity-version checks. Sale deletion preserves its purchase and siblings and restores stock once. Ten fixture API cases, UI delete checks and native concurrent create/edit/delete passed. |
| QA-05 tenant relationships | Related IDs are checked against the authenticated owner. Foreign vendor, payment method, platform, buyer and transaction sale IDs are rejected without writes. HTTP ownership regressions passed. |
| QA-06 inconsistent totals | Shared Decimal purchase/sale economics include full batch basis, allocated costs and cashback. API and screen fixtures agree on $520 batch basis, $208 sold basis, $312 remaining basis and $69.16 realized profit. Split-cent coverage passed. |
| QA-07 shipping/status | Realized totals subtract outbound shipping and exclude cancelled/returned/disputed sales. Shared financial and screen regressions passed. |
| QA-08 cash-flow scope | Totals and owed/buyer detail use the complete relevant sales set; recent activity is separately limited. Realized-sale and financial screen regressions passed. |
| QA-09 immediate sale | Purchase and immediate sale save atomically, reject overselling and preserve selected purchase status. Three HTTP cases passed. |
| QA-10 purchased quantity | Stock reconciles against sold units. Conditional writes reject stale concurrent purchase edits; failed edits preserve quantity and money. Four fixture cases and native purchase/sale overlap passed. |
| QA-11 receipt limit/safety | Shared 7 MiB parser permits exact 5 MiB decoded receipts. Empty/malformed/oversized/unsupported input is rejected. Failed replacement preserves the old receipt and attempts new-asset cleanup. Twelve API cases passed; Cloudinary transfer/cleanup were mocked. |
| QA-12 recurring expenses | Month-end clamping, unique occurrence constraints and atomic template/generation/marker writes prevent skips and duplicates. Atomic deletion preserves history on failure. Five fixture cases and native concurrent generation/pause/resume passed. |
| QA-13 tax-exempt report | Customer-exempt sales are included regardless of purchase exemption; percentage denominator follows the same period. Two screen cases cover year/quarter filters and empty periods. |
| QA-14 platform tax | Partial tax edits preserve unrelated fields and platform tax flags are applied. Platform HTTP and financial regressions passed. |
| QA-15 currency precision | Stages 1–7 implemented: nullable Decimal companions, backfill/compatibility triggers, precise validation, arithmetic, allocation and exact API/export strings. All 15 migrations apply to a fresh disposable database; read-only configured-data projection produced 516 comparisons with zero mismatches. **Production cutover and removal of legacy Float columns remain deferred.** |
| QA-16 purchase receipt | Selection is retained and uploaded after purchase creation; receipt failure retry reuses the saved purchase. Four hook regressions passed. External upload was mocked. |
| QA-17 calendar | Partial date edits validate the effective range; subscription feed uses a supported remote URL and full purchase basis. Four event and two feed API cases passed. Live external calendar subscription was not exercised. |
| QA-18 goals | Typed targets reject negative/non-finite/unsupported values, distinguish unit counts from money and parse boolean strings deliberately. Goal and supporting-currency HTTP regressions passed. |
| QA-19 Buyer/Invoice ownership | Required owner columns and matching owner/buyer foreign keys are added with safe backfill. Four HTTP and four isolated SQL cases passed. Hosted migration is deferred; invoice features remain disabled. |
| QA-20 stale controls | Existing-data exports, Inventory actions and Transactions pagination work. Invoices, Notifications and other unfinished controls are clearly disabled per user instruction. Four controls and ten export UI/unit cases plus two read-only export API cases passed. Actual OS save completion and remote receipt downloads were not exercised. |
| QA-21 vendor/marketplace edit | Shared editor persists supported fields, preserves existing tax/commission contracts, refreshes lists and retains failed drafts. Thirteen UI and nine platform API cases passed. |
| QA-22 account optional fields | Omitted fields are preserved; null/empty values clear optional fields. Ownership, invalid values, failures and retries covered by thirteen HTTP cases. |
| QA-23 failed mutations | HTTP responses are checked before local success. Card forms preserve drafts and guard pending operations; partial Quick Add retry skips successful cards. Response-helper, modal and five card-parent/form regressions passed. |
| QA-24 receipt basis | Receipt costs include quantity, tax, inbound shipping, fees and gift-card adjustment. Receipt API and calendar basis regressions passed. |
| QA-25 quality gates | Zero-warning lint, full tests, production/PWA build, fresh migration chain and CI with disposable PostgreSQL are enabled and passed. Overall route smoke checks passed at desktop/mobile sizes. |

## Final overall regression

Code checkpoint: `943f56500daa6a40dfef2523ad280816286ecc24` on `codex/qa-checkpoint`.

- Local API: 146 passed; eight native PostgreSQL cases intentionally skipped without a disposable QA database URL.
- Frontend: 74 passed. Lint passed with `--max-warnings 0`. Production/PWA build passed; the existing large bundle warning remains a performance backlog item.
- Prisma validation and client generation passed. Migration-chain coverage applies all 15 checked-in migrations to a fresh disposable database.
- [CI run 34709524475](https://github.com/CarlBalansag/Profit-Tracker/actions/runs/34709524475) passed migration deployment, API tests with the eight native cases enabled, frontend tests, zero-warning lint and build against disposable PostgreSQL 16.
- Browser fixture smoke check: every one of the 16 routes rendered its expected title at 1280 px desktop and 390 × 844 px mobile; document width matched viewport width, with no new error-boundary rendering or console errors during this pass. This is route/responsive smoke coverage, not exhaustive manual interaction with every control. Focused workflow checks are listed above and in the execution log.
- All mutation checks used disposable fixtures/databases. Hosted migrations, production OAuth, real Cloudinary transfer/cleanup, external calendar subscription and OS download completion remain unverified in this session.

The initial checkpoint is a recovery reference, not permission to skip QA when later changes affect a previously checked flow.

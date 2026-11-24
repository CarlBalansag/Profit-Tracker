# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-past-import-restore | Past imports: restoring an undone import from Activity works at any size, keeps cashout commitment links, and is refused when the items were imported again | `profit-tracker-api/services/activityLog.js` (undoChange, undoActivity, logRemoved removed), `profit-tracker-api/services/cashouts/importHistory.js`, `profit-tracker-api/test/importHistoryPostgres.test.mjs` | In progress | 2026-11-24 |
| fix-email-order-dashes | Email matching ignores dashes in order numbers; adding a purchase no longer logs its details | `profit-tracker-api/services/email/{match,linkPreview}.js`, `profit-tracker-api/routes/inventory.js`, tests | QA passed, waiting for the next batch | 2026-11-24 |
| feat-csv-export-due-banner | Transactions CSV export and a payment-due-soon banner on Credit Card | profit-tracker-app/src/pages/{Transactions,CreditCard}.jsx, profit-tracker-app/src/components/CreditCard/DueSoonBanner.jsx, profit-tracker-app/src/utils/cardDueDates.js, profit-tracker-api/routes/inventory.js (sale tracking number on the list read), profit-tracker-api/test/inventoryListIds.test.mjs, their tests, hook mocks in creditCardPoints/refundsScreens/loadErrors tests | QA passed, not merged | 2026-11-24 |
| fix-ai-guide-rate-limit | AI guide: note and ground rule for the per-key request limit on the AI-assistant endpoint (guide version 1.50) | `shared/aiGuide.mjs` | In progress | 2026-11-24 |
| fix-invoice-pdf-punctuation | Invoice PDF prints curly quotes and long dashes as plain ones instead of "?" | `profit-tracker-app/src/utils/invoicePdf.js` and its test | In progress | 2026-11-24 |

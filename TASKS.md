# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-csv-export-due-banner | Transactions CSV export and a payment-due-soon banner on Credit Card | profit-tracker-app/src/pages/{Transactions,CreditCard}.jsx, profit-tracker-app/src/components/CreditCard/DueSoonBanner.jsx, profit-tracker-app/src/utils/cardDueDates.js, profit-tracker-api/routes/inventory.js (sale tracking number on the list read), profit-tracker-api/test/inventoryListIds.test.mjs, their tests, hook mocks in creditCardPoints/refundsScreens/loadErrors tests | QA passed, not merged | 2026-11-24 |

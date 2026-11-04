# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| batch/ui-fixes | Vendor default return days: prefill on Add Transaction, days instead of a date in the edit window | profit-tracker-api/prisma, profit-tracker-api/routes/platforms.js, profit-tracker-api/validation/schemas.js, profit-tracker-app/src/components/Settings/Vendors.jsx, profit-tracker-app/src/pages/AddTransaction.jsx, profit-tracker-app/src/components/TransactionDetailModal.jsx | In progress | 2026-11-04 |
| fix/cross-page-totals | Reconcile inventory cost, total cost and purchase counts across Inventory, Transactions and Analytics | profit-tracker-api/routes/analytics.js, shared/finance.mjs, profit-tracker-app/src/pages/Inventory.jsx, profit-tracker-app/src/pages/Transactions.jsx, profit-tracker-app/src/pages/Analytics.jsx, new profit-tracker-api/test/crossPageTotals.test.mjs | In progress | 2026-11-03 |

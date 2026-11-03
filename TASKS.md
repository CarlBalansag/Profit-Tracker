# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| fix/cancelled-sale-stock | Stop cancelled/voided/returned sales double-restoring stock on delete and counting as sold in the edit window / qty_purchased edit (adds Sales.restored_qty) | profit-tracker-api/routes/sales.js (DELETE), profit-tracker-api/services/transactionEdit.js, profit-tracker-api/services/statusTransitions.js (sale cancel/void/mark_returned), profit-tracker-api/routes/inventory.js (PUT qty math), profit-tracker-api/prisma/schema.prisma (Sales), profit-tracker-api/prisma/migrations/20261103010000_add_sale_restored_qty/, profit-tracker-api/test/restoredSaleStock.test.mjs, profit-tracker-api/test/statusTransitions.test.mjs (sale seed), profit-tracker-app/src/data/changelog.js | In progress | 2026-11-02 |

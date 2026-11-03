# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| fix/refuse-reopen-restored-sale | Refuse moving a sale whose units a cancel/void/return restored back to a status that counts as a sale (API + status option lists) | profit-tracker-api/services/statusTransitions.js (correct_status + helper), profit-tracker-api/routes/sales.js (PUT status), profit-tracker-api/routes/inventory.js (GET list sale select), profit-tracker-api/services/transactionEdit.js (sale status), profit-tracker-api/routes/mcp.js (updateSaleShipment), shared/finance.mjs (export only), profit-tracker-app/src/data/statusActions.js (+ its test), profit-tracker-api/test/restoredSaleReopen.test.mjs, profit-tracker-api/test/restoredSaleStock.test.mjs + restoredSaleEdits.test.mjs (reopen setup), profit-tracker-app/src/data/changelog.js | In progress | 2026-11-03 |

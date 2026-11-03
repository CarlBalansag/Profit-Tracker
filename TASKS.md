# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/return-window | Optional store return window on purchases (return-by date) with a days-left badge on Record Sale, Inventory and the transaction edit window | profit-tracker-api/prisma/schema.prisma, profit-tracker-api/prisma/migrations/20261102000000_add_inventory_return_by_date/, profit-tracker-api/validation/schemas.js, profit-tracker-api/routes/inventory.js, profit-tracker-api/test/returnWindow.test.mjs, profit-tracker-app/src/utils/returnWindow.js, profit-tracker-app/src/components/ReturnWindowBadge.jsx, profit-tracker-app/src/pages/AddTransaction.jsx, profit-tracker-app/src/components/TransactionDetailModal.jsx, profit-tracker-app/src/pages/AddSale.jsx, profit-tracker-app/src/pages/Inventory.jsx, profit-tracker-app/src/pages/returnWindow.test.jsx, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-02 |

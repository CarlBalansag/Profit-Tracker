# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| fix/restored-sale-edits | Sale quantity edits (REST PUT, MCP update_sale) and sale refunds respect Sales.restored_qty so a cancelled/returned sale can't put units back twice | profit-tracker-api/routes/sales.js (PUT), profit-tracker-api/routes/mcp.js (update_sale), profit-tracker-api/routes/refunds.js (refundSale), profit-tracker-api/test/restoredSaleEdits.test.mjs, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-03 |

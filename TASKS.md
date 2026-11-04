# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| fix/local-date-defaults | Default dates on Add Transaction, Record Sale and Add Expense use the local day instead of UTC (tomorrow in the evening) | profit-tracker-app/src/pages/AddTransaction.jsx, profit-tracker-app/src/pages/AddSale.jsx, profit-tracker-app/src/pages/Expenses.jsx, profit-tracker-app/src/pages/localDateDefaults.test.jsx, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-03 |
| fix/schedulec-settings-copy | Settings > Schedule C description: sale labels and fees are now included | profit-tracker-app/src/components/Settings/ScheduleCSettings.jsx | In progress | 2026-11-03 |
| feat/mcp-sale-label-card | AI assistant can set the shipping-label card on add_sale and update_sale | profit-tracker-api/routes/mcp.js, profit-tracker-api/test/mcpSaleLabelCard.test.mjs | In progress | 2026-11-03 |

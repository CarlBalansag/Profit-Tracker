# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/mcp-refunds | AI assistant can record, list and remove refunds, using one shared refund service | profit-tracker-api/services/refunds.js, profit-tracker-api/routes/refunds.js, profit-tracker-api/routes/mcp.js, profit-tracker-api/test/mcpRefunds.test.mjs, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-04 |
| feat/cashflow-refunds | Show refund amounts on Cash Flow totals and refunded sale rows | profit-tracker-api/routes/analytics.js, profit-tracker-api/test/cashFlowRefunds.test.mjs, profit-tracker-app/src/pages/CashFlow.jsx, profit-tracker-app/src/pages/cashFlowRefunds.test.jsx, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-04 |
| feat/schedulec-returns | Schedule C: show refunds to buyers as returns and allowances (line 2) | profit-tracker-api/services/scheduleC.js, profit-tracker-api/routes/scheduleC.js, profit-tracker-api/test/scheduleCReturns.test.mjs, profit-tracker-app/src/pages/ScheduleC.jsx, profit-tracker-app/src/pages/ScheduleC.test.jsx, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-04 |

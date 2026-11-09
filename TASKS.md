# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/cashout-commitments | Add EB Commitments + tracking submission: CashoutCommitment model, commit/tracking/log-purchase services+routes, 7 new MCP tools, Commitments panel + Log Purchase modal on Cashout page | profit-tracker-api/prisma/schema.prisma, profit-tracker-api/prisma/migrations/20261108000000_cashout_commitments/, profit-tracker-api/routes/cashouts.js, profit-tracker-api/routes/mcp.js, profit-tracker-api/services/cashouts/, profit-tracker-api/test/cashoutCommits.test.mjs, profit-tracker-api/test/mcpCashoutCommits.test.mjs, profit-tracker-app/src/hooks/useApi.js, profit-tracker-app/src/pages/Cashout.jsx, profit-tracker-app/src/pages/Cashout.test.jsx, qa/harness.cjs | In progress | 2026-11-08 |

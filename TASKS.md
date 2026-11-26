# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-mcp-log-uncommitted | MCP: log_cashout_purchase without tracking (pending commit), commit later, order_number dedupe, activity ids | profit-tracker-api/routes/mcp.js (cashout tools), profit-tracker-api/routes/cashouts.js (logCashout move), profit-tracker-api/services/cashouts/logPurchase.js, profit-tracker-api/services/cashouts/pendingCommit.js, shared/aiGuide.mjs, profit-tracker-api/test/mcpCashoutCommits.test.mjs, qa/harness.cjs | In progress | 2026-11-25 |

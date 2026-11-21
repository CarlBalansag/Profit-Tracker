# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-mcp-paid-status | MCP payout fixes + new tools (reconcile_transactions, find_records, list_all_costs, data_quality_report, match_deposit), mark_sale_paid backfill, expense external id + PROXY category | profit-tracker-api/routes/mcp.js, profit-tracker-api/services/markSalesPaid.js, profit-tracker-api/routes/sales.js, profit-tracker-api/routes/expenses.js, profit-tracker-api/services/ (new mcp*/reconcile files), profit-tracker-api/prisma/ (Expense.external_id migration), profit-tracker-api/validation/schemas.js, profit-tracker-api/test/, profit-tracker-app/src/pages/Expenses.jsx | In progress | 2026-11-20 |

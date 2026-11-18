# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-mcp-purchase-account | MCP: store account on add_purchase/update_purchase/log_cashout_purchase, list_inventory shows it, new list_store_accounts tool | `profit-tracker-api/routes/mcp.js`, `profit-tracker-api/test/mcpPurchaseAccount.test.mjs` (new), `qa/harness.cjs` (inventory.account relation) | In progress | 2026-11-18 |

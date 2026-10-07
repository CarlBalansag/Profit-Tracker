# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feature/mcp-platform-buyer | MCP "buyer" = sale's marketplace/cashout Platform, not the Buyer table; remove update_sale_buyer/mark_sale_paid buyer param; list_sales default-all | selvora-api/routes/mcp.js, selvora-api/services/markSalesPaid.js, selvora-api/services/buyers.js, selvora-api/routes/sales.js, selvora-api/validation/schemas.js, selvora-api/test/ | In progress | 2026-10-08 |

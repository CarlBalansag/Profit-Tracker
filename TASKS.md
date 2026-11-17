# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-mcp-cards | AI assistant (MCP) tools for points/cashback cards and the card list | `profit-tracker-api/routes/mcp.js` (payment-method tools only), new `profit-tracker-api/services/linkedCards.js`, `profit-tracker-api/routes/paymentMethods.js` (move auto-update into the service), new `profit-tracker-api/test/mcpCards.test.mjs`, `profit-tracker-app/src/components/Settings/ApiKeys.jsx` (tool list), `README.md` (MCP tool docs) | In progress | 2026-11-17 |
| feat-mcp-activity | AI assistant writes in the Activity log, list/undo activity tools, full refunds, return windows (built on feat-mcp-cards) | `profit-tracker-api/routes/mcp.js` (write tools, refunds, list_inventory), `profit-tracker-api/services/activityLog.js` (undo source only), `profit-tracker-api/services/refunds.js` (fullRefund), new `profit-tracker-api/test/mcpActivity.test.mjs`, `profit-tracker-app/src/components/Settings/ApiKeys.jsx`, `README.md` | In progress | 2026-11-17 |

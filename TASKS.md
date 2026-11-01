# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/mcp-extensions | MCP: per-transaction notes (+ notes panel UI), search, get_item_profit, add_platform/add_payment_method, attachments, market value, void_sale/void_purchase | profit-tracker-api/routes/mcp.js, profit-tracker-api/routes/transactionNotes.js (new), profit-tracker-api/prisma/schema.prisma + new migrations, profit-tracker-api/index.js, profit-tracker-api/test/mcp*.test.mjs, qa/harness.cjs, profit-tracker-app/src/components/TransactionDetailModal.jsx, profit-tracker-app/src/components/TransactionNotesPanel.jsx (new), profit-tracker-app/src/hooks/useApi.js, profit-tracker-app/src/data/changelog.js | In progress | 2026-10-31 |

# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-daily-login-cashouts | LA/P4D deals checked once a day, 1h Sync now cooldown, Sync now only from the button | profit-tracker-api/services/cashouts/{service,syncScheduler,la,p4d}.js, prisma (CashoutConnection.cached_deals), profit-tracker-api/routes/mcp.js (cashout deal tools), shared/aiGuide.mjs, profit-tracker-app/src/pages/Cashout.jsx (handleSyncNow) | In progress | 2026-11-25 |

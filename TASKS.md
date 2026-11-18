# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-log-purchase-ids | Log Purchase form sends store/card IDs the API reads | profit-tracker-app/src/pages/Cashout.jsx, Cashout.test.jsx; profit-tracker-api/test/cashoutCommits.test.mjs | Done, awaiting batch push | 2026-11-17 |
| feat-eb-deferred-commit (on top of fix-log-purchase-ids) | EB Log Purchase without tracking saves a pending commit; adding tracking later asks to commit | profit-tracker-api/services/cashouts/{logPurchase,commits,pendingCommit}.js, routes/{cashouts,sales}.js, prisma schema + migration; profit-tracker-app/src/pages/Cashout.jsx, components/PendingCashoutCommit.jsx, components/Layout/Shell.jsx, hooks/useApi.js (apiFetch), utils/pendingCashoutCommit.js | Done, awaiting batch push | 2026-11-17 |

# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-purchase-tracking-commit | Offer the cashout commit prompt when tracking is added to a purchase (ships straight to EB) or in the transaction editor; don't resend a tracking number already sent with another item | profit-tracker-api/services/cashouts/pendingCommit.js, profit-tracker-api/services/cashouts/commits.js, profit-tracker-api/services/cashouts/logPurchase.js, profit-tracker-app/src/pages/Cashout.jsx, profit-tracker-api/routes/inventory.js, profit-tracker-app/src/components/PendingCashoutCommit.jsx, profit-tracker-app/src/utils/pendingCashoutCommit.js, profit-tracker-app/src/hooks/useApi.js, related tests | In progress | 2026-11-18 |

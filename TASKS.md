# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-commitments-account-col | Store account across Cashout: Commitments column, Log Purchase preselect + already-bought, account in commit/tracking/lower/withdraw prompts | `profit-tracker-app/src/pages/Cashout.jsx`, `profit-tracker-app/src/components/PendingCashoutCommit.jsx`, `profit-tracker-app/src/utils/storeAccounts.js`, `profit-tracker-api/services/cashouts/{commits,pendingCommit}.js` (+ their tests) | In progress | 2026-11-21 |

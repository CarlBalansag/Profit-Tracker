# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-transactions-sale-above-buy | Transactions list: on the same day, a purchase's SALE row sits above its BUY row (sort tie-break only) | `profit-tracker-app/src/pages/Transactions.jsx` (the `rows.sort` line + one import), `profit-tracker-app/src/utils/transactionRowOrder.js` + `.test.js` (new) | In progress | 2026-11-18 |

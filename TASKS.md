# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-cashout-commit-topup | Buy more of an already-committed cashout item: each purchase commits when its tracking is added (first creates, later ones raise the EB commitment); refused raise kept + flagged; cancel/return asks to lower; Commitments groups purchases | `profit-tracker-api/prisma/` (schema + migration), `profit-tracker-api/services/cashouts/{commits,pendingCommit,logPurchase}.js`, `profit-tracker-api/routes/cashouts.js`, `profit-tracker-api/routes/sales.js` (action response only), `profit-tracker-api/routes/mcp.js` (cashout tools), `profit-tracker-app/src/pages/Cashout.jsx` (Log Purchase + Commitments), `profit-tracker-app/src/components/PendingCashoutCommit.jsx`, `profit-tracker-app/src/utils/pendingCashoutCommit.js`, `profit-tracker-app/src/hooks/useApi.js` (prompt wiring), cashout tests | In progress | 2026-11-18 |

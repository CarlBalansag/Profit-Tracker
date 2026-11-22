# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-cashout-import | Settings > Data: import sold items from EB (CSV) and LA/P4D (CSV or saved login) as purchases + sales, skipping ones already recorded | `profit-tracker-api/services/cashouts/importSold.js`, `profit-tracker-api/services/cashouts/parsefile.js`, `profit-tracker-api/routes/cashouts.js`, `profit-tracker-api/prisma/schema.prisma` (Sales.import_ref), new migration, `profit-tracker-app/src/components/Settings/CashoutImport.jsx`, `profit-tracker-app/src/pages/Settings.jsx`, `profit-tracker-app/src/hooks/useApi.js` | In progress | 2026-11-22 |

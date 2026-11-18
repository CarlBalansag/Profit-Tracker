# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-recommit-after-withdraw | Committing an item again after withdrawing it no longer fails | profit-tracker-api/prisma (schema + migration), services/cashouts/{commits,logPurchase}.js, test/cashoutRecommitPostgres.test.mjs | Done, awaiting batch push | 2026-11-17 |

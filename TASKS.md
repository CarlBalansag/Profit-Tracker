# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-past-import-restore | Past imports: restoring an undone import from Activity works at any size, keeps cashout commitment links, and is refused when the items were imported again | `profit-tracker-api/services/activityLog.js` (undoChange, undoActivity, logRemoved removed), `profit-tracker-api/services/cashouts/importHistory.js`, `profit-tracker-api/test/importHistoryPostgres.test.mjs` | In progress | 2026-11-24 |

# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-email-order-dashes | Email matching ignores dashes in order numbers; adding a purchase no longer logs its details | `profit-tracker-api/services/email/{match,linkPreview}.js`, `profit-tracker-api/routes/inventory.js`, tests | QA passed, waiting for the next batch | 2026-11-24 |

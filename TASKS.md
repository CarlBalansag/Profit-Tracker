# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-tax-engine | Schedule C tax planning phase 2: shared tax engine (federal 2025/2026, SE, QBI, credits, estimated payments, no-tax states) + IRS and Tax-Calculator tests; no UI | `shared/tax/`, `profit-tracker-api/test/taxEngine*.test.mjs`, `profit-tracker-api/test/fixtures/taxcalcOracle.json`, `profit-tracker-api/scripts/tax-oracle/`, `notes/schedule-c-tax-plan.md` | In progress | 2026-11-21 |

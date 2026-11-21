# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-schedule-c-books | Schedule C Parts I and III from purchases and sales (gross receipts, COGS with Dec 31 inventory, line 31), reconciliation to app profit, 1099-K platform totals, year-end cutoff | `profit-tracker-api/services/scheduleCBooks.js`, `profit-tracker-api/routes/scheduleC.js`, `profit-tracker-api/test/scheduleCBooks.test.mjs`, `profit-tracker-app/src/components/ScheduleC/ScheduleCBooks.jsx`, `profit-tracker-app/src/pages/ScheduleC.jsx`, `profit-tracker-app/src/pages/ScheduleC.test.jsx`, `profit-tracker-app/src/components/Settings/ScheduleCSettings.jsx` | In progress | 2026-11-21 |

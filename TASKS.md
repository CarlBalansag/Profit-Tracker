# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-activity-setup | Activity log + undo for setup records (cards, store accounts, platforms, buyers, goals, recurring expenses); card remove confirm | profit-tracker-api/services/activityLog.js; profit-tracker-api/routes/{paymentMethods,platforms,accounts,buyers,goals,recurringExpenses,mcp}.js; profit-tracker-app/src/pages/Activity.jsx; profit-tracker-app/src/utils/activityText.js; profit-tracker-app/src/components/Settings/PaymentMethods.jsx; profit-tracker-app/src/hooks/useApi.js (useActivity) | QA passed, waiting for batch push | 2026-11-19 |

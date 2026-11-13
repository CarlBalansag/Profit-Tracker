# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-kpi-loading | Dashboard: KPI cards keep one height in All/Cashout/Marketplace, filter and date changes keep the page up with skeleton values instead of going blank, and big numbers count up (takes over the empty feat/dashboard-count-up-numbers claim) | profit-tracker-app/src/pages/Dashboard.jsx + dashboardDisplay.test.jsx, profit-tracker-app/src/components/UI/CountUp.jsx + test, profit-tracker-app/src/components/PageLoader.jsx, profit-tracker-app/src/hooks/useApi.js (useDashboard only) | In progress | 2026-11-13 |

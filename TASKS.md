# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-analytics-cashflow-overhaul | Rework /analytics and /cashflow (new stats, cash flow endpoint, animations) | profit-tracker-app/src/pages/Analytics.jsx, profit-tracker-app/src/pages/CashFlow.jsx (+ their tests), profit-tracker-app/src/components/Analytics/, profit-tracker-app/src/components/CashFlow/, profit-tracker-app/src/hooks/useApi.js (useCashFlow only), profit-tracker-app/src/data/pagePrefetch.js (/cashflow line), profit-tracker-api/routes/analytics.js, profit-tracker-api/services/cashFlow.js | In progress | 2026-11-17 |
| feat-cashout-eb-link-best-card | Cashout: EB deals-page link button + Best Card column (best saved card and profit per deal) | `profit-tracker-app/src/pages/Cashout.jsx`, `profit-tracker-app/src/utils/cashoutDeals.js` (+ test), `profit-tracker-api/services/cashouts/eb.js` (+ test) | In progress | 2026-11-17 |

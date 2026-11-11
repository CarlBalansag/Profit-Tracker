# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/profit-cost-trend-chart | Rebuild Dashboard "Profit & Cost Trend" line chart as an SVG + motion component (wipe-in, toggle key, hover tooltip) | profit-tracker-app/package.json, profit-tracker-app/package-lock.json, profit-tracker-app/src/components/Dashboard/ProfitCostTrendChart.jsx, profit-tracker-app/src/components/Dashboard/ProfitRevenueTrendChart.jsx (removed), profit-tracker-app/src/utils/trendPoints.js, profit-tracker-app/src/styles/colorPalette.css, profit-tracker-app/src/index.css (token alias only), profit-tracker-app/src/pages/Dashboard.jsx (line-chart block only), profit-tracker-app/src/pages/dashboardDisplay.test.jsx | In progress | 2026-11-10 |

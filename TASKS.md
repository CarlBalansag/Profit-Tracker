# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| fix/dashboard-money-status | Dashboard: commas on dollar amounts and readable status names | profit-tracker-app/src/pages/Dashboard.jsx, profit-tracker-app/src/data/dashboardRegistry.js, profit-tracker-app/src/utils/money.js | In progress | 2026-11-04 |
| fix/ui-audit-5-12 | UI audit findings 5 to 12 plus listing count and Aging checks | profit-tracker-app/src/pages (Transactions, Dashboard, Analytics, CashFlow, CreditCard, Settings, AddTransaction, AddSale, Inventory, Login), profit-tracker-app/src/index.css, profit-tracker-app/src/components/UI, profit-tracker-app/src/components/Layout | In progress | 2026-11-04 |

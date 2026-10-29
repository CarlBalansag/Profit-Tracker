# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/theme-toggle-switch | Floating day/night theme switch with wavy reveal animation, plus dark-mode color tokens | profit-tracker-app/src/components/UI/ThemeSwitch.jsx, profit-tracker-app/src/components/UI/ThemeSwitch.css, profit-tracker-app/src/App.jsx, profit-tracker-app/src/styles/colorPalette.css | In progress | 2026-10-28 |
| feat/derived-expense-lines | Show purchase tax/shipping/fees and sale label/commission as computed read-only lines on the Expenses tab with split totals; retire manual Shipping/Platform Fee categories | profit-tracker-api/services/derivedExpenses.js, profit-tracker-api/routes/expenses.js, profit-tracker-api/routes/mcp.js (add_expense wording only), profit-tracker-api/test/derivedExpenses.test.mjs, profit-tracker-app/src/pages/Expenses.jsx, profit-tracker-app/src/pages/expensesDerived.test.jsx, profit-tracker-app/src/hooks/useApi.js, profit-tracker-app/src/data/changelog.js | In progress | 2026-10-28 |

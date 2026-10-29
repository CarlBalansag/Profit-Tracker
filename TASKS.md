# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/theme-toggle-switch | Floating day/night theme switch with wavy reveal animation, plus dark-mode color tokens | profit-tracker-app/src/components/UI/ThemeSwitch.jsx, profit-tracker-app/src/components/UI/ThemeSwitch.css, profit-tracker-app/src/App.jsx, profit-tracker-app/src/styles/colorPalette.css | In progress | 2026-10-28 |
| feat/schedulec-sale-costs | Schedule C worksheet: include sale shipping labels (postage, 27b) and platform fees (line 10) automatically, keep purchase tax/shipping/fees out (cost of goods), flag manual expenses that look like duplicates | profit-tracker-api/services/scheduleC.js, profit-tracker-api/routes/scheduleC.js, profit-tracker-api/services/derivedExpenses.js, profit-tracker-api/test/scheduleC.test.mjs, profit-tracker-api/test/scheduleCSaleCosts.test.mjs, profit-tracker-api/test/derivedExpenses.test.mjs, profit-tracker-app/src/pages/ScheduleC.jsx, profit-tracker-app/src/pages/ScheduleC.test.jsx, profit-tracker-app/src/data/changelog.js | In progress | 2026-10-29 |

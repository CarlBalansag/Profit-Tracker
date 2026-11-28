# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-sync-times-per-cashout | Cashout page: show each cashout's last sync time under Sync now; fit the tabs on a 320px phone | profit-tracker-app/src/pages/Cashout.jsx, profit-tracker-app/src/utils/cashoutDeals.js, profit-tracker-app/src/pages/Cashout.test.jsx | Ready for batch push | 2026-11-26 |
| feat-discord-deals | Read LA deal posts from the user's Discord server each minute for Live Deals and alerts | profit-tracker-api/services/cashouts/discordDeals.js, dealAlerts.js, syncScheduler.js, prisma/schema.prisma + new migration, qa/harness.cjs, shared/aiGuide.mjs | Ready for batch push | 2026-11-26 |
| redesign | Dashboard redesign and new ledger sidebar (Impeccable), plus motion | profit-tracker-app/src/pages/Dashboard.jsx, profit-tracker-app/src/components/Dashboard/, profit-tracker-app/src/components/Layout/ (Sidebar, BottomNav, Shell, PageSearch, pageList, navFigures + tests), profit-tracker-app/src/components/UI/CountUp.jsx + ThemeSwitch.css, profit-tracker-app/src/hooks/useApi.js + useDashboardSettings.js, profit-tracker-app/src/context/TutorialContext.jsx, Dashboard + sidebar styles in profit-tracker-app/src/index.css, PRODUCT.md | Ready for batch push | 2026-11-26 |

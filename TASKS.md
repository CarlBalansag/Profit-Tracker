# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-cashout-roi | Cashout deals: ROI % (push text + page), sort/filter by ROI, minimum-ROI alert setting, bought-vs-limit tag, payout history window | profit-tracker-api/services/cashouts/dealAlerts.js, profit-tracker-api/routes/push.js, profit-tracker-api/prisma (NotificationSettings.deal_min_roi + migration 20261124090000), profit-tracker-api/test/{dealAlertsPostgres,push,cashouts}.test.mjs, profit-tracker-app/src/pages/Cashout.jsx(+test), profit-tracker-app/src/components/Cashout/*, profit-tracker-app/src/components/Settings/DealAlertSettings.jsx(+test), profit-tracker-app/src/utils/cashoutDeals.js(+test), profit-tracker-app/src/hooks/useApi.js (useCashoutDealHistory) | In progress | 2026-11-24 |

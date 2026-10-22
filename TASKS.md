# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| chore/remove-dead-code-and-deps | Remove confirmed-unused npm dependencies, orphaned source files, and stale superseded docs (no behavior change) | selvora-app/package.json, selvora-api/package.json, selvora-app/src/components/UI/{StatCard,Table}.jsx, selvora-app/src/pages/Forecast.jsx, selvora-api/services/discord{StrategyOptions,TokenExchange}.js, root selvora-v2-glass-workspace.jsx + structure.txt + AUTH_DEPLOYMENT_CHECKLIST.md, qa/*.cjs one-off scripts | In progress | 2026-10-19 |
| feat/glass-dashboard-goals-split-payment | Glassmorphism Brown Dashboard: move Goals widget into the Payment Cards row, splitting it into two half-width cards side by side | selvora-app/src/pages/Dashboard.jsx | In progress | 2026-10-21 |

# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| chore/remove-dead-code-and-deps | Remove confirmed-unused npm dependencies, orphaned source files, and stale superseded docs (no behavior change) | selvora-app/package.json, selvora-api/package.json, selvora-app/src/components/UI/{StatCard,Table}.jsx, selvora-app/src/pages/Forecast.jsx, selvora-api/services/discord{StrategyOptions,TokenExchange}.js, root selvora-v2-glass-workspace.jsx + structure.txt + AUTH_DEPLOYMENT_CHECKLIST.md, qa/*.cjs one-off scripts | In progress | 2026-10-19 |
| feature/verify-ux | Replace the "Continue after verification" button with a waiting/auto-continuing message, since background polling already finishes the sign-in automatically | selvora-app/src/components/Auth/FirebaseLoginForm.jsx, selvora-app/src/data/changelog.js | In progress | 2026-10-21 |

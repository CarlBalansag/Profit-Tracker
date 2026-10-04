# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feature/status-workflow | Rework inventory/sale status model per `future_plans/STATUS_WORKFLOW_PLAN.md`: split receiving vs. sale status, workflow presets, contextual actions, new "Statuses" sidebar view | `selvora-api/prisma/schema.prisma`, `selvora-api/validation/schemas.js`, `selvora-api/services/statusHierarchy.js`, `selvora-api/services/tracking.js`, `selvora-api/services/carriers/`, `selvora-api/routes/inventory.js`, `selvora-api/routes/sales.js`, `selvora-app/src/pages/Inventory.jsx`, `selvora-app/src/pages/Sales*.jsx`, `selvora-app/src/pages/AddTransaction.jsx`, `selvora-app/src/pages/Transactions.jsx`, `selvora-app/src/components/Layout/Sidebar.jsx`, `selvora-app/src/components/UI/StatusPipeline.jsx`, new Statuses page | In progress | 2026-10-01 |
| feature/dashboard-customizer-metrics | Correct dashboard metric labels/formulas/descriptions and remove the redundant Completed pipeline option | `selvora-app/src/data/dashboardRegistry.js`, `selvora-app/src/hooks/useDashboardSettings.js`, `selvora-app/src/components/DashboardSettingsModal.jsx`, `selvora-app/src/pages/Dashboard.jsx`, focused frontend tests, `selvora-app/src/data/changelog.js` | In progress | 2026-10-03 |

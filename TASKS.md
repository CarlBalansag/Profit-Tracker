# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-todos | To-Do page (phase 1): auto to-dos from purchases, sales, cash-outs, cards, invoices; snooze/dismiss; sidebar + bottom-nav badge; Dashboard card | `profit-tracker-api/services/todos.js`, `profit-tracker-api/routes/todos.js`, `profit-tracker-api/prisma/schema.prisma` (TodoState model + migration), `profit-tracker-api/index.js` (mount), `qa/harness.cjs`, `profit-tracker-app/src/pages/Todos.jsx`, `profit-tracker-app/src/pages/lazyPages.js`, `profit-tracker-app/src/App.jsx`, `profit-tracker-app/src/components/Layout/Sidebar.jsx`, `profit-tracker-app/src/components/Layout/BottomNav.jsx`, `profit-tracker-app/src/hooks/useApi.js`, `profit-tracker-app/src/pages/Dashboard.jsx`, `profit-tracker-app/src/pages/Todos.test.jsx`, `profit-tracker-app/src/components/Dashboard/TodoSummary.jsx`, `profit-tracker-app/src/utils/todoLink.js`, `profit-tracker-app/src/data/pagePrefetch.js`, useApi mocks in `profit-tracker-app/src/pages/{dashboardDisplay,lookAndFeel,screenReader}.test.jsx` | In progress | 2026-11-21 |

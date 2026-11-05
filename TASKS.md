# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| fix/page-centering | Center page content again after the look and feel pass left-aligned it | profit-tracker-app/src/pages (outer wrappers only, not Dashboard.jsx), TASKS.md | In progress | 2026-11-04 |
| fix/load-error-states | Show a real error instead of $0.00 or empty screens when data fails to load | profit-tracker-app/src/components/UI/LoadError.jsx, profit-tracker-app/src/pages (not Dashboard.jsx), TASKS.md | In progress | 2026-11-04 |
| fix/screen-reader-keyboard | Name unlabeled controls, make clickable rows work by keyboard, mark dialogs, add a skip link | profit-tracker-app/src/pages (not Dashboard.jsx), profit-tracker-app/src/components (modals and Layout/Shell.jsx), TASKS.md | In progress | 2026-11-04 |

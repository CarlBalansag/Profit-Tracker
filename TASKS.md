# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat/dashboard-count-up-numbers | Animate big Dashboard numbers (stat cards, Goals widget) counting up on load/refresh/navigation, old->new on update, via framer-motion | profit-tracker-app/package.json, profit-tracker-app/src/components/UI/CountUp.jsx, profit-tracker-app/src/pages/Dashboard.jsx | In progress | 2026-10-22 |
| feat/refunds-ui | Refunds part 2 (screens): Refunds section for the purchase and each sale in the transaction edit window, Refunded badge + kept units on Transactions, refund credit rows on the Credit Card page | profit-tracker-app/src/components/RefundsPanel.jsx, profit-tracker-app/src/components/TransactionDetailModal.jsx, profit-tracker-app/src/hooks/useApi.js (refund hooks only), profit-tracker-app/src/pages/Transactions.jsx, profit-tracker-app/src/pages/CreditCard.jsx, profit-tracker-app/src/components/refundsPanel.test.jsx, profit-tracker-app/src/pages/refundsScreens.test.jsx, test mocks in profit-tracker-app/src/components/transactionAtomicSave.test.jsx + pages/financialScreens.test.jsx + pages/returnWindow.test.jsx + pages/saleLabelCard.test.jsx, profit-tracker-app/src/data/changelog.js | In progress | 2026-11-03 |

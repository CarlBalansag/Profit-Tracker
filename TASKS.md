# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-loose-ends | Small fixes: negative money shown as -$5.00 everywhere, no "Since Invalid Date" on recurring expenses, New Invoice button marked not-ready | profit-tracker-app/src/utils/money.js(+test), profit-tracker-app/src/pages/{Expenses,Invoices,Dashboard,TaxExempt,Transactions,AddSale,AddTransaction}.jsx (money/date display lines only), profit-tracker-app/src/components/TransactionDetailModal.jsx (profit display lines) | Ready on branch (tests pass) | 2026-11-24 |

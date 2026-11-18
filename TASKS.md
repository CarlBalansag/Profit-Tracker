# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-buyer-info-tip | Info (i) tip explaining "Buyer (who paid)" on Add Transaction; share InfoTip from RefundsPanel | `profit-tracker-app/src/pages/AddTransaction.jsx`, `profit-tracker-app/src/components/RefundsPanel.jsx`, `profit-tracker-app/src/components/UI/InfoTip.jsx` | In progress | 2026-11-17 |
| feat-purchase-account | Optional store-account dropdown on purchases (Inventory.account_id), shown under Store when the store has accounts | `profit-tracker-api/prisma/` (schema + new migration), `profit-tracker-api/routes/inventory.js`, `profit-tracker-api/services/transactionEdit.js`, `profit-tracker-api/services/ownership.js`, `profit-tracker-api/services/cashouts/logPurchase.js`, `profit-tracker-api/routes/cashouts.js` (log-purchase body only), `profit-tracker-api/validation/schemas.js` (inventory schemas), `profit-tracker-app/src/pages/AddTransaction.jsx`, `profit-tracker-app/src/components/TransactionDetailModal.jsx`, `profit-tracker-app/src/pages/Cashout.jsx` (Log Purchase form), `profit-tracker-app/src/components/StoreAccountSelect.jsx` (new), `qa/harness.cjs` | In progress | 2026-11-18 |

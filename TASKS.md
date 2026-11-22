# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| feat-email-connections | Email connections E1: IMAP + app password, read-only sync of allow-listed senders, Email settings tab | profit-tracker-api/services/email/, profit-tracker-api/routes/email.js, prisma (EmailAccount/EmailFolderCursor/EmailMessage), index.js email mounts, monitoring.js, services/dataReset.js, qa/harness.cjs, profit-tracker-app/src/components/Settings/EmailAccounts*, pages/Settings.jsx, hooks/useApi.js | In progress | 2026-11-22 |
| feat-email-extract | Email E2: read order details (schema.org, store templates, generic) from store emails; Found in email panel | profit-tracker-api/services/email/extract/, services/email/{imap,sync}.js, routes/email.js, prisma EmailMessage columns, test/fixtures/emails.mjs, profit-tracker-app/src/components/Settings/{FoundInEmail,EmailAccounts}* | In progress | 2026-11-22 |
| feat-email-match | Email E3: group emails into orders, match to purchases/sales/expenses with reasons, auto-link sure matches, review list, To-Do items | profit-tracker-api/services/email/{orders,match,settings}.js, routes/email.js, services/todos.js, prisma EmailOrder/EmailMatch, profit-tracker-app/src/components/Settings/EmailOrders* | In progress | 2026-11-22 |

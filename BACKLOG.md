# Selvora backlog

Curated September 11, 2026 from the former notes/todo.txt and payment-method notes.
These are unscheduled ideas, not implementation instructions or verified open bugs. Recheck current code before starting each task.
Work on one task at a time under [AGENTS.md](AGENTS.md).

## Correctness and quality

- Review current source/tests against [QA audit](qa/QA_REPORT.md) and [remediation log](qa/QA_REMEDIATION_PROGRESS.md); confirm remaining findings before scheduling fixes.
- Follow the separate [currency precision plan](CURRENCY_DECIMAL_MIGRATION_PLAN.md) for fixed-precision money.
- Expand meaningful financial, transaction-edit, ownership, workflow and real-database concurrency coverage.
- Add CI for tests, lint and build; address remaining quality-gate failures as separate tasks.
- Recheck dynamic Tailwind classes in AddTransaction and replace unsupported interpolation if still present.
- Gradually introduce TypeScript/shared types and split large page components when a focused task warrants it.

## Product features

- Complete CSV/Excel exports for transactions, analytics and Settings data; retain existing Expenses CSV export.
- Add bulk CSV import with field mapping and validation.
- Implement tenant-owned invoices, sale linking, partial payments and overdue tracking; current invoice screen is a prototype.
- Add an official eBay integration or price suggestions; current price endpoint is a cache, not a live scraper.
- Explore AI monthly business summaries and price suggestions, with accuracy and data handling defined first.
- Add overdue-payout and recurring-expense notifications.
- Consider another login option alongside Discord.
- Improve README presentation with screenshots/demo information; a root README already exists.

## Infrastructure and scale

- Add API/auth rate limiting and structured request logging.
- Move recurring-expense catch-up from request handlers into a reliable background job.
- Add pagination to large lists and database aggregation for reports; avoid full-record processing at scale.
- Consider Docker Compose for local PostgreSQL/API/frontend setup.
- Add useful performance/usage metrics, with a defined privacy policy and operational purpose.

## Payment cards and cashback

- Warn about expiring quarterly preset rates and provide a manual update flow; consider automated refresh only after choosing a reliable source.
- Notify users when a vendor override changes the selected cashback rate, if current feedback is insufficient.
- Add statement balance snapshots and payment history before presenting actual bank balances.
- Add upcoming due-date/autopay reminders.
- Add cashback redemption planning and multi-card comparison tips.
- Add monthly utilization history.
- Add signup-bonus spend progress; verify which metadata is actually persisted first.
- Add annual-fee versus cashback ROI tracking.

## Local requests to reconcile

The editor's `.vscode/project-todos.json` is preserved as local user data. Its unchecked entries are reminders, not verified bug status:

- Recheck Transactions inline editing against current fixes and regression coverage.
- Consider a horizontal scrollbar above the Transactions table.
- Consider a combined inbound/outbound shipping display while retaining their separate stored values.

Completed product-name autocomplete is omitted from the active backlog. Duplicate pagination/aggregation ideas are combined above.
Old feature plans are kept in [notes/archive](notes/archive/README.md) for design context only.

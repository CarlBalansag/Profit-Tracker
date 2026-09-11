# Selvora agent workflow

Use this workflow for every change in this repository.

1. Work on **one clearly defined task at a time**. Do not combine unrelated fixes, refactors, or feature work in the same change.
2. Before editing, identify the affected user flow, API routes, database models, and calculations. Read existing QA findings in `qa/QA_REPORT.md` when the work touches transactions, inventory, sales, financial totals, permissions, or recurring records.
3. Make the smallest change that fully resolves the task. Preserve unrelated user changes in the working tree.
4. After implementation, perform focused QA before declaring the task complete. Test the normal flow, empty and invalid input, edits that omit optional fields, cancel/retry behavior, failure responses, permissions/ownership, and any relevant create/update/delete scenarios.
5. For changes that affect quantities, money, inventory, sales, or related records, also test multi-item data, partial updates, repeated actions, concurrent requests where applicable, and consistency across every screen that displays the affected totals.
6. Verify the database contract: validate request data, confirm ownership of every related ID, preserve data on failed operations, and use atomic database operations where multiple records must remain consistent.
7. Run the relevant automated tests, lint/build checks, and browser/API checks. Add meaningful regression coverage for a bug when practical.
8. Report what changed, the use cases tested, results, and any remaining limitations. Do not claim QA is complete if a relevant scenario was not exercised.

Do not fix unrelated issues discovered during QA. Record them with reproduction steps and affected files so they can become separate, focused tasks.

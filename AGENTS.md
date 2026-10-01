# Selvora agent workflow

Use this workflow for every change in this repository.

1. Work on **one clearly defined task at a time**. Do not combine unrelated fixes, refactors, or feature work in the same change. If another agent or developer may be working in this repo at the same time, read "Working with other agents in parallel" below before starting.
2. Before editing, identify the affected user flow, API routes, database models, and calculations. Read existing QA findings in `qa/QA_REPORT.md` when the work touches transactions, inventory, sales, financial totals, permissions, or recurring records.
3. Make the smallest change that fully resolves the task. Preserve unrelated user changes in the working tree.
4. After implementation, perform focused QA before declaring the task complete. Test the normal flow, empty and invalid input, edits that omit optional fields, cancel/retry behavior, failure responses, permissions/ownership, and any relevant create/update/delete scenarios.
5. For changes that affect quantities, money, inventory, sales, or related records, also test multi-item data, partial updates, repeated actions, concurrent requests where applicable, and consistency across every screen that displays the affected totals.
6. Verify the database contract: validate request data, confirm ownership of every related ID, preserve data on failed operations, and use atomic database operations where multiple records must remain consistent.
7. Run the relevant automated tests, lint/build checks, and browser/API checks. Add meaningful regression coverage for a bug when practical.
8. Report what changed, the use cases tested, results, and any remaining limitations. Do not claim QA is complete if a relevant scenario was not exercised.

Do not fix unrelated issues discovered during QA. Record them with reproduction steps and affected files so they can become separate, focused tasks.

## Working with other agents in parallel

Multiple agents (or an agent and a human) may be working on different tasks in this repo at the same time, each in their own branch/worktree. `TASKS.md` at the repo root is the shared ledger that keeps that from colliding. Before writing any code:

1. Read `TASKS.md`. If an active row's "Files / folders" column overlaps with what this task needs to touch, stop and surface the conflict instead of proceeding — do not start parallel edits on the same files. Pick a different task, or wait for the other row to clear.
2. Add a row for this task before the first edit: branch name, a one-line description, the specific files/folders it expects to touch, status `In progress`, and today's date. Keep the scope narrow and accurate — a vague scope (e.g. "selvora-api/") defeats the point. **Commit and push this row to `main` directly** (not the feature branch) so other agents see the claim immediately — a claim sitting unpushed on a feature branch doesn't protect anyone until that branch merges, which is too late.
3. Keep the branch short-lived. Merge to `main` and delete the branch as soon as this task's QA (above) passes, rather than letting it diverge across multiple sessions — a long-lived divergent branch is expensive to reconcile later (this repo has direct history of that: see the `codex/qa-checkpoint` branch-consolidation effort in `qa/`).
4. In the same change that merges the branch, remove that task's row from `TASKS.md` (or mark it `Done`). Don't leave finished rows behind.

If `TASKS.md` doesn't exist yet, create it with a one-line header and an empty table before adding the first row.

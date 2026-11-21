# Profit Tracker agent workflow

Use this workflow for every change in this repository.

1. Work on **one clearly defined task at a time**. Do not combine unrelated fixes, refactors, or feature work in the same change. If another agent or developer may be working in this repo at the same time, read "Working with other agents in parallel" below before starting.
2. Before editing, identify the affected user flow, API routes, database models, and calculations. Read existing QA findings in `qa/QA_REPORT.md` when the work touches transactions, inventory, sales, financial totals, permissions, or recurring records.
3. Make the smallest change that fully resolves the task. Preserve unrelated user changes in the working tree.
4. After implementation, perform focused QA before declaring the task complete. Test the normal flow, empty and invalid input, edits that omit optional fields, cancel/retry behavior, failure responses, permissions/ownership, and any relevant create/update/delete scenarios. Any change to UI the user sees must also pass "Mobile and responsive checks" below before it is called done or pushed to `main`.
5. For changes that affect quantities, money, inventory, sales, or related records, also test multi-item data, partial updates, repeated actions, concurrent requests where applicable, and consistency across every screen that displays the affected totals.
6. Verify the database contract: validate request data, confirm ownership of every related ID, preserve data on failed operations, and use atomic database operations where multiple records must remain consistent.
7. Run the relevant automated tests, lint/build checks, and browser/API checks. Add meaningful regression coverage for a bug when practical.
8. The "What's New" log (`profit-tracker-app/src/data/changelog.js`, shown in the app sidebar) gets **at most one new entry per push to `main`**, not one per change. Several branches or features going out in the same push share a single entry, summed up in one or two short, non-technical sentences. Add an entry only when the push contains something a user would care about, such as a new feature or a noticeable behavior change. Small changes do not get a version of their own: wording tweaks, minor fixes, internal refactors, QA-only changes, tests and docs are left out, or folded into a bigger entry going out in the same push. Add the entry as the last step before pushing, incrementing the version by `0.01` from `main`'s current top entry at that moment (not whatever it was when the branch started), so branches can't collide on a version number.
9. Report what changed, the use cases tested, results, and any remaining limitations. Do not claim QA is complete if a relevant scenario was not exercised.

Do not fix unrelated issues discovered during QA. Record them with reproduction steps and affected files so they can become separate, focused tasks.

## AI guide (for people's AI assistants)

`shared/aiGuide.mjs` is the guide that teaches people's AI assistants how to use the MCP tools. People copy it from Settings > AI Assistant, and a connected AI pulls it with the `get_ai_guide` MCP tool, which remembers per API key which version that AI last read. Any push that changes what an AI can do over MCP (a tool added, removed or renamed, new inputs, or changed behavior or rules) must, in the same push:

1. Rewrite the affected parts of `AI_GUIDE_BODY` so it describes how things work **now** — it's the full guide for new people, not a history.
2. Add one entry at the top of `AI_GUIDE_UPDATES` with that push's What's New version and date, and a few short notes saying only what changed and what the AI should do differently. An AI that already knows the previous version gets just these notes (copied, or from `get_ai_guide`), so keep them short and complete on their own.

One entry per push, like What's New; pushes with no MCP-facing change get none. `profit-tracker-api/test/aiGuide.test.mjs` fails if a tool is missing from the guide, a removed tool is still named, or a guide version isn't in `changelog.js`.

## Mobile and responsive checks

The app is used on a phone in a store as much as at a desk. Every change that adds or edits something the user sees (a page, component, dialog, menu, table, form, or a new field in one) is designed for the phone first and checked on a phone before it goes to `main`. Not checked on mobile means not done.

**While building**

- Lay it out for a 360px-wide phone first, then let it grow. No fixed widths that only fit desktop, and nothing that relies on hover to show information.
- Tables: on phones, show the same data as cards (one record per card), not a squeezed or sideways-scrolling table. Render one layout per breakpoint with `useMatchMedia` (`src/hooks/useMatchMedia.js`), not two copies hidden with CSS: duplicates break unit tests, screen readers and find-in-page.
- Rows of numbers or pills must wrap (`flex-wrap`, or a 2–3 column grid). Long names truncate or clamp to two lines; words never break mid-word.
- Dialogs: every modal goes through `useModalKeyboard` and is capped at the screen height by the shared rule in `index.css`. Don't override it with a fixed height; long forms scroll inside the dialog.
- Menus and popovers stay inside the screen. Open them toward the side and direction with room, as `MoreActionsMenu` does.
- Touch: buttons and other controls are at least 44px tall on touch screens. The shared `(pointer: coarse)` rules in `index.css` cover `.page-btn`, tabs, inputs and icon buttons with an `aria-label`. Text inputs are 16px on phones so iOS doesn't zoom.
- Navigation: below 1024px the bottom bar is the navigation (More opens the sidebar drawer); from 1024px the sidebar is always visible. Don't add other menu buttons.
- Swipeable groups (pagers, section tabs) use `SectionPager` / `SwipeArea` from `src/components/Analytics/SectionPager.jsx` or the dashboard `PageNav`, with dots and a visible sign that there is more.
- Colours come from the theme tokens. Accent-coloured text uses `--dp-accent-text` so it stays readable in dark mode.

**Before calling it done or pushing to `main`**

1. Open every changed screen in a browser at **375px** (phone) and **320px** (small phone), with touch/mobile emulation on (Playwright `isMobile`/`hasTouch`, or Chrome DevTools device mode). Then check **768px** (tablet) and **1280px** (laptop) to make sure desktop didn't regress.
2. Check both **dark and light** themes on the phone size.
3. Look for, and fix before pushing:
   - the page scrolling sideways (the page's scroll container's `scrollWidth` must equal its `clientWidth`);
   - text, numbers or buttons cut off at the right edge, or overlapping;
   - dialogs whose title, close button or Save is off-screen, including in phone landscape (about 780×360) and with the keyboard open (about 360×430);
   - menus or dropdowns opening off-screen;
   - controls too small to tap, or tap targets that crowd each other;
   - empty space or crowding that a phone layout would use better.
4. Open and close the changed dialogs, menus and expandable rows on the phone size, and use the changed controls. A layout check of the closed state isn't enough.
5. Take a phone-size screenshot of each changed screen and look at it before reporting. In the report, say which widths and themes were checked and what was fixed. If a size could not be checked, say so instead of claiming it passed.

Only push to `main` (with the user's go-ahead, as `CLAUDE.md` requires) once the mobile check passes or the user has accepted the remaining issues.

## Working with other agents in parallel

Multiple agents (or an agent and a human) may be working on different tasks in this repo at the same time, each in their own branch/worktree. `TASKS.md` at the repo root is the shared ledger that keeps that from colliding. Before writing any code:

1. Read `TASKS.md`. If an active row's "Files / folders" column overlaps with what this task needs to touch, stop and surface the conflict instead of proceeding — do not start parallel edits on the same files. Pick a different task, or wait for the other row to clear.
2. Add a row for this task before the first edit: branch name, a one-line description, the specific files/folders it expects to touch, status `In progress`, and today's date. Keep the scope narrow and accurate — a vague scope (e.g. "profit-tracker-api/") defeats the point. **Commit and push this row to `main` directly** (not the feature branch) so other agents see the claim immediately — a claim sitting unpushed on a feature branch doesn't protect anyone until that branch merges, which is too late.
3. Keep the branch short-lived. Merge to `main` and delete the branch as soon as this task's QA (above) passes, rather than letting it diverge across multiple sessions — a long-lived divergent branch is expensive to reconcile later (this repo has direct history of that: see the `codex/qa-checkpoint` branch-consolidation effort in `qa/`).
4. In the same change that merges the branch, remove that task's row from `TASKS.md` (or mark it `Done`). Don't leave finished rows behind.

If `TASKS.md` doesn't exist yet, create it with a one-line header and an empty table before adding the first row.

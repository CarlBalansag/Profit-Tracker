# Invite-only password login cutover

Replacement for Discord login deployed in hosted commit 4f09154. Auth-only migration and three owner-approved accounts provisioned; hosted checks and remaining owner checks tracked below. Schedule C is excluded.

## Data preservation

LocalCredential stores a normalized login email and password hash under an existing User.id. Original Discord IDs, usernames, User.email and every business foreign key remain unchanged. No business records need moving. Six accounts were found by a read-only query of the configured Neon database; three have inventory/sales. Confirm that database matches Render before any production writes. Do not commit the private roster or credential files.

## Before cutover

1. Owner confirms the exact existing user IDs and chosen login emails; include the owner. Empty accounts are not automatically approved or deleted. Login email identifiers need not change the stored Discord email; users must know which identifier to use. There is no automated email delivery.
2. Confirm Render's intended database and save a consistent private data snapshot (a provider backup/restore point is preferable when available). Inspect the standalone LocalCredential migration. Apply only that additive migration in the intended database; do not run all pending QA/Schedule C migrations. Confirm the deployed branch has no Schedule C changes.
3. Generate Prisma Client and use the owner-only CLI in a trusted environment with the correct DATABASE_URL. Default CLI invocation is a read-only dry run:

   node scripts/provision-login.js --user-id EXISTING_UUID --email LOGIN_EMAIL

   To apply, additionally pass --apply --credentials-file ABSOLUTE_PATH_OUTSIDE_REPOSITORY. The file must not already exist. Use an owner-private folder. A random temporary password expires in 24 hours and must be changed on first login. Share it privately with the verified account owner. No passwords belong in Git, logs or Discord alerts. --reset-existing is required to reset an already-provisioned account; resets increment its version and invalidate older password sessions.
4. Provision all approved users, verify account IDs/related-record counts are unchanged, and deploy the replacement only after focused QA and the owner can access their credentials. No public signup/reset is available. Unprovisioned accounts retain their records but cannot log in.

## Behavior to verify

Email/password login uses secure existing PostgreSQL sessions. The UI and API block business access until a temporary password is changed. Sessions are regenerated on authentication/password change. Current credential state/version is checked each request; owner resets/disabled accounts invalidate older sessions. Old Discord sessions are rejected; retired Discord URLs redirect to email login and never contact Discord. /auth/me omits credential hashes, temporary expirations and session secrets. Owners reset lost/expired passwords with the CLI.

Password changes use a version-checked update. Concurrent/reset conflicts cannot overwrite newer credentials. If password persistence succeeds but session persistence fails, the response states that users must sign in with the new password. Old sessions remain invalidated. Authentication derivations use OWASP-minimum scrypt with bounded concurrency. IP attempt limits and hashing queues are process-local and reset on restart; distributed limits would be a separate deployment requirement if replicas are added.

## Pending production verification

Owner confirmed the Render database and completed password rotation. A consistent read-only snapshot of business/user tables and schema metadata was saved outside Git in an owner-only Windows folder; it excludes live sessions and the price cache and is not a provider backup. The additive LocalCredential SQL and its Prisma migration record were applied together in one transaction, after rechecking business fingerprints. Credentials were provisioned only for the three owner-approved existing users; random passwords stayed in separate private files. Original users and business records were not edited.

Hosted API login passed for each approved existing account using its temporary credentials. Each response identified the expected existing user ID, set a Secure/HttpOnly cookie and persisted the password auth method, user ID and credential version in PostgreSQL. Two subsequent /auth/me requests retained the expected identity. Business access returned PASSWORD_CHANGE_REQUIRED. Logout removed the persisted session, and the old cookie returned 401. The site's same-origin Netlify auth proxy also passed POST login, session reload and logout without redirects. No password was changed during those checks.

Post-provision read-only SHA-256 comparisons confirmed all 13 existing user/business tables matched the private snapshot. Exactly three approved credential rows exist, all requiring a first-login password change. Hosted browser displayed the deployed email/password form after reopening a tab that had loaded older frontend assets during deployment.

Remaining owner checks: complete first-login password change in the hosted browser, verify dashboard/inventory/sales, log out and sign in with the new password, reject the old password and verify a session across an actual Render restart. Production owner reset and authenticated business-data isolation after changing passwords were not exercised. Automated fixtures cover completed password changes and ownership isolation, but do not replace these hosted checks.

## Local verification

- API integration: `npx vitest run test/passwordAuth.test.mjs` passed 9 tests using Express, Passport and MemoryStore with fixture users/credentials. Covered forced changes, business-access denial, ownership isolation, invalid/unknown/disabled/expired access, input validation, logout/relogin, session/database failures, attempt limits, concurrent password changes and rejection of old Discord sessions.
- UI: `npx vitest run src/pages/Login.test.jsx --environment jsdom` passed 6 tests for returning/temporary-password users, duplicate submission, failure/retry, protected routes and confirmation validation.
- Frontend production build, Prisma validation/client generation, Node syntax and diff whitespace checks passed. Existing bundle-size warning and the existing unused `fillColor` in Login.jsx remain unrelated findings.
- Standalone SQL migration exercised in disposable PGlite: foreign-key, duplicate-email and normalization constraints rejected invalid writes; existing fixture business records remained unchanged. This does not verify production PostgreSQL sessions.
- Provisioning CLI: 5 regression tests passed for dry run/validation, hash-only persistence/private file output, explicit reset/version increment, transaction/disk/concurrency failure rollback and path restrictions. Private file output is flushed before transaction completion. Production dry runs and initial provisioning succeeded; a production owner reset was not exercised.
- Browser with local fixture API: invalid login displayed a safe error, retry succeeded, and first login opened the forced password-change screen. No new private user password was entered through browser automation. UI tests and API integration cover completed password changes; owner/browser completion remains pending.
- Netlify auth routing uses a 200 proxy rather than a 301 redirect, preserving password-login POST requests when VITE_API_URL is empty. Direct API and proxy deployment paths require hosted verification.

# Invite-only password login cutover

Prepared replacement for Discord login. Not deployed or provisioned yet. Schedule C is excluded.

## Data preservation

LocalCredential stores a normalized login email and password hash under an existing User.id. Original Discord IDs, usernames, User.email and every business foreign key remain unchanged. No business records need moving. Six accounts were found by a read-only query of the configured Neon database; three have inventory/sales. Confirm that database matches Render before any production writes. Do not commit the private roster or credential files.

## Before cutover

1. Owner confirms the exact existing user IDs and chosen login emails; include the owner. Empty accounts are not automatically approved or deleted. Login email identifiers need not change the stored Discord email; users must know which identifier to use. There is no automated email delivery.
2. Confirm Render's intended database and take a provider backup/restore point. Inspect the standalone LocalCredential migration. Apply only that additive migration in the intended database; do not run all pending QA/Schedule C migrations. Confirm the deployed branch has no Schedule C changes.
3. Generate Prisma Client and use the owner-only CLI in a trusted environment with the correct DATABASE_URL. Default CLI invocation is a read-only dry run:

   node scripts/provision-login.js --user-id EXISTING_UUID --email LOGIN_EMAIL

   To apply, additionally pass --apply --credentials-file ABSOLUTE_PATH_OUTSIDE_REPOSITORY. The file must not already exist. Use an owner-private folder. A random temporary password expires in 24 hours and must be changed on first login. Share it privately with the verified account owner. No passwords belong in Git, logs or Discord alerts. --reset-existing is required to reset an already-provisioned account; resets increment its version and invalidate older password sessions.
4. Provision all approved users, verify account IDs/related-record counts are unchanged, and deploy the replacement only after focused QA and the owner can access their credentials. No public signup/reset is available. Unprovisioned accounts retain their records but cannot log in.

## Behavior to verify

Email/password login uses secure existing PostgreSQL sessions. The UI and API block business access until a temporary password is changed. Sessions are regenerated on authentication/password change. Current credential state/version is checked each request; owner resets/disabled accounts invalidate older sessions. Old Discord sessions are rejected; retired Discord URLs redirect to email login and never contact Discord. /auth/me omits credential hashes, temporary expirations and session secrets. Owners reset lost/expired passwords with the CLI.

Password changes use a version-checked update. Concurrent/reset conflicts cannot overwrite newer credentials. If password persistence succeeds but session persistence fails, the response states that users must sign in with the new password. Old sessions remain invalidated. Authentication derivations use OWASP-minimum scrypt with bounded concurrency. IP attempt limits and hashing queues are process-local and reset on restart; distributed limits would be a separate deployment requirement if replicas are added.

## Pending production verification

No migration, account provisioning or deployment performed while mappings/database confirmation are pending. Hosted normal login, forced password change, logout/relogin, old-password rejection, session persistence across restart and owner/user data isolation must be tested after cutover. This file is an operational plan, not proof of hosted success.

## Local verification

- API integration: `npx vitest run test/passwordAuth.test.mjs` passed 8 tests using Express, Passport and MemoryStore with fixture users/credentials. Covered forced changes, business-access denial, ownership isolation, invalid/unknown/disabled/expired access, input validation, logout/relogin, session/database failures, attempt limits and concurrent password changes.
- UI: `npx vitest run src/pages/Login.test.jsx --environment jsdom` passed 6 tests for returning/temporary-password users, duplicate submission, failure/retry, protected routes and confirmation validation.
- Frontend production build, Prisma validation/client generation, Node syntax and diff whitespace checks passed. Existing bundle-size warning and the existing unused `fillColor` in Login.jsx remain unrelated findings.
- Standalone SQL migration exercised in disposable PGlite: foreign-key, duplicate-email and normalization constraints rejected invalid writes; existing fixture business records remained unchanged. This does not verify production PostgreSQL sessions.
- Provisioning CLI durability improvement flushes the private credential file before transaction completion. Actual provisioning/reset CLI against the intended database, native-browser end-to-end checks and hosted verification remain pending.

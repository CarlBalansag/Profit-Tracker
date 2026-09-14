# Firebase Auth rollout

Status: email/password implementation exists locally in the isolated login worktree. Firebase and new registration default OFF. Production has not been deployed or migrated. Schedule C is excluded.

## Owner configuration required

1. Create/select separate development and production Firebase projects. Share project IDs only; keep service-account private keys out of chat and Git. Add a Firebase Web app to each project to obtain its public web configuration.
2. Enable email/password. Set password policy to **Require**, minimum 15 characters; enable email-enumeration protection. Configure owned authorized domains, verification/password-reset templates and approved continue URLs. Authorize localhost only in development. Verify actual delivery, quotas, abuse protections and prices before public registration.
3. Render needs Node >=22 (firebase-admin 14.4.0), `FIREBASE_PROJECT_ID`, and dedicated server credentials through the secret `FIREBASE_SERVICE_ACCOUNT_JSON` or supported application-default credentials. JSON credentials must belong to the exact configured project. Never use VITE fields for private keys.
4. Netlify needs public `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_APP_ID`. For initial production transport set `VITE_API_URL=https://api.profittracker.carltechs.com` and Render `FRONTEND_URL=https://profittracker.carltechs.com` exactly. Do not mix direct API/proxy cookie hosts.
5. Start with `FIREBASE_AUTH_ENABLED=false`, `FIREBASE_SIGNUP_ENABLED=false`, `VITE_FIREBASE_AUTH_ENABLED=false`, `VITE_FIREBASE_SIGNUP_ENABLED=false`. Enable auth in staging only after configuration. Both signup flags remain false until the public-release checks pass. Returning mapped Firebase users can still log in with signup disabled.
6. Production refuses `FIREBASE_AUTH_EMULATOR_HOST`; production frontend refuses `VITE_FIREBASE_AUTH_EMULATOR_URL`. Never transfer emulator settings or its unsigned users/cookies to production.

## Database and deployment order

Take a provider restore point when available plus a private consistent snapshot and record business counts/fingerprints. Inspect actual deployed commit and migration history first. Apply only the reviewed additive SQL `selvora-api/prisma/migrations/20260914000000_firebase_auth/migration.sql` and register its checksum through the existing reviewed auth-cutover process. Do not run `db push`, destructive resets, or deploy every pending migration against production; unrelated QA/Schedule C migrations must stay excluded.

The new code selects `User.login_disabled`, so additive schema migration must precede deploying this runtime, even while Firebase is disabled. The migration creates only five auth tables and an account-disabled flag; it does not change business foreign keys, totals or existing user IDs. Database tests exercise the actual SQL against a private local PostgreSQL database with preexisting User/PaymentMethod records.

Deploy compatible backend with Firebase/signup OFF, verify existing local login, then deploy the configured frontend. Enable Firebase auth after staging acceptance; new public registration remains closed. Preserve the compatible Firebase guard on rollback, retain additive tables, and stop NEW signup independently of returning login. Deploying the old password-only guard after migrating users would lock them out.

## Migrate the three existing users

Only migrate carlbbb, qwk23 and xiva210 initially. Privately verify the intended real email for each original account. Their current `@profittracker.invalid` login identifiers cannot receive verification/recovery email. They must finish their temporary-password change before migration; the shared temporary password is not sufficient proof and is never imported into Firebase.

1. Sign in with the existing private local password and open Settings > Profile. The migration form appears after Firebase auth is enabled.
2. Enter the existing private password and sign into/create the intended Firebase account using a real email/private password. Verify its email. This creates only a provider account, without a new Neon business user.
3. Give the owner the displayed Firebase UID through a private channel. The owner independently verifies the account/email and runs, in a trusted server environment configured for the exact production project/database:

   `node scripts/approveFirebaseMigration.js EXISTING_USER_UUID VERIFIED_FIREBASE_UID`

   This issues one expiring approval. Public clients cannot create it. Never select an existing UUID by an email match. An already-linked identity requires a separate owner-reviewed reconciliation task.
4. The user presses Complete approved migration. Fresh private-password proof, exact owner approval and a verified recent Firebase token are checked; one transaction attaches the identity to the SAME User.id, consumes grants, registers a cookie fingerprint and disables/increments the local credential. No business data is transferred or duplicated.
5. Verify owner first, then the other two: private data counts/fingerprints, actual inventory/sales/settings access, permissions, logout/relogin and Render restart. If the response is lost after commit, use Firebase login to recover the same account; never automatically restore retired local passwords.

Existing legacy login remains in an explicit migration disclosure during rollout. Migrated credentials cannot log in locally. Removal of Passport/legacy password UI is the separate cleanup after all three real migrations pass.

## Supported flows and operational controls

- Public signup uses a real email, compliant password and verification before Neon creation. An interrupted provider signup can sign in, verify and explicitly Register this verified account. Login alone never auto-links an existing account or creates a business user.
- Verification/reset emails use Firebase's current web actions and a fixed `/login` continue URL. Provider errors receive generic UI messages; resend/reset have a 60-second client cooldown. Provider-side policy/enumeration/throttling must still be configured: an attacker can bypass our UI and call public Firebase endpoints.
- Cookies are five-day HttpOnly, SameSite=Lax and host-only; production uses Secure `__Host-pt_firebase_session`. Every authenticated Firebase request checks provider revocation plus fresh Neon identity, disabled flag and cookie fingerprint. Provider outages fail closed with safe 503 responses.
- Controlled auth endpoints require exact Origin, custom header and a browser-bound single-use intent. They use a 16 KiB parser before the receipt parser, durable 40-request/network/15-minute counters and a global 5,000-request/window cap bounding per-network storage. Requests already in flight through the SDK are bounded to 20 with a ten-second response deadline. These initial limits need real-traffic tuning and quota review; do not advertise them as complete bot protection.
- Logout revokes the current fingerprint and clears both cookie types, including malformed/expired-cookie recovery. Logout-all denies all local sessions before provider revocation. A provider failure is explicit; fresh login plus retry or trusted owner action can finish revocation. Failed logout is shown honestly in the UI. Password resets and Web SDK password updates revoke old sessions through the checked provider state.
- Settings password changes require fresh sign-in and a backend check for the exact mapped Firebase UID; passwords go to Firebase. Normal logout does not revoke Google consent.
- Trusted owner disable: `node scripts/disableFirebaseAccount.js EXISTING_USER_UUID`. Durable account-wide local denial commits before provider revocation; rerun to retry a provider failure. There is no public disable/role/migration-approval endpoint.
- User changes clear query caches; business API 401 expires local auth state. The sidebar and profile display the actual signed-in user rather than hardcoded/Discord-only identity text.

## Remaining release gates

Real Firebase projects/secrets and owner email mapping; actual provider signatures, policy/enumeration configuration, email delivery/actions/quotas, real browsers/PWA/mobile, HTTPS CORS/cookies on the canonical hosted origin, Render restart, actual three-user data preservation and failure/rollback drills remain pending. Public release must review current tenant-isolation findings; local existing ownership tests pass, but that does not replace hosted acceptance.

App Check/Identity Platform availability, costs and enforcement require separate provider configuration and legitimate-browser staging checks. No claim of App Check protection is made. The documented Pre-GA Auth integration is not our sole abuse control. Google provider/linking and mobile redirect/proxy compatibility remain the optional next phase after email/password production acceptance; no unfinished Google controls are exposed.

## Repeatable local QA

- API: `npm test` in selvora-api. Firebase tests start a private embedded PostgreSQL cluster with a random localhost port; no repository database URL is used.
- Frontend: `npm test`, `npm run build`, focused ESLint in selvora-app. Whole affected Settings/Sidebar lint still includes reproduced preexisting violations; see the QA report.
- Emulator: from repository root run `npx --package firebase-tools firebase emulators:start --only auth --project demo-profittracker --config qa/firebase-emulator.json`.
- In a second interactive terminal run `node qa/firebase-local-server.cjs`; this uses only local disposable PostgreSQL and the demo emulator. Type `restart` to restart only the API while keeping its QA database intact.
- In a third terminal run `node qa/firebase-emulator-check.cjs`. Browser fixture login is `browser-qa@example.test` with the synthetic password in that QA script; never use real credentials against the emulator.
- Frontend local browser QA needs the public demo configuration, auth/signup flags true, `VITE_API_URL=http://localhost:3059`, `VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099`, and Vite on localhost:5179. No emulator settings belong in production.

Research rechecked: [cookies](https://firebase.google.com/docs/auth/admin/manage-cookies), [revocation](https://firebase.google.com/docs/auth/admin/manage-sessions), [emulator caveats](https://firebase.google.com/docs/emulator-suite/connect_auth), [security checklist](https://firebase.google.com/support/guides/security-checklist). Provider abuse controls and real-environment verification are still required after local tests.

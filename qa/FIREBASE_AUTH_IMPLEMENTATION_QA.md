# Firebase Auth implementation QA

Result: local email/password implementation tested through repeated implement -> QA -> fix -> QA passes, isolated PostgreSQL integration, Firebase Auth Emulator and the actual browser. **Hosted/Firebase production acceptance remains pending configuration.** No production user/business data, credentials or Schedule C changes were made in this task. No deployment/push occurred.

## Scope

Firebase email/password signup, verification, login, recovery, cookie exchange, single/all logout, exact-UID settings reauthentication, private-password plus owner-approved migration preserving User.id, durable API limits, fresh disabled/revocation checks, safe auth errors, query-cache/account isolation and migration-compatible rollback flags. Additive schema creates five auth tables and User.login_disabled. Google linking/redirect, App Check configuration and legacy-provider cleanup remain the explicitly staged follow-ups in the plan.

## Repeat QA findings and fixes

1. Initial full existing API suite passed (74 tests). Database schema validated with explicitly local placeholder URLs; no real database credentials were read. SDK versions were checked against Node compatibility; firebase-admin was upgraded from the initially selected 13.10.0 to current 14.4.0 after dependency review, with a Node >=22 runtime contract.
2. Real PostgreSQL suite initially had two invalid QA fixtures missing required PaymentMethod.type; corrected the fixtures and reran all cases successfully. The actual Firebase additive migration SQL was subsequently applied transactionally to the pre-Firebase contract in the isolated DB, preserving an existing user and payment-method record.
3. Design/runtime review caught an interrupted-signup recovery gap. After refresh and email verification, a provider-only account could not finish registration through login alone. Added explicit Register this verified account, keeping existing-email collision/migration protections. Frontend regression passed.
4. Fixed stale local-session recovery only for the narrow Firebase intent/session endpoints, keeping migration fully authenticated. No broad Firebase route bypass was added. Invalid/duplicate/empty Firebase cookies never fall back to legacy authentication; supported logout can clear them safely.
5. Cookie registration accounts for a provider returning an already-active identical cookie without reopening a revoked fingerprint. Intent/identity/session writes remain atomic; remote cookie creation precedes the transaction and cookie issuance follows commit. Injected provider/DB failures and simultaneous signup/linkage are covered.
6. Review bounded durable limit storage using a global window cap in addition to per-network counters; verified limits after recreating the router. Provider verification slots remain occupied until actual work finishes, even after the ten-second response deadline.
7. Browser QA exposed old Discord-only Settings text and a hardcoded CarlBBB sidebar identity. Corrected both to the actual authenticated account. Invalid-session recovery, query-cache clearing, stale StrictMode auth callbacks and honest failed-logout retry UI were checked.
8. Auth failures are sanitized with an internal public-error marker; SDK transport status/messages cannot leak private provider payloads. Narrow JSON parser errors bypass general telemetry. Auth responses are no-store. Startup rejects production emulator settings, non-HTTPS production frontend and wrong-project/invalid server credentials.

## Automated results

| Check | Result / exercised cases |
| --- | --- |
| API full suite | 92 tests across 20 files; includes existing local-login/business ownership regressions and 18 new Firebase PostgreSQL cases |
| Firebase integration | Wrong project/issuer, forged/unverified/stale/future tokens; origin/header/schema/CSRF/browser binding; single-use/expired grants; duplicate signup; legacy email collisions; active/revoked/disabled/mixed/duplicate/empty cookies; data isolation; logout/replay; fresh-intent recovery; exact owner approval; temporary/stale credential denial; owner disable; concurrent linkage; atomic rollback; durable limits; body-size enforcement; safe provider errors |
| Frontend full suite | 26 tests across 7 files, including 6 Firebase email UI and 3 auth-state/cache tests |
| Frontend scenarios | Signup/verification; repeated submits; invalid confirmation; generic recovery/cooldown; migration UID/proof; interrupted-signup recovery; account-switch/401 cache clearing; failed logout/retry; stale StrictMode callback denial; existing local login/forced password change regressions |
| Prisma / Node | Schema validate/generate and changed server modules syntax checks passed; SQL migration applied against local disposable DB |
| Production build | Passed, with the existing large-bundle warning |
| Focused ESLint | New Firebase forms/service, AuthContext and useApi passed |
| Whole affected legacy file lint | Settings has its reproduced preexisting state-in-effect error; Sidebar has three reproduced preexisting Icon argument unused errors. Compared against HEAD via eslint stdin; those are separate lint work, not claimed clean |

## Real SDK emulator and browser checks

`qa/firebase-emulator-check.cjs` uses only the demo emulator and isolated local API. It exercised real Admin/Web SDK token/cookie exchange, unverified denial, authenticated inventory read, logout replay denial, password-reset OOB action invalidating the old cookie and recovering the same User.id, exact-UID account-check and Web SDK password update revocation. Repeated after fixes; passed. Synthetic passwords/emails are disposable QA fixtures, never real user credentials.

Actual in-app browser against localhost:5179 and the local API confirmed existing verified Firebase login, dashboard and empty inventory access, reload persistence, expired-cookie recovery, corrected sidebar/Settings identity, API PROCESS RESTART with the same PostgreSQL DB retaining the authenticated browser account, and sign-out followed by reload remaining on login. Provider verification/reset forms were covered with frontend tests and real SDK/API emulator checks; no real mailbox or production provider signup was exercised through browser.

## Final research and unresolved release checks

Rechecked Firebase cookie, revocation, emulator and security documentation after implementation. Major password/email changes require revocation-aware verification; reset and Web SDK update behavior passed locally. Unsigned emulator credentials cannot certify production signatures. Firebase public web API keys are public configuration; controlled Render limits do not cover direct provider signup/reset calls. Provider-side policy, enumeration protection, quotas, abuse controls and legitimate-browser acceptance remain mandatory. Sources: [cookies](https://firebase.google.com/docs/auth/admin/manage-cookies), [revocation](https://firebase.google.com/docs/auth/admin/manage-sessions), [emulator](https://firebase.google.com/docs/emulator-suite/connect_auth), [security](https://firebase.google.com/support/guides/security-checklist).

Outstanding: owner-controlled dev/prod Firebase project IDs/credentials; real-email roster for the three users; actual email policy/delivery/actions/quota and abuse configuration; production signed/revoked credentials; canonical hosted HTTPS cookie/CORS/proxy/PWA/mobile behavior; actual three-user migration/data fingerprints and Render restart; production rollback/recovery drill. These are release blockers, not scenarios claimed QA-complete.

Dependency audit still reports existing/runtime and development advisories (including existing Vitest critical UI-server advisory and runtime undici/brace-expansion advisories). Current firebase-admin also brings optional Storage gaxios/uuid advisories; this application imports only app/auth, not Storage/Firestore. No blanket audit fix/major unrelated upgrade was applied. Resolve/review these in focused dependency work before public release; local tests do not prove absence of vulnerabilities.

Use `qa/FIREBASE_AUTH_ROLLOUT.md` for configuration, auth-only migration order, owner approval/disable commands and supported rollback. Google and App Check remain unexposed staged work, not silently advertised as implemented protections.

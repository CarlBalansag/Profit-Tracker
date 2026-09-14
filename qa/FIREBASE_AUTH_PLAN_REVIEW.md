# Firebase Auth plan review and revision record

Scope: design QA of FIREBASE_AUTH_IMPLEMENTATION_PLAN.md against current React/Express/Prisma code and primary Firebase documentation. This is not implementation QA. No Firebase SDK, emulator, real Firebase account, email, browser OAuth or hosted migration was executed during this task.

## Pass 1: security and migration contracts

Read passwordAuth.js, index.js, schema.prisma, AuthContext.jsx, main.jsx, monitoring.js and the relevant QA_REPORT.md findings. Reviewed Firebase password policy, server-cookie/revocation, user management and provider-linking documentation.

Found: the draft described owner approval without a concrete server-side authorization contract; a user changing the publicly shared temp password alone must not be enough to claim a new migration identity. Fixed by adding MigrationApproval for an exact existing User.id and verified Firebase project/UID, consumed atomically with recent local proof and the migration intent. The owner-only approval process cannot be invoked by public input. Private real-email verification remains a prerequisite.

Rechecked migration scenarios: unapproved account, guessed owner ID, UID already mapped, stale grant, temporary password not changed, disabled account and simultaneous link. The revised contracts deny each or produce one atomic winner without moving business records. These are design walkthroughs, not executed assertions.

## Pass 2: consistency, failure recovery and release

Found: the numbered signup flow appeared to create a User in both resolution and cookie-registration stages; migration cookie creation/registration order was underspecified; mixed legacy/Firebase cookies could reopen a retired password path; cookie transport needed a concrete initial choice.

Fixed: resolution prepares writes, one transaction performs user/identity/intent/session registration; remote cookie creation stays outside the transaction and issuance follows commit. Migration registration and retirement are in one transaction. Added deterministic cookie selection, no invalid-Firebase-to-legacy fallback, global disablement for both paths, explicit compatible rollback and initial direct API transport with host-only/Lax cookies. Updated password settings to use Firebase after migration.

Rechecked recovery boundaries: Firebase user created with no Neon row, database failure before commit, mapping commit followed by lost response, single logout cookie replay, logout-all remote failure, account reset, changed email and public-signup kill switch. Revised flow preserves identity/data and keeps returning-user authentication distinct from registration. Unused provider account cleanup is separate and never an automatic account deletion.

## Pass 3: final fresh documentation check

Revisited current session-cookie, session-revocation, Auth quotas, email-action, App Check/Identity Platform and provider-linking documentation after the design passes.

Improvements added:

- Identity Platform App Check is documented Pre-GA; do not confuse its readiness/prerequisites with custom-API attestation or rely on it alone for authentication protection.
- Firebase automatic reset revocation must be enforced by revocation-aware cookie verification; clearing browser state alone is insufficient.
- Email-send quotas differ from generated-link quotas; release checks/alerts must cover delivery, not just link generation.
- Use current web email-action configuration and approved continue origins; no stale Dynamic Links design.
- Known provider-linking caveat remains an explicit optional-Google test gate for the exact chosen SDK/method.
- Auth Emulator permits unsigned credentials, so production startup must reject its environment setting and production-signature tests remain separate.

## Reviewed scenario matrix

| Area | Plan coverage after revisions | Execution status |
| --- | --- | --- |
| Signup, verification and recovery | Real email, provider policy, verified-token refresh, generic errors, approved action origins, revocation | Pending implementation/staging |
| Token/session security | Configured project, signatures/expiry/revocation, recent auth_time, CSRF/origin, registered cookie fingerprint | Pending implementation/staging |
| Input/ownership | Strict schemas/limits, no client-selected user/role, fresh disabled status, related-ID ownership checks | Pending implementation; prior QA findings need recheck |
| Migration and concurrency | Exact owner approval, both-account proof, atomic grant/link/session/retirement, uniqueness and retry | Pending implementation/isolated PostgreSQL |
| Failure and cancellation | No cookies before commit, no automatic deletion/merge, lost-response recovery, retry UI | Pending implementation/browser |
| Logout/reset | One-session replay denial, all-session revocation, reset-aware verification, retired local path denied | Pending implementation/staging |
| Browser/shared-device behavior | In-memory SDK state, cache clearing, direct/proxy cookie-host tests, mobile/PWA/Google storage caveats | Pending implementation/browser |
| Abuse and operations | Durable controlled-API limits, provider endpoint exposure, quotas, App Check caveats, safe diagnostics | Pending configuration/load/staging |
| Deployment/rollback | Isolated auth migration, compatible returning-user path, independent signup flag, emulator rejection | Pending implementation/deployment |

Result: no known unresolved internal flow contradictions found in the final design walkthrough. This does not establish that the implementation is secure or that runtime QA has passed. External gates remain: owner Firebase project/secrets and real migration targets; selected abuse-control configuration/costs; required email/domain/privacy setup; current tenant-isolation finding resolution; actual SDK compatibility and all staged tests above.

No runtime tests were run because this task changes documentation only. Performed document consistency review and Git whitespace checks. All code/data/hosted behavior, including Schedule C, remains unchanged by this task. Implementation must follow the documented implement -> QA -> fix -> QA cycle and overall QA; each failed scenario stays open until fixed/retested, or explicitly pending if an external environment prevents verification.

Primary sources are linked inline in the implementation plan. This review record reports the actual design-review passes; it must not be reused as a production security certification.

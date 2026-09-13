# Hosted Discord login QA — September 13, 2026

Scope: hosted Discord login only. Checkout based on origin/main 265e1b8. Schedule C is excluded.

## Active hosted flow and evidence

The user confirmed https://profittracker.carltechs.com/login starts authorization with callback https://api.profittracker.carltechs.com/auth/discord/callback, then returns to /login?error=login-failed.

Public checks: custom API /health returns 200; unauthenticated /auth/me returns 401; /auth/discord returns 302 with the expected custom callback. Hosted frontend asset uses the custom API for OAuth. Custom frontend is served by Netlify; custom API responses indicate Render. Browser inspection confirms the custom frontend loads.

User-supplied Render logs show a successful DB user lookup and authenticated session before a subsequent OAuth failure. The later error is Failed to obtain access token, raised before profile/DB verification. This evidence does not indicate a database outage.

Earlier probes of profit-tracker-tcqo.onrender.com identified a DIFFERENT callback, profit-tracker-dusky.vercel.app. That Vercel deployment returns 402 DEPLOYMENT_DISABLED. It is not the custom-domain login failure the user reported; do not treat restoring it as the fix for the active app.

## Change

The installed node-oauth client defaults to User-Agent Node-oauth. Discord requires DiscordBot (client URL, version) identification and documents that invalid user agents may be blocked. Added the required custom header to token and profile requests. Added allowlisted error diagnostics for provider codes, HTTP status, network failures and DB cold-start codes. Raw provider bodies, authorization codes, secrets and tokens are not logged. Existing redirects, cookies, sessions, scopes and DB behavior remain unchanged.

This corrects an observed client HTTP contract issue and improves diagnosis; the supplied generic error does not prove that the user agent caused the hosted failure.

Reference: https://docs.discord.com/developers/reference#user-agent

## QA results and pending checks

11 focused tests passed: actual node-oauth HTTP requests to a disposable local server confirm compliant user agent on token/profile requests, correct form encoding, unchanged client/code/callback parameters, successful token parsing, rejected-code failure without retry, provider/network/DB classifications, and secret redaction for malformed/unknown responses.

Node syntax and git whitespace checks passed. No frontend or schema changes; no DB writes/migrations or user session changes performed during QA.

Hosted successful OAuth, new/existing users, cancellation/retry, logout/relogin, cold start and second browser profile remain pending. No authenticated Discord browser session or hosted management connection is available here. A hosted retry and its sanitized Render error output are required if the failure persists. Do not claim hosted login is fixed before that verification.

## Schedule C preservation

Original checkout remains untouched at C:/Users/Carl/Desktop/Projects/selvora_clone.
Local branch codex/schedule-c-saved-20260913 preserves committed base 6bb6fad.
Unfinished files and RESTORE.txt are copied to C:/Users/Carl/Desktop/Projects/selvora_schedule_c_backup_20260913.
Login-only checkout: C:/Users/Carl/Desktop/Projects/selvora_discord_login, branch codex/discord-login-fix, based on hosted main.

## Follow-up: confirmed Discord 429 and cooldown handling

New Render logs from September 13 09:27–09:29 UTC show repeated token endpoint HTTP 429 responses, no network/DB error, and a reachable Neon session pool. The user/browser authorization flow reproduces /login?error=login-failed. Commit 9abdd33 is deployed; the user-agent change did not clear the restriction.

Added a focused fetch transport for token exchange to preserve Retry-After headers discarded by node-oauth. It retains Passport profile/user verification and session handling, request identification, form parameters and callback behavior. A 429 starts an in-process cooldown using the longest valid Retry-After header/date, JSON retry_after or reset-after value. When the provider supplies no usable wait, a 60-second fallback prevents immediate repeated requests; this fallback does not assert the restriction expires in 60 seconds. OAuth initiation and repeated callback exchanges are blocked during the cooldown. There is no automatic token retry. All other errors retain normal failure behavior. Login now shows a countdown and disables all three login buttons until it expires. Logs include sanitized wait/scope and JSON/non-JSON response type for a persistent restriction.

Focused QA: 20 backend tests and 7 frontend tests passed; production build passed (existing large-bundle warning). Actual disposable HTTP token/profile request checks and Passport tests cover success, canceled authorization, failed/invalid code, no token, malformed JSON, network failure, 429 JSON/non-JSON response, header dates, invalid/missing waits, repeated/concurrent callbacks during cooldown and recovery after expiry. Login tests cover generic/cold-start failures, malformed cooldown query values, disabled controls and expiry. A browser preview of the production build with an isolated unauthenticated /auth/me stub verified the cooldown message and disabled login controls; no production DB connected.

Lint remains failing with 43 errors and 1 warning across existing code. Focused Login.jsx/Login.test.jsx lint finds only the pre-existing unused fillColor parameter at Login.jsx:25 (present in HEAD before this update); no new login lint issue. These unrelated findings are deferred rather than included in the login fix.

Remaining limitation: the application cannot lift Discord's external restriction. Hosted success/logout/relogin/cold start/second profile remain pending after deployment and provider cooldown. Cooldown is process-local and resets on restart; multiple API replicas do not share it. If 429 persists after the provider wait, inspect rateLimitScope/responseType, check API outbound request volume and raise the issue with Discord support/Render; a shared outbound-IP restriction is a possibility, not established by the current logs. No credentials, token responses or private records were collected. Schedule C remains excluded.

Reference: https://docs.discord.com/developers/topics/rate-limits

## Follow-up: rate-limit cause diagnostics

Added sanitized evidence to 429 callback logs: requestOrigin distinguishes discord-response from local-cooldown; tokenRequestsLastMinute counts actual transport invocations in this API process using a bounded 60-second bucket map; discordErrorCode retains only numeric codes; cloudflareErrorCode recognizes known 1015/1020/1010 markers; cloudflareRay retains only a validated edge request ID; rateLimitReason classifies known message/error markers without logging raw bodies. JSON global=true provides scope when the header is missing. Local cooldown errors retain the last provider evidence and recompute current volume without calling Discord.

23 focused backend tests passed, including prior token/profile HTTP and Passport behavior, recent-call counts/expiry, local-vs-provider origin, metadata preservation, HTML edge markers, JSON global scope, secret redaction and malformed/injected metadata. Syntax/whitespace checks passed. No frontend/schema changes in this follow-up, so prior build/login browser verification was not repeated. Existing lint findings remain deferred.

Exact original trigger is still unknown. These counters are forward-looking and process-local; they cannot reconstruct pre-deployment traffic or see other replicas/services sharing an outbound address. Correlate a future allowed attempt's sanitized callback log and timestamp with hosting traffic logs; Discord/Render support may need the edge request ID to establish the trigger. No additional production Discord token requests were made for this diagnostic QA. Respect the existing provider cooldown before testing again. Schedule C remains excluded.

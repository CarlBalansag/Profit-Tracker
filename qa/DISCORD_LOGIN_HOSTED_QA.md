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

# Active tasks

Shared ledger for agents/developers working on different branches at the same time. See `AGENTS.md`'s "Working with other agents in parallel" for the rules. Add a row before writing any code; remove it (or mark `Done`) in the same change that merges the branch.

| Branch | Task | Files / folders owned | Status | Started |
|---|---|---|---|---|
| fix-audit-top-four | Audit fixes: CI test setup (scrollIntoView), remove stale vercel.json, non-breaking package security updates, request limits per user/API key and protective headers | `profit-tracker-api/index.js`, `profit-tracker-api/middleware/rateLimiters.js`, `profit-tracker-api/test/rateLimiters.test.mjs`, `profit-tracker-api/package*.json`, `profit-tracker-api/.env.example`, `profit-tracker-app/netlify.toml`, `profit-tracker-app/vite.config.js`, `profit-tracker-app/src/test/setupDom.js`, `profit-tracker-app/package-lock.json` | In progress | 2026-11-24 |

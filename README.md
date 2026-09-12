# Selvora — Reseller Profit Tracker

Selvora tracks purchase batches, linked sales, credit-card cashback, expenses and receipts for resellers.
A React dashboard summarizes stock, sales economics and operational progress.

[Demo](https://profit-tracker.vercel.app) — Discord login required; availability has not been checked as part of this documentation cleanup.

## Documentation

- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md): main knowledge base, architecture, data contracts, calculations, source map and setup details.
- [BACKLOG.md](BACKLOG.md): curated future work and product ideas.
- [AGENTS.md](AGENTS.md): required workflow for repository changes.
- [QA report](qa/QA_REPORT.md) and [remediation log](qa/QA_REMEDIATION_PROGRESS.md): historical findings and later validation; compare with current code.
- [Currency migration plan](CURRENCY_DECIMAL_MIGRATION_PLAN.md): staged precision work.
- [Auth deployment checklist](AUTH_DEPLOYMENT_CHECKLIST.md): login/deployment configuration.
- [Archived feature notes](notes/archive/README.md): older plans and prototypes, not current specifications.

## Stack

React, Vite, React Router, TanStack React Query and Tailwind on the frontend.
Express, Prisma, Zod and PostgreSQL on the backend, with Discord OAuth and PostgreSQL sessions.
Cloudinary handles receipts and published calendar feeds. API Sentry is optional; frontend monitoring is currently a no-op.

The core flow is purchase → linked sale → stock and profit summaries. Purchases can have multiple partial sales.
Goals, product notes, a calendar and dashboard customization supplement that flow.
Invoices and forecasts remain prototypes, and some controls are unfinished.
Financial formulas differ across screens; see the knowledge base and QA records before relying on reporting as complete accounting.

## Getting started

1. Configure `.env` in both packages using their examples and the [environment guide](PROJECT_CONTEXT.md#local-setup-and-checks). Preserve existing files.
2. Use a dedicated development PostgreSQL database and configure Discord OAuth and Cloudinary as needed.
3. Run `npm ci` separately in `selvora-api` and `selvora-app`. API postinstall generates Prisma Client.
4. Review the Prisma migrations before applying them to the intended development database.
5. Run `npm start` in `selvora-api`, and `npm run dev` in `selvora-app` in separate terminals.

The API defaults to localhost:3000 and Vite normally uses localhost:5173.
Set frontend `VITE_API_URL=http://localhost:3000`; there is no Vite API proxy.
Production can use an empty API URL with the configured frontend rewrites.
For login, `VITE_API_DIRECT_URL` selects a direct OAuth origin, falling back to `VITE_API_URL`.

## Checks

Run `npm test` in each package. In `selvora-app`, also run `npm run lint` and `npm run build`.
In `selvora-api`, run `npx prisma validate`; `npx prisma migrate status` checks the configured database's migration state.
Follow AGENTS.md for focused workflow/API/database QA appropriate to each change.
The fixture harness in qa/ does not replace real database concurrency or external integration checks.

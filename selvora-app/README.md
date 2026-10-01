# Selvora frontend (selvora-app)

React 19 + Vite 5 SPA for the Selvora reseller profit tracker. See the [repo root README](../README.md) for the full architecture, tech stack, environment variables, and API surface.

Deployed on Netlify — see `netlify.toml` for build/redirect config.

## Local development

```
npm install
npm run dev      # Vite dev server
npm test         # Vitest
npm run build    # production build to dist/
```

Copy `.env.example` to `.env.local` and fill in Firebase web config + `VITE_API_URL` (point it at your local `selvora-api` instance; leave empty in production, where Netlify's redirects handle routing).

# Discord login deployment checklist (superseded)

**Update 2026-09-30**: both the hosting provider and the auth provider this checklist describes are gone. The frontend is hosted on Netlify, not Vercel (see `selvora-app/netlify.toml`), and Discord OAuth has been fully retired in favor of Firebase email/password auth (`/auth/discord*` now just redirects to `/login`; see `qa/FIREBASE_AUTH_ROLLOUT.md`). For the current, accurate environment-variable and deployment setup, see the root `README.md`'s "Environment Variables" and "Architecture" sections. Left below as a historical record only — do not follow it for a current deployment.

The following values must use the exact active Vercel domain. Do not mix an old Vercel preview URL, a Netlify URL, or the Render API domain.

| Service | Setting | Required value |
| --- | --- | --- |
| Render | `FRONTEND_URL` | `https://<active-vercel-domain>` |
| Render | `DISCORD_CALLBACK_URL` | `https://<active-vercel-domain>/auth/discord/callback` |
| Vercel | `VITE_API_URL` | Empty, so `/api` and `/auth` stay on the first-party Vercel proxy |
| Vercel | `VITE_API_DIRECT_URL` | `https://profit-tracker-tcqo.onrender.com` for starting Discord OAuth only |
| Discord Developer Portal | OAuth2 Redirect URI | Exactly the same callback URL as Render |

After any domain change, deploy the frontend and API, then test: new login, logout followed by login, server cold start followed by login, and a second browser profile.

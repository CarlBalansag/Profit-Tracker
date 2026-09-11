# Discord login deployment checklist

The following values must use the exact active Vercel domain. Do not mix an old Vercel preview URL, a Netlify URL, or the Render API domain.

| Service | Setting | Required value |
| --- | --- | --- |
| Render | `FRONTEND_URL` | `https://<active-vercel-domain>` |
| Render | `DISCORD_CALLBACK_URL` | `https://<active-vercel-domain>/auth/discord/callback` |
| Vercel | `VITE_API_URL` | Empty, so `/api` and `/auth` stay on the first-party Vercel proxy |
| Vercel | `VITE_API_DIRECT_URL` | `https://profit-tracker-tcqo.onrender.com` for starting Discord OAuth only |
| Discord Developer Portal | OAuth2 Redirect URI | Exactly the same callback URL as Render |

After any domain change, deploy the frontend and API, then test: new login, logout followed by login, server cold start followed by login, and a second browser profile.

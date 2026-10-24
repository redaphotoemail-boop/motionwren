# MotionWren: connecting the design to your backend

Two front-end pages exist today, both single files with demo data:

| Page | Who uses it | File |
|---|---|---|
| Public site + video studio + Content Studio + sign-in/account | Clients | keyreel-site.html |
| Manager portal (overview, videos, engines, customers, settings) | You only | admin.src.html |

## Recommended path
1. Put the backend repo on GitHub (it already is, or will be).
2. Give Claude the `owner/repo`. Claude reads the backbone, then:
   - moves the design into the repo (`/web` for the public site, `/web/admin` for the portal),
   - replaces every `BACKEND:` comment with a real call to your endpoints,
   - opens a pull request you can review.
3. Fallback if you prefer to paste: copy both files into the repo under `/web`, then ask ChatGPT to implement the endpoints below.

## Endpoints the front end expects
Every spot in the code marked `BACKEND:` maps to one of these.

| Where | Endpoint | Purpose |
|---|---|---|
| Studio, step 1 | `POST /api/uploads` | Upload listing photos, returns file ids |
| Studio, step 2 | `GET /api/listing?url=…` | Read price, beds, baths, address from a listing link |
| Studio, step 4 | `POST /api/checkout` | Stripe Checkout/PaymentIntent for one video ($39) |
| After payment | `POST /api/videos` | Create the render job (photos, order, music, details). Only after Stripe confirms payment (webhook) |
| Studio, step 5 | `GET /api/videos/:id` | Poll status: queued, rendering, ready, failed |
| Account, Videos | `GET /api/me/videos` | Client's history |
| Account, Download | `GET /api/videos/:id/download` | Signed URL, branded and MLS versions |
| Account, Request change | `POST /api/videos/:id/revisions` | One free revision |
| Pricing, Agent | `POST /api/subscribe` | Stripe subscription (Checkout) |
| Account, Billing | `POST /api/billing-portal` | Stripe customer portal link |
| Content Studio | `POST /api/packages` | Queue selected content pieces |

Manager portal endpoints (admin role only): `GET /api/admin/summary?range=7|30`, `GET /api/admin/videos`, `POST /api/admin/videos/:id/retry`, `POST /api/admin/videos/:id/refund`, `GET /api/admin/engines`, `GET /api/admin/customers`, `GET|PUT /api/admin/settings` (prices, switches).

## Sign-in
Use a hosted auth service so Google, Apple and email links work without custom code: **Clerk**, **Supabase Auth**, **Auth.js** or **Firebase Auth**. Steps: create the project, enable Google, Apple and Email link, paste the client ids. Apple needs an Apple Developer account.

Roles: every user is `client` by default. Your account is `admin`. The server must check the role on every `/api/admin/*` call. Hiding the link is not security.

## Environment variables (server only, never in the page)
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `REPLICATE_API_TOKEN`, `ELEVENLABS_API_KEY`, `AUTH_SECRET` (or your auth provider's keys), storage bucket credentials, email provider key.

## Before going live
- Replace the stand-in rooms and synthesized music previews with real sample footage and licensed or ElevenLabs clips.
- Set final prices in the manager portal Settings (all current prices are placeholders).
- Add Terms and Privacy pages (linked from sign-in).
- Point `motionwren.com` at the deployment (Vercel).

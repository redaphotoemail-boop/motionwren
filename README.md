# MotionWren

MotionWren is a multi-tenant real-estate video SaaS. Customers sign in, import a public listing or enter its details, upload ordered property photos, and receive a finished 1080p video. Owners manage customers, projects, generation engines, production jobs, costs, storage, and deliveries from a protected operations dashboard.

Production site: https://framemotionstudio.storydezign.com

## Product surfaces

- `/` — public marketing and pricing
- `/dashboard` — authenticated customer workspace
- `/admin` — owner-only business and production dashboard
- `/admin/customers` — owner-only CRM directory
- `/admin/projects/:id` — owner project operations
- `/studio` — owner-only advanced generation lab

## Architecture

- Vinext/React application running on Cloudflare Workers
- Cloudflare D1 for accounts, projects, jobs, credits, payments, subscriptions, notifications, and audit events
- Cloudflare R2 for private source images and final MP4 deliveries
- Replicate API for video generation and managed compositor fallback
- Controlled FFmpeg compositor for pinned, deterministic finishing when configured; multi-shot audio uses one master track from the first scene and never mixes independent scene music
- Stripe-ready checkout, credit reservation, webhooks, and automatic failure refunds
- Optional Resend delivery and failure email
- Sign in with ChatGPT for identity; owner role is enforced server-side by email allowlist

Provider tokens and pricing are server-only. Customer pages never receive `REPLICATE_API_TOKEN`, compositor credentials, Stripe secrets, provider endpoints, or raw provider costs.

## Required production environment

Copy `.env.example` locally. In production, configure secrets in the hosting provider rather than committing an environment file.

Required for unattended customer production:

- `FRAME_MOTION_ADMIN_EMAILS`
- `REPLICATE_API_TOKEN`

Required for the controlled media pipeline:

- `COMPOSITOR_API_URL`
- `COMPOSITOR_API_SECRET`
- `COMPOSITOR_API_VERSION`

The controlled compositor must implement `audio_mode: "single_master"` by extracting the first scene's audio track, looping or extending it to the final timeline, and applying one final AAC mix. If it is not configured, the managed fallback keeps audio-requested series silent rather than combining incompatible music from separate scenes.

Required before accepting payment:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_SINGLE`
- `STRIPE_PRICE_FIVE_PACK`
- `STRIPE_PRICE_PRO`

Recommended for customer delivery notifications:

- `RESEND_API_KEY`
- `FRAME_MOTION_FROM_EMAIL`

## Local development

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Validation:

```bash
npm test
npm run lint
npm audit --omit=dev
```

## Database

Drizzle migrations are stored in `drizzle/`. Current tables cover users, projects, project assets, render jobs, generation history, notifications, credits, payments, subscriptions, rate limits, inquiries, and audit events.

Generate a migration after changing `db/schema.ts`:

```bash
npm run db:generate
```

## Deployment

The production application is designed for Cloudflare Workers because it uses native D1 and R2 bindings through `cloudflare:workers`. The repository can be connected to GitHub for source control and agent collaboration.

Do not point the current code directly at Vercel and call it production. A reliable Vercel deployment requires replacing:

- D1 with Postgres or an HTTP-accessible database
- R2 Worker bindings with the S3-compatible R2 API or Vercel Blob
- ChatGPT dispatch headers with a portable authentication provider
- the Vinext/Cloudflare Worker build with standard Next.js runtime configuration

Until that migration is completed, the Cloudflare deployment is the canonical production environment.

## Security rules

- Never place provider, compositor, billing, or email secrets in client components.
- Customer data access must be scoped by authenticated owner ID.
- Owner APIs and pages must call `requireAdmin`.
- Generated files are copied to private R2 storage before a delivery is marked complete.
- Keep callbacks idempotent; a retry must not create a duplicate charge or history record.
- Preserve automatic credit refunds on terminal generation failure.

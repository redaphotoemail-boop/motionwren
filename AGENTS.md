# Agent guide

## Goal

Maintain Frame Motion Studio as a production real-estate video SaaS. The customer journey should remain short: property, photos, finished video. Advanced generation controls belong in the owner-only Studio.

## Non-negotiable behavior

- Never expose `REPLICATE_API_TOKEN` or any service credential to client code.
- Keep `/admin`, `/admin/customers`, `/admin/projects/*`, `/studio`, and owner APIs protected with server-side admin checks.
- Preserve customer ownership checks for projects, assets, history, and downloads.
- Keep generated videos durable in R2 and metadata in D1.
- Keep video generation and finishing browser-independent through provider callbacks.
- Preserve idempotent stitching, history writes, billing reservations, and refunds.
- Real-estate generation must use camera-only motion with static architecture, furnishings, lighting, reflections, and exterior elements.
- Multi-shot deliveries must use server-side assembly and true crossfades.

## UI direction

- Minimal, premium, spacious, and mobile-first.
- Use plain customer language, not provider or model jargon.
- Keep optional inputs collapsed.
- Do not add dashboard cards unless the information changes an owner decision.
- Do not remove generation-engine choice from the owner dashboard or Studio.

## Before committing

Run:

```bash
npm test
npm run lint
npm audit --omit=dev
```

Existing lint output includes image-preview performance warnings in `app/studio/page.tsx`; do not introduce new lint errors.

## Hosting

The canonical deployment targets Cloudflare Workers and uses D1/R2 bindings. Do not deploy the current source to Vercel as a production replacement without completing the database, object-storage, authentication, and runtime migration documented in `README.md`.

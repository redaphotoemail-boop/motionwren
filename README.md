# Frame Motion Studio

Frame Motion turns property photos into professionally directed real estate videos. The public page lets a client choose a length, upload ordered photos, choose a style, and leave contact details. The owner dashboard tracks submissions and downloads each project's source photos with its brief. The private production studio generates clips with supported video engines and assembles a film.

The live site is [Frame Motion Studio](https://frame-motion-private-studio.reda-photoemail.chatgpt.site). Read [PROJECT_CONTINUITY.md](./PROJECT_CONTINUITY.md) before changing the product direction; it records what is implemented and what remains a proposal.

## What's in this repository

- `app/page.tsx` — client intake and upload flow
- `app/dashboard/` — owner queue, project details, source photos, and ZIP export
- `app/studio/` — private generation workspace
- `app/api/` — intake, storage, model calls, stitching, and history endpoints
- `db/schema.ts` and `drizzle/` — database schema and migrations
- `public/` — site assets
- `.openai/hosting.json` — production Sites project ID and Cloudflare binding names
- `.replit` — Replit development workspace configuration

## How the live workflow works

1. A client selects 20, 35, or 50 seconds and supplies 5, 10, or 15 photos respectively. The form blocks extra files and supports removal and reordering.
2. The server saves the project record in Cloudflare D1 and original photos in R2. The owner dashboard is at `/dashboard`.
3. The owner opens the project in `/studio`, generates controlled scenes, assembles the video, and manages its status.

Owner pages and owner data endpoints require the signed-in account specified in `app/owner-auth.ts`. Public upload endpoints use a per-project upload token. The live site depends on OpenAI Sites for ChatGPT sign-in and Cloudflare bindings.

## Run for development

Use Node.js 22 or later. Install dependencies with `npm ci`, then start with `npm run dev`. Replit can import this private GitHub repository and uses the included `.replit` run command.

Local and Replit development use the Cloudflare Vite plugin to simulate the `DB` and `BUCKET` bindings. Apply the SQL migrations in `drizzle/` to a local development database before testing submissions. The public page can be edited and previewed without production credentials. Owner sign-in and production data access depend on the live Sites host, so they require adaptation if the app is moved to another hosting platform.

`npm run build` is the Sites/Vinext deployment build. The scripts in `scripts/` assume Linux tools, including GNU `timeout`; macOS users can run the Vite or Vinext CLIs directly for local checks.

## Credentials and data

No API keys, client submissions, or uploaded photos are stored in GitHub. Add `REPLICATE_API_TOKEN` through the hosting provider's secret settings if you need model generation. Never commit it to this repository. A Replit import copies code and assets; it does not transfer the production D1 records, R2 photos, Sites account access, domain, or runtime secrets.

The authoritative production deployment remains the Sites project declared in `.openai/hosting.json`. Importing into Replit creates a separate development copy; editing there does not automatically update the live site. Commit and push Replit changes to GitHub, then deploy the desired revision through Sites.

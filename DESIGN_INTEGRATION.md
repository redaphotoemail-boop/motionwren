# MotionWren design integration

This branch applies the supplied MotionWren visual system without replacing the
application backbone.

## Presentation files changed

- `app/page.tsx` — MotionWren public landing page and conversion path.
- `app/globals.css` — MotionWren typography, colors, responsive layout and
  compatible styling for the authenticated workspace and owner surfaces.
- `app/layout.tsx` — MotionWren metadata.
- `app/dashboard/page.tsx`, `app/admin/page.tsx`,
  `app/admin/customers/page.tsx`, `app/admin/projects/[id]/page.tsx` and
  `app/studio/page.tsx` — display-name changes only; their data flow is
  unchanged.
- `public/motionwren/*` — supplied brand assets.

The exact designer deliverables are retained under `design-reference/` so a
future UI pass can compare the production React implementation with the
original HTML without relying on another account or attachment.

## Backbone files intentionally unchanged

- `app/api/**`
- `db/**`
- `drizzle/**`
- `worker/**`
- authentication and authorization helpers
- generation, stitching, billing, storage and notification logic

## Runtime surfaces

- `/` — public MotionWren landing page.
- `/dashboard` — authenticated client workspace.
- `/admin` — protected manager dashboard.
- `/studio` — protected production studio.

The landing-page actions continue to use the existing authenticated dashboard
entry point. The manager link remains role-gated inside the authenticated
workspace rather than exposed publicly.

## Premium minimal redesign (October 27, 2026, branch `redesign/premium-minimal`)

One design system now runs through every page and matches the create-video
overlay (`public/studio/mw-studio.html`, unchanged): warm paper, ink, dusk and
amber; Bricolage Grotesque, Geist and Geist Mono; no card borders.

- `app/globals.css` — rewritten from scratch. Sections: tokens, film, site,
  forms, sign-in, legal, workspace, manager, Studio.
- `app/components/` — `brand.tsx` (inline wren mark and wordmark),
  `scenes.tsx` (illustrated stand-in listing photos) and `property-film.tsx`
  (looping sample film used on the homepage, sign-in and empty states).
  Swap the scenes for real listing footage when a licensed film exists.
- Homepage, sign-in, reset, privacy, terms and `/dashboard` — new layouts,
  same endpoints and behaviour. Pricing words and prices are unchanged.
- Manager — shared sidebar (`app/admin/manager-shell.tsx`) on every owner page
  and `/studio`. Orders moved to `/admin/orders` (old `/admin#orders` links
  forward there); engines and scene timing moved to `/admin/engines`.
- Studio — restyled inside the manager shell, plus a bar to make the engine
  being tested the customer default. Generation logic is unchanged.
- APIs (admin-only, read-only additions): `/api/admin/overview` accepts
  `?customer=<email>`, returns `filteredProjectTotal`, a failed-project count,
  owner names, and an estimated cost on activity rows;
  `/api/admin/customers` returns each account's estimated production cost.

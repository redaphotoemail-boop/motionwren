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

# MotionWren — handoff

This folder contains the complete current working tree for MotionWren.

## Current repository state

- Base commit: `778f909 Add owner CRM and agent-ready documentation`
- The updates listed below are present locally but are not committed or pushed.
- The GitHub repository is private at `redaphotoemail-boop/motionwren`.
- Do not publish or replace the live site until the owner explicitly approves deployment.

## Changes included in this handoff

- Added engine-duration compatibility handling so requested 3-second/5-second choices are reconciled with each engine's supported duration.
- Added actual stitched-duration reporting in the Studio UI.
- Corrected multi-shot audio behavior: only the first scene supplies the master music/audio track; later scenes are generated without separate music so the stitched result does not jump between unrelated soundtracks.
- Added controlled-compositor payload fields for `audio_mode`, `audio_source`, `audio_loop`, direction, and voiceover/script data.
- Added safe fallback behavior that mutes audio-requested multi-shot clips when the controlled compositor is unavailable, avoiding mismatched scene music.
- Added owner timing settings API and migration (`drizzle/0007_platform_settings.sql`).
- Updated dashboard/admin/studio UI, engine catalog, styles, history, prediction, generation, and stitching routes.
- Updated the rendered HTML tests and README with the controlled FFmpeg compositor contract.

## Files changed or added

```text
README.md
app/admin/page.tsx
app/api/_lib/render-jobs.ts
app/api/admin/settings/route.ts
app/api/history/route.ts
app/api/predictions/route.ts
app/api/projects/[id]/generate/route.ts
app/api/stitch/route.ts
app/dashboard/page.tsx
app/engine-catalog.ts
app/globals.css
app/page.tsx
app/studio/page.tsx
drizzle/0007_platform_settings.sql
tests/rendered-html.test.mjs
```

## Verification completed

- `npm test` — passed; production build completed and all 6 tests passed.
- `npm run lint` — passed with 0 errors; 8 existing `<img>` warnings remain.
- `npm audit --omit=dev` — 0 vulnerabilities.
- `git diff --check` — passed.

## Important architecture note

The controlled FFmpeg media worker is external to this repository. The app calls it through `COMPOSITOR_API_URL` with `COMPOSITOR_API_SECRET` and `COMPOSITOR_API_VERSION`. The worker must be deployed separately as a pinned, containerized FFmpeg service before production use. The browser is not the production compositor.

## How to transfer this work to the correctly connected GitHub account

1. In the other ChatGPT account, connect GitHub as `redaphotoemail-boop` and grant access to the private repository.
2. Open this local project folder.
3. Apply `motionwren-updates.patch` from this handoff directory, or copy the complete `motionwren-source.zip` snapshot.
4. Review the diff, run the verification commands above, then commit and push to the repository's intended branch.
5. Keep production deployment and domain settings unchanged until the owner approves the release.

No credentials or tokens are stored in this handoff.

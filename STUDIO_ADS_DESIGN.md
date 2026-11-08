# Studio Ads — design

Admin-only tab for Reda to make commercials / social ads. NOT client-facing.
Branch: `feature/studio-ads`, base main `4d04060`. No merge, no deploy in this task.

## Where the tab lives

- Nav: `app/admin/manager-shell.tsx`, one new entry in the `links` array, right
  after Studio: `{ href: "/admin/studio-ads", label: "Studio Ads", icon: "motion" }`.
  (No "ads" icon exists in `app/ui-icon.tsx`; "motion" fits.)
- Pages (all inside `/admin`, so `app/admin/layout.tsx`'s server-side
  `requireAdmin` gate covers them — no new gate code):
  - `app/admin/studio-ads/page.tsx` — one client page, three sections:
    Create (form + uploads), Actors (library), Ads (list + status + download).
- No link from any client-facing page. No change to `/studio`, the plan flow,
  prices, or any customer route.

## Routes (all `requireAdmin`, all under `/api/admin/studio-ads/`)

| Route | Purpose |
|---|---|
| `GET/POST /api/admin/studio-ads` | list ads / create an ad |
| `GET/DELETE /api/admin/studio-ads/[id]` | one ad / delete it |
| `POST /api/admin/studio-ads/[id]/assets` | upload source images (the video's images) |
| `POST /api/admin/studio-ads/[id]/generate` | start generation (draft or full) |
| `GET/POST /api/admin/studio-ads/actors` | list / create an actor |
| `DELETE /api/admin/studio-ads/actors/[id]` | delete an actor (+ its photos) |
| `POST /api/admin/studio-ads/actors/[id]/photos` | upload an actor photo (angle: front / side / three-quarter / silhouette) |
| `GET /api/admin/studio-ads/voices` | ElevenLabs voice list (live when keyed, honest 503 when not) |

Rate limits mirror the customer paths: uploads 120/hr, generate 6/hr.

## Data — own tables (not the `projects` table)

`projects` is real-estate-shaped (listingUrl, beds, baths, price, agentName…).
Reusing it with a kind flag would leave most columns null and mix ad rows into
customer order queries. Own tables, migration `drizzle/0011_studio_ads.sql`
(hand-written SQL, applied in the D1 console like `0010`), plus drizzle
definitions in `db/schema.ts`:

- `ad_projects` — id, owner_id, title, hook, prompt (user prompt),
  scene_prompts (JSON, one per scene for 30s/60s), engine, resolution, aspect
  (`vertical` 9:16 | `horizontal` 16:9 | `square` 1:1), target_duration (10/30/60),
  subtitles (JSON: on/off, lines, position, size), voiceover_script, voice_id,
  music_mood, draft (0/1), status, render_job_id, final_history_id, cost_cents,
  created_at, updated_at.
- `ad_assets` — id, ad_project_id, owner_id, kind (`source`), r2_key, file_name,
  content_type, size_bytes, sort_order, expires_at (90 days), created_at.
- `ad_actors` — id, owner_id, name, notes, created_at, updated_at.
- `ad_actor_photos` — id, actor_id, owner_id, angle
  (`front` | `side` | `three-quarter` | `silhouette` | `other`), r2_key,
  file_name, content_type, size_bytes, sort_order, created_at.
  Actor photos never expire (library); deleted with the actor.
- `ad_project_actors` — ad_project_id, actor_id (many actors per ad).

Generation reuses the existing `render_jobs` table with `kind = "ad-series"`
and `category = "ad"` — the queue, heartbeat recovery, and manager alerts
already work off that table, and no customer query reads it by kind.
`generation_history` gets the finished film the same way (category `ad`).

## Prompt — new module, real-estate prompts untouched

- `app/api/_lib/ads-production.ts` — `ADS_THEME`: a big theme prompt
  (premium, cinematic, very realistic, true to the source images, no artifacts,
  no warping/morphing/flicker, creative camera language chosen by the engine,
  never childish, never cheesy, no fake text, no distorted hands/faces).
  The user's prompt is layered on top; per-scene prompts (30s/60s) layer
  under the theme. Actor blocks name the actor and their angles.
- `STATIC_LOCK` / `MOVEMENTS` in `customer-production.ts` and the realEstate
  prompts in `app/studio/page.tsx` are NOT touched or imported.
- Pure builders (theme assembly, per-scene prompts, subtitle .ass text,
  duration plan, cost estimate) live in `app/ads-creative.ts` — no
  `cloudflare:workers` import, so they are unit-testable with plain node.

## Durations → scenes → cost (measured with the repo's own `scenePlan`)

`scenePlan(engine, "1080p", target, photos)` — scenes are made at the shortest
engine length covering their share, then trimmed to the share in the edit.
Cost = engine $/s × sceneSeconds × scenes (catalog prices in
`app/engine-catalog.ts`). With 12 photos available:

| Ad | Wan 3.0 1080p | Kling 3.0 1080p | Runway 4.5 1080p |
|---|---|---|---|
| 10 s (4 scenes × 3 s) | $0.82 | $2.69 | $2.77 |
| 30 s (9 × 4 s / 8 × 5 s) | $2.47 | $8.96 | $5.54 |
| 60 s (12 × 6 s / 12 × 10 s) | $4.94 | $16.13 | $16.63 |

Notes: longer ads waste engine time (a 60 s Runway film renders 120 s of
clips, trimmed down) — that is the existing scene-planner's trade, not new.
With 1 photo, 10 s is a single 10 s clip. 30 s with 3 photos is 3 × 12 s.
Draft render (480p, capped at 10 s) costs roughly a third of the full render
(Wan 3.0 480p is $0.025/s vs $0.0686/s at 1080p).

## Engines — same catalog, no move presets

- Engine picker reads `studioEngines` (unavailable engines hidden, same as
  the Engines page). No `PHOTO_MOVE_*` / movement choice is offered: the
  prompt tells the engine to choose the camera language.
- `buildEngineInput` takes one image per scene. Actor photos are used two
  ways: an actor photo can BE a scene's start image, and the prompt carries
  the actor identity block. Multi-image reference input is NOT in
  `buildEngineInput` today — a future step, not this build.
- Square (1:1): `aspectRatio` gains `"1:1"` in `engine-providers.ts`
  (additive; existing 16:9 / 9:16 callers unchanged). Engines that take 1:1
  (Kling, Wan, Hailuo, Runway, H3 Lite, Luma) get it; Veo 3.1 / Gemini Omni
  (16:9 + 9:16 only) get 16:9 and the composer center-crops to square.
  `outputSize` and the composer edit gain the square dimensions.
  The composer already scales + crops every clip to the film size, so square
  works for every engine at the edit step.

## Subtitles + ElevenLabs — how they fit the pipeline

- Subtitles: NOTHING in the repo burns subtitles today. New: the ad stores
  subtitle lines (start/end/text, from the voiceover script or typed in);
  `EditSpec` gains `subtitles { lines, position: bottom|top, size: small|medium|large }`;
  `composer/server.mjs` writes an `.ass` file and adds the ffmpeg `subtitles`
  filter (libass; the container image already ships `fonts-liberation2` /
  `fonts-dejavu-core`, so Liberation Sans is available). Position = ASS
  alignment (bottom-center 2, top-center 8); size scales with output height.
  Composer files ship with the Worker deploy (`scripts/build-verified.sh`
  copies `composer/*` into `dist/server/composer`), so no separate redeploy.
- ElevenLabs music: ALREADY wired. `composer/server.mjs` calls ElevenLabs
  Music (`/v1/music`, `ELEVENLABS_API_KEY`) with a Stable Audio 2.5 backup;
  `app/music-catalog.ts` holds the templates. Ads get their own moods in
  `app/ads-music-catalog.ts` (bold, cinematic, upbeat, minimal, luxe, warm —
  instrumental prompts written for commercials, never cheesy). The manifest's
  `edit.music.prompt` carries the mood; the composer makes one track per film.
- ElevenLabs sound is OPTIONAL, one toggle for all of it, default OFF.
  The Create form's Sound panel has an "ElevenLabs sound" checkbox; off,
  the music mood, voiceover script and voice stay saved but disabled, so
  turning it back on restores them. Off means the film keeps the sound
  the video engine already made: `startAd` puts NO `music` key in
  `manifest.edit` and never calls ElevenLabs at all — not even for a
  stored voiceover script — so a missing key cannot fail the generate
  (no 503). On means exactly today's behavior: music from the chosen
  mood (or the format default) plus a voiceover synthesized first, so a
  missing key fails before any generation money is spent. The estimate
  line only mentions ElevenLabs billing when the toggle is on. Subtitles
  are unaffected by the toggle: typed lines are used as-is, and a stored
  script still feeds subtitle timing when off. Stored on `ad_projects`
  as `elevenlabs_on` (0/1, default 0; `drizzle/0012_…`).
- ElevenLabs voiceover (TTS): NEW — no TTS code exists in the repo today.
  New `app/api/_lib/elevenlabs.ts`: `listVoices()` (GET `/v1/voices`) and
  `synthesizeVoiceover()` (POST `/v1/text-to-speech/{voice_id}`,
  `eleven_multilingual_v2`, mp3). The key is read from `ELEVENLABS_API_KEY`
  exactly like the music-check route does; when absent the voices route and
  the generate step fail honestly (503, "The ElevenLabs key is not added
  yet") — same pattern as the password-reset routes. The MP3 is stored at
  `render-jobs/<jobId>/voiceover.mp3`; the composer mixes it over the music
  (music ducked to 0.35 under the voice, one mixed audio stream out).
- Single-clip ads (e.g. 10 s from 1 photo) normally skip the composer edit
  and are saved straight from the engine — which would drop music, subtitles
  and voiceover. Ads set a `manifest.ads` flag that forces the composer path
  for every ad film (`render-jobs.ts`: assemble branch, `startComposerEdit`
  single-clip guard, music line, `keepAudio` spread).
- The film-review reality check is NOT run for ads: it compares stills to the
  source photo and flags anything added/removed/changed — exactly what a
  creative ad is allowed to do. `collectComposedFilm` skips `judgeFilm` when
  `row.kind === "ad-series"`; the composer's mechanical QC still runs and is
  visible on the Production page. No `stills: true` is requested for ad edits.

## The cost question — two upload places vs one

No extra cost. Both areas store in the same R2 bucket (`site-creator-r2`,
same mechanism as the customer asset upload: `BUCKET.put` + a D1 row).
Storage is per byte, not per folder: a second area costs $0 extra — the bytes
are the same bytes either way. R2 storage is $0.015/GB-month with zero egress;
a typical 2 MB photo costs ~$0.00003/month to keep. The real money is
generation (table above: roughly $1–$17 per ad at 1080p, by engine and
length) and ElevenLabs usage (metered in ElevenLabs credits; the repo does
not itemise a per-track price — check the ElevenLabs dashboard). The actors
library also costs nothing extra: it is the same photos stored once and
referenced by many ads, which SAVES re-uploads.

## Recommendations included in the build

- 1:1 square preset (in addition to 9:16 + 16:9).
- Hook field (the opening 2 seconds), placed first in the form and first in
  the prompt.
- Cheap draft render (480p, max 10 s) before the full render.
- Per-scene prompt fields for 30 s / 60 s ads.
- Actor angle guidance in the UI (front / side / three-quarter / silhouette)
  so face consistency holds across scenes.

## Files

New: `drizzle/0011_studio_ads.sql`, `db/schema.ts` (+5 tables),
`app/ads-creative.ts`, `app/ads-music-catalog.ts`,
`app/api/_lib/ads-production.ts`, `app/api/_lib/elevenlabs.ts`,
`app/api/admin/studio-ads/route.ts`,
`app/api/admin/studio-ads/[id]/route.ts`,
`app/api/admin/studio-ads/[id]/assets/route.ts`,
`app/api/admin/studio-ads/[id]/generate/route.ts`,
`app/api/admin/studio-ads/actors/route.ts`,
`app/api/admin/studio-ads/actors/[id]/route.ts`,
`app/api/admin/studio-ads/actors/[id]/photos/route.ts`,
`app/api/admin/studio-ads/voices/route.ts`,
`app/admin/studio-ads/page.tsx`,
`tests/studio-ads/ads.test.mjs`, `tests/composer/ads-edit.test.mjs`,
`package.json` (`test:ads` script).
Changed (minimal, additive only): `app/admin/manager-shell.tsx` (1 nav line),
`app/api/_lib/scene-queue.ts` (`QUEUE_KINDS` + `"ad-series"`),
`app/api/_lib/render-jobs.ts` (`CROSSFADE_KINDS` + `"ad-series"`, `outputSize`
square, `startComposerEdit` ad gates, `collectComposedFilm` review skip),
`app/api/_lib/composer.ts` (`EditSpec` subtitles + voiceover),
`app/api/_lib/production.ts` (`ProductionManifest.ads` + `edit.subtitles` /
`edit.voiceover` + `voiceoverKey`),
`composer/server.mjs` (subtitle .ass burn-in, voiceover mix, validation),
`app/engine-providers.ts` (`aspectRatio` `"1:1"`).

## Needs Reda (before the first voiceover / music check)

- ElevenLabs API key: he adds it himself as a Worker secret
  (`ELEVENLABS_API_KEY`) — the composer container receives it from the
  Worker's secrets, so music + voiceover both start working from a fresh
  edit once it is set. Whether the key is already set is unverified from
  here (Worker secrets are not readable); the ads page shows the key status
  from `/api/admin/production` and voiceover fails honestly until it is set.
- Confirm the 1:1 square preset and the recommendations (hook field, draft
  render, per-scene prompts, actor angles) — all inside the new tab only.
- Migration `0011` must be run in the D1 console before first use (like 0010).

## Verification (Nov 7, on branch feature/studio-ads)

- `npm run test:ads` (new): 28 unit checks + 14 composer checks, ALL PASS.
  Unit: theme has no real-estate words; hook on scene 0 only; per-scene
  prompts; aspect mapping incl. the Veo/Gemini 16:9 fallback; adPlan
  10s = 4x3s, 60s = 12x6s, draft = 480p + max 10s; costs Wan 3.0 10s
  $1.06, Kling 3.0 60s $16.13; subtitle split timing; .ass alignment /
  size scaling; 6 music moods, all instrumental, none real-estate;
  ElevenLabs stubbed TTS returns bytes with the key sent, and fails with
  ElevenLabsMissingKey before any call without a key. Composer (real
  ffmpeg): subtitle burn-in changes pixels at subtitle time and matches
  away from subtitles; voiceover 880 Hz present at -24 dB, music 220 Hz
  under it, scene tone gone (-62 dB); bad subtitle/voiceover specs refused
  with 400.
- `npm run test:queue`: 84/85 — the 1 failure is pre-existing 21a,
  identical on pristine main (proven Nov 6).
- `npm run test:composer`: exit 0 (composer 54 + QC 11, same as baseline).
- `npm test` (build + rendered-html): build PASSES. Rendered-html is
  2 pass / 6 fail — identical to pristine main 4d04060, verified by
  running the same test on a fresh main clone. The 6 are pre-existing
  stale string expectations (cloudflare: import scheme, Scene timing,
  Wan 2.2 Fast, "You can close this page", "What is happening",
  /admin#orders). One extra failure appeared during the build and was
  fixed, not chased: the crossfade test pinned
  `CROSSFADE_KINDS = ["customer-series", "studio-series"]`; the ad kind
  is a deliberate third member, so the expectation in
  tests/rendered-html.test.mjs now lists all three. Two build bugs were
  also caught and fixed by the build itself: three actors routes imported
  `_lib/account` one `..` too shallow, and ads-production.ts imported
  CROSSFADE_SECONDS from production.ts instead of engine-catalog.ts.
- Lint on all new/changed files: clean after one fix (set-state-in-effect
  in the page, fixed with the dashboard's Promise.resolve().then idiom).
  The only remaining lint error in the touched set is the pre-existing
  render-jobs.ts line 669 non-null-asserted optional chain.
- `npm audit --omit=dev`: cannot run in this VM (registry 403
  policy_denied) — environment limitation, not a code failure.

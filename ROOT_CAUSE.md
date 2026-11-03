# Production failures — root cause and fix

_November 3, 2026 · MotionWren Studio and client orders_

## The failure

> Scene 2 could not be started: Request was throttled. Your rate limit for creating predictions is reduced to 6 requests per minute with a burst of 1 requests while you have less than $5.0 in credit. Your rate limit resets in ~8s.

## Root cause

1. **The Replicate account is under $5 of credit**, so Replicate limits it to **one new prediction about every 10 seconds** (6/min, burst 1).
2. **Production sent every scene at once.** `startProductionScenes` (in `app/api/_lib/production.ts`, the version deployed at commit `305e771`) created scene 1, scene 2, scene 3… back to back in a single request. Scene 1 was accepted; scene 2 arrived inside the same 10-second window and got **HTTP 429**.
3. **A 429 was treated as a permanent failure.** `startScene` retried once after 1.5 s, which is still inside the window, so it got a second 429. `startProductionScenes` then **cancelled every scene already started** (including the accepted scene 1) and threw. The route marked the whole film **failed**.
4. **Nothing rescheduled it.** There was no stored "try again at" time, no provider-wide wait, and no queue. The only option was to start over, which hit the same limit again.

5. **Second cause, found live (Nov 3, afternoon): joining was refused every time.** The crossfade join (`nicolascoutureau/video-utils`, pinned version `700f4b0e`) publishes a schema whose required inputs are `task` **and** `input_file`, even for `composeVideosSeamlessly`, which reads its clips from `urls_csv`. We never sent `input_file`, so every join came back `- input: input_file is required`. History held only single clips; no joined film had ever been saved. Fix: send the first scene as `input_file` (commit `156050d`). The queue test's simulated engine now enforces that schema and reproduces the failure without the fix.
6. **Film length ran long.** Planning assumed scenes overlap by 1 s at each crossfade. The real joiner plays every scene in full and adds a short dissolve (~0.25 s per join), so a "15-second" film came out 18.6 s and a 60-second one would be ~75 s. Planning now assumes no overlap (15 s → 3 × 5 s ≈ 15.5 s).

Earlier versions failed the same way for the same reason. The browser-driven Studio started scenes two at a time, and the server-side series path started all of them together.

**Where requests were made:** before the fix, scenes were created on the server, inside the request that started the video. That was the Studio route `app/api/studio/production/[id]/route.ts` (plus the old inline path in `app/api/studio/production/route.ts`), and the client route `app/api/projects/[id]/generate/route.ts`. Retries came from `advanceRenderJob` in `app/api/_lib/render-jobs.ts`, which ran on callbacks and page checks. All of these could fire at the same moment, with no shared limit.

## What changed

| File | Change |
|---|---|
| `app/api/_lib/provider.ts` (new) | Provider layer. It classifies errors as **throttled** (429, honouring `Retry-After` / "resets in ~8s"), **credit** (402), **transient** (network/5xx) or **rejected** (other 4xx). It also holds shared provider state (wait-until, pause, last error), configurable concurrency (`provider_max_active` setting or `REPLICATE_MAX_ACTIVE`, default **1**), short self-expiring leases, and backoff with jitter. |
| `app/api/_lib/scene-queue.ts` (new) | **The scene queue.** Each step: checks the scenes the engine is working on → keeps copies of finished scenes → stops only when a scene has used its 3 tries → joins when all are ready → otherwise sends the next scenes **in order**, only up to the concurrency limit across **all** videos, and never while the provider has asked to wait. A per-job lease plus a "being sent" mark saved before each engine call means a double click, two callbacks or the heartbeat can't create duplicate engine jobs. Manager actions: resume, retry a scene, regenerate a scene, re-join. |
| `app/api/_lib/production.ts` | The manifest (in R2) records per scene: settings snapshot, photo, state, tries, next allowed time, why it is waiting, last provider message, finished output and our stored copy. The old send-everything-at-once start was removed. |
| `app/api/_lib/render-jobs.ts` | The job engine runs every scene video through the queue. Joining scenes is also throttle-aware (it waits, never fails, on a 429) and retried twice. Re-made films are saved as new History versions. Adds start-over (a clean new run with the same photos and settings), scene detail for progress views, and a provider status note. |
| `app/api/_lib/customer-errors.ts` | Clients only ever see plain wording, never provider text, URLs or credit details. |
| Studio routes (`app/api/studio/production/*`), client route (`app/api/projects/[id]/generate`) | Starting a video only puts it in the queue (create → send photos → start), so nothing is sent to the engine in bulk. |
| `app/api/admin/production/*`, `app/admin/production/page.tsx` (new) | Manager **Production** page: provider health (status, engine, scenes with the engine vs. limit, scenes in line, last provider message, low-credit warning), a "scenes at once" setting, every video scene by scene (state, tries, next try, engine job ID, last message), and the actions **Resume**, **Retry now**, **Regenerate**, **Re-join scenes**, **Start over**. |
| `app/api/heartbeat` + `worker/index.ts` + `vite.config.ts` | A once-a-minute Cloudflare cron moves every video along (scheduled retries, missed callbacks, after redeploys/restarts), and removes a finished video's working files after 30 days. |
| `app/studio/*`, `app/dashboard/*` | Plain scene states (In line, Sending, Making, Engine busy · 8s, Try 2 soon, Paused, Ready, Failed). The view never says "Stopped" while a retry is scheduled. Studio adds Resume and Start over. |

## How production behaves now

1. Photos are uploaded and the video is created as **in line** (nothing sent to the engine yet).
2. The queue sends **scene 1**. Scene 2 is sent only when there is room (default: after scene 1 finishes). With credit topped up, the "scenes at once" setting can be raised.
3. If the engine says **slow down**, that scene waits as long as the engine says (minimum 10 s) and every other video waits with it. That's not a failure, and finished scenes are never redone.
4. If the engine **fails a scene**, only that scene is tried again, up to 3 tries, with the photo handed over a different way each time (engine file storage → private link → inline).
5. If the engine account is **out of credit**, production **pauses** (videos stay in line), the manager is alerted, and it continues by itself once credit is added.
6. When every scene is ready, they are **joined with short dissolves** and the film is saved to History (Studio) or delivered to the client's order. The client is notified.
7. A video stops only when a scene has used all 3 tries (or after 6 hours). Finished scenes are kept. The manager can **Resume**, **Retry** that scene or **Start over**, all through the same queue. A client's credit is restored once.
8. Refreshes, closed pages, redeploys and worker restarts don't matter. State lives in D1 and R2, and the minute heartbeat carries every video forward.

## Proof

- `npm run test:queue` (`tests/scene-queue/scene-queue.test.mjs`): **39/39 passing**. The real production code runs against SQLite (project migrations) and a simulated Replicate that enforces the exact limit above on a simulated clock. Covered: a 4-scene film with burst limit 1 (sent strictly one at a time, zero throttles); a 429 on scene 2 → automatic wait → done, one engine job per scene; refresh/worker restart with a retry scheduled, finished by the heartbeat alone; duplicate Generate/Resume clicks; one scene failing permanently while finished scenes are kept, then **Retry** that scene; client credit restored exactly once; out of credit → pause → continue; a throttled join; an 80-minute film joined from our stored copies; regenerate one scene → new History version; videos already in flight from the previous version; Start over; the photo hand-off order.
- Local end-to-end on the dev server, with a stand-in engine that enforces the same limit and sends real callbacks and MP4s: **16/16 passing**. A client order and a Studio film ran at the same time. The Studio film was created through the real Studio screen, with a refresh midway. 7 scenes went out one at a time, each made once, and one throttled join was absorbed. Both films were joined, saved to History and downloaded as real MP4s, and the client dashboard showed the video ready.

- **Live, real engine (Nov 3, 21:04–21:13 UTC):** one 15-second Studio film (Wan 3.0, 1080p, 3 photos, engine estimate $1.80) made through the real Studio screen on motionwren.com. Scenes went to the engine one at a time, each made once, with zero throttles; every scene copy was kept. The page was refreshed once and then closed: scene 2, scene 3, the join and the save all happened with no page open. Total 8 min 37 s from click to History. The file downloads as a real MP4 (1920×1080, 18.6 s, 31 MB). That length is what led to point 6 above.

## Not done in this change / needs a decision

- **Replicate credit.** Under $5 the account allows one new request every ~10 s, so scenes are made one at a time: a 30-second film (7 scenes) takes about 7 × the engine time. Adding credit lifts the limit; then raise **Scenes at once** on the Production page.
- **Payments** (Stripe) are not connected; when they are, orders are reserved when submitted and restored once on final failure (already wired).
- **Email** (Resend) is not connected; clients see in-app notifications.
- A manager **Resume** of a client order that already had its credit restored delivers that video as goodwill (no second charge).

## One music track per film: our own editor (Nov 3, evening)

**Why the music changed every scene:** Wan 3.0 always generates its own sound for each scene (its Replicate schema has no switch to turn it off), and the outside joiner kept each scene's sound.

**Fix: the composer**, our own ffmpeg editing step (`composer/server.mjs`), running in a Cloudflare Container next to the site (`worker/composer.ts`, bound as `COMPOSER`; one instance per film, up to 20 at once). For every multi-scene film it:
1. trims each scene to its share of the film and joins them with true 0.5 s crossfades, so the film lands on the exact ordered length;
2. drops every scene's own sound;
3. lays **one** music track over the whole film (fade in, fade out, even loudness). The music is made once per film by **ElevenLabs Music** (instrumental, matched to the film: elegant for listing films, luxury for long or cinematic films, modern for vertical reels). If ElevenLabs is unavailable, **Stable Audio 2.5** on Replicate makes it instead. The track is stored with the film, so a re-edit (re-made scene, re-join) keeps the same music;
4. checks the result (length, size, one sound track) before it is saved to History.

If the editing service can't take a film three times, the film still finishes with the old joiner, and the manager gets an alert and can use "Re-join scenes" later. The Production page shows **Editing** and **Music** status.

**Scene timing is automatic:** quicker cuts for short videos, calmer shots for long films (10 s → 4 photos, 15 s → 6, 20 s → 6, 30 s → 9, 60 s → 12, when there are enough photos). Each scene is made at the shortest engine length that covers its share.

**Proof (local, real ffmpeg):**
- `npm run test:composer`: **26/26**. The scenes' own sound is gone (−59 dB) and the music is there (−19 dB). The middle of each join is a true blend of both scenes. Lengths are exact. Also covered: ElevenLabs down → backup music; a refused key is not retried; a re-edit reuses the music; a missing scene; a short scene; a vertical film; a single scene.
- `npm run test:queue`: **54/54**, adding the composer path, a failed edit retried, the editing service down (backup joiner + manager alert), a lost edit redone and saved once, and **25 films from 25 accounts at once**: with one engine slot every scene was made exactly once and every film finished from the heartbeat alone; with 6 slots they all finished in 19 simulated minutes, never over the limit.
- Local end-to-end with the real composer: a client 20 s vertical reel and a Studio 15 s film came out at exactly 20.00 s (1080×1920) and 15.00 s (1920×1080), each with one music track and no scene sound.

**To turn on in production:** the Cloudflare account must be on **Workers Paid** ($5/month; containers need it). Add the Worker secret **`ELEVENLABS_API_KEY`**. Until it is added, the backup music (Stable Audio, ~$0.20 per film) is used.

# Protected features — never remove, hide or gate these

Reda's standing rule: when editing one thing, change ONLY what was agreed. Never remove, hide,
move behind a condition, or rewrite anything that already works and was not part of the request.
If a request seems to conflict with an existing feature, keep the feature and ask.

Before every commit that touches `app/studio/page.tsx`, `app/studio/final-edit.tsx`,
`app/studio/edit-film.tsx`, or `app/admin/**`, run `npm run test:protected`. It fails if a
protected section below is missing. If you must change one on purpose, Reda has to approve it first.

## Studio (multi-shot film builder)
- Choice between "One prompt per scene" and "One prompt, multiple images"
- Photo upload / scene builder ("Build your scenes" / "Add your shot images") — first
- Shot type, scene timing
- "Finish your film": listing cards (house + realtor info, logo, preview), music, voiceover, sound effects — ALWAYS visible, never hidden until a photo is added
- Production settings (engine, quality, aspect, speed, continuity)
- "Make the film" (length, cost, generate, final video, download)
- History: Edit button and the Edit window (scenes & movement, cards, sound)
- Baked prompts (never touched): customer-production.ts STATIC_LOCK/MOVEMENTS; studio/page.tsx realEstateBasePrompt / realEstateMovements / realEstatePrompt / multiShotStabilityLock

## Admin
- Library Studio: video templates + MotionWren templates + music library
- Studio Ads: upload, templates, scenes, actors, sound, subtitles
- WrenCut (/admin/wrencut): reference upload/link → template "MotionWren N" (no reference info kept), History/photo preview, show-in-Studio switch, effect chips on every template thumbnail, "Update from a reference" (re-read a template)

- Edit film panel (Studio History → Edit): Scenes and movement, Listing cards, Sound, and "Your clips" (each saved clip viewable, "Edit again with a template" with the choice of which clips to use, no engine cost).

- Cinematic titles (Studio "Finish your film" → Titles, and Edit film → Titles): five fonts, words typed at the start and/or the end; drawn by the composer (composer/titles.mjs, composer/fonts); never read from a reference video.

- Saved clips (Studio, owner only): pick clips from History to make a new film with no engine charge; routes /api/studio/clips and /api/studio/production/from-clips are admin-only. History cards tag template films ("Template · name") and "Saved clips".

- Frame size (Studio): 16:9, 9:16, 2.39 crop-safe and "Original · Photo shape" (the film is made at the photos' own shape, only on engines that keep it: Kling 3, Wan 3/2.7/2.5, Hailuo 2.3, H3, H3 Lite). Edit film → Frame cuts a finished film to 16:9 or vertical with no engine charge (the floor stays; composer `anchorY`).

- Verified photo upload (Studio): each photo is sent with its SHA-256, the server reads it back and replies with size + fingerprint, the start request is checked against what is stored (missing photos are re-sent), and the page says "All N photos arrived and were checked" only after that. Photos stay on the device (IndexedDB, `app/studio/pending-upload.ts`) until confirmed, with a "Send again" banner. Never show "received" without the server's receipt.

- Social media templates (Library Studio → "Social media" section; Studio template picker → "Social media"): thirteen beat-aligned templates (app/social-templates.ts) installed as ordinary templates; each shows what photos it needs in Studio and, once photos are added, a photo check (count, order, story, movement, quality — app/social-check.ts, /api/studio/social-check, owner-only) with "Arrange my photos this way"; production matches the photos to the template's shots (the recipe names each shot's photo) and keeps the template's own canvas. Existing templates are unchanged (they still get the smooth film).

- Quality loop (owner only): a flagged scene is re-made with a fix note that names the problem and the film is re-checked after each re-make — at most three attempts (`MAX_FIX_ROUNDS = 2` re-makes). History cards show the result (red "Needs attention · not fixed after N attempts" with a red outline, green "Approved" or "Fixed on attempt N · ready to deliver"); Quality → each flagged scene has "Full screen". When problems remain after the last attempt an alert notification "Quality problem not fixed · MW-xxxx" is sent; a fixed film sends "Film fixed, ready to deliver". The status comes from the film's manifest (`qualityState`), never from the browser.

- Scene-by-scene Quality (History → Quality, owner only): every scene is listed (not only flagged ones) with the number of frames the check looked at (three per scene), its attempts with the exact instruction written for each re-make (`fix.sent`, written by `app/fix-notes.ts`), full-screen playback of each attempt, and a "Fix this scene" button (price in dollars) that writes a complete instruction from the scene's recorded problems plus the camera-only rules, makes only that scene again on Wan 3.0, and saves the result as a new History version. Route: POST /api/studio/production/[id] {action:"fix-scene"} (admin only).

- Compact pickers (Studio): templates are one scrolling row with "Listing films" / "Social media" tabs; saved clips are one scrolling row per film (four films, then "Show more"), with a sticky "Make a film from these" bar. Once two or more saved clips are chosen, the main "Make film" button makes the film from them (no photos needed) and a hint says what is missing when it is grey.

- Engine reliability (Studio, owner only): a scene the engine has not started is cancelled and sent again after 6 minutes, one it is running after 4 min + 1 min per second of video (5 s: 9 min, never over 18); an engine that stalls twice on a scene stops it instead of a third wait; each stall raises a "Video engine slow" alert; the progress card shows minutes with the engine, what the engine says, and a "Send again now" button (action `restart-scene`); Stop cancels the engine job and confirms it really stopped (`cancelAndConfirm`); /api/predictions/[id] (owner) reports the engine's model, queue time and log tail.

- Make versions (Studio History → Edit film → "Make versions", owner only): tick several templates and each becomes its own new film cut from the film's saved scenes (`app/studio/variants.tsx` → /api/studio/production/from-clips, one call per template). No engine generation; a social template's canvas (9:16 or 16:9) is applied by a cut (`edit.reframe`), never a stretch.
- Requirements first (template guidance): the bold "Requirements: N photos for the best result (at least L)" line at the top of a chosen template (`template-strip.tsx`, `tpl-need`), Make film disabled below the minimum, and per-template "Needs N scenes" in Make versions (`variants.tsx`, scenes below the minimum cannot be ticked).
- Upscale is the last touch: versions from Make versions are made at the engine's own resolution (`upscale: false` in from-clips, no upscale cost). History shows "Approved? Upscale to 1080p · about $X" (`upscaleCents`, action `upscale-final` → `upscaleFinal` in render-jobs.ts), which makes a new 1080p version and keeps the approved one.
- Template shots keep their exact length (`composer/wrencut.mjs`: slow-motion look-ahead in `rampHead`, shots slowed to fit a short clip, hard length guard in `shotArgs`; `tests/shot-length.test.mjs`). A short shot made template films freeze while the music played on.
- The editor refuses a film whose picture is shorter than its music (`composer/server.mjs`, "The picture came out"); every finished film reports `build` and `videoDuration`.
- Spending guard (Admin → Finance, top of the page, `app/spend-guard.ts`, `app/api/_lib/spend-guard.ts`, `/api/admin/spend-guard`, `spend-guard-panel.tsx`): monthly and daily dollar limits, a per-film "ask me first" amount, alerts at 50/80/100%, a one-tap "Pause all spending", and an automatic stop at 100% that holds (never fails) unsent scenes, new films, re-makes, upscales and the paid AI quality check. Every engine charge passes `createPrediction`, which asks the guard last (`ProviderError` kind `budget`). Studio asks "This film costs about $X. Make it?" above the per-film amount (`confirmSpend`). Scenes already with the engine finish. The guard never takes the site down: if it cannot read its numbers it lets work continue.
- Frame sizes in Edit film (`app/studio/edit-film.tsx`): the Frame section offers the film's original size plus 16:9, 9:16, 1:1 and 4:5 as tiles, several can be ticked at once and each becomes its own new History version (one edit per size, in order), the film's current size is shown as "This film now" and nothing in it looks greyed out, and the price (about 2¢ per size, no scenes made again) is shown in the section and in the footer. "Original size" goes back to the frame the film was made at. The Edit sheet keeps its warm beige look (scoped `.fin-sheet` variables in globals.css).

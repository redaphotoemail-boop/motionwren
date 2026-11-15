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

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
- WrenCut (/admin/wrencut): reference upload/link → template "MotionWren N" (no reference info kept), History/photo preview, show-in-Studio switch

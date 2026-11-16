# MotionWren Template Recipe Spec v1

**Status:** implemented (composer track) — Nov 15, 2026; house-calling-v1 rebuilt Nov 16, 2026 (14.5s, 8 scenes, no flash, ramps on the walk-through) on branch `feature/house-calling-v2`, unmerged.
**Source:** the v1 spec agreed Nov 15, 2026 (`~/workspace/goals/motionwren-real-estate-video-platform/files/template-recipe-spec-v1.md` — the contract; this file is its port into the repo).
**Purpose:** one frozen, versioned format that describes a template exactly, so the SAME template can be executed by Shotstack and by the owned FFmpeg composer, and so a built template can be verified against it instead of judged by eye.

**Why this exists:** the old flow had three breaks. (1) No fixed format — a reel went to Claude, Claude invented fields nothing understood. (2) No executor — the composer only knew trim/crossfade/music, not whip pans, kinetic type, speed ramps or grade. (3) No test render before going live. The recipe fixes all three: the recipe is the format, the renderer is the executor, the verification task is the test.

**Hard rules**
- No template selected = current behavior exactly. Nothing about the existing composer path changes when no recipe is given.
- Templates are MotionWren originals. Styles may be studied from references; no bought template, no Shorty/Envato asset, no copied footage, no copied font file, no copied music is ever offered as a template. Music is licensed stock only.
- Same recipe + same inputs = same output every time. A recipe is frozen as v1.0 in git with its golden renders.
- No merge to main without Reda's approval. Build on a branch from the latest main.
- **STANDING RULE — no white flash, ever.** No template may contain a white-flash scene or a `white_flash` transition. `white_flash` is not an allowed transition (see §1) and the executor refuses any recipe that uses it. Added Nov 16, 2026 — Reda does not like it at all, in any template.
- **STANDING RULE — no whoosh sound, ever.** No template may add a whoosh sound effect (a `whoosh` or `flash` SFX accent on a cut). Template audio is music only. The composer never emits cut accents, the social-template builder adds no SFX, and stored wren recipes are stripped of whoosh/flash accents when parsed. Added Nov 16, 2026 — Reda does not like it at all, in any template.

## 1. The recipe format (JSON)

The canonical example is the first template, `composer/templates/house-calling-v1.json` (14.5s, 9:16, "This House Is Calling"). Its shape:

```json
{
  "recipe_version": "1.0",
  "template_id": "house-calling-v1",
  "name": "This House Is Calling",
  "aspect": "9:16",
  "resolution": "1080x1920",
  "fps": 30,
  "duration_s": 14.5,
  "inputs": [
    {"slot": "exterior_day", "type": "image_or_video", "required": true}
  ],
  "scenes": [
    {
      "id": "S1",
      "start_s": 0.0, "duration_s": 5.0,
      "input": "exterior_day",
      "camera": {"move": "push_in", "amount": 1.08, "speed": "constant"},
      "captions": [
        {"text": "THIS HOUSE", "style": "bold_white_caps", "start_s": 0.0, "end_s": 2.6, "fade_out_s": [2.3, 2.7]}
      ],
      "overlay": {"type": "call_banner", "title": "The Perfect House", "subtitle": "Mobile",
        "slide_in_s": [0.5, 1.0], "visible_s": [1.0, 2.0], "slide_out_s": [2.0, 2.5]},
      "grade": "bright_warm_day",
      "transition_in": "open"
    },
    {"id": "S2", "start_s": 5.0, "duration_s": 0.8, "input": "exterior_night",
     "camera": {"move": "push_in", "speed": "constant", "amount": 1.05}, "grade": "night_warm_windows",
     "transition_in": "hard_cut"},
    {"id": "S4", "start_s": 6.9, "duration_s": 3.1, "input": "exterior_night",
     "camera": {"move": "push_in", "speed": "constant", "amount": 1.06}, "grade": "night_warm_windows",
     "transition_in": "hard_cut"},
    {"id": "S8", "start_s": 13.6, "duration_s": 0.9, "input": "living",
     "camera": {"move": "whip_in_then_push_in", "speed": "constant"}, "grade": "warm_evening_interior",
     "transition_in": "whip_blur"}
  ],
  "text_styles": {
    "bold_white_caps": {"font": "bold sans-serif, all caps, white, centred", "size": "large"}
  },
  "grades": {
    "bright_warm_day": {"note": "bright day, warm sun, saturated blue sky"}
  },
  "music": {
    "track": "licensed stock, 120 BPM, cinematic pop",
    "beat_map_s": [6.0, 12.0, 14.0],
    "cut_points_s": [5.0, 6.0, 7.0, 10.0, 12.0, 12.5, 13.5],
    "ducking": true
  },
  "speed_ramps": [
    {"scene": "S4", "note": "slow as the camera comes in, accelerating toward the front door",
     "points": [[0, 0.5], [0.3, 0.7], [0.55, 1.0], [0.8, 1.9], [1, 2.5]]},
    {"scene": "S5", "note": "whip in through the doorway with motion blur, settle slow, accelerate out",
     "points": [[0, 2.5], [0.2, 1.0], [0.45, 0.4], [0.7, 0.9], [1, 2.5]]}
  ]
}
```

Notes on the fields:
- `camera.move` values are a closed list: `push_in`, `glide_lateral`, `glide`, `tilt_down_glide`, `whip_in_then_push_in`, `static`. A renderer that cannot do a move must fail loudly, never silently substitute a different move.
- `transition_in` values are a closed list: `open`, `hard_cut`, `whip_blur`, `crossfade`. `white_flash` was removed from this list Nov 16, 2026 (standing rule — no white flash in any template, ever). Same rule as moves: unsupported = fail, never substitute.
- `speed_ramps` are part of the format from v1. The ramp entry is a curve: `{"scene": ..., "points": [[t, speed], ...]}` with bezier easing. The composer must implement it (see §2); Shotstack documents bezier-eased speed ramps natively. First exercised in `tour-flow-v1` (v1.1); house-calling-v1 gained ramps on its walk-through scenes (S4–S8) Nov 16, 2026: slow coming in, whip fast through the doorway with motion blur, slow and settle inside.
- `night_slots` (v1.2, a job-time choice, not part of the frozen template): a list of scene ids or input slot names, e.g. `["exterior"]`. Each named scene is rendered with the night grade (`night_warm_windows`) instead of its own grade. It is a grade only — the same photo, the same move, the same timing; the house does not change at all, only the light and colour. No AI re-render: an AI re-render redraws the house and can drift, which is exactly what this must not do. The night grade is a composer built-in, so it does not need to be in the recipe's `grades` map. Each entry must name a real scene or input slot. Offered in Studio when creating, e.g. when a template's night slot is empty ("no night photo? generate one from your day photo").
- Music is licensed stock only, chosen separately, never baked into the recipe as a copyrighted track. Template audio is music only — never a whoosh sound effect (standing rule).
- Scenes must tile exactly: each scene starts where the previous one ends, and the scenes run to `duration_s` (less the overlap of any true dissolve — see §2).
- A caption's on-screen window ends at `fade_out_s[1]` when a fade is given (so the fade completes instead of cutting off mid-fade), otherwise at `end_s`.

## 2. Composer execution mapping (owned route)

Implemented in `composer/template-recipe.mjs`. The composer job carries the recipe as `spec.templateRecipe`, with `spec.clips` in the recipe's `inputs` order (one clip per slot). When no recipe is given, the composer does exactly what it does today.

| Recipe field | FFmpeg implementation |
|---|---|
| Scene trim + join | Each scene rendered on its own to its exact length, then joined |
| `push_in` | `zoompan`, at double size so the zoom stays smooth to the pixel |
| `glide` / `glide_lateral` / `tilt_down_glide` | Animated `crop` over a slightly enlarged picture (the WrenCut pattern) |
| `whip_in_then_push_in` | Fast zoom out of the whip (first 0.25s), then the slow push-in |
| `hard_cut` | Concatenation at the exact frame |
| `whip_blur` | A blurred boundary effect: 0.15s of each side, fast scale + `tmix` trail + a spatial blur (tmix alone needs several frames to build up and the edge is only a few frames long); the film's total length is unchanged |
| `crossfade` | A true dissolve: `CROSSFADE_S` (0.5s) of each side crossfaded with `xfade`. It consumes footage, so `duration_s` = scenes' sum less 0.5s per crossfade |
| `captions` | `drawtext` with alpha fade in/out expressions, exact start/end times |
| `call_banner` overlay | Drawn banner PNG (dark card, red decline + green accept dots, title over subtitle), slid in/out with an animated `overlay` y |
| `speed_ramps` | Bezier (smoothstep) easing sampled densely, then the WrenCut slicer (`rampHead`): `setpts` per segment, `tmix` blur where it speeds up, `minterpolate` where it slows down. Move-first (v1.1): the recipe's camera move runs over the source seconds the ramp consumes, then the ramp re-times the moved picture — so a still photo's push-in whips and settles with the ramp instead of gliding at constant speed. Ramp rules (v1.2, Nov 16 — measured on real photos, not assumed): (1) the blur sits AFTER `fps=` — each output frame then smears across the motion the whip actually plays; blending before the retiming only smears across neighbouring source frames, which on a still differ by a fraction of a pixel, so the whip showed no blur at all. (2) Every slice at or below 1.12x gets in-between frames made (`minterpolate`), so no frame is ever duplicated to hold the rate — a duplicated frame reads as stuttering. (3) A ramped scene's move must be big enough that its SLOWEST point still visibly moves: a 0.4x settle on a 1.06 move drifts ~6px/s on a still, which reads as the film freezing (measured: S4 frozen 2.5 of its 3.2s). A ramped glide gets a 1.2 zoom and a ramped push-in at least a 1.15 amount, so the slowest point still drifts ~20px/s. Unramped scenes keep the 1.06 framing. (4) Slice lengths are whole frames (v1.2, Nov 16): `rampHead` spreads the scene's frames over the 8 slices as evenly as possible (first slices get the extra frame) instead of cutting equal (d+0.2)/8 slices. An equal slice is 2.625 frames on a 0.5s scene, and `trim=duration=outLen` then drops the frame that would carry the slice's tail source — every slice loses ~0.04s of source and holds a frame, so the ramp plays ~30% slow on short scenes (measured: S6 played 0.6x instead of ~1.0x; a 3.0s scene is 96 frames, 12 per slice, which is why it never showed). After the fix S6 reads 0.82/0.71/0.99/1.08/1.44 vs window-average 0.95/0.91/1.09/0.98/1.11. |
| `grade` | `eq` + `lut3d` (true LUT — the composer is the only route with this). Grade names map to `composer/luts/*.cube` (generated by `composer/luts/generate-luts.py`) + eq values in `GRADE_TABLE` |
| `night_slots` | Job-time grade override (v1.2): a scene named here (by id or input slot) renders with the night grade (`night_warm_windows`, `eq` + `lut3d`) instead of its own grade. Same photo, same move, same timing — only light and colour change. Never an AI re-render |
| `music` + `ducking` | One master track, `sidechaincompress` ducking under a voiceover, cut to exact length. Beat-synced cuts (v1.3, Nov 16): the recipe's `beat_map_s` / `cut_points_s` are the DECLARED grid, and the render ENFORCES it — the composer measures the actual track's tempo AND phase (`beatGrid` in `wrenaudio.mjs`, fitted to the track's own onsets) and snaps every scene boundary to the nearest beat before rendering (`snapRecipeToBeatGrid`; wren/library recipes snap the same way via `snapWrenToBeatGrid`). When the declared grid and the measured track disagree, the track wins — a cut is never silently off-beat. Generated music is measured the same way (an ElevenLabs track has no guaranteed tempo either). No steady beat in the track (ambient music) = no grid, and the cuts stay on the recipe's grid. The total length never changes; a boundary that would collapse a scene under 0.3s takes the next beat instead, and no boundary moves 0.6s or more. The audit's beat check (every cut vs the finished film's own audio, within 0.06s) is the proof. |
| QC | Duration = recipe duration ±0.1s; resolution/aspect match; audio present and not clipping; no black frames at start/end (`templateQualityCheck`, report-only) |

Executor decisions (where the spec left a choice):
- The whip is a boundary effect, not a dissolve: it does not consume footage and does not shorten the film. A crossfade does consume footage (see above).
- The template join adds no fade in/out, no sharpening, no extra grade — the recipe is the edit.
- Still-image inputs (v1.1): a template input may be a still photo (JPEG/PNG/WebP). The composer loops it into a clip of the length the recipe needs (`prepareTemplateInputs`: at least the scene's own duration, and the ramp's source need when that is longer), so the recipe's camera move is what moves it — a real listing photo is a valid template input.
- Night slots (v1.2): `night_slots` is a job-time choice carried on the recipe object the app sends, not a field the template author writes. The composer validates each entry against the recipe's scenes/slots and applies the night grade in `templateShotArgs`. The verifier's grade check (check 9) reads the effective grade, so a night-slotted scene is checked as night (dark, B>R), not as its declared day grade.
- A clip that runs short for its scene is a loud failure, never a silent stretch — or the same recipe would not give the same output. A ramp that would need more footage than the clip has is a loud failure too (`rampSourceSeconds` vs the clip's remaining length, 0.97 factor matching `rampHead`'s own trigger): the composer never silently scales a ramp down, or the film would quietly lose the whip.
- Planner headroom (v1.2, Nov 16): when a clip is shared by several scenes, the planner spreads the scenes across it by the clip's largest ramp source need (`maxNeed`), not by any one scene's duration — a ramped last occurrence on a shared clip can never be planned otherwise. The spread and the ramp-need check share one headroom constant (`RAMP_HEADROOM = 0.97`); a last occurrence longer than ~1.6s on a max-need clip is unplannable by construction and the planner fails loudly instead of producing a frozen tail.
- Template films render at the recipe's resolution, never upscaled (v1.2, Nov 16): the app never sets an upscale flag for a template film, and the Worker's edit start takes the height from the recipe's resolution when a template recipe is present — a template that declared 1080x1920 must never be edited at 720p, or the composer's size check fails the film.
- Beat-synced cuts (v1.3, Nov 16): the composer fetches the music BEFORE the scenes are rendered (not after), measures its beat grid, and snaps the template's cuts to it — recipe templates via `snapRecipeToBeatGrid`, wren/library via `snapWrenToBeatGrid`. The music fetch moved earlier for exactly this reason; a film whose scenes fail still pays for the music, but the clips are already downloaded by then, so a scene failure after that point is rare — and a film cut off-beat costs more than a wasted track.

## 3. Shotstack mapping (hosted route)

Same recipe → Shotstack JSON: `timeline.tracks`, one clip per scene with `start`/`length`, `transition` per `transition_in`, `html` overlay assets for captions and the call banner, `speed`/`playbackRate` with bezier easing for ramps, LUT is NOT supported (grade = Shotstack color adjustments only — document the difference, never pretend it matches the composer grade). No true sidechain ducking (volume keyframes as the workaround). The Shotstack template JSON is generated from the recipe, not hand-written separately — one recipe, two renderers.

## 4. First template

`house-calling-v1`, 14.5s, 9:16, 8 scenes, structure measured from the reference breakdown (`~/workspace/your_files/shortyedit-13-real-estate-templates/shortyedit-13-shot-by-shot.md`, template #1). Built as a MotionWren original: own fonts, own banner graphic, licensed stock music. Captions only in the first 5 seconds. Day-to-night alternation preserved. No white flash (removed Nov 16, 2026 — standing rule, never in any template). Whip/blur into the final living-room shot. Speed ramps on the walk-through (S4–S8, added Nov 16): slow coming in, whip fast through the doorway with motion blur, slow and settle inside. Cuts on the 120 BPM grid (5.0/6.0/7.0/10.0/12.0/12.5/13.5, beat-synced Nov 16). Takes 7 inputs; a clip may appear in more than one scene (exterior_night is S2 and S4).

Second template (v1.1): `tour-flow-v1`, 15.0s, 9:16 — a real-estate walkthrough, exterior → foyer → living room → kitchen → bedroom, 3.0s per scene, cuts at 3.0/6.0/9.0/12.0 on the 100 BPM grid (beat-synced Nov 16; was 16.0s at 3.2s per scene, which is 5.33 beats and provably off-beat). Every transition between spaces is a speed-ramped move with motion blur (ramp up into the move, blur through it, ramp down and settle; the first scene opens slow and accelerates toward the door, the last settles slow on the bedroom and the film ends slow). Captions are room names only. Grade: bright warm day outside, warm evening interior inside. This is the template that proves smooth room-to-room and exterior-to-interior movement, and the first to exercise speed ramps and still-photo inputs.

## 5. Verification task — run on every template before client use

Run: `composer/verify-template.mjs` (see "Verification command" below).

### 5a. Coherence check (does the built template match the recipe?)
Run with FIXED test inputs (same 7 photos/clips every time), then check each item pass/fail:
1. Scene count and each scene's start/duration within ±0.1s of the recipe (ffprobe + frame extraction at the 0.5s timeline points).
2. Caption text exact, and each caption's on-screen window within ±0.1s (frame check at 0.0/0.5/1.0/2.0/2.5/3.0/4.0/5.0).
3. Call banner slides in ~0.5–1.0, visible 1.0–2.0, slides out 2.0–2.5 (frame check).
4. No white flash anywhere in the film: no frame blown out to white outside the recipe's own bright content, and no `white_flash` scene or transition in the recipe (the executor refuses them; the verifier asserts the absence explicitly). Standing rule — a template that flashes white fails.
5. Transitions at the right times: hard cuts at 5.0/6.0/7.0/10.0/12.0/12.5, whip/blur at 13.5 (frame must be heavily motion-blurred, not a clean cut). The whip's sharpness is measured at 360x640, not on the 160x90 check frames: at 160x90 a synthetic test clip's checkerboard edges dominate the Laplacian and the blur barely registers (a film whose whip is visibly soft read 0.90x), while at 360x640 the same whip reads 1.4 vs ~20 outside (0.06x). A hard cut reads ~1.0x at any resolution, so the 0.75 bar still catches a missing whip.
6. No caption after 5.0s.
7. Output duration 14.5s ±0.1s, 1080x1920, 30 fps, audio present, no black frames at start/end.
8. Speed ramp curve (where the recipe has one): measured, not eyeballed. (a) Calibration: each ramped scene rendered alone from a bar clip (a solid grey frame whose brightness rises linearly with source time) with a static move and no grade or captions, so the output brightness slope IS the playback speed — the measured speed at five points must match the recipe curve within 35%. The bar's slope is measured by regression over its linear region; a swept gradient saturates and silently corrupts the measurement. The bar's slope ADAPTS to the scene's source need (v1.2, Nov 16): it spans ~160 luma levels over the source the ramp consumes (48 → ~208, never saturating), because at the fixed 24 luma/s a slow exit on a short scene moves the brightness only ~3 levels over the measurement window and the regression is dominated by luma quantization and the steps where fps holds a source frame — a correct ramp then fails (measured: S8's slow exit read 0.25 instead of 0.55; the numbered-frame render proved the ramp itself was correct). The measured speed is compared to the curve's WINDOW-AVERAGE over the same ±0.25s window, not the curve's point value — for a 0.5s scene the window covers the whole ramp, and a U-ramp's window-average at the settle is far above its point speed (measured: S6's window-averages are ~1.0 flat while its point speeds swing 2.2 → 0.45). The calibration render is timing-only (no tmix/minterpolate): tmix is a trailing average, so on a fast slice it delays the picture by up to half its window and that lag reads as the ramp playing slow; the blur is a look, verified separately in (b). (b) Blur calibration: the same scene rendered from a detailed still with the scene's move and no captions or grade — the fast points are measurably blurred and the slow points sharp. The film itself cannot be used for this: a caption drawn after the ramp inflates whole-frame sharpness whenever it is on screen, which masks the blur entirely. (c) The film itself: where the move is a glide, the fast points move faster (frame-difference energy). The old first-third-vs-last-third energy check is retired — it cannot see a U-shaped ramp.
9. Grade: day scenes bright/warm, night scenes dark blue with warm windows (frame sample check, not a vibe check).
10. Beat: every cut lands on a beat of the finished film's own audio (measured from the film, not assumed from the recipe), within 0.06s. The verifier snaps the recipe to the music's measured grid before rendering when `--music` is given, so this check runs against the grid the film was actually cut on; the audit's beat check is the same measurement on a finished film.

### 5b. Readiness check (is it ready for clients?)
1. Determinism: same recipe + same inputs rendered 3×, outputs frame-identical (hash the extracted frames).
2. Three input sets: real photos, AI-generated clips, mixed — all three render without failure and look coherent.
3. Watch-through: Reda watches the golden render next to the reference and confirms it feels like the reference.
4. Freeze: recipe + golden renders committed as v1.0 in git. Any later change is v1.1 with a new golden render.
5. Cost logged per render (generation + composer/Shotstack) so the per-template cost is known.

A template that fails any 5a item is NOT coherent and does not proceed to 5b. A template that fails 5b is not offered to clients.

### 5c. Template audit with auto-fix (visual quality check, Nov 16, 2026)

The verifier (§5a) checks the render MATCHES the recipe. The audit (`composer/audit-template.mjs`) checks the render is actually good to watch, on a real film — then fixes what it can and re-renders, up to 3 rounds (mirroring the film auto-fix loop). A template that still fails does not ship. Checks: (1) freeze — dense frame-to-frame diff, any run ≥0.2s under threshold fails; (2) smoothness — per-scene energy at 5 points vs the ramp curve, fast must move faster than slow, slowest point must still move; (3) whip-blur — the fast point is measurably blurrier than the slow point (ratio ≥1.3x), preferring the verifier's caption-free calibration numbers when a report is supplied (a caption inflates the fast frame's sharpness and masks the blur); (4) no-whoosh — the recipe declares no whoosh/flash accent; (5) story — exterior before interior, rooms in walk-through order, judged on FIRST appearances (a template may reuse an input — house-calling shows exterior_night twice, the night shot then the approach to the door — a repeat is the camera returning, not a story break); a wrong order is flagged for Reda, never auto-fixed; (6) coherence — the verifier's §5a report, when supplied; (7) beat — every cut vs the finished film's own audio, within 0.06s (no steady beat in the track = skipped, not failed). A check that cannot be judged is recorded as SKIPPED in the report, not hidden. Auto-fix: freeze/smoothness → soften the slowest ramp points +0.15 (capped 0.7); whip-blur fail → cap the whip at 1.5x; whoosh → strip the SFX; story wrong → flag only; beat fail → snap cuts to the film's measured grid. The audit is shown in Library Studio ("Audit this template" — `app/admin/library-studio/template-audit.tsx`, reports committed under `composer/audits/<template-id>/audit-report.json`), so Reda sees the render's checks, not just PASS/FAIL. Motion checks (freeze, smoothness) read the film as seen on its inputs: on synthetic flat test cards they report the film as still even when the ramp is correct (a flat dark card shows almost no visible motion), so those two checks are only meaningful on real photos or clips — the ramp itself is proven by the §5a calibration instead.

```bash
node composer/audit-template.mjs --recipe composer/templates/<id>.json \
  --film <rendered film.mp4> --verifier-report <verification-report.json> \
  [--inputs <test inputs dir>] [--out <report dir>] [--fix] [--max-rounds 3]
```

### Verification command

```bash
# From the repo root. Inputs: one clip per recipe input slot, named <slot>.mp4.
# Music: a licensed stock track (MP3). Voiceover: optional, only to check ducking.
node composer/verify-template.mjs \
  --recipe composer/templates/house-calling-v1.json \
  --inputs <dir of 7 clips> \
  --music <licensed-stock-track.mp3> \
  [--voiceover <voiceover.mp3>] \
  --out <report dir> \
  [--size 1080x1920] [--fps 30] [--determinism]
```

It renders the template, runs every §5a check from the frames themselves, prints one PASS/FAIL line per check plus a JSON report (`verification-report.json` in `--out`), and exits 1 when any check fails. `--determinism` also runs §5b.1 (three renders, frame hashes compared).

What it cannot check: that a caption's letters are exactly right (needs OCR — the composer container ships tesseract, this box may not; caption text exactness is checked at the filter-graph level by `tests/composer/template-recipe.test.mjs`), and that a grade "feels" right on real footage (it checks channel balance and brightness only, per scene).

### Unit tests

```bash
npm run test:template-recipe   # reader, planner, graphs, and small ffmpeg renders
npm run test:composer          # the whole composer suite, including the above
```

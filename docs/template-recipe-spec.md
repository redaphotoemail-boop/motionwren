# MotionWren Template Recipe Spec v1

**Status:** implemented (composer track) — Nov 15, 2026
**Source:** the v1 spec agreed Nov 15, 2026 (`~/workspace/goals/motionwren-real-estate-video-platform/files/template-recipe-spec-v1.md` — the contract; this file is its port into the repo).
**Purpose:** one frozen, versioned format that describes a template exactly, so the SAME template can be executed by Shotstack and by the owned FFmpeg composer, and so a built template can be verified against it instead of judged by eye.

**Why this exists:** the old flow had three breaks. (1) No fixed format — a reel went to Claude, Claude invented fields nothing understood. (2) No executor — the composer only knew trim/crossfade/music, not whip pans, kinetic type, speed ramps or grade. (3) No test render before going live. The recipe fixes all three: the recipe is the format, the renderer is the executor, the verification task is the test.

**Hard rules**
- No template selected = current behavior exactly. Nothing about the existing composer path changes when no recipe is given.
- Templates are MotionWren originals. Styles may be studied from references; no bought template, no Shorty/Envato asset, no copied footage, no copied font file, no copied music is ever offered as a template. Music is licensed stock only.
- Same recipe + same inputs = same output every time. A recipe is frozen as v1.0 in git with its golden renders.
- No merge to main without Reda's approval. Build on a branch from the latest main.

## 1. The recipe format (JSON)

The canonical example is the first template, `composer/templates/house-calling-v1.json` (14.9s, 9:16, "This House Is Calling"). Its shape:

```json
{
  "recipe_version": "1.0",
  "template_id": "house-calling-v1",
  "name": "This House Is Calling",
  "aspect": "9:16",
  "resolution": "1080x1920",
  "fps": 30,
  "duration_s": 14.9,
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
    {"id": "FLASH", "start_s": 5.0, "duration_s": 0.4, "type": "white_flash", "peak_s": 5.2},
    {"id": "S8", "start_s": 14.0, "duration_s": 0.9, "input": "living",
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
    "cut_points_s": [5.5, 6.0, 7.5, 10.5, 12.0, 13.0, 14.0],
    "ducking": true
  },
  "speed_ramps": [
    {"scene": "S1", "note": "constant speed in v1; ramps are a v1 field, first exercised in tour-flow-v1 (v1.1)"}
  ]
}
```

Notes on the fields:
- `camera.move` values are a closed list: `push_in`, `glide_lateral`, `glide`, `tilt_down_glide`, `whip_in_then_push_in`, `static`. A renderer that cannot do a move must fail loudly, never silently substitute a different move.
- `transition_in` values are a closed list: `open`, `hard_cut`, `white_flash`, `whip_blur`, `crossfade`. Same rule: unsupported = fail, never substitute.
- `speed_ramps` are part of the format from v1 even though the first template uses constant speed. The ramp entry is a curve: `{"scene": ..., "points": [[t, speed], ...]}` with bezier easing. The composer must implement it (see §2); Shotstack documents bezier-eased speed ramps natively. First exercised in `tour-flow-v1` (v1.1).
- `night_slots` (v1.2, a job-time choice, not part of the frozen template): a list of scene ids or input slot names, e.g. `["exterior"]`. Each named scene is rendered with the night grade (`night_warm_windows`) instead of its own grade. It is a grade only — the same photo, the same move, the same timing; the house does not change at all, only the light and colour. No AI re-render: an AI re-render redraws the house and can drift, which is exactly what this must not do. The night grade is a composer built-in, so it does not need to be in the recipe's `grades` map. Each entry must name a real scene or input slot; a white flash takes no grade and cannot be night-graded. Offered in Studio when creating, e.g. when a template's night slot is empty ("no night photo? generate one from your day photo").
- Music is licensed stock only, chosen separately, never baked into the recipe as a copyrighted track.
- Scenes must tile exactly: each scene starts where the previous one ends, and the scenes run to `duration_s` (less the overlap of any true dissolve — see §2).
- A `white_flash` scene takes no `input` and no `camera`. A scene whose `transition_in` is `white_flash` must be preceded by a `white_flash` scene.
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
| `white_flash` | The previous scene's footage continues under the flash, fading to white with its peak at `peak_s` — so the last caption stays faintly visible through the start of the flash, as in the reference |
| `whip_blur` | A blurred boundary effect: 0.15s of each side, fast scale + `tmix` trail + a spatial blur (tmix alone needs several frames to build up and the edge is only a few frames long); the film's total length is unchanged |
| `crossfade` | A true dissolve: `CROSSFADE_S` (0.5s) of each side crossfaded with `xfade`. It consumes footage, so `duration_s` = scenes' sum less 0.5s per crossfade |
| `captions` | `drawtext` with alpha fade in/out expressions, exact start/end times |
| `call_banner` overlay | Drawn banner PNG (dark card, red decline + green accept dots, title over subtitle), slid in/out with an animated `overlay` y |
| `speed_ramps` | Bezier (smoothstep) easing sampled densely, then the WrenCut slicer (`rampHead`): `setpts` per segment, `tmix` blur where it speeds up, `minterpolate` where it slows down. Move-first (v1.1): the recipe's camera move runs over the source seconds the ramp consumes, then the ramp re-times the moved picture — so a still photo's push-in whips and settles with the ramp instead of gliding at constant speed |
| `grade` | `eq` + `lut3d` (true LUT — the composer is the only route with this). Grade names map to `composer/luts/*.cube` (generated by `composer/luts/generate-luts.py`) + eq values in `GRADE_TABLE` |
| `night_slots` | Job-time grade override (v1.2): a scene named here (by id or input slot) renders with the night grade (`night_warm_windows`, `eq` + `lut3d`) instead of its own grade. Same photo, same move, same timing — only light and colour change. Never an AI re-render |
| `music` + `ducking` | One master track, `sidechaincompress` ducking under a voiceover, cut to exact length, beat map used only to place cut points |
| QC | Duration = recipe duration ±0.1s; resolution/aspect match; audio present and not clipping; no black frames at start/end (`templateQualityCheck`, report-only) |

Executor decisions (where the spec left a choice):
- The whip is a boundary effect, not a dissolve: it does not consume footage and does not shorten the film. A crossfade does consume footage (see above).
- A `white_flash` scene inherits the previous scene's input and starts where that scene left off.
- The template join adds no fade in/out, no sharpening, no extra grade — the recipe is the edit.
- Still-image inputs (v1.1): a template input may be a still photo (JPEG/PNG/WebP). The composer loops it into a clip of the length the recipe needs (`prepareTemplateInputs`: at least the scene's own duration, and the ramp's source need when that is longer), so the recipe's camera move is what moves it — a real listing photo is a valid template input.
- Night slots (v1.2): `night_slots` is a job-time choice carried on the recipe object the app sends, not a field the template author writes. The composer validates each entry against the recipe's scenes/slots and applies the night grade in `templateShotArgs`. The verifier's grade check (check 9) reads the effective grade, so a night-slotted scene is checked as night (dark, B>R), not as its declared day grade.
- A clip that runs short for its scene is a loud failure, never a silent stretch — or the same recipe would not give the same output. A ramp that would need more footage than the clip has is a loud failure too (`rampSourceSeconds` vs the clip's remaining length, 0.97 factor matching `rampHead`'s own trigger): the composer never silently scales a ramp down, or the film would quietly lose the whip.

## 3. Shotstack mapping (hosted route)

Same recipe → Shotstack JSON: `timeline.tracks`, one clip per scene with `start`/`length`, `transition` per `transition_in`, `html` overlay assets for captions and the call banner, `speed`/`playbackRate` with bezier easing for ramps, LUT is NOT supported (grade = Shotstack color adjustments only — document the difference, never pretend it matches the composer grade). No true sidechain ducking (volume keyframes as the workaround). The Shotstack template JSON is generated from the recipe, not hand-written separately — one recipe, two renderers.

## 4. First template

`house-calling-v1`, 14.9s, 9:16, structure measured from the reference breakdown (`~/workspace/your_files/shortyedit-13-real-estate-templates/shortyedit-13-shot-by-shot.md`, template #1). Built as a MotionWren original: own fonts, own banner graphic, licensed stock music. Captions only in the first 5 seconds. Day-to-night alternation preserved. White flash at ~5.0–5.4s. Whip/blur into the final living-room shot.

Second template (v1.1): `tour-flow-v1`, 16.0s, 9:16 — a real-estate walkthrough, exterior → foyer → living room → kitchen → bedroom, 3.2s per scene. Every transition between spaces is a speed-ramped move with motion blur (ramp up into the move, blur through it, ramp down and settle; the first scene opens slow and accelerates toward the door, the last settles slow on the bedroom and the film ends slow). Captions are room names only. Grade: bright warm day outside, warm evening interior inside. This is the template that proves smooth room-to-room and exterior-to-interior movement, and the first to exercise speed ramps and still-photo inputs.

## 5. Verification task — run on every template before client use

Run: `composer/verify-template.mjs` (see "Verification command" below).

### 5a. Coherence check (does the built template match the recipe?)
Run with FIXED test inputs (same 7 photos/clips every time), then check each item pass/fail:
1. Scene count and each scene's start/duration within ±0.1s of the recipe (ffprobe + frame extraction at the 0.5s timeline points).
2. Caption text exact, and each caption's on-screen window within ±0.1s (frame check at 0.0/0.5/1.0/2.0/2.5/3.0/4.0/5.0).
3. Call banner slides in ~0.5–1.0, visible 1.0–2.0, slides out 2.0–2.5 (frame check).
4. White flash at 5.0–5.4, frame blown out at ~5.2.
5. Transitions at the right times: hard cuts at 6.2/7.3/10.4/12.2/12.9, whip/blur at 14.0 (frame must be heavily motion-blurred, not a clean cut).
6. No caption after 5.0s.
7. Output duration 14.9s ±0.1s, 1080x1920, 30 fps, audio present, no black frames at start/end.
8. Speed ramp curve (where the recipe has one): measured, not eyeballed. (a) Calibration: each ramped scene rendered alone from a bar clip (a solid grey frame whose brightness rises linearly with source time) with a static move and no grade or captions, so the output brightness slope IS the playback speed — the measured speed at five points must match the recipe curve within 35%. The bar's slope is measured by regression over its linear region; a swept gradient saturates and silently corrupts the measurement. (b) Blur calibration: the same scene rendered from a detailed still with the scene's move and no captions or grade — the fast points are measurably blurred and the slow points sharp. The film itself cannot be used for this: a caption drawn after the ramp inflates whole-frame sharpness whenever it is on screen, which masks the blur entirely. (c) The film itself: where the move is a glide, the fast points move faster (frame-difference energy). The old first-third-vs-last-third energy check is retired — it cannot see a U-shaped ramp.
9. Grade: day scenes bright/warm, night scenes dark blue with warm windows (frame sample check, not a vibe check).

### 5b. Readiness check (is it ready for clients?)
1. Determinism: same recipe + same inputs rendered 3×, outputs frame-identical (hash the extracted frames).
2. Three input sets: real photos, AI-generated clips, mixed — all three render without failure and look coherent.
3. Watch-through: Reda watches the golden render next to the reference and confirms it feels like the reference.
4. Freeze: recipe + golden renders committed as v1.0 in git. Any later change is v1.1 with a new golden render.
5. Cost logged per render (generation + composer/Shotstack) so the per-template cost is known.

A template that fails any 5a item is NOT coherent and does not proceed to 5b. A template that fails 5b is not offered to clients.

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

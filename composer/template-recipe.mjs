/* Template recipes (spec v1): one frozen JSON format that describes a
   template exactly, so the SAME template can be executed by Shotstack and
   by this composer, and so a built template can be verified against it
   instead of judged by eye.

   Spec: docs/template-recipe-spec.md (source: the v1 spec, Nov 15 2026).

   What this module does:
     - parseTemplateRecipe: loads and validates a recipe. The closed lists
       (camera.move, transition_in) are enforced here: an unsupported value
       is a loud failure, never a silent substitution.
     - planTemplateScenes: maps each scene to a source clip and a start
       offset in it. A white_flash scene with no input continues the
       previous scene's footage (so text stays faintly visible through
       the flash, as in the reference) and fades it to white.
     - templateShotArgs: one scene rendered on its own, at its exact
       length — camera move, grade (eq + true LUT), captions, call banner.
     - templateEditArgs: the join — hard cuts at exact frames, white
       flash, whip_blur as a blurred boundary effect, crossfade as a true
       dissolve; music with sidechaincompress ducking under a voiceover.
     - templateQualityCheck: the mechanical QC for a rendered template
       film. It only reports, it never fails a film.
     - makeCallBanner: the incoming-call banner as a PNG, drawn once
       per job from the recipe's title/subtitle.

   What it does NOT do: when no template recipe is given, the composer
   behaves exactly as it does today — this module is never called.
   Still-image inputs (v1.1): a template input may be a still photo
   (JPEG/PNG/WebP). prepareTemplateInputs loops it into a clip of the
   length the recipe needs, so the recipe's camera move is what moves
   it — a real listing photo is a valid template input. */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rampHead } from "./wrencut.mjs";

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const isNum = (value) => typeof value === "number" && Number.isFinite(value);

/* ---------- closed lists (spec §1) ---------- */

export const TEMPLATE_CAMERA_MOVES = ["push_in", "glide_lateral", "glide", "tilt_down_glide", "whip_in_then_push_in", "static"];
export const TEMPLATE_TRANSITIONS = ["open", "hard_cut", "white_flash", "whip_blur", "crossfade"];
export const TEMPLATE_GRADES = ["bright_warm_day", "night_warm_windows", "warm_evening_interior"];
/* Text styles the composer can actually draw. A caption that names any
   other style fails at load time — the film is never made with a look
   the composer cannot draw. */
export const TEMPLATE_TEXT_STYLES = ["bold_white_caps"];
/* A whip_blur straddles the cut: this much of each side is blurred. The
   total length is unchanged — the blur is an effect on the boundary
   frames, not footage consumed by a dissolve. */
export const WHIP_WINDOW_S = 0.3;
/* A crossfade IS a dissolve, so it consumes footage: this much of the
   film's length goes to the overlap, exactly like WrenCut joins. */
export const CROSSFADE_S = 0.5;

/* The ducking chain, exported so the verifier measures the same filter the
   composer runs (one source of truth, not a copied string).
   threshold is linear amplitude: 0.05 is -26 dBFS, low enough that real
   narration (loudnorm'd to -16 LUFS, RMS around -19 dBFS) drives about
   6 dB of reduction, while room tone stays below it. Attack/release are in
   milliseconds — ffmpeg rejects attack below 0.01 and wants ms, not seconds.
   No makeup gain: the point is the music gets quieter under the voice and
   returns to its levelled level otherwise, not 12 dB hotter throughout.
   (Lavfi's sine source generates at amplitude 0.125, not 1.0 — test tones
   need volume 4.0 to reach 0.5 amplitude. A string check once let a dB
   threshold through, and a broadband RMS of the mix cannot show ducking
   at all, because the loud voice itself fills the mix.) */
export const DUCK_FILTER = "sidechaincompress=threshold=0.05:ratio=8:attack=5:release=500:knee=2:makeup=1:mix=1";

const fail = (message) => { throw new Error(`Template recipe: ${message}`); };

/* ---------- fonts ---------- */

/* Same shape as cards.mjs: the container ships Liberation 2, a local
   checkout falls back to DejaVu. The banner's dots (●) are drawn with
   DejaVu Sans, which carries the glyph. */
const FONT_DIRS = [
  "/usr/share/fonts/truetype/liberation2",
  "/usr/share/fonts/truetype/liberation",
  "/usr/share/fonts/truetype/dejavu",
];
const pickFont = (names) => {
  for (const dir of FONT_DIRS) for (const name of names) { const file = path.join(dir, name); try { if (fs.existsSync(file)) return file; } catch { /* keep looking */ } }
  return path.join(FONT_DIRS[FONT_DIRS.length - 1], names[names.length - 1]);
};
const BOLD_SANS = () => pickFont(["LiberationSans-Bold.ttf", "DejaVuSans-Bold.ttf"]);
const REGULAR_SANS = () => pickFont(["LiberationSans-Regular.ttf", "DejaVuSans.ttf"]);
const DOTS_SANS = () => pickFont(["DejaVuSans.ttf", "LiberationSans-Regular.ttf"]);

/* ---------- grades (spec §2): eq + a true LUT ---------- */

const LUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "luts");
export const GRADE_TABLE = {
  bright_warm_day: { lut: "bright-warm-day.cube", eq: "saturation=1.06:contrast=1.03:brightness=0.01", note: "bright day, warm sun, saturated blue sky" },
  night_warm_windows: { lut: "night-warm-windows.cube", eq: "saturation=1.04:contrast=1.05", note: "dark blue night sky, warm lit windows" },
  warm_evening_interior: { lut: "warm-evening-interior.cube", eq: "saturation=1.05:contrast=1.02", note: "warm evening interior light" },
};
/* ---------- 1. the reader ---------- */

function checkRange(value, lo, hi, what) {
  if (!isNum(value) || value < lo || value > hi) fail(`${what} must be a number from ${lo} to ${hi}.`);
}

/* The recipe as written, checked end to end. Returns the recipe object
   (the caller's object is never mutated). A bad recipe throws — the job
   is refused before any rendering starts. */
export function parseTemplateRecipe(value) {
  const recipe = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { fail("the recipe is not valid JSON."); } })() : value;
  if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) fail("the recipe must be a JSON object.");
  if (recipe.recipe_version !== "1.0") fail(`recipe_version must be "1.0", got ${JSON.stringify(recipe.recipe_version)}.`);
  if (typeof recipe.template_id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(recipe.template_id)) fail("template_id must be a lowercase slug (letters, digits, dashes).");
  if (typeof recipe.name !== "string" || !recipe.name.trim()) fail("name is required.");
  if (typeof recipe.aspect !== "string" || !/^\d+:\d+$/.test(recipe.aspect)) fail('aspect must look like "9:16".');
  const res = /^(\d+)x(\d+)$/.exec(typeof recipe.resolution === "string" ? recipe.resolution : "");
  if (!res) fail('resolution must look like "1080x1920".');
  const width = Number(res[1]), height = Number(res[2]);
  if (width % 2 || height % 2 || width < 240 || height < 240 || width > 4096 || height > 4096) fail("resolution is out of range.");
  if (recipe.fps !== 30) fail("fps must be 30 in v1.");
  checkRange(recipe.duration_s, 0.5, 60, "duration_s");

  if (!Array.isArray(recipe.inputs) || recipe.inputs.length < 1 || recipe.inputs.length > 20) fail("inputs needs 1 to 20 slots.");
  const slots = new Map();
  for (const input of recipe.inputs) {
    if (!input || typeof input.slot !== "string" || !input.slot) fail("every input needs a slot name.");
    if (slots.has(input.slot)) fail(`input slot "${input.slot}" is listed twice.`);
    if (input.type !== "image_or_video") fail(`input "${input.slot}" has an unknown type (v1 only takes "image_or_video").`);
    if (typeof input.required !== "boolean") fail(`input "${input.slot}" must say whether it is required.`);
    slots.set(input.slot, input);
  }

  if (!recipe.text_styles || typeof recipe.text_styles !== "object") fail("text_styles is required.");
  if (!recipe.grades || typeof recipe.grades !== "object") fail("grades is required.");
  for (const name of Object.keys(recipe.grades)) if (!TEMPLATE_GRADES.includes(name)) fail(`grade "${name}" is not one the composer can draw (${TEMPLATE_GRADES.join(", ")}).`);

  if (!Array.isArray(recipe.scenes) || recipe.scenes.length < 1 || recipe.scenes.length > 20) fail("scenes needs 1 to 20 scenes.");
  // Normalized copy (the caller's object is never mutated): a white_flash
  // scene with no transition_in enters by hard cut — the flash itself is
  // the transition, so the cut into it is plain.
  const scenes = recipe.scenes.map((scene) => ({ ...scene, transition_in: scene.transition_in ?? (scene.type === "white_flash" ? "hard_cut" : scene.transition_in) }));
  const seen = new Set();
  let cursor = 0;
  for (const [index, scene] of scenes.entries()) {
    if (!scene || typeof scene.id !== "string" || !scene.id) fail(`scene ${index + 1} needs an id.`);
    if (seen.has(scene.id)) fail(`scene id "${scene.id}" is used twice.`);
    seen.add(scene.id);
    checkRange(scene.start_s, 0, recipe.duration_s, `scene "${scene.id}" start_s`);
    checkRange(scene.duration_s, 0.3, 30, `scene "${scene.id}" duration_s`);
    if (Math.abs(scene.start_s - cursor) > 0.001) fail(`scene "${scene.id}" starts at ${scene.start_s}s but the previous scene ends at ${round(cursor)}s — scenes must tile with no gaps.`);
    cursor = scene.start_s + scene.duration_s;
    if (scene.type !== undefined && scene.type !== "white_flash") fail(`scene "${scene.id}" has an unknown type "${scene.type}".`);
    if (scene.type === "white_flash") {
      if (scene.input !== undefined) fail(`scene "${scene.id}" is a white flash and takes no input.`);
      checkRange(scene.peak_s, scene.start_s, scene.start_s + scene.duration_s, `scene "${scene.id}" peak_s`);
      if (index === 0) fail(`scene "${scene.id}" is a white flash and cannot be the first scene.`);
    } else {
      if (typeof scene.input !== "string" || !slots.has(scene.input)) fail(`scene "${scene.id}" names an unknown input slot "${scene.input}".`);
    }
    if (scene.type !== "white_flash") {
      if (!scene.camera || !TEMPLATE_CAMERA_MOVES.includes(scene.camera.move)) fail(`scene "${scene.id}" has an unknown camera move "${scene.camera?.move}" (${TEMPLATE_CAMERA_MOVES.join(", ")}).`);
      if (scene.camera.amount !== undefined) checkRange(scene.camera.amount, 1, 1.6, `scene "${scene.id}" camera amount`);
      if (scene.camera.speed !== undefined && scene.camera.speed !== "constant") fail(`scene "${scene.id}" camera speed must be "constant" in v1.`);
    }
    if (!TEMPLATE_TRANSITIONS.includes(scene.transition_in)) fail(`scene "${scene.id}" has an unknown transition_in "${scene.transition_in}" (${TEMPLATE_TRANSITIONS.join(", ")}).`);
    if (index === 0 && scene.transition_in !== "open") fail(`the first scene must open with transition_in "open".`);
    if (scene.transition_in === "white_flash") {
      const prev = scenes[index - 1];
      if (!prev || prev.type !== "white_flash") fail(`scene "${scene.id}" enters with a white flash but the previous scene is not a white_flash scene — a flash transition needs its flash scene.`);
    }
    if (scene.grade !== undefined) {
      if (!TEMPLATE_GRADES.includes(scene.grade)) fail(`scene "${scene.id}" has an unknown grade "${scene.grade}" (${TEMPLATE_GRADES.join(", ")}).`);
      if (!(scene.grade in recipe.grades)) fail(`scene "${scene.id}" uses grade "${scene.grade}" which the recipe's grades map does not describe.`);
    }
    for (const caption of scene.captions || []) {
      if (typeof caption.text !== "string" || !caption.text.trim() || caption.text.length > 200) fail(`scene "${scene.id}" has a caption with no usable text.`);
      if (!recipe.text_styles[caption.style]) fail(`scene "${scene.id}" uses text style "${caption.style}" which the recipe does not define.`);
      if (!TEMPLATE_TEXT_STYLES.includes(caption.style)) fail(`scene "${scene.id}" uses text style "${caption.style}" which the composer cannot draw (only ${TEMPLATE_TEXT_STYLES.join(", ")} in v1).`);
      checkRange(caption.start_s, scene.start_s, scene.start_s + scene.duration_s, `scene "${scene.id}" caption start_s`);
      checkRange(caption.end_s, caption.start_s, scene.start_s + scene.duration_s, `scene "${scene.id}" caption end_s`);
      if (caption.fade_out_s !== undefined) {
        if (!Array.isArray(caption.fade_out_s) || caption.fade_out_s.length !== 2) fail(`scene "${scene.id}" caption fade_out_s must be [from, to].`);
        checkRange(caption.fade_out_s[0], caption.start_s, caption.end_s, `scene "${scene.id}" caption fade_out_s`);
        checkRange(caption.fade_out_s[1], caption.fade_out_s[0], caption.end_s + 0.2, `scene "${scene.id}" caption fade_out_s`);
      }
    }
    if (scene.overlay !== undefined) {
      if (scene.overlay.type !== "call_banner") fail(`scene "${scene.id}" has an unknown overlay type "${scene.overlay.type}".`);
      for (const key of ["title", "subtitle"]) if (typeof scene.overlay[key] !== "string" || !scene.overlay[key].trim()) fail(`scene "${scene.id}" call banner needs a ${key}.`);
      for (const key of ["slide_in_s", "visible_s", "slide_out_s"]) {
        const win = scene.overlay[key];
        if (!Array.isArray(win) || win.length !== 2) fail(`scene "${scene.id}" call banner ${key} must be [from, to].`);
        checkRange(win[0], scene.start_s, scene.start_s + scene.duration_s, `scene "${scene.id}" call banner ${key}`);
        checkRange(win[1], win[0], scene.start_s + scene.duration_s, `scene "${scene.id}" call banner ${key}`);
      }
      if (!(scene.overlay.slide_in_s[1] <= scene.overlay.visible_s[0] && scene.overlay.visible_s[1] <= scene.overlay.slide_out_s[0])) {
        fail(`scene "${scene.id}" call banner windows must run slide-in, then visible, then slide-out.`);
      }
    }
  }
  // A scene next to a true dissolve must be longer than the footage
  // the dissolve consumes, or there would be nothing left to show.
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const next = scenes[i + 1];
    const consumed = (scene.transition_in === "crossfade" ? CROSSFADE_S : 0)
      + (next && next.transition_in === "crossfade" ? CROSSFADE_S : 0);
    if (scene.duration_s <= consumed) fail(`scene "${scene.id}" is ${scene.duration_s}s but the dissolves next to it need ${consumed}s.`);
  }
  // The film's length: the scenes end to end, less the overlap of each
  // true dissolve. Boundary effects (whip, flash, hard cut) consume
  // nothing, so they do not shorten the film.
  const overlaps = scenes.filter((scene) => scene.transition_in === "crossfade").length * CROSSFADE_S;
  const expected = round(scenes.reduce((sum, scene) => sum + scene.duration_s, 0) - overlaps);
  if (Math.abs(expected - recipe.duration_s) > 0.001) fail(`duration_s must be ${expected}s once the crossfade overlaps are counted.`);
  if (recipe.speed_ramps !== undefined) {
    if (!Array.isArray(recipe.speed_ramps)) fail("speed_ramps must be a list.");
    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    for (const ramp of recipe.speed_ramps) {
      if (!ramp || typeof ramp.scene !== "string" || !byId.has(ramp.scene)) fail(`a speed ramp names an unknown scene "${ramp?.scene}".`);
      if (byId.get(ramp.scene).type === "white_flash") fail(`a speed ramp cannot be put on the white flash scene "${ramp.scene}".`);
      if (ramp.points === undefined) continue; // a note only: constant speed
      if (!Array.isArray(ramp.points) || ramp.points.length < 2 || ramp.points.length > 16) fail(`speed ramp for scene "${ramp.scene}" needs 2 to 16 points.`);
      let prevT = -1;
      for (const point of ramp.points) {
        if (!Array.isArray(point) || point.length !== 2) fail(`speed ramp for scene "${ramp.scene}" has a point that is not [time, speed].`);
        checkRange(point[0], 0, 1, `speed ramp for scene "${ramp.scene}" time`);
        checkRange(point[1], 0.2, 4, `speed ramp for scene "${ramp.scene}" speed`);
        if (point[0] <= prevT) fail(`speed ramp for scene "${ramp.scene}" times must increase.`);
        prevT = point[0];
      }
    }
  }
  // Night slots (a job-time choice, not part of the frozen template): the
  // scenes or input slots named here are rendered with the night grade
  // (night_warm_windows) instead of their own grade. It is a grade only —
  // the same photo, the same move, the same timing; the house does not
  // change at all, only the light and colour. The night grade is a
  // composer built-in, so it does not need to be in the recipe's grades
  // map (a template author cannot predict which slot a user will want
  // at night). Each entry must name a real scene or input slot, and a
  // white flash takes no grade, so it cannot be night-graded.
  if (recipe.night_slots !== undefined) {
    if (!Array.isArray(recipe.night_slots)) fail("night_slots must be a list.");
    const byId = new Map(scenes.map((scene) => [scene.id, scene]));
    for (const slot of recipe.night_slots) {
      if (typeof slot !== "string" || !slot) fail("night_slots entries must be scene ids or input slot names.");
      const scene = byId.get(slot) || scenes.find((s) => s.input === slot);
      if (!scene) fail(`a night slot names an unknown scene or input slot "${slot}".`);
      if (scene.type === "white_flash") fail(`a night slot cannot be put on the white flash scene "${scene.id}".`);
    }
  }
  if (recipe.music !== undefined) {
    if (typeof recipe.music.track !== "string" || !recipe.music.track.trim()) fail("music.track is required when music is given.");
    for (const key of ["beat_map_s", "cut_points_s"]) {
      if (recipe.music[key] !== undefined && !(Array.isArray(recipe.music[key]) && recipe.music[key].every((t) => isNum(t) && t >= 0 && t <= recipe.duration_s))) {
        fail(`music.${key} must be times inside the film.`);
      }
    }
    if (recipe.music.ducking !== undefined && typeof recipe.music.ducking !== "boolean") fail("music.ducking must be true or false.");
  }
  return { ...recipe, scenes, _width: width, _height: height };
}

export function templateDuration(recipe) {
  const parsed = recipe._width ? recipe : parseTemplateRecipe(recipe);
  return round(parsed.scenes.reduce((sum, scene) => sum + scene.duration_s, 0)
    - parsed.scenes.filter((scene) => scene.transition_in === "crossfade").length * CROSSFADE_S);
}

/* ---------- planning: which clip, and where in it, each scene uses ---------- */

/* clipDurations are in the recipe's inputs order: clip i is inputs[i].
   A clip that serves several scenes gives each a different moment of its
   footage, so a room is never scattered through the film. A scene whose
   clip runs short is a loud failure: a template never stretches footage
   silently, or the same recipe would not give the same output. */
export function planTemplateScenes(recipe, clipDurations) {
  const parsed = recipe._width ? recipe : parseTemplateRecipe(recipe);
  if (!Array.isArray(clipDurations) || clipDurations.length !== parsed.inputs.length) {
    fail(`the recipe needs one clip per input slot (${parsed.inputs.length}), got ${clipDurations?.length ?? 0}.`);
  }
  const slotIndex = new Map(parsed.inputs.map((input, i) => [input.slot, i]));
  const uses = parsed.inputs.map(() => 0);
  const totalUses = parsed.inputs.map(() => 0);
  for (const scene of parsed.scenes) if (scene.type !== "white_flash") totalUses[slotIndex.get(scene.input)] += 1;
  return parsed.scenes.map((scene, index) => {
    if (scene.type === "white_flash") {
      // No input of its own: the previous scene's footage continues
      // under the flash, fading to white at peak_s.
      const prev = parsed.scenes[index - 1];
      return { scene, clip: slotIndex.get(prev.input), start: null, flash: true };
    }
    const clip = slotIndex.get(scene.input);
    const occurrence = uses[clip]++;
    const room = Math.max(0, clipDurations[clip] - scene.duration_s - 0.05);
    const start = totalUses[clip] > 1 ? round(room * (occurrence / (totalUses[clip] - 1))) : 0;
    const ramp = (parsed.speed_ramps || []).find((item) => item.scene === scene.id && Array.isArray(item.points));
    // A scene needs at least its own duration of footage — the white-flash
    // continuation starts at start + duration_s — even when its ramp
    // consumes less than that by running slow.
    const need = ramp ? Math.max(rampSourceSeconds(ramp.points, scene.duration_s), scene.duration_s) : scene.duration_s;
    if (clipDurations[clip] + 0.05 < start + need) {
      fail(`scene "${scene.id}" needs ${round(start + need)}s of "${scene.input}" but the clip is ${round(clipDurations[clip])}s.`);
    }
    if (ramp) rampNeeds(ramp.points, scene.duration_s, clipDurations[clip] - start, scene.id);
    return { scene, clip, start };
  }).map((plan, index, all) => {
    // The flash scene continues the previous scene's footage from where
    // that scene left off.
    if (!plan.flash) return plan;
    const prev = all[index - 1];
    return { ...plan, start: round(prev.start + prev.scene.duration_s) };
  });
}

/* ---------- speed ramps: bezier easing, sampled for the slicer ---------- */

/* The curve between two ramp points eases like a bezier (smoothstep):
   it leaves the first speed gently and arrives at the next gently,
   instead of changing speed in straight lines. Sampled densely so the
   slicer below, which joins its points in straight lines, follows the
   curve closely. */
export function sampleRampCurve(points, samples = 16) {
  const at = (u) => {
    if (u <= points[0][0]) return points[0][1];
    for (let k = 1; k < points.length; k += 1) {
      if (u <= points[k][0]) {
        const [u0, s0] = points[k - 1], [u1, s1] = points[k];
        const f = (u - u0) / Math.max(1e-6, u1 - u0);
        const eased = f * f * (3 - 2 * f); // smoothstep: a bezier ease
        return s0 + (s1 - s0) * eased;
      }
    }
    return points[points.length - 1][1];
  };
  return Array.from({ length: samples + 1 }, (_, i) => [round(i / samples, 4), round(at(i / samples), 4)]);
}

/* ---------- speed ramps: how much footage they need, and the loud check ---------- */

/* How many source seconds a ramp consumes: rampHead's own arithmetic, so
   the check below matches it exactly. total = d + 0.2 is rampHead's
   headroom; each of its 8 slices runs sliceLen output seconds at the
   curve's speed at its midpoint. */
export function rampSourceSeconds(points, d) {
  const sampled = sampleRampCurve(points);
  const total = d + 0.2;
  const sliceLen = total / 8;
  const at = (u) => {
    if (u <= sampled[0][0]) return sampled[0][1];
    for (let k = 1; k < sampled.length; k += 1) {
      if (u <= sampled[k][0]) {
        const [u0, s0] = sampled[k - 1], [u1, s1] = sampled[k];
        return s0 + (s1 - s0) * ((u - u0) / Math.max(1e-6, u1 - u0));
      }
    }
    return sampled[sampled.length - 1][1];
  };
  let source = 0;
  for (let k = 0; k < 8; k += 1) source += sliceLen * at(Math.min(1, ((k + 0.5) * sliceLen) / d));
  return round(source, 3);
}

/* A ramp that would need more footage than the clip has is a loud
   failure, never a silent slow-down: rampHead would otherwise scale
   the whole ramp down to fit (see wrencut.mjs), and the film would
   quietly lose the whip. The 0.97 matches rampHead's own trigger, so
   a ramp that would have run at full speed is never failed here. */
export function rampNeeds(points, d, available, sceneId) {
  const needed = rampSourceSeconds(points, d);
  if (Number.isFinite(available) && needed > available * 0.97) {
    fail(`scene "${sceneId}" needs ${needed}s of footage for its speed ramp but only ${round(available)}s is left in the clip — use a longer clip or ease the ramp.`);
  }
  return needed;
}

/* ---------- still-image inputs ---------- */

const STILL_CODECS = new Set(["mjpeg", "png", "webp", "bmp", "tiff"]);

/* A still photo as a template input: an image file (JPEG/PNG/WebP) has
   no video stream, so ffprobe reports no duration and no frame rate.
   A video file's first stream is a video codec, never one of these. */
export function isStillImage(file) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 15000 });
    return STILL_CODECS.has(String(out).trim().split("\n")[0].trim());
  } catch { return false; }
}

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (chunk) => { err += chunk; });
  child.on("error", reject);
  child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-300)}`))));
});

/* Loop a still photo into a clip of `seconds`, at the film's size and
   fps. The picture is scaled to cover the frame (never stretched), so
   a portrait photo fills a portrait film and a landscape photo is
   cropped, not squeezed. The clip is static — the recipe's camera move
   is what moves it — so it re-encodes cheaply. */
export async function stillToClip({ input, output, width, height, fps, seconds }) {
  await runFfmpeg(["-hide_banner", "-y", "-nostdin", "-loop", "1", "-framerate", String(fps), "-i", input,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,format=yuv420p`,
    "-t", seconds.toFixed(3), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "10", "-pix_fmt", "yuv420p", "-r", String(fps), output]);
  return output;
}

/* Replace any still-photo inputs with looped clips of the length the
   recipe needs, and return the files and durations the planner uses.
   A slot's loop length is the longest its scenes need: a ramped scene
   needs rampSourceSeconds, an unramped scene its own duration. A white
   flash continues the previous scene's footage, so its duration is
   added to that scene's slot as well. Video inputs pass through
   untouched. */
export async function prepareTemplateInputs({ recipe, files, durations, width, height, fps, dir }) {
  const parsed = recipe._width ? recipe : parseTemplateRecipe(recipe);
  const slotIndex = new Map(parsed.inputs.map((input, i) => [input.slot, i]));
  const need = parsed.inputs.map(() => 0);
  for (let i = 0; i < parsed.scenes.length; i += 1) {
    const scene = parsed.scenes[i];
    if (scene.type === "white_flash") {
      const prev = parsed.scenes[i - 1];
      if (prev) need[slotIndex.get(prev.input)] += scene.duration_s;
      continue;
    }
    const slot = slotIndex.get(scene.input);
    const ramp = (parsed.speed_ramps || []).find((item) => item.scene === scene.id && Array.isArray(item.points));
    // At least the scene's own duration (see planTemplateScenes: the
    // white-flash continuation starts at start + duration_s), and the
    // ramp's source need when that is longer.
    const seconds = ramp ? Math.max(rampSourceSeconds(ramp.points, scene.duration_s), scene.duration_s) : scene.duration_s;
    need[slot] = Math.max(need[slot], seconds);
  }
  const outFiles = [...files], outDurations = [...durations];
  for (let i = 0; i < files.length; i += 1) {
    if (!isStillImage(files[i])) continue;
    const seconds = round(need[i] + 0.3, 3);
    const output = path.join(dir, `still-${String(i + 1).padStart(2, "0")}.mp4`);
    await stillToClip({ input: files[i], output, width, height, fps, seconds });
    outFiles[i] = output;
    outDurations[i] = seconds;
  }
  return { files: outFiles, durations: outDurations };
}

/* ---------- drawing one scene ---------- */

const escText = (text) => String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%");

/* The camera move for one scene, as a filter chain on the label `src`
   that ends at label `moved`. `d` is the scene's length, `t` is the
   time inside the scene (0 at its first frame). All moves run at
   constant speed unless the scene has a ramp (handled before this). */
function moveChain({ move, amount, d, fps, width, height, src }) {
  const W = width, H = height;
  const total = Math.max(2, Math.round(d * fps));
  if (move === "static") {
    return [`[${src}]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,format=yuv420p[moved]`];
  }
  if (move === "push_in") {
    // zoompan, at double size so the zoom stays smooth to the pixel.
    const z = `1+${(amount - 1).toFixed(4)}*on/${total - 1}`;
    return [
      `[${src}]fps=${fps},scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W * 2}:${H * 2},`
      + `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W * 2}x${H * 2}:fps=${fps},scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[moved]`,
    ];
  }
  if (move === "whip_in_then_push_in") {
    // Fast zoom out of the whip (first 0.25 s), then the slow push-in.
    // The blur trail at the cut itself comes from the whip_blur join.
    const fast = 0.25, z0 = 1.22;
    const z = `if(lt(t,${fast}),${z0}-(${(z0 - 1).toFixed(3)})*(t/${fast}),1+${(amount - 1).toFixed(4)}*((t-${fast})/${(d - fast).toFixed(3)}))`;
    return [
      `[${src}]fps=${fps},scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W * 2}:${H * 2},`
      + `scale=w='${W * 2}*${z}':h='${H * 2}*${z}':eval=frame:flags=bilinear,`
      + `crop=${W * 2}:${H * 2}:x='(in_w-${W * 2})/2':y='(in_h-${H * 2})/2',scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[moved]`,
    ];
  }
  // glide, glide_lateral, tilt_down_glide: a slow animated crop over a
  // slightly enlarged picture (the recipeChain pattern, proven in the
  // WrenCut path). The zoom stays fixed so the frame never shows an edge.
  const zoom = 1.06;
  const u = `(t/${d.toFixed(3)})`;
  const x = move === "tilt_down_glide" ? `(in_w-${W * 2})*0.25*${u}` : `(in_w-${W * 2})*${u}`;
  const y = move === "tilt_down_glide" ? `(in_h-${H * 2})*${u}` : `(in_h-${H * 2})/2`;
  return [
    `[${src}]fps=${fps},scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W * 2}:${H * 2},`
    + `scale=w='${W * 2}*${zoom}':h='${H * 2}*${zoom}':eval=frame:flags=bilinear,`
    + `crop=${W * 2}:${H * 2}:x='${x}':y='${y}',scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[moved]`,
  ];
}

/* One scene as its own file, at its exact length. The caller passes the
   scene's source clip (a video file) and, for a call-banner scene, the
   banner PNG made by makeCallBanner. Returns the full ffmpeg argv, in
   the same shape as wrencut's shotArgs. */
export function templateShotArgs({ recipe, scene, input, output, width, height, fps, start, bannerFile, lutDir, available }) {
  const parsed = recipe._width ? recipe : parseTemplateRecipe(recipe);
  const d = scene.duration_s;
  const filters = [];
  const ramp = (parsed.speed_ramps || []).find((item) => item.scene === scene.id && Array.isArray(item.points));
  let src = "0:v";
  if (ramp) {
    // The ramp re-times the scene's own motion AND the recipe's camera
    // move together: the move runs first, over the source seconds the
    // ramp consumes, and the ramp then re-times the moved picture. A
    // still photo's push-in therefore whips and settles with the ramp
    // instead of gliding at constant speed. A ramp that cannot be
    // executed fails loudly here — rampHead would otherwise scale it
    // down silently, so it is called without `avail`.
    if (!Number.isFinite(available)) fail(`scene "${scene.id}" has a speed ramp but the clip's available length was not given — the ramp cannot be checked.`);
    const needed = rampNeeds(ramp.points, d, available, scene.id);
    const sampled = sampleRampCurve(ramp.points);
    filters.push(`[0:v]trim=start=${start.toFixed(3)}:duration=${(needed + 0.1).toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1[src]`);
    filters.push(...moveChain({ move: scene.camera.move, amount: scene.camera.amount || 1.06, d: needed, fps, width, height, src: "src" }));
    const built = rampHead({ index: 0, speed: sampled, d, start: 0, fps, strength: 1, src: "moved" });
    filters.push(...built.lines);
    src = built.label;
    filters.push(`[${src}]trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[ramped]`);
    src = "ramped";
  } else {
    filters.push(`[0:v]trim=start=${start.toFixed(3)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=3,trim=duration=${d.toFixed(3)},setpts=PTS-STARTPTS[src]`);
    src = "src";
  }
  if (scene.type === "white_flash") {
    // The previous scene's footage continues, fading to white with its
    // peak at peak_s — so the last caption stays faintly visible
    // through the start of the flash, as in the reference.
    const peakOff = round(scene.peak_s - scene.start_s, 3);
    filters.push(`[${src}]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},fade=t=out:st=0:d=${peakOff.toFixed(3)}:color=white,setsar=1,format=yuv420p[flashed]`);
    return ["-hide_banner", "-y", "-nostdin", "-i", input, "-filter_complex", filters.join(";"), "-map", "[flashed]", "-t", d.toFixed(3), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "10", "-pix_fmt", "yuv420p", "-r", String(fps), output];
  }
  // A ramped scene already had its move applied before the ramp (above);
  // every other scene gets its move here. A ramped scene's picture is
  // at [ramped] now, not [moved].
  if (src !== "ramped") filters.push(...moveChain({ move: scene.camera.move, amount: scene.camera.amount || 1.06, d, fps, width, height, src }));
  let last = src === "ramped" ? "ramped" : "moved";
  // The grade: the scene's own grade, unless this scene (by id or input
  // slot) is in night_slots — then it is the night grade instead. A
  // night slot is a grade only: the same photo, the same move, the same
  // timing; the house does not change at all, only the light and colour.
  // No AI re-render, so nothing in the picture can drift.
  const night = (parsed.night_slots || []).includes(scene.id) || (parsed.night_slots || []).includes(scene.input);
  const gradeName = night ? "night_warm_windows" : scene.grade;
  if (gradeName) {
    const grade = GRADE_TABLE[gradeName];
    const lut = path.join(lutDir || LUT_DIR, grade.lut);
    if (!fs.existsSync(lut)) fail(`grade "${gradeName}" needs its LUT file (${lut}), which is missing.`);
    filters.push(`[${last}]eq=${grade.eq},lut3d=file='${lut}'[graded]`);
    last = "graded";
  }
  // Captions: bold white caps, centred, with the recipe's exact text and
  // timing. A caption's on-screen window ends at fade_out[1] when a fade
  // is given (so the fade completes instead of cutting off mid-fade),
  // otherwise at end_s. All times are scene-relative here.
  for (const caption of scene.captions || []) {
    const startRel = round(caption.start_s - scene.start_s, 3);
    const endRel = round((caption.fade_out_s ? caption.fade_out_s[1] : caption.end_s) - scene.start_s, 3);
    const fontSize = Math.max(20, Math.round(height * 0.055));
    const alpha = caption.fade_out_s
      ? `'if(lt(t,${round(caption.fade_out_s[0] - scene.start_s, 3)}),1,if(lt(t,${round(caption.fade_out_s[1] - scene.start_s, 3)}),(${round(caption.fade_out_s[1] - scene.start_s, 3)}-t)/${round(caption.fade_out_s[1] - caption.fade_out_s[0], 3)},0))'`
      : "'1'";
    filters.push(`[${last}]drawtext=text='${escText(caption.text)}':fontfile=${BOLD_SANS()}:fontsize=${fontSize}:fontcolor=white:borderw=2:bordercolor=black@0.35:x=(w-text_w)/2:y=(h-text_h)*0.42:alpha=${alpha}:enable='between(t,${startRel},${endRel})'[cap${filters.length}]`);
    last = `cap${filters.length - 1}`;
  }
  // The call banner slides in at the top, holds, and slides out, on the
  // recipe's windows. Outside its window it sits off-screen above the
  // frame, so the slide is a real slide, not a pop.
  const args = ["-hide_banner", "-y", "-nostdin", "-i", input];
  if (scene.overlay?.type === "call_banner") {
    if (!bannerFile) fail(`scene "${scene.id}" has a call banner but no banner image was made.`);
    const banner = scene.overlay;
    const inRel = [round(banner.slide_in_s[0] - scene.start_s, 3), round(banner.slide_in_s[1] - scene.start_s, 3)];
    const holdRel = [round(banner.visible_s[0] - scene.start_s, 3), round(banner.visible_s[1] - scene.start_s, 3)];
    const outRel = [round(banner.slide_out_s[0] - scene.start_s, 3), round(banner.slide_out_s[1] - scene.start_s, 3)];
    const targetY = Math.round(height * 0.05);
    const y = `'if(lt(t,${inRel[0]}),-h,if(lt(t,${inRel[1]}),-h+(h+${targetY})*(t-${inRel[0]})/${(inRel[1] - inRel[0]).toFixed(3)},if(lt(t,${holdRel[1]}),${targetY},if(lt(t,${outRel[1]}),${targetY}+(-h-${targetY})*(t-${outRel[0]})/${(outRel[1] - outRel[0]).toFixed(3)},-h))))'`;
    args.push("-loop", "1", "-framerate", String(fps), "-t", d.toFixed(3), "-i", bannerFile);
    filters.push(`[${last}][1:v]overlay=x='(W-w)/2':y=${y}:enable='between(t,${inRel[0]},${outRel[1]})'[bannered]`);
    last = "bannered";
  }
  filters.push(`[${last}]setsar=1,format=yuv420p[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-t", d.toFixed(3), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "10", "-pix_fmt", "yuv420p", "-r", String(fps), output);
  return args;
}

/* ---------- the call banner ---------- */

/* The incoming-call card as a PNG: a dark card, a red decline dot on
   the left, the title over the subtitle in the middle, a green accept
   dot on the right. Drawn once per job from the recipe's words, with
   the system's own fonts — no copied graphic. */
export async function makeCallBanner({ title, subtitle, width, height, dir }) {
  const bw = Math.round(width * 0.78);
  const bh = Math.max(90, Math.round(height * 0.11));
  const out = path.join(dir, "call-banner.png");
  const titleSize = Math.round(bh * 0.30);
  const subSize = Math.round(bh * 0.20);
  const dotSize = Math.round(bh * 0.36);
  const run = (args) => new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`banner failed (${code}): ${err.slice(-300)}`))));
  });
  await run(["-hide_banner", "-y", "-nostdin", "-f", "lavfi", "-i", `color=c=0x1c1c1e:s=${bw}x${bh}:r=30:d=0.2`,
    "-vf",
    `drawtext=text='●':fontfile=${DOTS_SANS()}:fontsize=${dotSize}:fontcolor=0xFF3B30:x=36:y=(h-text_h)/2,`
    + `drawtext=text='${escText(title)}':fontfile=${BOLD_SANS()}:fontsize=${titleSize}:fontcolor=white:x=110:y=(h-text_h)/2-${Math.round(subSize * 0.7)},`
    + `drawtext=text='${escText(subtitle)}':fontfile=${REGULAR_SANS()}:fontsize=${subSize}:fontcolor=0xAEAEB2:x=110:y=(h-text_h)/2+${Math.round(titleSize * 0.7)},`
    + `drawtext=text='●':fontfile=${DOTS_SANS()}:fontsize=${dotSize}:fontcolor=0x34C759:x=w-36-text_w:y=(h-text_h)/2`,
    "-frames:v", "1", out]);
  return out;
}

/* ---------- the join ---------- */

/* A blurred whip edge: the last (or first) slice of a scene, scaled up
   fast and smeared across neighbouring frames. Returns the filter lines
   and the label of the blurred slice. */
function whipEdge({ input, dur, width, height, fps, fromStart, out }) {
  const edge = WHIP_WINDOW_S / 2;
  const range = fromStart ? `trim=start=0:duration=${edge.toFixed(3)}` : `trim=start=${(dur - edge).toFixed(3)}:duration=${edge.toFixed(3)}`;
  // Scale up through the edge (leaving) or down into it (entering).
  const zoom = fromStart ? `1.18-0.18*(t/${edge.toFixed(3)})` : `1+0.18*(t/${edge.toFixed(3)})`;
  // tmix smears the frames into a trail, but it needs several frames to
  // build up and the edge is only a few frames long — so the edge also
  // gets a real spatial blur, or the first frames of the whip stay sharp.
  const sigma = Math.max(3, Math.round(width * 0.01));
  return {
    lines: [
      `[${input}]${range},setpts=PTS-STARTPTS,fps=${fps},scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width * 2}:${height * 2},`
      + `scale=w='${width * 2}*${zoom}':h='${height * 2}*${zoom}':eval=frame:flags=bilinear,crop=${width * 2}:${height * 2},`
      + `tmix=frames=5:weights='1 1 1 1 1',gblur=sigma=${sigma},scale=${width}:${height}:flags=lanczos,setsar=1,format=yuv420p[${out}]`,
    ],
    label: out,
  };
}

/* The finished film from the rendered scene files. The recipe is the
   edit: no fade in/out, no sharpening, no extra grade is added here —
   every look is already in the scene files. Music ducks under a
   voiceover with a true sidechain compressor; without a voiceover the
   music simply plays. Returns the full ffmpeg argv. */
export function templateEditArgs({ recipe, sceneFiles, music, voiceover, width, height, fps, duration, output, musicVolume }) {
  const parsed = recipe._width ? recipe : parseTemplateRecipe(recipe);
  if (!Array.isArray(sceneFiles) || sceneFiles.length !== parsed.scenes.length) {
    fail(`the join needs one file per scene (${parsed.scenes.length}), got ${sceneFiles?.length ?? 0}.`);
  }
  const filters = [];
  const parts = [];
  const edge = WHIP_WINDOW_S / 2;
  // Each scene contributes its main body plus, at a whip boundary, a
  // blurred edge. A crossfade boundary is a true dissolve: the two
  // scenes give up CROSSFADE_S/2 each and the overlap is crossfaded.
  const headCut = parsed.scenes.map((scene) => {
    if (scene.transition_in === "whip_blur") return edge;
    if (scene.transition_in === "crossfade") return CROSSFADE_S;
    return 0;
  });
  const tailCut = parsed.scenes.map((scene, i) => {
    const next = parsed.scenes[i + 1];
    if (!next) return 0;
    if (next.transition_in === "whip_blur") return edge;
    if (next.transition_in === "crossfade") return CROSSFADE_S;
    return 0;
  });
  parsed.scenes.forEach((scene, i) => {
    filters.push(`[${i}:v]trim=duration=${scene.duration_s.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps},setsar=1,format=yuv420p[s${i}]`);
  });
  // A scene's stream can feed several segments: its main body, a whip edge,
  // and/or a dissolve half. A filter label may only feed ONE filter — reusing
  // it silently routes the wrong frames (a whip join once showed the first
  // scene's footage in the last scene's slot). Split any stream read more
  // than once, the same way wrencut splits its slices.
  const srcOf = parsed.scenes.map((scene, i) => {
    const d = scene.duration_s;
    const keys = [];
    if (scene.transition_in === "crossfade" && i > 0) keys.push("xb");
    if (scene.transition_in === "whip_blur") keys.push("ws");
    if (d - tailCut[i] > headCut[i] + 0.01) keys.push("m");
    if (parsed.scenes[i + 1]?.transition_in === "whip_blur") keys.push("we");
    if (parsed.scenes[i + 1]?.transition_in === "crossfade") keys.push("xa");
    if (keys.length === 0) fail(`scene ${i + 1} contributes no segment (duration ${d}s is all edge).`);
    const map = {};
    if (keys.length > 1) {
      filters.push(`[s${i}]split=${keys.length}${keys.map((_, k) => `[s${i}c${k}]`).join("")}`);
      keys.forEach((key, k) => { map[key] = `s${i}c${k}`; });
    } else {
      map[keys[0]] = `s${i}`;
    }
    return map;
  });
  const seg = (label) => { parts.push(`[${label}]`); };
  parsed.scenes.forEach((scene, i) => {
    const d = scene.duration_s;
    const mainStart = headCut[i], mainEnd = d - tailCut[i];
    if (scene.transition_in === "crossfade" && i > 0) {
      // The dissolve between the previous scene's tail and this head:
      // CROSSFADE_S of each, crossfaded over CROSSFADE_S.
      const prev = parsed.scenes[i - 1];
      filters.push(`[${srcOf[i - 1].xa}]trim=start=${(prev.duration_s - CROSSFADE_S).toFixed(3)}:duration=${CROSSFADE_S.toFixed(3)},setpts=PTS-STARTPTS[xa${i}]`);
      filters.push(`[${srcOf[i].xb}]trim=start=0:duration=${CROSSFADE_S.toFixed(3)},setpts=PTS-STARTPTS[xb${i}]`);
      filters.push(`[xa${i}][xb${i}]xfade=transition=fade:duration=${CROSSFADE_S.toFixed(3)}:offset=0[xf${i}]`);
      seg(`xf${i}`);
    }
    if (headCut[i] > 0 && scene.transition_in === "whip_blur") {
      const built = whipEdge({ input: srcOf[i].ws, dur: d, width, height, fps, fromStart: true, out: `ws${i}` });
      filters.push(...built.lines);
      seg(built.label);
    }
    if (mainEnd > mainStart + 0.01) {
      filters.push(`[${srcOf[i].m}]trim=start=${mainStart.toFixed(3)}:end=${mainEnd.toFixed(3)},setpts=PTS-STARTPTS[m${i}]`);
      seg(`m${i}`);
    }
    if (tailCut[i] > 0 && parsed.scenes[i + 1]?.transition_in === "whip_blur") {
      const built = whipEdge({ input: srcOf[i].we, dur: d, width, height, fps, fromStart: false, out: `we${i}` });
      filters.push(...built.lines);
      seg(built.label);
    }
  });
  filters.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=0[joined]`);
  filters.push(`[joined]trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[vout]`);
  const args = ["-hide_banner", "-y", "-nostdin"];
  sceneFiles.forEach((file) => args.push("-i", file));
  const musicIndex = music ? sceneFiles.length : -1;
  if (music) args.push("-i", music);
  const voiceIndex = voiceover ? sceneFiles.length + (music ? 1 : 0) : -1;
  if (voiceover) args.push("-i", voiceover);
  const tail = Math.min(1, duration / 4);
  if (music && voiceover) {
    // Each source is levelled on its own BEFORE the mix: a loudnorm after
    // the mix would fight the ducking and level the windows back out.
    // And each chain ends with apad+atrim AFTER loudnorm: loudnorm's end of
    // stream reaches the compressor early and starves it (its output stopped
    // at ~1.1s of a 4s film, the music never coming back), and the pad after
    // it re-establishes the stream so the compressor sees the full length.
    filters.push(`[${musicIndex}:a]aresample=48000,apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=${(duration - tail).toFixed(3)}:d=${tail.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=duration=${duration.toFixed(3)}[mus]`);
    filters.push(`[${voiceIndex}:a]aresample=48000,apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=${(duration - tail).toFixed(3)}:d=${tail.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,apad,atrim=duration=${duration.toFixed(3)}[vo]`);
    // A label feeds one filter only: split the voice so one copy drives the
    // compressor's sidechain and the other is mixed into the output.
    filters.push("[vo]asplit=2[vo_sc][vo_mix]");
    filters.push(`[mus][vo_sc]${DUCK_FILTER}[ducked]`);
    filters.push("[ducked][vo_mix]amix=inputs=2:normalize=0,aresample=48000[aout]");
  } else if (music) {
    filters.push(`[${musicIndex}:a]aresample=48000,apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=${(duration - tail).toFixed(3)}:d=${tail.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
  } else if (voiceover) {
    filters.push(`[${voiceIndex}:a]aresample=48000,apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.5,afade=t=out:st=${(duration - tail).toFixed(3)}:d=${tail.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
  }
  void musicVolume; // the ducking is the level control when a voiceover is present; without one the music plays as made
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]");
  if (music || voiceover) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000");
  else args.push("-an");
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "17", "-tune", "film", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", String(fps), "-g", String(fps * 2), "-movflags", "+faststart", "-t", duration.toFixed(3), output);
  return args;
}

/* ---------- the mechanical QC for a rendered template film ---------- */

function runCapture(command, args, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} took too long.`)); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(`${command} failed (${code}): ${err.slice(-300)}`)); });
  });
}
async function probeFile(file) {
  const stdout = await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,duration", "-of", "json", file]);
  const data = JSON.parse(stdout);
  const video = (data.streams || []).find((s) => s.codec_type === "video");
  const audio = (data.streams || []).filter((s) => s.codec_type === "audio");
  const [num, den] = String(video?.r_frame_rate || "0/1").split("/").map(Number);
  return { duration: Number(data.format?.duration) || 0, videoDuration: Number(video?.duration) || 0, width: video?.width || 0, height: video?.height || 0, fps: den ? num / den : 0, audioStreams: audio.length };
}
async function frameLuma(file, t) {
  const out = await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=64:64:flags=area,format=gray", "-f", "rawvideo", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("frame read failed"))));
  });
  if (out.length < 64 * 64) return 0;
  let sum = 0;
  for (let i = 0; i < 64 * 64; i += 1) sum += out[i];
  return sum / (64 * 64);
}

/* Checks the finished film against the recipe: length, size, frame rate,
   sound, and no black frames at the start or end. Only reports — it
   never throws, and it never fails the film on its own. */
export async function templateQualityCheck(file, { recipe, width, height, fps }) {
  const checks = [];
  const check = (id, pass, detail) => checks.push({ id, pass, detail });
  try {
    const parsed = recipe._width ? recipe : parseTemplateRecipe(recipe);
    const info = await probeFile(file);
    check("duration", Math.abs(info.duration - parsed.duration_s) <= 0.1, `${round(info.duration, 3)}s vs ${parsed.duration_s}s`);
    check("resolution", info.width === width && info.height === height, `${info.width}x${info.height} vs ${width}x${height}`);
    check("fps", Math.abs(info.fps - fps) < 0.5, `${round(info.fps, 2)} vs ${fps}`);
    check("audio", info.audioStreams >= 1, `${info.audioStreams} audio stream(s)`);
    const first = await frameLuma(file, 0.05);
    const last = await frameLuma(file, Math.max(0.05, parsed.duration_s - 0.05));
    check("no-black-start", first > 10, `first frame mean luma ${round(first, 1)}`);
    check("no-black-end", last > 10, `last frame mean luma ${round(last, 1)}`);
  } catch (error) {
    return { status: "error", checks, error: String(error?.message || error).slice(0, 300), checkedAt: Date.now() };
  }
  const failed = checks.filter((c) => !c.pass);
  return { status: failed.length ? "fail" : "pass", checks, checkedAt: Date.now() };
}

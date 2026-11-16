/* Template recipes (spec v1) on the real ffmpeg: the reader refuses bad
   recipes loudly, the shot and join graphs carry the recipe's exact
   text/timing/grade/transitions, and a small render comes out at the
   right length with a visibly blurred whip and a working speed ramp. */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseTemplateRecipe, planTemplateScenes, templateDuration, templateShotArgs,
  templateEditArgs, templateQualityCheck, makeCallBanner, sampleRampCurve,
  isStillImage, prepareTemplateInputs, rampSourceSeconds, stillToClip,
  snapRecipeToBeatGrid,
} from "../../composer/template-recipe.mjs";
import { sampleFrames, sharpness } from "../../composer/qc.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "template-recipe-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const dur = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
const throws = (fn) => { try { fn(); return ""; } catch (error) { return String(error?.message || error); } };

const recipeJson = fs.readFileSync(new URL("../../composer/templates/house-calling-v1.json", import.meta.url), "utf8");
const recipe = parseTemplateRecipe(recipeJson);
check("house-calling-v1 parses", recipe.template_id === "house-calling-v1" && recipe.scenes.length === 8, `${recipe.scenes.length} scenes`);
check("the film is 14.5s", Math.abs(templateDuration(recipe) - 14.5) < 0.001, `${templateDuration(recipe)}s`);

const bad = (mutate, label) => {
  const copy = JSON.parse(recipeJson);
  mutate(copy);
  const error = throws(() => parseTemplateRecipe(copy));
  check(`reader refuses: ${label}`, error.startsWith("Template recipe:"), error.slice(0, 120));
};
bad((r) => { r.scenes[0].camera.move = "dolly_zoom"; }, "unknown camera move");
bad((r) => { r.scenes[2].transition_in = "morph"; }, "unknown transition");
bad((r) => { r.scenes[3].start_s = 6.5; }, "scene gap");
bad((r) => { r.scenes[0].grade = "teal_orange"; }, "unknown grade");
bad((r) => { r.scenes[0].captions[0].style = "fancy_script"; }, "caption style not defined");
bad((r) => { r.text_styles.neon = { font: "neon", size: "large" }; r.scenes[0].captions[0].style = "neon"; }, "caption style the composer cannot draw");
bad((r) => { r.scenes[1].transition_in = "white_flash"; }, "white_flash transition is refused");
bad((r) => { r.scenes[1].type = "white_flash"; }, "white_flash scene is refused");
bad((r) => { r.duration_s = 15.5; }, "duration mismatch");
bad((r) => { r.speed_ramps = [{ scene: "S1", points: [[0, 0.5], [0.5, 9], [1, 1]] }]; }, "ramp speed out of range");
bad((r) => { r.scenes[5].duration_s = 0.4; r.scenes[5].transition_in = "crossfade"; }, "scene too short for its dissolve");
bad((r) => { r.scenes[0].captions[0].text = ""; }, "empty caption");
bad((r) => { r.recipe_version = "2.0"; }, "wrong recipe version");

/* Planning: 7 clips feed 8 scenes; the night exterior serves twice (S2 and S4). */
const picks = planTemplateScenes(recipe, [6, 6, 6, 6, 6, 6, 6]);
check("scenes map to their slots in order", picks.map((p) => p.clip).join(",") === "0,1,2,1,3,4,5,6", picks.map((p) => p.clip).join(","));
check("a shared clip gives each scene a different moment", picks[1].start === 0 && picks[3].start > 0, `S2@${picks[1].start}s, S4@${picks[3].start}s`);
check("the recipe has no white flash (standing rule)", recipe.scenes.every((scene) => scene.type !== "white_flash" && scene.transition_in !== "white_flash"), "no white_flash scene or transition");
check("a short clip fails loudly instead of stretching", throws(() => planTemplateScenes(recipe, [6, 6, 6, 6, 6, 6, 0.5])).startsWith("Template recipe:"), "living clip 0.5s");

/* Ramps: bezier easing honours the endpoints and stays smooth. */
const curve = sampleRampCurve([[0, 0.5], [0.5, 1], [1, 2.5]]);
check("a ramp curve honours its endpoints", curve[0][1] === 0.5 && curve[curve.length - 1][1] === 2.5, JSON.stringify([curve[0], curve[curve.length - 1]]));
check("a ramp curve is smooth (no jumps)", curve.every((p, i) => i === 0 || Math.abs(p[1] - curve[i - 1][1]) < 0.35), `max step ${Math.max(...curve.slice(1).map((p, i) => Math.abs(p[1] - curve[i][1]))).toFixed(2)}`);

/* Graphs: the recipe's exact words, times, grades and moves are in them. */
const banner = await makeCallBanner({ title: "The Perfect House", subtitle: "Mobile", width: 360, height: 640, dir });
check("the call banner is a real image", fs.existsSync(banner) && fs.statSync(banner).size > 2000, `${fs.statSync(banner).size} bytes`);
const s1 = templateShotArgs({ recipe, scene: recipe.scenes[0], input: "in.mp4", output: "out.mp4", width: 360, height: 640, fps: 30, start: 0, bannerFile: banner });
const s1Graph = s1.join(" ");
check("S1 carries the exact caption text and window", s1Graph.includes("THIS HOUSE") && s1Graph.includes("between(t,0,2.7)") && s1Graph.includes("CALLING") && s1Graph.includes("GOTCHA!"), "THIS HOUSE 0-2.7, CALLING, GOTCHA!");
check("S1 carries its grade LUT", s1Graph.includes("bright-warm-day.cube") && s1Graph.includes("lut3d"), "lut3d bright-warm-day");
check("a push-in uses zoompan", s1Graph.includes("zoompan"), "zoompan in S1");
const s5 = templateShotArgs({ recipe, scene: recipe.scenes[4], input: "in.mp4", output: "out.mp4", width: 360, height: 640, fps: 30, start: 0, available: 6 });
check("a tilt-down uses an animated crop", s5.join(" ").includes("crop=720:1280"), "animated crop in S5");
// Timing-only: a ramped scene rendered for speed measurement carries no blur — tmix is a trailing
// average, so it delays the picture and reads as the ramp playing slow. The blur is verified
// separately, from a detailed still.
const s5Timed = templateShotArgs({ recipe, scene: recipe.scenes[4], input: "in.mp4", output: "out.mp4", width: 360, height: 640, fps: 30, start: 0, available: 6, timingOnly: true });
check("a timing-only ramp carries no tmix or minterpolate", !s5Timed.join(" ").includes("tmix") && !s5Timed.join(" ").includes("minterpolate"), "no blur filters");
check("a normal ramp still carries its blur", s5.join(" ").includes("tmix") || s5.join(" ").includes("minterpolate"), "blur present");
const join = templateEditArgs({ recipe, sceneFiles: recipe.scenes.map((_, i) => `scene-${i}.mp4`), width: 360, height: 640, fps: 30, duration: 14.5, output: "film.mp4" });
check("the join has the whip blur, not a hard cut", join.join(" ").includes("tmix=frames=5") && join.join(" ").includes("concat"), "tmix + concat");
const joinVo = templateEditArgs({ recipe, sceneFiles: recipe.scenes.map((_, i) => `scene-${i}.mp4`), music: "music.mp3", voiceover: "vo.mp3", width: 360, height: 640, fps: 30, duration: 14.5, output: "film.mp4" });
check("music ducks under a voiceover (sidechain)", joinVo.join(" ").includes("sidechaincompress"), "sidechaincompress");
const joinNoVo = templateEditArgs({ recipe, sceneFiles: recipe.scenes.map((_, i) => `scene-${i}.mp4`), music: "music.mp3", width: 360, height: 640, fps: 30, duration: 14.5, output: "film.mp4" });
check("no voiceover, no ducking", !joinNoVo.join(" ").includes("sidechaincompress"), "music only");
check("the join cuts to the exact length", join.join(" ").includes("-t 14.500"), "-t 14.500");
// A filter label may only feed one filter: reusing one silently routes the
// wrong frames (a whip join once showed the first scene's footage in the
// last scene's slot). Every label in the graph must be consumed at most
// once; a stream read twice must go through an explicit split.
const labelUses = (args) => {
  const uses = {};
  for (const chunk of args[args.indexOf("-filter_complex") + 1].split(";")) {
    const head = chunk.match(/^((?:\[[^\]]+\])+)/)?.[1] ?? "";
    for (const label of head.matchAll(/\[([^\]]+)\]/g)) uses[label[1]] = (uses[label[1]] || 0) + 1;
  }
  return uses;
};
const reused = (args) => Object.entries(labelUses(args)).filter(([, n]) => n > 1).map(([label]) => label);
check("every join-graph label feeds exactly one filter", reused(join).length === 0, reused(join).join(",") || "no label reused");
check("the same holds with music and voiceover", reused(joinVo).length === 0, reused(joinVo).join(",") || "no label reused");
const fadeRecipe = parseTemplateRecipe({
  recipe_version: "1.0", template_id: "fade-test", name: "Fade test", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 1.5,
  inputs: [{ slot: "a", type: "image_or_video", required: true }, { slot: "b", type: "image_or_video", required: true }],
  scenes: [
    { id: "A", start_s: 0, duration_s: 1, input: "a", camera: { move: "static" }, transition_in: "open" },
    { id: "B", start_s: 1, duration_s: 1, input: "b", camera: { move: "static" }, transition_in: "crossfade" },
  ],
  text_styles: {}, grades: {},
});
const fadeJoin = templateEditArgs({ recipe: fadeRecipe, sceneFiles: ["a.mp4", "b.mp4"], width: 360, height: 640, fps: 30, duration: 1.5, output: "film.mp4" });
check("a crossfade join also splits its shared streams", fadeJoin.join(" ").includes("split=2") && reused(fadeJoin).length === 0, reused(fadeJoin).join(",") || "split=2, no label reused");

/* Real renders, small: detailed moving clips so blur and motion are measurable. */
const clip = path.join(dir, "clip.mp4");
ff(["-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", clip]);
const W = 360, H = 640, FPS = 30;
const s1Out = path.join(dir, "s1.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe, scene: recipe.scenes[0], input: clip, output: s1Out, width: W, height: H, fps: FPS, start: 0, bannerFile: banner })]);
check("S1 renders to its 5.0s", Math.abs(dur(s1Out) - 5) < 0.15, `${dur(s1Out).toFixed(2)}s`);
// The old white flash is gone: S2 now enters by hard cut from the night exterior.
const s2Out = path.join(dir, "s2.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe, scene: recipe.scenes[1], input: clip, output: s2Out, width: W, height: H, fps: FPS, start: 0 })]);
check("S2 renders to its 1.0s", Math.abs(dur(s2Out) - 1.0) < 0.1, `${dur(s2Out).toFixed(2)}s`);
// Whip: two 1s scenes joined with a whip_blur — the boundary frame must be blurred, the neighbours sharp.
const whipRecipe = parseTemplateRecipe({
  recipe_version: "1.0", template_id: "whip-test", name: "Whip test", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 2,
  inputs: [{ slot: "a", type: "image_or_video", required: true }, { slot: "b", type: "image_or_video", required: true }],
  scenes: [
    { id: "A", start_s: 0, duration_s: 1, input: "a", camera: { move: "static" }, transition_in: "open" },
    { id: "B", start_s: 1, duration_s: 1, input: "b", camera: { move: "static" }, transition_in: "whip_blur" },
  ],
  text_styles: {}, grades: {},
});
const whipPicks = planTemplateScenes(whipRecipe, [4, 4]);
const whipFiles = [];
for (let i = 0; i < 2; i += 1) {
  const out = path.join(dir, `whip-${i}.mp4`);
  ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe: whipRecipe, scene: whipRecipe.scenes[i], input: clip, output: out, width: W, height: H, fps: FPS, start: whipPicks[i].start })]);
  whipFiles.push(out);
}
const whipFilm = path.join(dir, "whip-film.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateEditArgs({ recipe: whipRecipe, sceneFiles: whipFiles, width: W, height: H, fps: FPS, duration: 2, output: whipFilm })]);
check("a whip join keeps the 2.0s", Math.abs(dur(whipFilm) - 2) < 0.15, `${dur(whipFilm).toFixed(2)}s`);
{
  const frames = await sampleFrames(whipFilm, { width: 160, height: 90, fps: 30 });
  const at = (t) => { const f = frames[Math.round(t * 30)]; return f ? sharpness(f, 160, 90) : 0; };
  const before = at(0.5), during = at(1.03), after = at(1.6);
  check("the whip frame is heavily blurred, neighbours are not", during < 0.5 * Math.max(before, after, 1), `sharpness ${before.toFixed(1)} → ${during.toFixed(1)} → ${after.toFixed(1)}`);
}
// Ducking, measured on the real film: the music must drop under a loud
// voiceover and come back when the voice goes quiet. The test tones are far
// apart in frequency — music 110 Hz, voice 2000 Hz — and the music is
// measured through a lowpass, which keeps the voice ~30 dB down. (A
// broadband RMS of the mix cannot show ducking, because the loud voice
// itself fills the mix; and lavfi's sine source is amplitude 0.125, so the
// tones need volume 4.0/2.0 to reach 0.5/0.25.) The film is 4s: voice loud
// 0-1s, quiet 1-4s; the quiet window starts at 2.0s, after the 500 ms
// release has fully let go, and ends before the fade-out at 3.0s.
const rmsDb = (file, from, len, pre = "anull") => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-ss", String(from), "-t", String(len), "-af", `${pre},astats=metadata=1:reset=0`, "-f", "null", "-"], { encoding: "utf8" });
  const m = /RMS level dB:\s*(-?[\d.]+)/.exec(r.stderr || "");
  return m ? Number(m[1]) : null;
};
const duckRecipe = parseTemplateRecipe({
  recipe_version: "1.0", template_id: "duck-test", name: "Duck test", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 4,
  inputs: [{ slot: "a", type: "image_or_video", required: true }],
  scenes: [{ id: "A", start_s: 0, duration_s: 4, input: "a", camera: { move: "static" }, transition_in: "open" }],
  text_styles: {}, grades: {},
});
const duckMusic = path.join(dir, "duck-music.mp3");
ff(["-f", "lavfi", "-i", "sine=frequency=110:duration=4", "-af", "volume=2.0", "-c:a", "libmp3lame", "-q:a", "4", duckMusic]);
const duckVo = path.join(dir, "duck-vo.mp3");
ff(["-f", "lavfi", "-i", "sine=frequency=2000:duration=1", "-f", "lavfi", "-i", "sine=frequency=2000:duration=3", "-filter_complex", "[0:a]volume=4.0[a];[1:a]volume=0.16[b];[a][b]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-c:a", "libmp3lame", "-q:a", "4", duckVo]);
const duckScene = path.join(dir, "duck-scene.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe: duckRecipe, scene: duckRecipe.scenes[0], input: clip, output: duckScene, width: W, height: H, fps: FPS, start: 0, available: 8 })]);
const duckFilm = path.join(dir, "duck-film.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateEditArgs({ recipe: duckRecipe, sceneFiles: [duckScene], music: duckMusic, voiceover: duckVo, width: W, height: H, fps: FPS, duration: 4, output: duckFilm })]);
const duckLoud = rmsDb(duckFilm, 0.2, 0.6, "lowpass=f=300");
const duckQuiet = rmsDb(duckFilm, 2.0, 0.9, "lowpass=f=300");
check("ducking is real: music drops under a loud voiceover", duckLoud !== null && duckQuiet !== null && duckQuiet - duckLoud >= 6, `music ${duckQuiet?.toFixed(1) ?? "?"} dB (voice quiet) vs ${duckLoud?.toFixed(1) ?? "?"} dB (voice loud)`);
{
  const duckQc = await templateQualityCheck(duckFilm, { recipe: duckRecipe, width: W, height: H, fps: FPS });
  check("a film with music and voiceover has audio", duckQc.checks.find((c) => c.id === "audio")?.pass === true, duckQc.checks.find((c) => c.id === "audio")?.detail);
}
// Ramp: a 3s scene, slow then fast - it keeps its length and the motion follows the curve.
// The source is a window sweeping across a wide black-to-white gradient
// at constant speed, so each output frame's mean brightness IS its source
// time: the slope of brightness over output time is the playback speed.
// (drawbox cannot move: its position is fixed at configure time, so the
// sweep is a crop with an animated x, which does move per frame.)
const bar = path.join(dir, "bar.mp4");
ff(["-f", "lavfi", "-i", "gradients=s=2880x640:c0=black:c1=white:x0=0:y0=0:x1=2880:y1=0:speed=0:seed=7:d=8", "-vf", "crop=360:640:x='(iw-360)*t/8':y=0", "-c:v", "libx264", "-pix_fmt", "yuv420p", bar]);
const rampRecipe = parseTemplateRecipe({
  recipe_version: "1.0", template_id: "ramp-test", name: "Ramp test", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 3,
  inputs: [{ slot: "a", type: "image_or_video", required: true }],
  scenes: [{ id: "A", start_s: 0, duration_s: 3, input: "a", camera: { move: "static" }, transition_in: "open" }],
  text_styles: {}, grades: {},
  speed_ramps: [{ scene: "A", points: [[0, 0.5], [0.5, 1], [1, 2.5]] }],
});
const rampOut = path.join(dir, "ramp.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe: rampRecipe, scene: rampRecipe.scenes[0], input: bar, output: rampOut, width: W, height: H, fps: FPS, start: 0, available: 8 })]);
check("a ramped scene keeps its 3.0s", Math.abs(dur(rampOut) - 3) < 0.2, `${dur(rampOut).toFixed(2)}s`);
{
  const frames = await sampleFrames(rampOut, { width: 160, height: 90, fps: 10 });
  const mean = (frame) => { let s = 0; for (let i = 0; i < frame.length; i += 1) s += frame[i]; return s / frame.length; };
  const lumas = frames.map((f, i) => ({ t: i / 10, l: mean(f) }));
  const slope = (list) => (list[list.length - 1].l - list[0].l) / Math.max(0.1, list[list.length - 1].t - list[0].t);
  const first = slope(lumas.slice(0, 10)), last = slope(lumas.slice(-10));
  check("a ramped scene moves slowly first, fast last", last > first * 1.3, `brightness slope ${first.toFixed(1)} -> ${last.toFixed(1)} luma/s`);
}
// The mechanical QC passes a good film and fails a short one.
{
  const qcFull = await templateQualityCheck(whipFilm, { recipe: whipRecipe, width: W, height: H, fps: FPS });
  check("QC passes a good film (except audio, which it has none of)", qcFull.checks.filter((c) => c.id !== "audio").every((c) => c.pass), JSON.stringify(qcFull.checks));
  const shortQc = await templateQualityCheck(s1Out, { recipe: whipRecipe, width: W, height: H, fps: FPS });
  check("QC fails a film of the wrong length", shortQc.checks.find((c) => c.id === "duration")?.pass === false, JSON.stringify(shortQc.checks.find((c) => c.id === "duration")));
}

/* v1.1 — ramp source needs, loud failure on a short clip, still inputs. */
check("a constant-speed ramp consumes d+0.2s of source", Math.abs(rampSourceSeconds([[0, 1], [1, 1]], 3) - 3.2) < 0.01, `${rampSourceSeconds([[0, 1], [1, 1]], 3)}s`);
check("a double-speed ramp consumes twice the source", Math.abs(rampSourceSeconds([[0, 2], [1, 2]], 3) - 6.4) < 0.01, `${rampSourceSeconds([[0, 2], [1, 2]], 3)}s`);
check("the tour U-ramp consumes 4.336s for a 3.2s scene", Math.abs(rampSourceSeconds([[0, 2.5], [0.2, 1.0], [0.45, 0.4], [0.7, 0.9], [1, 2.5]], 3.2) - 4.336) < 0.01, `${rampSourceSeconds([[0, 2.5], [0.2, 1.0], [0.45, 0.4], [0.7, 0.9], [1, 2.5]], 3.2)}s`);
{
  const shortRamp = parseTemplateRecipe({
    recipe_version: "1.0", template_id: "short-ramp", name: "Short ramp", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 3.2,
    inputs: [{ slot: "a", type: "image_or_video", required: true }],
    scenes: [{ id: "A", start_s: 0, duration_s: 3.2, input: "a", camera: { move: "glide" }, transition_in: "open" }],
    text_styles: {}, grades: {},
    speed_ramps: [{ scene: "A", points: [[0, 2.5], [0.2, 1.0], [0.45, 0.4], [0.7, 0.9], [1, 2.5]] }],
  });
  // A clip too short for the LENGTH fails on the length; a clip long
  // enough for the length but too short for the ramp's 0.97 margin
  // (need 4.336s, ramp margin needs 4.336/0.97 = 4.47s) fails on the
  // ramp. 4.4s is between the two, so it hits the ramp check.
  const err = throws(() => planTemplateScenes(shortRamp, [4.4]));
  check("a clip too short for its ramp fails loudly", err.includes("for its speed ramp"), err.slice(0, 120));
  check("a clip too short for the scene length also fails loudly", throws(() => planTemplateScenes(shortRamp, [4])).includes("needs 4.336s"), "4s clip");
  check("a long enough clip plans the same ramp", planTemplateScenes(shortRamp, [8])[0].start === 0, "8s clip");
}
// A still photo is a valid template input: it loops into a clip and the
// recipe's camera move is what moves it.
const still = path.join(dir, "still.jpg");
ff(["-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=1", "-frames:v", "1", still]);
check("a JPEG is a still image, a video is not", isStillImage(still) && !isStillImage(clip), `still=${isStillImage(still)} video=${isStillImage(clip)}`);
const stillClip = path.join(dir, "still-clip.mp4");
await stillToClip({ input: still, output: stillClip, width: W, height: H, fps: FPS, seconds: 3.5 });
check("a still loops into a clip of the asked length", Math.abs(dur(stillClip) - 3.5) < 0.15, `${dur(stillClip).toFixed(2)}s`);
{
  const tour = parseTemplateRecipe(fs.readFileSync(new URL("../../composer/templates/tour-flow-v1.json", import.meta.url), "utf8"));
  check("tour-flow-v1 parses: 5 scenes, all ramped", tour.scenes.length === 5 && tour.speed_ramps.length === 5, `${tour.scenes.length} scenes, ${tour.speed_ramps.length} ramps`);
  const files = ["exterior", "foyer", "living", "kitchen", "bedroom"].map(() => still);
  const prepared = await prepareTemplateInputs({ recipe: tour, files, durations: files.map(() => 0), width: W, height: H, fps: FPS, dir });
  check("still inputs loop to the ramp need plus margin", prepared.durations.every((d, i) => Math.abs(d - [4.391, 4.399, 4.399, 4.399, 3.3][i]) < 0.01), prepared.durations.map((d) => d.toFixed(3)).join(","));
  const plan = planTemplateScenes(tour, prepared.durations);
  const stillScene = path.join(dir, "still-scene.mp4");
  ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe: tour, scene: plan[1].scene, input: prepared.files[plan[1].clip], output: stillScene, width: W, height: H, fps: FPS, start: plan[1].start, available: prepared.durations[plan[1].clip] - plan[1].start })]);
  check("a ramped scene renders from a still photo", Math.abs(dur(stillScene) - 3.0) < 0.2, `${dur(stillScene).toFixed(2)}s`);
}
// The ramp's blur, measured without a caption: a caption is drawn after
// the ramp, so its sharp text inflates whole-frame sharpness whenever
// it is on screen and masks the blur. A dedicated no-caption scene with
// the tour U-ramp and a glide, rendered from the detailed testsrc2
// still: the fast entry and exit are smeared, the slow middle sharp.
// Fast = the most-blurred frame across the fast entry and exit (tmix
// needs a few frames to build up, so the very first fast frame is
// sharp); slow = the sharpest frame across the slow middle.
{
  const blurRecipe = parseTemplateRecipe({
    recipe_version: "1.0", template_id: "blur-cal", name: "Blur cal", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 3.2,
    inputs: [{ slot: "a", type: "image_or_video", required: true }],
    scenes: [{ id: "A", start_s: 0, duration_s: 3.2, input: "a", camera: { move: "glide" }, transition_in: "open" }],
    text_styles: {}, grades: {},
    speed_ramps: [{ scene: "A", points: [[0, 2.5], [0.2, 1.0], [0.45, 0.4], [0.7, 0.9], [1, 2.5]] }],
  });
  const need = rampSourceSeconds([[0, 2.5], [0.2, 1.0], [0.45, 0.4], [0.7, 0.9], [1, 2.5]], 3.2) + 0.3;
  const detailClip = path.join(dir, "blur-detail.mp4");
  await stillToClip({ input: still, output: detailClip, width: W, height: H, fps: FPS, seconds: need });
  const blurOut = path.join(dir, "blur-scene.mp4");
  ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe: blurRecipe, scene: blurRecipe.scenes[0], input: detailClip, output: blurOut, width: W, height: H, fps: FPS, start: 0, available: need })]);
  const sFrames = await sampleFrames(blurOut, { width: W, height: H, fps: 30 });
  const sharpAt = (u) => sharpness(sFrames[Math.round(u * 3.2 * 30)], W, H);
  const fastSharp = Math.min(...[0.05, 0.10, 0.15, 0.85, 0.90, 0.95].map(sharpAt));
  const slowSharp = Math.max(...[0.4, 0.5, 0.6].map(sharpAt));
  // >=20% drop is the bar (same as the verifier's blur calibration: a
  // push-in's blur is weaker than a glide's, and a constant-speed
  // scene with no blur reads ~1.0x).
  check("a ramped still is blurred fast and sharp slow", slowSharp > 5 && fastSharp < 0.80 * slowSharp, `sharpness fast ${fastSharp.toFixed(1)} vs slow ${slowSharp.toFixed(1)}`);
}

/* v1.2 — night slots: a day photo rendered as night by grade only.
   The house must not change at all — only light and colour — so the
   grade is the night LUT, never an AI re-render. */
{
  const tourJson = JSON.parse(fs.readFileSync(new URL("../../composer/templates/tour-flow-v1.json", import.meta.url), "utf8"));
  const badNight = (mutate, label) => {
    const copy = JSON.parse(JSON.stringify(tourJson));
    mutate(copy);
    const error = throws(() => parseTemplateRecipe(copy));
    check(`reader refuses: ${label}`, error.startsWith("Template recipe:"), error.slice(0, 120));
  };
  badNight((r) => { r.night_slots = ["attic"]; }, "night slot names an unknown scene");
  badNight((r) => { r.night_slots = "S1"; }, "night_slots must be a list");
  const houseJson = JSON.parse(recipeJson);
  const whiteFlash = (mutate, label) => {
    const copy = JSON.parse(JSON.stringify(houseJson));
    mutate(copy);
    const error = throws(() => parseTemplateRecipe(copy));
    check(`reader refuses: ${label}`, error.startsWith("Template recipe:") && /white.flash/i.test(error), error.slice(0, 120));
  };
  whiteFlash((r) => { r.scenes[1].transition_in = "white_flash"; }, "white_flash transition is refused, naming the rule");
  whiteFlash((r) => { r.scenes[1].type = "white_flash"; }, "white_flash scene is refused, naming the rule");
  // The graph: a night-slotted scene carries the night LUT, not its own.
  const nightTour = parseTemplateRecipe({ ...tourJson, night_slots: ["S1"] });
  const dayTour = parseTemplateRecipe(tourJson);
  const nightGraph = templateShotArgs({ recipe: nightTour, scene: nightTour.scenes[0], input: "in.mp4", output: "out.mp4", width: W, height: H, fps: FPS, start: 0, available: 8 }).join(" ");
  const dayGraph = templateShotArgs({ recipe: dayTour, scene: dayTour.scenes[0], input: "in.mp4", output: "out.mp4", width: W, height: H, fps: FPS, start: 0, available: 8 }).join(" ");
  check("a night slot renders with the night LUT, not its day grade", nightGraph.includes("night-warm-windows.cube") && !nightGraph.includes("bright-warm-day.cube"), "night LUT in graph");
  check("a scene outside night_slots keeps its own grade", dayGraph.includes("bright-warm-day.cube") && !dayGraph.includes("night-warm-windows.cube"), "day LUT in graph");
  // A night slot named by input slot works the same as by scene id.
  const slotTour = parseTemplateRecipe({ ...tourJson, night_slots: ["exterior"] });
  const slotGraph = templateShotArgs({ recipe: slotTour, scene: slotTour.scenes[0], input: "in.mp4", output: "out.mp4", width: W, height: H, fps: FPS, start: 0, available: 8 }).join(" ");
  check("a night slot named by input slot works too", slotGraph.includes("night-warm-windows.cube"), "slot name");
  // The render: the same day photo, day grade vs night grade. The night
  // version is dark and blue-dominant; the day version is bright; and
  // the house is unchanged — the edge maps correlate, because a LUT is
  // a pointwise colour map and cannot move, add or remove anything.
  const s1Need = rampSourceSeconds([[0, 0.5], [0.3, 0.7], [0.55, 1.0], [0.8, 1.9], [1, 2.5]], 3.2) + 0.3;
  const nightClip = path.join(dir, "night-clip.mp4");
  await stillToClip({ input: still, output: nightClip, width: W, height: H, fps: FPS, seconds: s1Need });
  const dayOut = path.join(dir, "night-day.mp4");
  const nightOut = path.join(dir, "night-night.mp4");
  ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe: dayTour, scene: dayTour.scenes[0], input: nightClip, output: dayOut, width: W, height: H, fps: FPS, start: 0, available: s1Need })]);
  ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe: nightTour, scene: nightTour.scenes[0], input: nightClip, output: nightOut, width: W, height: H, fps: FPS, start: 0, available: s1Need })]);
  const rgbAt = (file, t) => {
    const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=${W}:${H}:flags=area,format=rgb24`, "-f", "rawvideo", "-"]);
    let r = 0, g = 0, b = 0; const n = W * H;
    for (let i = 0; i < n; i += 1) { r += raw[i * 3]; g += raw[i * 3 + 1]; b += raw[i * 3 + 2]; }
    return { r: r / n, g: g / n, b: b / n };
  };
  const dayRgb = rgbAt(dayOut, 1.6), nightRgb = rgbAt(nightOut, 1.6);
  const dayLuma = 0.2126 * dayRgb.r + 0.7152 * dayRgb.g + 0.0722 * dayRgb.b;
  const nightLuma = 0.2126 * nightRgb.r + 0.7152 * nightRgb.g + 0.0722 * nightRgb.b;
  check("the day version is bright", dayLuma > 100, `luma ${dayLuma.toFixed(0)}`);
  check("the night version is dark and blue-dominant", nightLuma < 110 && nightRgb.b > nightRgb.r, `luma ${nightLuma.toFixed(0)} B ${nightRgb.b.toFixed(0)} > R ${nightRgb.r.toFixed(0)}`);
  const edge = (frame) => {
    const out = new Float64Array(W * H);
    for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
      const i = y * W + x;
      out[i] = 4 * frame[i] - frame[i - 1] - frame[i + 1] - frame[i - W] - frame[i + W];
    }
    return out;
  };
  const corr = (a, b) => {
    let ma = 0, mb = 0; const n = a.length;
    for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i += 1) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
    return num / Math.max(1e-9, Math.sqrt(da * db));
  };
  const dayFrames = await sampleFrames(dayOut, { width: W, height: H, fps: 30 });
  const nightFrames = await sampleFrames(nightOut, { width: W, height: H, fps: 30 });
  const at = Math.round(1.6 * 30);
  const edgeCorr = corr(edge(dayFrames[at]), edge(nightFrames[at]));
  check("the night grade does not change the house (edges correlate)", edgeCorr > 0.85, `edge correlation ${edgeCorr.toFixed(3)}`);
}

// Beat-synced cuts: every interior boundary lands on the measured beat grid; the film's
// total length does not change, and a caption never crosses its scene's new end.
{
  const grid120 = { bpm: 120, phase: 0, period: 0.5, beats: Array.from({ length: 30 }, (_, i) => +(i * 0.5).toFixed(3)), confidence: 0.97 };
  const aligned = snapRecipeToBeatGrid(recipe, grid120);
  check("a beat-aligned recipe snaps to itself", aligned.moved.length === 0 && aligned.recipe.scenes.every((s, i) => s.start_s === recipe.scenes[i].start_s), `${aligned.moved.length} moved`);
  const offBeat = JSON.parse(JSON.stringify(recipe));
  offBeat.scenes[2].start_s = 5.8; offBeat.scenes[2].duration_s = 1.1;
  offBeat.scenes[3].start_s = 6.9; offBeat.scenes[3].duration_s = 3.1;
  offBeat.scenes[5].start_s = 11.8; offBeat.scenes[5].duration_s = 0.7;
  offBeat.scenes[6].start_s = 12.5; offBeat.scenes[6].duration_s = 1.1;
  offBeat.scenes[7].start_s = 13.6; offBeat.scenes[7].duration_s = 0.9;
  const snapped = snapRecipeToBeatGrid(offBeat, grid120);
  check("off-beat cuts snap to the nearest beat", snapped.recipe.scenes.map((s) => s.start_s).join(",") === "0,5,6,7,10,12,12.5,13.5", snapped.recipe.scenes.map((s) => s.start_s).join(","));
  check("snapping does not change the film's length", Math.abs(templateDuration(snapped.recipe) - 14.5) < 0.01, `${templateDuration(snapped.recipe)}s`);
  check("the snapped grid becomes the recipe's cut points", snapped.recipe.music.cut_points_s.join(",") === "5,6,7,10,12,12.5,13.5", snapped.recipe.music.cut_points_s.join(","));
  check("captions stay inside their scene after snapping", snapped.recipe.scenes[0].captions.every((c) => c.end_s <= 5.0), JSON.stringify(snapped.recipe.scenes[0].captions.map((c) => c.end_s)));
  const noGrid = snapRecipeToBeatGrid(recipe, null);
  check("no beat grid leaves the recipe unchanged", noGrid.moved.length === 0 && noGrid.recipe === recipe, "null grid");
  const tight = parseTemplateRecipe({
    recipe_version: "1.0", template_id: "tight", name: "Tight", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 4,
    inputs: [{ slot: "a", type: "image_or_video", required: true }],
    scenes: [
      { id: "S1", start_s: 0, duration_s: 1.4, input: "a", camera: { move: "push_in", speed: "constant" }, transition_in: "open" },
      { id: "S2", start_s: 1.4, duration_s: 0.3, input: "a", camera: { move: "push_in", speed: "constant" }, transition_in: "hard_cut" },
      { id: "S3", start_s: 1.7, duration_s: 2.3, input: "a", camera: { move: "push_in", speed: "constant" }, transition_in: "hard_cut" },
    ],
    text_styles: {}, grades: {},
  });
  const tightSnapped = snapRecipeToBeatGrid(tight, grid120);
  check("a snap never collapses a scene under 0.3s", tightSnapped.recipe.scenes.every((s) => s.duration_s >= 0.3), tightSnapped.recipe.scenes.map((s) => s.duration_s).join(","));
  check("two cuts near one beat do not land on it together", tightSnapped.recipe.scenes.map((s) => s.start_s).join(",") === "0,1.5,2", tightSnapped.recipe.scenes.map((s) => s.start_s).join(","));
  check("a snap never moves a cut by 0.6s or more", tightSnapped.moved.every((m) => Math.abs(m.to - m.from) < 0.6), JSON.stringify(tightSnapped.moved));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

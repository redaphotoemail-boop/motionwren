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
check("house-calling-v1 parses", recipe.template_id === "house-calling-v1" && recipe.scenes.length === 9, `${recipe.scenes.length} scenes`);
check("the film is 14.9s", Math.abs(templateDuration(recipe) - 14.9) < 0.001, `${templateDuration(recipe)}s`);

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
bad((r) => { r.scenes.splice(1, 1); }, "flash transition without its flash scene");
bad((r) => { r.duration_s = 15.5; }, "duration mismatch");
bad((r) => { r.speed_ramps = [{ scene: "S1", points: [[0, 0.5], [0.5, 9], [1, 1]] }]; }, "ramp speed out of range");
bad((r) => { r.scenes[5].duration_s = 0.4; r.scenes[5].transition_in = "crossfade"; }, "scene too short for its dissolve");
bad((r) => { r.scenes[0].captions[0].text = ""; }, "empty caption");
bad((r) => { r.recipe_version = "2.0"; }, "wrong recipe version");

/* Planning: 7 clips feed 9 scenes; the night exterior serves twice. */
const picks = planTemplateScenes(recipe, [6, 6, 6, 6, 6, 6, 6]);
check("scenes map to their slots in order", picks.map((p) => p.clip).join(",") === "0,0,1,2,1,3,4,5,6", picks.map((p) => p.clip).join(","));
check("a shared clip gives each scene a different moment", picks[2].start === 0 && picks[4].start > 0, `S2@${picks[2].start}s, S4@${picks[4].start}s`);
check("the flash continues the previous scene's footage", picks[1].flash === true && picks[1].clip === 0 && Math.abs(picks[1].start - 5) < 0.01, `clip ${picks[1].clip} @ ${picks[1].start}s`);
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
const s5 = templateShotArgs({ recipe, scene: recipe.scenes[4], input: "in.mp4", output: "out.mp4", width: 360, height: 640, fps: 30, start: 0 });
check("a tilt-down uses an animated crop", s5.join(" ").includes("crop=720:1280"), "animated crop in S5");
const join = templateEditArgs({ recipe, sceneFiles: recipe.scenes.map((_, i) => `scene-${i}.mp4`), width: 360, height: 640, fps: 30, duration: 14.9, output: "film.mp4" });
check("the join has the whip blur, not a hard cut", join.join(" ").includes("tmix=frames=5") && join.join(" ").includes("concat"), "tmix + concat");
const joinVo = templateEditArgs({ recipe, sceneFiles: recipe.scenes.map((_, i) => `scene-${i}.mp4`), music: "music.mp3", voiceover: "vo.mp3", width: 360, height: 640, fps: 30, duration: 14.9, output: "film.mp4" });
check("music ducks under a voiceover (sidechain)", joinVo.join(" ").includes("sidechaincompress"), "sidechaincompress");
const joinNoVo = templateEditArgs({ recipe, sceneFiles: recipe.scenes.map((_, i) => `scene-${i}.mp4`), music: "music.mp3", width: 360, height: 640, fps: 30, duration: 14.9, output: "film.mp4" });
check("no voiceover, no ducking", !joinNoVo.join(" ").includes("sidechaincompress"), "music only");
check("the join cuts to the exact length", join.join(" ").includes("-t 14.900"), "-t 14.900");
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
const flashOut = path.join(dir, "flash.mp4");
ff(["-hide_banner", "-loglevel", "error", ...templateShotArgs({ recipe, scene: recipe.scenes[1], input: clip, output: flashOut, width: W, height: H, fps: FPS, start: 5 })]);
check("the flash renders to its 0.4s", Math.abs(dur(flashOut) - 0.4) < 0.1, `${dur(flashOut).toFixed(2)}s`);
// The flash peaks white: sample the frame at 5.2s into the flash scene's own timeline (0.2s).
{
  const frames = await sampleFrames(flashOut, { width: 80, height: 45, fps: 10 });
  const mean = (f) => { let s = 0; for (let i = 0; i < f.length; i += 1) s += f[i]; return s / f.length; };
  const peak = mean(frames[2]);
  check("the flash is blown out at its peak", peak > 230, `mean luma ${peak.toFixed(0)} at 0.2s`);
}
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

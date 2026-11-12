/* WrenCut on the real ffmpeg: a recipe (shots, joins, zoom, grade) renders to its
   own length; a flash join brightens the join; the analyzer reads a synthetic
   reference back into a recipe with the same number of shots. */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assText, editArgs } from "../../composer/server.mjs";
import { analyzeVideo, recipeDuration, validRecipe } from "../../composer/wrencut.mjs";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "wrencut-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const dur = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

const recipe = {
  version: 1, duration: 0, fps: 24, aspect: "9:16",
  slots: [{ dur: 2, zoom: [1, 1.25], pan: [0, 0] }, { dur: 1.5, zoom: [1, 1], pan: [0, 0] }, { dur: 1.5, zoom: [1.1, 1], pan: [0, 0] }],
  joins: [{ type: "cut", dur: 0.04 }, { type: "flash", dur: 0.16 }],
  grade: { warmth: 0.5, saturation: 1.05 },
};
recipe.duration = recipeDuration(recipe);
check("the recipe is valid", validRecipe(recipe) === "", validRecipe(recipe));

const clips = [0x303030, 0x606060, 0x909090].map((c, n) => { const file = path.join(dir, `c${n}.mp4`); ff(["-f", "lavfi", "-i", `color=c=0x${c.toString(16)}:s=360x640:r=24:d=4`, "-c:v", "libx264", "-pix_fmt", "yuv420p", file]); return file; });
const output = path.join(dir, "out.mp4");
ff(editArgs({ clips, width: 360, height: 640, fps: 24, crossfade: 0, duration: recipe.duration, sceneSeconds: 2, output, recipe, strength: 1 }));
check("the film is the recipe's length", Math.abs(dur(output) - recipe.duration) < 0.3, `${dur(output).toFixed(2)} vs ${recipe.duration.toFixed(2)}`);

// Reference: three clearly different shots, read back into a recipe.
const refParts = ["testsrc2", "mandelbrot", "life=mold=10:ratio=0.1:death_color=#202040:life_color=#ffcc88"].map((src, n) => { const file = path.join(dir, `r${n}.mp4`); ff(["-f", "lavfi", "-i", `${src}${src.includes("=") ? ":" : "="}s=360x640:r=30`, "-t", "1.5", "-pix_fmt", "yuv420p", file]); return file; });
const ref = path.join(dir, "ref.mp4");
ff([...refParts.flatMap((f) => ["-i", f]), "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0", "-pix_fmt", "yuv420p", ref]);
const read = await analyzeVideo(ref, { duration: 4.5, fps: 30, width: 360, height: 640 });
check("the analyzer finds the three shots", read.slots.length === 3, `${read.slots.length} shots`);
check("the analyzer's recipe is valid", validRecipe(read) === "", validRecipe(read));
// Sound: a 120 BPM bed with a whoosh building into the cut at 1.5 s.
const audio = path.join(dir, "a.wav"), sound = path.join(dir, "sound-ref.mp4"), silent = path.join(dir, "silent.mp4");
ff(["-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*80*t)*exp(-14*mod(t\\,0.5)):s=16000:d=6", "-f", "lavfi", "-i", "anoisesrc=d=0.4:c=white:a=0.5:r=16000,afade=t=in:d=0.4,adelay=1100|1100,apad=whole_dur=6", "-filter_complex", "amix=inputs=2:duration=first:normalize=0", "-t", "6", audio]);
ff(["-i", ref, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-shortest", sound]);
const heard = await analyzeVideo(sound, { duration: 4.5, fps: 30, width: 360, height: 640 });
check("the music's tempo is found", heard.audio?.music?.bpm >= 115 && heard.audio.music.bpm <= 125, `bpm ${heard.audio?.music?.bpm}`);
check("a whoosh into the first cut is found", heard.audio?.sfx?.some((item) => item.join === 0 && item.kind === "whoosh"), JSON.stringify(heard.audio?.sfx));
check("the sound is only prompts and numbers", !JSON.stringify(heard.audio).includes(dir));
check("a silent reference has no sound plan", (await analyzeVideo(ref, { duration: 4.5, fps: 30, width: 360, height: 640 })).audio === undefined);
void silent;
// Titles: where, when and how they come in — never their words.
const font = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const titled = path.join(dir, "titled.mp4");
ff(["-f", "lavfi", "-i", "color=c=0x334455:s=540x960:r=24:d=5", "-vf", `drawtext=text='GRAND OPENING':fontfile=${font}:fontsize=58:fontcolor=white:x=(w-text_w)/2:y=300:alpha='if(lt(t,1),0,min(1,(t-1)/0.5))':enable='between(t,0,4)',drawtext=text='Visit us today':fontfile=${font}:fontsize=40:fontcolor=white:x='(w-text_w)/2+200*max(0\\,1-(t-2)/0.5)':y=700:enable='gte(t,2)'`, "-pix_fmt", "yuv420p", titled]);
const seen = await analyzeVideo(titled, { duration: 5, fps: 24, width: 540, height: 960, workDir: dir });
check("both titles are found", seen.texts?.length === 2, `${seen.texts?.length}`);
check("the title is centred high, in capitals, fading in", seen.texts?.[0] && Math.abs(seen.texts[0].x - 0.5) < 0.05 && seen.texts[0].y < 0.4 && seen.texts[0].caps && seen.texts[0].fx?.type === "fade", JSON.stringify(seen.texts?.[0]));
check("the second title slides in from the side", seen.texts?.[1]?.fx?.type === "slide" && Math.abs(seen.texts[1].fx.dx) > 0.15, JSON.stringify(seen.texts?.[1]));
check("no words are kept", !/GRAND|OPENING|Visit/i.test(JSON.stringify(seen)));
const ass = assText([{ start: 1, end: 3, text: "HI", y: 0.33, h: 0.046, fx: { type: "slide", dur: 0.4, dx: 0.3, dy: 0 } }, { start: 0, end: 2, text: "plain" }]);
check("a title carries its place and entrance; a plain line stays plain", /\{\\an5\\move\(/.test(ass) && /,plain$/m.test(ass));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

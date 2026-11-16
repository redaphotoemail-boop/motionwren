/* Template Audit: it catches a freezing ramp and a whoosh, and passes a clean film.
   Synthetic films only (no renders): a frozen middle is a held frame, a clean film is a
   moving test pattern throughout. The auto-fix is tested by its recipe change, not by a
   re-render (that needs the verifier + real inputs). */
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const dir = mkdtempSync(path.join(os.tmpdir(), "audit-test-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const audit = (args) => spawnSync("node", ["--no-warnings", "composer/audit-template.mjs", ...args], { cwd: path.resolve("."), encoding: "utf8" });

const recipe = {
  template_id: "audit-test", name: "Audit Test", aspect: "9:16", resolution: "360x640", fps: 30, duration_s: 3,
  inputs: [{ slot: "exterior", type: "image_or_video", required: true }, { slot: "living", type: "image_or_video", required: true }],
  scenes: [
    { id: "S1", start_s: 0, duration_s: 1.5, input: "exterior", camera: { move: "push_in", amount: 1.06, speed: "constant" }, grade: "bright_warm_day", transition_in: "open" },
    { id: "S2", start_s: 1.5, duration_s: 1.5, input: "living", camera: { move: "glide", speed: "constant" }, grade: "warm_evening_interior", transition_in: "hard_cut" },
  ],
  speed_ramps: [{ scene: "S2", points: [[0, 2.5], [0.2, 1.0], [0.45, 0.4], [0.7, 0.9], [1, 2.5]] }],
  music: { track: "licensed stock, 120 BPM", ducking: true },
};
const recipePath = path.join(dir, "recipe.json");
writeFileSync(recipePath, JSON.stringify(recipe));

// Frozen film: 1s moving, 1s held frame, 1s moving. The held second must fail the freeze check.
const moving = path.join(dir, "moving.mp4");
ff(["-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", moving]);
const held = path.join(dir, "held.mp4");
ff(["-f", "lavfi", "-i", "color=c=0x404040:s=360x640:r=30:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", held]);
const frozenFilm = path.join(dir, "frozen.mp4");
ff(["-i", moving, "-i", held, "-i", moving, "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0", "-pix_fmt", "yuv420p", frozenFilm]);
const frozen = audit(["--recipe", recipePath, "--film", frozenFilm]);
check("the audit catches the frozen middle", frozen.status === 1 && /FAIL freeze/.test(frozen.stdout), `exit ${frozen.status}: ${frozen.stdout.split("\n")[0]}`);
check("the audit names the frozen seconds", /1\.0-2\.0s \(1\.0?s\)/.test(frozen.stdout) || /frozen 1/.test(frozen.stdout), frozen.stdout.split("\n")[0]);

// Clean film: 3s of motion throughout, against a recipe with no ramps (a synthetic pattern
// was never ramped, so the ramp checks have nothing to measure). Freeze must pass; exit 0.
const cleanRecipe = { ...recipe, speed_ramps: [] };
const cleanRecipePath = path.join(dir, "clean-recipe.json");
writeFileSync(cleanRecipePath, JSON.stringify(cleanRecipe));
const cleanFilm = path.join(dir, "clean.mp4");
ff(["-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", cleanFilm]);
const clean = audit(["--recipe", cleanRecipePath, "--film", cleanFilm]);
check("a clean film passes the freeze check", /PASS freeze/.test(clean.stdout), clean.stdout.split("\n")[0]);
check("a clean film passes the audit", clean.status === 0, `exit ${clean.status}`);

// Whoosh: a recipe that declares a whoosh accent fails the no-whoosh check (standing rule).
const whooshRecipe = { ...recipe, music: { ...recipe.music, sfx: [{ join: 0, kind: "whoosh", lead: 0.25, prompt: "airy filtered-noise whoosh" }] } };
const whooshPath = path.join(dir, "whoosh-recipe.json");
writeFileSync(whooshPath, JSON.stringify(whooshRecipe));
const whoosh = audit(["--recipe", whooshPath, "--film", cleanFilm]);
check("the audit catches a whoosh in the recipe", whoosh.status === 1 && /FAIL no-whoosh/.test(whoosh.stdout), `exit ${whoosh.status}`);

// Story: interiors before the exterior fails the story check (flagged for Reda, never auto-fixed).
const wrongOrder = JSON.parse(JSON.stringify(recipe));
// Deep-copy the scenes before swapping: the shared recipe object must stay intact for the
// tests that run after this one.
wrongOrder.scenes = [JSON.parse(JSON.stringify(recipe.scenes[1])), JSON.parse(JSON.stringify(recipe.scenes[0]))];
wrongOrder.scenes[0].start_s = 0; wrongOrder.scenes[1].start_s = 1.5;
const wrongPath = path.join(dir, "wrong-order.json");
writeFileSync(wrongPath, JSON.stringify(wrongOrder));
const wrong = audit(["--recipe", wrongPath, "--film", cleanFilm]);
check("the audit flags a story out of order", wrong.status === 1 && /FAIL story/.test(wrong.stdout), `exit ${wrong.status}`);

// Beat: a film with a 120 BPM click track. A cut at 1.5s is on a beat (PASS); a cut at
// 1.3s is between beats (FAIL). Both recipes have no ramps, so only the beat check is
// exercised here.
const beatFilm = path.join(dir, "beat.mp4");
ff(["-f", "lavfi", "-i", "testsrc2=s=360x640:r=30:d=3", "-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*80*t)*exp(-14*mod(t\\,0.5)):s=16000:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", beatFilm]);
const beatRecipe = { ...recipe, speed_ramps: [] };
const beatPath = path.join(dir, "beat-recipe.json");
writeFileSync(beatPath, JSON.stringify(beatRecipe));
const onBeat = audit(["--recipe", beatPath, "--film", beatFilm]);
check("a cut on the beat passes the beat check", onBeat.status === 0 && /PASS beat/.test(onBeat.stdout), `exit ${onBeat.status}: ${onBeat.stdout.split("\n").filter((l) => /beat/.test(l)).join(" | ")}`);
const offBeatRecipe = JSON.parse(JSON.stringify(beatRecipe));
offBeatRecipe.scenes[1].start_s = 1.3; offBeatRecipe.scenes[1].duration_s = 1.7;
const offBeatPath = path.join(dir, "offbeat-recipe.json");
writeFileSync(offBeatPath, JSON.stringify(offBeatRecipe));
const offBeat = audit(["--recipe", offBeatPath, "--film", beatFilm]);
check("a cut between beats fails the beat check", offBeat.status === 1 && /FAIL beat/.test(offBeat.stdout), `exit ${offBeat.status}`);

// Auto-fix: on the frozen film with --fix but no --inputs, the audit softens the ramp in the
// written recipe (the re-render needs inputs, so it stops there) instead of silently passing.
const fixOut = path.join(dir, "fix-out");
const fixed = audit(["--recipe", recipePath, "--film", frozenFilm, "--fix", "--out", fixOut]);
const fixedRecipe = JSON.parse(readFileSync(path.join(fixOut, "audited-recipe.json"), "utf8"));
const slowPoint = fixedRecipe.speed_ramps[0].points.find((p) => p[0] === 0.45)[1];
check("auto-fix softens the slowest ramp point", slowPoint === 0.55, `0.4 → ${slowPoint}`);
check("auto-fix still fails the frozen film (no re-render without inputs)", fixed.status === 1, `exit ${fixed.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

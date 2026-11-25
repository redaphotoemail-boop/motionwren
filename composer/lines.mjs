/* The line guard and the scene finish, run on each engine scene before the film is edited.

   Reda's rules (Nov 25, 2026):
   - Straight lines (window frames, door frames, walls, ceilings) must never shift, wobble or bend,
     and the camera must never show anything beyond the photo's edges.
   - Stabilization may trim at most 2% of the picture (1% on each side), never more.

   For each engine scene that has its photo:
   1. Stabilization (ffmpeg vidstab: measured, then applied) irons out small jitters with a fixed 2% zoom;
      shifts and turns are capped so the trim never grows past that. If it fails, the scene is used as made.
   2. A closing pull-back is the engine's push-in played backwards (in the same encode), so it never leaves the photo.
   3. The line guard (lines.py, OpenCV) compares the scene with its photo.
   4. A scene that fails is replaced by a still-photo move made from the photo itself (a pure zoom or
      pan on the still, no AI), which can never warp or invent anything.
   Nothing here costs money: it is ffmpeg and OpenCV in the composer. */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), "lines.py");

/** Stabilization's fixed trim, in percent of the picture's size (1% on each side). */
export const STABILIZE_TRIM_PERCENT = 2;
export const LINE_MODES = ["push", "arc"];
/** Still-photo moves a failed scene may be replaced with (all stay inside the photo). */
export const STILL_FALLBACKS = ["push", "pull", "slide-left", "slide-right"];

function exec(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; if (stdout.length > 200_000) stdout = stdout.slice(-100_000); });
    child.stderr.on("data", (data) => { stderr += data; if (stderr.length > 20_000) stderr = stderr.slice(-10_000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} took too long.`)); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} failed (${code}): ${stderr.split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 300)}`));
    });
  });
}

/** The clip played backwards (a push-in becomes a pull-back that stays inside the photo). */
export function reverseArgs(input, output) {
  return ["-hide_banner", "-y", "-nostdin", "-i", input, "-vf", "reverse,setsar=1,format=yuv420p", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "14", output];
}

/** Two-pass stabilization with the trim capped (see STABILIZE_TRIM_PERCENT). */
export function stabilizeArgs(input, transforms, output, width) {
  const margin = STABILIZE_TRIM_PERCENT / 200; // per side, as a share of the picture
  const maxshift = Math.max(1, Math.floor(width * margin));
  const detect = ["-hide_banner", "-y", "-nostdin", "-i", input, "-vf", `vidstabdetect=shakiness=4:accuracy=12:result=${transforms}`, "-f", "null", "-"];
  const transformFilter = `vidstabtransform=input=${transforms}:smoothing=18:optzoom=0:zoom=${STABILIZE_TRIM_PERCENT}:maxshift=${maxshift}:maxangle=0.004:interpol=bicubic:crop=keep`;
  const transform = ["-hide_banner", "-y", "-nostdin", "-i", input, "-vf", `${transformFilter},setsar=1,format=yuv420p`, "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "14", output];
  return { detect, transform, transformFilter };
}

/** → { held, reason, ... } from lines.py, or { error } when the scene could not be read. */
export async function linesHeld(clip, photo, mode = "push") {
  const out = await exec("python3", [SCRIPT, clip, photo, LINE_MODES.includes(mode) ? mode : "push"], 4 * 60 * 1000);
  const verdict = JSON.parse(out.trim().split("\n").pop() || "{}");
  return verdict;
}

/* Prepares one engine scene: reverse, stabilize, guard, and fall back to the still move when the
   lines don't hold. Returns the file to use and what happened (for the film's record). */
export async function guardScene({ file, photo, dir, name, mode = "push", reverse = false, stabilize = true, fallback = "push", width, makeStill }) {
  const record = { mode, reversed: false, stabilized: false, used: "ai" };
  let current = file;
  // One encode for both steps (the editor encodes the film again at the end, so this one only has to be clean):
  // the stabilizer's shifts are measured on the scene as made, then applied, then the scene is played backwards.
  let steady = "";
  if (stabilize) {
    try {
      // The trim cap is set in the scene's own pixels (an engine scene in the photo's shape may be narrower than the film).
      const probed = Number((await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", current], 30_000)).trim()) || width;
      const transforms = path.join(dir, `${name}.trf`);
      const { detect, transformFilter } = stabilizeArgs(current, transforms, "", probed);
      await exec("ffmpeg", detect, 5 * 60 * 1000);
      steady = transformFilter;
    } catch (error) { record.stabilizeError = String(error?.message || error).slice(0, 200); }
  }
  if (steady || reverse) {
    const out = path.join(dir, `${name}-ready.mp4`);
    const filters = [steady, reverse ? "reverse" : "", "setsar=1", "format=yuv420p"].filter(Boolean).join(",");
    try {
      await exec("ffmpeg", ["-hide_banner", "-y", "-nostdin", "-i", current, "-vf", filters, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", out], 6 * 60 * 1000);
      current = out; record.stabilized = Boolean(steady); record.reversed = reverse;
    } catch (error) {
      // Stabilizing failed: play it backwards alone if it closes the film, else use it as made.
      record.stabilizeError = String(error?.message || error).slice(0, 200);
      if (reverse) { await exec("ffmpeg", reverseArgs(file, out), 5 * 60 * 1000); current = out; record.reversed = true; }
    }
  }
  if (!photo) return { file: current, record: { ...record, guard: "no photo" } };
  let verdict;
  try { verdict = await linesHeld(current, photo, mode); } catch (error) { verdict = { error: String(error?.message || error).slice(0, 200) }; }
  record.verdict = verdict;
  // A scene the guard could not read is not trusted either: the still move is always safe.
  if (verdict.held === true) return { file: current, record };
  const still = path.join(dir, `${name}-still.mp4`);
  await makeStill(STILL_FALLBACKS.includes(fallback) ? fallback : "push", still);
  return { file: still, record: { ...record, used: "still", reason: verdict.reason || verdict.error || "The lines could not be checked." } };
}

/** Removes the stabilizer's notes (the scene files themselves stay: one of them is in the film). */
export async function cleanup(dir, name) {
  await fs.rm(path.join(dir, `${name}.trf`), { force: true }).catch(() => {});
}

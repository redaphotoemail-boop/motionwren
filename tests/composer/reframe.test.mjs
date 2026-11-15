/* A film made at the photo's own shape (3:2) is cut to 16:9 and to vertical by the composer, for real with ffmpeg.
   The test picture has a green ceiling band at the top, a blue floor band at the bottom and a red post in the centre. A
   16:9 cut must keep the floor (and lose the ceiling first); a vertical cut must keep the centre and the whole height. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { editArgs } from "../../composer/server.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "reframe-test-"));
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// 3:2 clip, 600x400: grey; ceiling band y 0..39 green; floor band y 361..399 blue; centre post x 290..309 red.
const clip = path.join(dir, "own.mp4");
ff(["-f", "lavfi", "-i", "color=c=gray:s=600x400:r=24:d=3", "-vf", "drawbox=x=0:y=0:w=600:h=40:color=green:t=fill,drawbox=x=0:y=360:w=600:h=40:color=blue:t=fill,drawbox=x=290:y=40:w=20:h=320:color=red:t=fill", "-c:v", "libx264", "-pix_fmt", "yuv444p", clip]);

const pixel = (file, x, y) => {
  const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `select=eq(n\\,10),format=rgb24,crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [raw[0], raw[1], raw[2]];
};
const near = (rgb, name) => name === "blue" ? rgb[2] > 180 && rgb[0] < 90 : name === "green" ? rgb[1] > 100 && rgb[0] < 90 && rgb[2] < 90 : name === "red" ? rgb[0] > 180 && rgb[1] < 90 : false;
const cut = (name, width, height, anchorY) => { const output = path.join(dir, name); ff(editArgs({ clips: [clip], width, height, fps: 24, crossfade: 0, duration: 2, sceneSeconds: 2, output, anchorY, keepAudio: false })); return output; };

// 16:9 from 3:2 at 480x270: the picture is scaled to 480 wide (480x320) and 50 rows go; with the floor kept, 75% of them (37 rows) come off the top.
const wide = cut("wide.mp4", 480, 270, 0.75);
check("16:9 cut: the floor is still in the picture", near(pixel(wide, 100, 268), "blue"), JSON.stringify(pixel(wide, 100, 268)));
check("16:9 cut: the ceiling goes first", !near(pixel(wide, 100, 1), "green"), JSON.stringify(pixel(wide, 100, 1)));
// Without an anchor the cut is centred (as every film before this): 25 rows go from each end, so a sliver of ceiling is still there
const centred = cut("centred.mp4", 480, 270, undefined);
check("centred cut (no anchor): unchanged, a sliver of ceiling remains", near(pixel(centred, 100, 1), "green"), JSON.stringify(pixel(centred, 100, 1)));
// Vertical from 3:2 at 180x320: scaled to 480 high (720x480), the middle 270 px kept: the post stays in the centre, floor and ceiling bands stay (full height)
const tall = cut("tall.mp4", 180, 320, 0.75);
check("vertical cut: the post is in the middle", near(pixel(tall, 90, 160), "red"), JSON.stringify(pixel(tall, 90, 160)));
check("vertical cut: the whole height is kept (floor)", near(pixel(tall, 20, 318), "blue"), JSON.stringify(pixel(tall, 20, 318)));
check("vertical cut: the whole height is kept (ceiling)", near(pixel(tall, 20, 1), "green"), JSON.stringify(pixel(tall, 20, 1)));
// A film at its own shape (3:2, no cut) keeps everything
const own = cut("same.mp4", 600, 400, undefined);
check("own shape: floor and ceiling both kept", near(pixel(own, 100, 398), "blue") && near(pixel(own, 100, 1), "green"));
const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", own]).toString());
check("own shape: the film is 600x400 (3:2)", probe.streams.some((s) => s.width === 600 && s.height === 400));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

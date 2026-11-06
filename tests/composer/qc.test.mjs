/* The free quality check (composer/qc.mjs) on small generated films. */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { extractStills, qualityCheck } from "../../composer/qc.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "qc-test-"));
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const out = (n) => path.join(dir, n);
const enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
const opts = { width: 640, height: 360, duration: 10 };
const noisy = "nullsrc=s=640x360:r=24:d=10,geq=random(1)*255:128:128";
const detail = "testsrc2=s=640x360:r=24:d=10";

// A crisp, moving picture
ff(["-f", "lavfi", "-i", detail, ...enc, out("good.mp4")]);
const good = await qualityCheck(out("good.mp4"), opts);
check("1 a crisp moving film passes", good.status === "pass", JSON.stringify(good.flags));

// The same picture blurred hard
ff(["-f", "lavfi", "-i", detail, "-vf", "gblur=sigma=14", ...enc, out("soft.mp4")]);
const soft = await qualityCheck(out("soft.mp4"), opts);
check("2 a blurred film is flagged soft", soft.flags.some((f) => f.code === "soft"), JSON.stringify(soft.metrics));

// Black stretch in the middle (3 s)
ff(["-f", "lavfi", "-i", detail, "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,4,7)'", ...enc, out("black.mp4")]);
const black = await qualityCheck(out("black.mp4"), opts);
check("3 a black stretch fails", black.status === "fail" && black.flags.some((f) => f.code === "black"), JSON.stringify(black.flags));

// Frozen picture (one frame held for 6 s)
ff(["-f", "lavfi", "-i", detail, "-vf", "trim=end=2,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=8", ...enc, out("frozen.mp4")]);
const frozen = await qualityCheck(out("frozen.mp4"), opts);
check("4 a frozen stretch is flagged", frozen.flags.some((f) => f.code === "frozen"), JSON.stringify(frozen.flags));

// A sudden jump to a different picture at 5 s
ff(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=5", "-f", "lavfi", "-i", "color=c=white:s=640x360:r=24:d=5", "-filter_complex", "[0][1]concat=n=2:v=1:a=0", ...enc, out("jump.mp4")]);
const jump = await qualityCheck(out("jump.mp4"), opts);
check("5 a hard jump is flagged", jump.flags.some((f) => f.code === "jump"), JSON.stringify(jump.flags));
const planned = await qualityCheck(out("jump.mp4"), { ...opts, sceneSeconds: 5, crossfade: 0 });
check("6 the same cut is fine when it is a planned scene change", !planned.flags.some((f) => f.code === "jump"), JSON.stringify(planned.flags));

// Flicker: brightness swinging every frame
ff(["-f", "lavfi", "-i", detail, "-vf", "eq=brightness=0.35:enable='lt(mod(n,12),6)'", ...enc, out("flicker.mp4")]);
const flicker = await qualityCheck(out("flicker.mp4"), { ...opts });
check("7 brightness flicker is flagged", flicker.flags.some((f) => f.code === "flicker"), JSON.stringify(flicker.flags));
check("8 an unreadable file reports an error and never throws", (await qualityCheck(out("nope.mp4"), opts)).status === "error");

const stills = await extractStills(out("good.mp4"), dir, { duration: 10, count: 4 });
check("9 four stills are kept for the AI review", stills.length === 4 && stills.every((f) => existsSync(f) && statSync(f).size > 2000));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

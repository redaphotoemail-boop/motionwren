import assert from "node:assert/strict";
import { diagnoseJob, plainWhy } from "../app/api/_lib/job-diagnosis.ts";

const now = 1_800_000_000_000;
const job = (patch = {}) => ({ id: "j1", kind: "studio-single", status: "succeeded", error: null, createdAt: now - 12 * 60_000, updatedAt: now - 60_000, costCents: 100, ...patch });
const scene = (patch = {}) => ({ state: "ready", attempt: 1, nextAt: 0, error: "", startedAt: 0, readyAt: now - 2 * 60_000, saved: true, expired: false, ...patch });
let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;

{ // a clean fast video has no problems
  const out = diagnoseJob(job({ createdAt: now - 3 * 60_000 }), [scene()], [], [], now);
  assert.equal(out.issues.length, 0); assert.equal(out.timeline[0].text, "Started"); ok("clean video: no problems, starts with Started");
}
{ // stopped: names the reason and offers Resume with the scenes left
  const out = diagnoseJob(job({ status: "failed", error: "The engine did not finish the scene within 9 minutes (it said \"processing\")" }), [scene(), scene({ state: "failed", error: "x" })], [], [], now);
  const issue = out.issues.find((item) => item.code === "stopped");
  assert.ok(issue && /processing/.test(issue.why) && /Scene 2/.test(issue.why)); assert.equal(issue.fix.action, "resume"); ok("stopped video: reason in words, Resume fix");
}
{ // stopped with every scene made: join again
  const out = diagnoseJob(job({ status: "failed", error: "join failed" }), [scene(), scene()], [], [], now);
  assert.equal(out.issues.find((item) => item.code === "stopped").fix.action, "reassemble"); ok("all scenes made: join again");
}
{ // expired finished scene counts as missing
  const out = diagnoseJob(job({ status: "failed", error: "x" }), [scene({ expired: true })], [], [], now);
  assert.equal(out.issues.find((item) => item.code === "stopped").fix.action, "resume"); ok("expired scene: resume");
}
{ // a scene waiting to retry gets Retry now on that scene
  const out = diagnoseJob(job({ status: "generating" }), [scene(), scene({ state: "retry", attempt: 2, error: "429 throttled", nextAt: now + 30_000 })], [], [], now);
  const issue = out.issues.find((item) => item.code === "waiting");
  assert.equal(issue.scene, 1); assert.equal(issue.fix.action, "retry-scene"); assert.match(issue.why, /busy/); ok("waiting scene: retry now");
}
{ // no movement for a long time: nudge
  const out = diagnoseJob(job({ status: "generating", updatedAt: now - 30 * 60_000 }), [scene({ state: "creating" })], [], [], now);
  assert.equal(out.issues.find((item) => item.code === "stuck").fix.label, "Fix: nudge"); ok("stuck video: nudge");
}
{ // slow finished video: names the cause (quality re-makes), no fix
  const out = diagnoseJob(job(), [scene()], [], [{ round: 1, scenes: [0], why: "lines bent", cents: 48, engine: "h3", at: now - 5 * 60_000 }], now);
  const slow = out.issues.find((item) => item.code === "slow"); const remade = out.issues.find((item) => item.code === "remade");
  assert.ok(slow && /quality re-make/.test(slow.why) && slow.fix === null); assert.ok(remade && /\$0\.48/.test(remade.why)); ok("slow video: cause named, nothing to fix");
}
{ // stalled attempt is on the timeline with a time
  const out = diagnoseJob(job({ createdAt: now - 3 * 60_000 }), [scene()], [{ savedAt: now - 2 * 60_000, scene: 0, attempt: 1, engine: "h3lite", why: "stalled", status: "processing", error: "", queuedSeconds: 4, runningSeconds: null }], [], now);
  assert.ok(out.timeline.some((event) => event.at === now - 2 * 60_000 && /stalled/.test(event.text) && /H3 Lite/.test(event.text))); assert.ok(out.issues.some((item) => item.code === "stalled")); ok("stalled try: on the timeline with its time");
}
{ // History names the engine that made the delivered clip: say so when it moved
  const out = diagnoseJob(job({ createdAt: now - 3 * 60_000 }), [scene()], [], [], now, { engine: "h3", firstEngine: "vidu3turbo" });
  assert.ok(out.timeline.some((event) => /Started on Vidu Turbo/.test(event.text)) && out.timeline.some((event) => /Now on H3/.test(event.text))); ok("engine moved by the quality check is explained");
}
{ assert.match(plainWhy("insufficient credit"), /credit/); assert.match(plainWhy("flagged as sensitive"), /sensitive/); ok("plain reasons"); }
{ const times = diagnoseJob(job(), [scene()], [], [], now).timeline.map((event) => event.at); assert.deepEqual([...times].sort((a, b) => a - b), times); ok("timeline is in time order"); }
console.log(`${n} passed, 0 failed`);

import assert from "node:assert/strict";
import { fixInstruction, STANDING_RULES } from "../app/fix-notes.ts";

const car = fixInstruction(["Reality: car moved to the left of the driveway"]);
assert.ok(/parked exactly where it is/.test(car) && /no rolling, turning, driving/.test(car), "a moved car gets the vehicle clause");
assert.ok(car.includes(STANDING_RULES), "the camera-only rules are always repeated");
const many = fixInstruction(["The straight lines are wavy", "A large white square was added to the table", "Smeared patch near the trees", "The watermark is superimposed"], "Lateral slide");
for (const word of ["straight", "Add nothing", "no smearing", "no text, logo or watermark", "Lateral slide"]) assert.ok(many.includes(word), `missing: ${word}`);
assert.ok(many.length < 1500, "an instruction with four problems stays under the length cap");
assert.ok(fixInstruction([]).startsWith("Fix: make a new, cleaner version"), "no recorded issue still gives a full instruction");
assert.equal(fixInstruction(["same", "same."]).split('"same"').length - 1, 1, "a repeated problem is listed once");
console.log("fix notes: ok");

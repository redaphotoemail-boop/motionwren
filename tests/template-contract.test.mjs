/* Every template is a fixed recipe: the contract (app/template-contract.ts) is filled in completely and passes its checker,
   the checker refuses a template that leaves anything loose, and turning the templates into fixed recipes did not change a
   single edit the editor runs (the fixture was taken from the code before the change). */
import fs from "node:fs";
import { SOCIAL_SPECS, buildSocialRecipe, keptActs, sourceSeconds } from "../app/social-templates.ts";
import { CAMERA_MOVES, TEXT_FIELDS, jsonFixedRecipe, socialFixedRecipe, validateFixedRecipe } from "../app/template-contract.ts";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) { pass += 1; console.log(`PASS ${name}`); } else { fail += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); } };
const fixed = (spec) => { const built = buildSocialRecipe(spec); return socialFixedRecipe(spec, built, built.slots.map((slot) => sourceSeconds(slot.dur, slot.speed))); };
const v1 = ["house-calling-v1", "tour-flow-v1"].map((id) => jsonFixedRecipe(JSON.parse(fs.readFileSync(`composer/templates/${id}.json`, "utf8"))));

/* 1. The restaurant template is gone. */
/* (tests/studio-ads/ads.test.mjs checks the library list itself is empty and the old id resolves to none.) */
check("1a the library list is empty", fs.readFileSync("app/library-templates.ts", "utf8").includes("export const LIBRARY_TEMPLATES: LibraryTemplate[] = [];"));
for (const file of ["app/library-templates.ts", "app/social-templates.ts", "app/template-recipes.ts", "app/studio/template-strip.tsx", "composer/templates/house-calling-v1.json", "composer/templates/tour-flow-v1.json"]) {
  const text = fs.readFileSync(file, "utf8").toLowerCase();
  check(`1c ${file} offers no restaurant template`, !/"restaurant-interior"|name: "restaurant/.test(text));
}

/* 2. Every built-in template passes the contract. */
for (const spec of SOCIAL_SPECS) {
  const recipe = fixed(spec), problems = validateFixedRecipe(recipe);
  check(`2 ${spec.name}: a complete fixed recipe`, problems.length === 0, problems.join(" | "));
  check(`2 ${spec.name}: every photo has a camera move from the closed list`, spec.acts.every((act) => act.camera in CAMERA_MOVES));
  check(`2 ${spec.name}: words are named slots, not ideas`, Array.isArray(spec.text) && !("words" in spec) && spec.text.every((slot) => slot.field in TEXT_FIELDS));
  check(`2 ${spec.name}: shot list matches the edit (${recipe.shots.length} shots)`, recipe.shots.length === buildSocialRecipe(spec).slots.length);
}
for (const recipe of v1) { const problems = validateFixedRecipe(recipe); check(`2 ${recipe.name} (v1): a complete fixed recipe`, problems.length === 0, problems.join(" | ")); }
check("2 all fourteen built-in templates are covered", SOCIAL_SPECS.length + v1.length === 14);

/* 3. Nothing the editor runs changed. */
const before = JSON.parse(fs.readFileSync("tests/fixtures/social-edit-recipes.json", "utf8"));
for (const spec of SOCIAL_SPECS) {
  const now = []; for (let count = spec.acts.length; count >= 1; count -= 1) now.push(buildSocialRecipe(spec, keptActs(spec, count)));
  check(`3 ${spec.name}: the edit is byte-for-byte what it was, at every photo count`, JSON.stringify(now) === JSON.stringify(before[spec.key]));
}

/* 4. The checker refuses a loose template. */
const base = fixed(SOCIAL_SPECS[0]);
const broken = (name, change, expect) => {
  const copy = structuredClone(base); change(copy);
  const problems = validateFixedRecipe(copy);
  check(`4 refuses: ${name}`, problems.some((text) => expect.test(text)), problems.join(" | ") || "no problem found");
};
broken("a cut off the beat", (r) => { r.shots[1].start += 0.05; r.shots[0].end += 0.05; r.shots[0].seconds += 0.05; r.shots[1].seconds -= 0.05; }, /off the beat/);
broken("a gap between shots", (r) => { r.shots[2].start += 0.1; r.shots[2].seconds -= 0.1; }, /not where the last one ended/);
broken("a shot too short to read", (r) => { r.shots[1].end = r.shots[1].start + 0.2; r.shots[1].seconds = 0.2; r.shots[2].start = r.shots[1].end; r.shots[2].seconds = r.shots[2].end - r.shots[2].start; }, /shorter than/);
broken("a camera move outside the list", (r) => { r.shots[0].camera = "spin"; }, /unknown camera move/);
broken("a join outside the list", (r) => { r.shots[1].transition = "page_curl"; }, /unknown join/);
broken("a first shot that does not open", (r) => { r.shots[0].transition = "cut"; }, /first shot must open/);
broken("a photo that is never shown", (r) => { r.photos.slots.push({ label: "Extra", role: "any", light: "any", essential: false }); r.photos.best += 1; }, /never shown/);
broken("music that does not name its tempo", (r) => { r.music.style = "elegant piano"; }, /name its tempo/);
broken("two words in one place", (r) => { r.text.push({ at: "start", line: "title", field: "price", example: "$1" }); }, /share the start title/);
broken("a title too long to draw", (r) => { r.text[0].example = "x".repeat(70); }, /longer than Titles/);
broken("a line with no title above it", (r) => { r.text = [{ at: "end", line: "sub", field: "cta", example: "Call" }]; }, /no title above/);
broken("a ramp outside the safe range", (r) => { r.speeds[1] = [5]; }, /ramps outside/);
broken("a clip longer than the engine makes", (r) => { r.clipSeconds[0] = 20; }, /longer than 12 s/);
broken("shots that do not reach the end", (r) => { r.seconds += 1; }, /the shots end at/);
broken("a missing recipe version", (r) => { r.version = 0; }, /recipe version/);
broken("camera-only switched off", (r) => { r.quality = { ...r.quality, cameraOnly: false }; }, /camera-only/);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

import { SOCIAL_SPECS, buildSocialRecipe, keptActs, socialGuide, socialMinScene, sourceSeconds } from "../app/social-templates.ts";
import { validRecipe, assignClips } from "../composer/wrencut.mjs";
const ov = (join) => join.type === "cut" ? 0.04 : join.type === "flash" ? 0.16 : join.dur;
const recipeSeconds = (recipe) => Math.round((recipe.slots.reduce((sum, slot) => sum + slot.dur, 0) - recipe.joins.reduce((sum, join) => sum + ov(join), 0)) * 1000) / 1000;
const joinTimes = (recipe) => { let acc = recipe.slots[0].dur; return recipe.joins.map((join, index) => { const x = ov(join); const time = acc - x + x / 2; acc += recipe.slots[index + 1].dur - x; return Math.round(time * 1000) / 1000; }); };
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); } else { fail += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); } };
check("thirteen templates", SOCIAL_SPECS.length === 13);
check("unique keys and numbers", new Set(SOCIAL_SPECS.map((spec) => spec.key)).size === 13 && new Set(SOCIAL_SPECS.map((spec) => spec.number)).size === 13);
for (const spec of SOCIAL_SPECS) {
  const recipe = buildSocialRecipe(spec);
  check(`${spec.number} ${spec.name}: editor accepts the recipe`, validRecipe(recipe) === "", validRecipe(recipe));
  const total = spec.bounds[spec.bounds.length - 1];
  check(`${spec.number}: length is the beat-aligned end`, Math.abs(recipeSeconds(recipe) - total) < 0.005, `${recipeSeconds(recipe)} vs ${total}`);
  const times = joinTimes(recipe), cuts = spec.bounds.slice(1, -1);
  check(`${spec.number}: every join lands on its beat-aligned time`, times.length === cuts.length && times.every((time, index) => Math.abs(time - cuts[index]) < 0.006), JSON.stringify(times));
  check(`${spec.number}: joins and shots agree`, spec.joins.length === spec.bounds.length - 2 && spec.use.length === spec.bounds.length - 1);
  check(`${spec.number}: every shot uses a real photo`, spec.use.every((act) => act >= 0 && act < spec.acts.length) && spec.acts.every((_, act) => spec.use.includes(act)));
  check(`${spec.number}: no smoothness break (speed within 0.3–3.5, eased)`, recipe.slots.every((slot) => !slot.speed || (slot.speed.length <= 8 && slot.speed.every(([, s]) => s >= 0.3 && s <= 3.5) && slot.speed.every((point, i) => i === 0 || point[0] > slot.speed[i - 1][0]))));
  check(`${spec.number}: at most one ramp per shot`, recipe.slots.every((slot) => !slot.speed || slot.speed.length <= 8));
  check(`${spec.number}: whooshes sit on real joins`, (recipe.audio?.sfx || []).every((item) => item.kind === "whoosh" && item.join >= 0 && item.join < recipe.joins.length));
  const guide = socialGuide(spec);
  check(`${spec.number}: guide is sane`, guide.best === spec.acts.length && guide.least >= 2 && guide.least <= guide.best, JSON.stringify(guide));
  const need = socialMinScene(spec, spec.acts.length);
  const clips = spec.acts.map(() => need);
  const mapped = assignClips(recipe, clips);
  check(`${spec.number}: each shot plays its own photo`, mapped.every((item, index) => item.clip === spec.use[index]), JSON.stringify(mapped.map((m) => m.clip)));
  check(`${spec.number}: clip length covers every shot`, need >= Math.max(...recipe.slots.map((slot) => slot.dur + 0.2)) && need <= 12, `${need}s`);
  // fewer photos
  for (let count = spec.acts.length - 1; count >= guide.least; count -= 1) {
    const kept = keptActs(spec, count), fewer = buildSocialRecipe(spec, kept);
    check(`${spec.number}: with ${count} photos every essential photo stays and shots map to ${kept.length} photos`, validRecipe(fewer) === "" && kept.length === count && spec.acts.every((act, index) => !act.essential || kept.includes(index) || count < guide.least) && fewer.slots.every((slot) => slot.photo >= 0 && slot.photo < count));
  }
}
check("ramp source need is more than the shot's own length", sourceSeconds(1, [[0, 3.5], [0.5, 0.3], [1, 1]]) >= 1.2);
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

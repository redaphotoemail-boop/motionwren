import { SOCIAL_SPECS } from "../app/social-templates.ts";
import { analyzePixels, arrangePhotos, checkSocialPhotos, hamming, parseLight, parseRoom, parseYes } from "../app/social-check.ts";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) { pass += 1; console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); } else { fail += 1; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); } };
const spec = (key) => SOCIAL_SPECS.find((item) => item.key === key);
const good = { w: 1600, h: 2400, sharp: 120, bright: 120, hash: "f0f0f0f00f0f0f0f" };
const p = (name, room, light, extra = {}) => ({ name, ...good, room, light, depth: true, ...extra });

check("room answers", parseRoom("Kitchen.") === "kitchen" && parseRoom("aerial drone view") === "aerial" && parseRoom("the front of the house") === "exterior" && parseRoom("???") === null);
check("light answers", parseLight("Night") === "night" && parseLight("it is dusk") === "dusk" && parseLight("daytime") === "day" && parseLight("") === null);
check("yes/no", parseYes("Yes.") === true && parseYes("no") === false && parseYes("maybe") === null);
check("hamming", hamming("0000000000000000", "ffffffffffffffff") === 64 && hamming("f0f0f0f00f0f0f0f", "f0f0f0f00f0f0f0f") === 0 && hamming("x", "y") === null);

// pixels: a sharp checker pattern versus a flat blur
const size = 64, checker = new Uint8ClampedArray(size * size * 4), flat = new Uint8ClampedArray(size * size * 4);
for (let i = 0; i < size * size; i += 1) { const v = ((i % size) + Math.floor(i / size)) % 2 ? 255 : 0; checker.set([v, v, v, 255], i * 4); flat.set([120, 120, 120, 255], i * 4); }
const sharpOne = analyzePixels(checker, size, size), flatOne = analyzePixels(flat, size, size);
check("sharpness tells detail from blur", sharpOne.sharp > 1000 && flatOne.sharp < 1, `${sharpOne.sharp} vs ${flatOne.sharp}`);
check("brightness", Math.abs(flatOne.bright - 120) < 0.5 && analyzePixels(checker, size, size).hash.length === 16);

// Template 10 in the wrong order is arranged dusk, night. Landscape photos:
// the film is horizontal, so portrait photos would be flagged as a fix.
const t10 = spec("never-always-night");
const shuffled = [p("night.jpg", "exterior", "night", { w: 2400, h: 1600, hash: "0f0f0f0ff0f0f0f0" }), p("dusk.jpg", "exterior", "dusk", { w: 2400, h: 1600, hash: "f0f0f0f00f0f0f0e" })];
const arranged = arrangePhotos(t10, shuffled);
check("template 10: photos land in story order", arranged.used.map((i) => shuffled[i].name).join() === "dusk.jpg,night.jpg", arranged.used.map((i) => shuffled[i].name).join());
const report = checkSocialPhotos(t10, shuffled);
check("template 10: says it will reorder", report.reordered && report.findings.some((f) => /order/i.test(f.text)));
check("template 10: no fixes for a good set", report.findings.every((f) => f.level !== "fix"), JSON.stringify(report.findings.filter((f) => f.level === "fix")));

// Missing night photo: the night act gets a daylight photo instead, so the
// template asks for the night shot by name.
const noNight = [p("dusk.jpg", "exterior", "dusk", { w: 2400, h: 1600, hash: "f0f0f0f00f0f0f0e" }), p("day.jpg", "exterior", "day", { w: 2400, h: 1600, hash: "0f0f0f0ff0f0f0f0" })];
const missing = checkSocialPhotos(t10, noNight);
check("template 10: asks for the night photo", missing.findings.some((f) => f.level === "fix" && /night/i.test(f.text)), JSON.stringify(missing.findings.filter((f) => f.level === "fix").map((f) => f.text)));

// Too few photos
const few = checkSocialPhotos(t10, [p("a.jpg", "exterior", "day", { w: 2400, h: 1600 })]);
check("too few photos is a fix", few.verdict === "fix" && few.findings.some((f) => /at least/.test(f.text)));

// Too many photos: extras are left out and say they are not charged
const many = checkSocialPhotos(spec("front-vs-back"), [p("f.jpg", "exterior", "day"), p("b1.jpg", "outdoor", "day", { hash: "1111111111111111" }), p("b2.jpg", "outdoor", "day", { hash: "aaaa0000aaaa0000" }), p("x.jpg", "bedroom", "day", { hash: "0f1e2d3c4b5a6978" })]);
check("extra photos are left out", many.arrangement.unused.length === 1 && many.findings.some((f) => /not charged/.test(f.text)));

// Photo faults
const faulty = checkSocialPhotos(spec("front-vs-back"), [p("f.jpg", "exterior", "day", { w: 500, h: 800 }), p("b1.jpg", "outdoor", "day", { sharp: 4, hash: "1111111111111111" }), p("b2.jpg", "outdoor", "day", { bright: 10, hash: "aaaa0000aaaa0000" })]);
const text = faulty.findings.map((f) => f.text).join("\n");
check("small, soft and dark photos are flagged", /small/.test(text) && /soft/.test(text) && /dark/.test(text));
const dup = checkSocialPhotos(spec("front-vs-back"), [p("f.jpg", "exterior", "day"), p("b1.jpg", "outdoor", "day"), p("b2.jpg", "outdoor", "day")]);
check("near-duplicates are flagged", dup.findings.some((f) => /almost the same/.test(f.text)));
const landscape = checkSocialPhotos(spec("front-vs-back"), [p("f.jpg", "exterior", "day", { w: 2400, h: 1600 }), p("b1.jpg", "outdoor", "day", { hash: "1111111111111111" }), p("b2.jpg", "outdoor", "day", { hash: "aaaa0000aaaa0000" })]);
check("landscape on a vertical film is a tip about the crop", landscape.findings.some((f) => f.level === "tip" && /cropped/.test(f.text)));
const portraitWide = checkSocialPhotos(spec("brick-dusk"), [p("a.jpg", "exterior", "dusk", { w: 1200, h: 1800 })]);
check("portrait on a widescreen film is a fix", portraitWide.findings.some((f) => f.level === "fix" && /portrait/.test(f.text)));

// wrong room
const wrong = checkSocialPhotos(spec("front-vs-back"), [p("f.jpg", "kitchen", "day"), p("b1.jpg", "outdoor", "day", { hash: "1111111111111111" }), p("b2.jpg", "outdoor", "day", { hash: "aaaa0000aaaa0000" })]);
check("a kitchen where the front of the house is wanted is a fix", wrong.findings.some((f) => f.level === "fix" && /front/i.test(f.text)));
// pair views
const pairBad = checkSocialPhotos(spec("never-always-night"), [p("a.jpg", "exterior", "dusk", { hash: "ffffffff00000000" }), p("b.jpg", "exterior", "night", { hash: "0000000000ffffff" })]);
check("day and night that are not the same view get a tip", pairBad.findings.some((f) => /same (view|spot)/.test(f.text)));
// unknown classification keeps upload order
const unknown = arrangePhotos(t10, [1, 2].map((i) => ({ name: `${i}`, w: 2400, h: 1600, hash: `${i}`.repeat(16) })));
check("when photos cannot be read the upload order is kept", unknown.used.join() === "0,1");
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

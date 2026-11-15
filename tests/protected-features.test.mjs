// Fails if a feature Reda relies on has been removed from the Studio. See PROTECTED_FEATURES.md.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const studio = readFileSync("app/studio/page.tsx", "utf8");
const must = [
  "One prompt per scene", "One prompt, multiple images", "Build your scenes", "Add your shot images",
  "Finish your film", "Listing cards", "RealEstateBrandingPanel", "CardsPreview", "FinalSoundPanel",
  "Production settings", "Make the film", "EditFilm", "realEstateBasePrompt", "realEstateMovements", "multiShotStabilityLock",
];
for (const text of must) assert.ok(studio.includes(text), `Studio page lost: ${text}`);

// The finishing panel must never be conditional on photos being uploaded.
const start = studio.indexOf('Heading number="02" title="Finish your film"');
const end = studio.indexOf('<div className="series-workspace">', start);
assert.ok(start > 0 && end > start, "Finish panel not found");
assert.ok(!/shots\.some\(/.test(studio.slice(start, end)), "The finishing panel must always show, not wait for photos");

const panel = readFileSync("app/studio/final-edit.tsx", "utf8");
for (const text of ["Music", "Voiceover", "Sound effects"]) assert.ok(panel.includes(text), `Sound panel lost: ${text}`);

const library = readFileSync("app/admin/library-studio/page.tsx", "utf8");
assert.ok(library.includes("MusicLibrary"), "Library Studio lost the music library");
assert.ok(library.includes("WrenTemplates"), "Library Studio lost the MotionWren templates");
const wrencut = readFileSync("app/admin/wrencut/page.tsx", "utf8");
for (const text of ["Bring a reference", "Make the preview", "Show in Studio", "Update from a reference"]) assert.ok(wrencut.includes(text), `WrenCut lost: ${text}`);
assert.ok(readFileSync("app/studio/template-strip.tsx", "utf8").includes("api/admin/wrencut"), "The Studio template grid lost the WrenCut templates");
assert.ok(readFileSync("app/studio/template-strip.tsx", "utf8").includes("FxChips"), "The Studio template thumbnails lost their effect chips");
const editFilm = readFileSync("app/studio/edit-film.tsx", "utf8");
for (const text of ["Scenes and movement", "Listing cards", "Sound", "Your clips", "Edit again with a template"]) assert.ok(editFilm.includes(text), `The Edit film panel lost: ${text}`);
assert.ok(readFileSync("app/studio/page.tsx", "utf8").includes("TitlesPanel"), "The Studio finishing panel lost the cinematic titles");
const clipPicker = readFileSync("app/studio/clip-picker.tsx", "utf8");
assert.ok(clipPicker.includes("Use saved clips") || clipPicker.includes("saved clips"), "Studio lost the saved-clips picker");
assert.ok(readFileSync("app/api/studio/production/from-clips/route.ts", "utf8").includes("requireAdmin"), "The saved-clips route lost its admin check");
assert.ok(readFileSync("app/api/studio/clips/route.ts", "utf8").includes("requireAdmin"), "The clips list lost its admin check");
const studioPage = readFileSync("app/studio/page.tsx", "utf8");
for (const text of ["Photo shape", "Horizontal", "Social", "Crop-safe"]) assert.ok(studioPage.includes(text), `The Studio frame size lost: ${text}`);
for (const text of ["arrived and were checked", "Send again", "Checking every photo"]) assert.ok(studioPage.includes(text), `The Studio photo verification lost: ${text}`);
assert.ok(editFilm.includes("Frame"), "The Edit film panel lost the Frame (cut to 16:9 / vertical) choice");
const strip = readFileSync("app/studio/template-strip.tsx", "utf8");
for (const text of ["Social media", "SocialGuide"]) assert.ok(strip.includes(text), `The Studio template picker lost: ${text}`);
const socialGuide = readFileSync("app/studio/social-guide.tsx", "utf8");
for (const text of ["Your photos, in this order", "Check my photos", "Arrange my photos this way", "api/studio/social-check"]) assert.ok(socialGuide.includes(text), `The social photo guide lost: ${text}`);
assert.ok(readFileSync("app/api/studio/social-check/route.ts", "utf8").includes("requireAdmin"), "The social photo check lost its admin check");
assert.ok(readFileSync("app/admin/library-studio/wren-templates.tsx", "utf8").includes("Social media"), "Library Studio lost the Social media section");
assert.ok(readFileSync("app/api/studio/production/route.ts", "utf8").includes("socialOrder"), "Production stopped matching photos to a social template");
const qualityTab = readFileSync("app/studio/quality-tab.tsx", "utf8");
for (const text of ["Full screen", "QualityBadge", "Needs attention"]) assert.ok(qualityTab.includes(text), `The Quality tab lost: ${text}`);
const prodLib = readFileSync("app/api/_lib/production.ts", "utf8");
assert.ok(/MAX_FIX_ROUNDS = 2/.test(prodLib) && prodLib.includes("qualityState"), "The quality loop lost its three-attempt limit or its status");
assert.ok(readFileSync("app/api/_lib/render-jobs.ts", "utf8").includes("Quality problem not fixed"), "The unresolved-quality alert is gone");
assert.ok(readFileSync("app/api/history/route.ts", "utf8").includes("qualityState"), "History stopped reporting each film's quality status");
for (const text of ["Fix this scene", "attempts · see what was changed", "frames looked at"]) assert.ok(qualityTab.includes(text), `The Quality tab lost: ${text}`);
assert.ok(readFileSync("app/api/_lib/render-jobs.ts", "utf8").includes("fixSceneByHand") && readFileSync("app/api/studio/production/[id]/route.ts", "utf8").includes("fix-scene"), "The Fix this scene action is gone");
console.log("protected features: all present");

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
// The Frame picker shows on every film, including vertical ones, with all three shapes —
// a vertical film's dimensions change both ways — and the film's current shape is marked.
assert.ok(!editFilm.includes('data.aspect !== "vertical"'), "The Frame picker is hidden on vertical films again");
assert.ok(editFilm.includes('key: "horizontal", ratio: "16:9"') && editFilm.includes('key: "vertical", ratio: "9:16"'), "The Frame picker lost the 16:9 / 9:16 choices");
assert.ok(editFilm.includes("This film now"), "The Frame picker stopped marking the film's current shape");
// A dimensions-only edit must reach the composer on every path, not just multi-scene films:
// a single-clip film with a frame cut goes to the composer (not saved as-is), the composer
// accepts a single clip when a cut is set, the joiner prefers the composer when a cut is set,
// and the backup joiner cuts to the new frame instead of the film's original one.
const renderJobs = readFileSync("app/api/_lib/render-jobs.ts", "utf8");
assert.ok(renderJobs.includes("loadedManifest.edit?.reframe"), "A single-clip film with a frame cut is saved as-is, so the cut never lands");
assert.ok(renderJobs.includes("manifest.edit?.sound?.sfx || manifest.edit?.reframe"), "The joiner skips the composer for a frame-only edit");
assert.ok(renderJobs.includes("!manifest.edit?.sound?.sfx && !manifest.edit?.reframe"), "The composer refuses a single-clip frame cut");
assert.ok(renderJobs.includes("manifest?.edit?.reframe || row.aspect"), "The backup joiner cuts to the film's original frame, not the new one");
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
assert.ok(readFileSync("app/studio/variants.tsx", "utf8").includes("Make versions") && readFileSync("app/studio/edit-film.tsx", "utf8").includes("<Variants"), "Edit film lost Make versions");
assert.ok(readFileSync("app/api/studio/production/from-clips/route.ts", "utf8").includes("manifest.edit.reframe = canvas"), "Saved-clip films lost the social canvas cut");
console.log("protected features: all present");
assert.ok(readFileSync("app/studio/template-strip.tsx", "utf8").includes("Requirements:") && readFileSync("app/studio/variants.tsx", "utf8").includes("upscale: false"), "Template requirements or native-quality versions lost");
assert.ok(readFileSync("app/api/_lib/render-jobs.ts", "utf8").includes("export async function upscaleFinal") && readFileSync("app/studio/page.tsx", "utf8").includes("Upscale to 1080p"), "Upscale last-touch lost");
assert.ok(readFileSync("composer/wrencut.mjs", "utf8").includes("shotout") && readFileSync("composer/wrencut.mjs", "utf8").includes("lookahead"), "Template shot length guard lost");
assert.ok(readFileSync("composer/server.mjs", "utf8").includes("The picture came out"), "Picture-length check lost");

// Spending guard: the Spend page keeps its limits panel, and every engine charge still passes the guard.
assert.ok(readFileSync("app/admin/replicates/page.tsx", "utf8").includes("SpendGuardPanel"), "The Spend page lost the spending guard");
assert.ok(readFileSync("app/admin/replicates/spend-guard-panel.tsx", "utf8").includes("Pause all spending"), "The spending guard lost its pause switch");
assert.ok(readFileSync("app/api/_lib/provider.ts", "utf8").includes("guardAtEngine"), "createPrediction no longer asks the spending guard");
assert.ok(readFileSync("app/api/_lib/scene-queue.ts", "utf8").includes('"budget"'), "The scene queue no longer holds scenes at the spending limit");
assert.ok(readFileSync("app/studio/production.tsx", "utf8").includes("confirmSpend"), "Studio lost the per-film confirmation");

// Frame sizes in Edit film: original + 16:9, 9:16, 1:1, 4:5; several at once; the price is shown.
for (const text of ["frame-tiles", "FRAME_CHOICES", "SIZE_CENTS", "Original size", "This film now", '"square"', '"portrait"']) assert.ok(editFilm.includes(text), `Edit film lost: ${text}`);
assert.ok(readFileSync("app/api/_lib/render-jobs.ts", "utf8").includes('body.frame === "square" || body.frame === "portrait"'), "The edit lost the 1:1 and 4:5 sizes");

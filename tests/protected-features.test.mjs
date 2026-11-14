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
console.log("protected features: all present");

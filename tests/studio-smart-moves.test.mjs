import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync("app/studio/smart-moves.tsx", "utf8");
const body = /export function studioMove[\s\S]*?\n}\n/.exec(src)[0].replace("export function studioMove(move: string): StudioMove", "function studioMove(move)");
const studioMove = new Function(`${body}; return studioMove;`)();
const expected = { push: "push", pull: "pull", drop: "pull", rise: "tilt", slideLeft: "slide", slideRight: "slide" };
for (const [from, to] of Object.entries(expected)) assert.equal(studioMove(from), to, from);
console.log("PASS studio move mapping");

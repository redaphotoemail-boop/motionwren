import assert from "node:assert/strict";
import { planSequence, scoreMoves, MOVE_PHRASE, MOVES, cyclePicks, readMode } from "../app/api/_lib/movement-plan.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;
const corridor = { aspect: 1.5, convergence: 0.95, levelShare: 0.3, uprightShare: 0.4, floorOpen: 0.7, centreWeight: 0.6, vanishing: { x: 0.5, y: 0.46 } };
const flatWall = { aspect: 1.5, convergence: 0.05, levelShare: 0.8, uprightShare: 0.2, vanishing: null };
const house = { aspect: 1.55, convergence: 0.2, skyRatio: 0.4, greenRatio: 0.3, floorOpen: 0.5 };
const tallFacade = { aspect: 0.75, convergence: 0.1, uprightShare: 0.8, skyRatio: 0.3 };

{ const top = (m) => MOVES.reduce((a, b) => (scoreMoves(m)[b] > scoreMoves(m)[a] ? b : a)); assert.equal(top(corridor), "push"); assert.ok(["slideLeft", "slideRight"].includes(top(flatWall))); assert.equal(top(tallFacade), "rise"); assert.equal(top(house), "pull"); ok("the scene decides the move"); }
{ const picks = planSequence([flatWall, flatWall, flatWall, flatWall, flatWall, flatWall]); for (let i = 1; i < picks.length; i += 1) assert.notEqual(picks[i].move, picks[i - 1].move); ok("never the same move twice in a row"); }
{ const picks = planSequence([flatWall, house, flatWall, corridor, house]); assert.equal(picks[0].move, "push"); assert.equal(picks.at(-1).move, "pull"); ok("opens by moving in, closes by pulling back"); }
{ const picks = planSequence([corridor, corridor, corridor, corridor, corridor, corridor]); assert.ok(picks.filter((p) => p.move === "push").length <= 3); ok("moves are spread out"); }
{ const picks = planSequence([{ error: "bad" }, null, undefined, {}]); assert.equal(picks.length, 4); for (const p of picks) assert.ok(MOVE_PHRASE[p.move]); ok("unreadable photos still get a move"); }
{ const reading = [{ move: "rise", why: "tall windows" }, { move: "drop" }, {}]; const picks = planSequence([flatWall, flatWall, flatWall], reading); assert.equal(picks[1].move, "drop"); assert.ok(scoreMoves(flatWall, { move: "rise" }).rise > scoreMoves(flatWall).rise); ok("the AI reader's view counts"); }
{ assert.equal(planSequence([corridor]).length, 1); assert.equal(planSequence([]).length, 0); ok("one photo and none"); }
{ assert.equal(cyclePicks(7)[6].move, "push"); assert.equal(readMode("ai"), "ai"); assert.equal(readMode("off"), "off"); assert.equal(readMode(undefined), "opencv"); assert.equal(readMode("junk"), "opencv"); ok("standard order and the setting"); }
{ assert.equal(MOVE_PHRASE.push, "a slow stabilized push-in"); assert.equal(Object.keys(MOVE_PHRASE).length, 6); ok("only the existing movement phrases are used"); }
console.log(`${n} passed`);

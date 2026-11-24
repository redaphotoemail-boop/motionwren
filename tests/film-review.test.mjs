import assert from "node:assert/strict";
import { reviewStills } from "../app/api/_lib/film-review.ts";

let n = 0; const ok = (name) => console.log(`PASS ${name}`) || n++;
const still = new Uint8Array([1, 2, 3]);
// Cloudflare's small model "sees" a car that is not there, in every frame.
const guessing = { AI: { run: async () => ({ response: "ISSUE: car moved to the left" }) } };
const calm = { AI: { run: async () => ({ response: "OK" }) } };

{ // Cloudflare alone: its guesses are notes, never a flag (so never a paid re-make)
  delete process.env.ANTHROPIC_API_KEY;
  const review = await reviewStills(guessing, [still, still], [1, 3], { cloudflare: true, claude: false }, [still, still]);
  assert.equal(review.status, "pass"); assert.equal(review.findings.length, 0); assert.ok(review.notes.length >= 2);
  ok("Cloudflare alone never flags a film; its remarks are kept as notes");
}
{ // nothing to say: a clean pass and no notes
  const review = await reviewStills(calm, [still], [1], { cloudflare: true, claude: false }, [still]);
  assert.equal(review.status, "pass"); assert.equal(review.notes, undefined);
  ok("a clean film passes with no notes");
}
{ // Claude confirms: only then the film is flagged
  process.env.ANTHROPIC_API_KEY = "test";
  const real = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ content: [{ text: '{"issues":[{"frame":1,"issue":"door frame bends"}]}' }] }), { status: 200 }); };
  const review = await reviewStills(guessing, [still], [1], { cloudflare: true, claude: true }, [still]);
  assert.equal(review.status, "flag"); assert.ok(review.findings.some((item) => /door frame/.test(item.issue))); assert.ok(calls >= 1);
  ok("Claude's confirmed finding flags the film");
  globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ text: '{"issues":[]}' }] }), { status: 200 });
  const second = await reviewStills(guessing, [still], [1], { cloudflare: true, claude: true }, [still]);
  assert.equal(second.status, "pass"); assert.ok(second.notes.length >= 1);
  ok("when Claude sees nothing wrong, Cloudflare's guess is dropped (a note only)");
  globalThis.fetch = real; delete process.env.ANTHROPIC_API_KEY;
}
console.log(`${n} passed`);

/* Reality check: the AI compares each video still with the uploaded
   photograph it came from and flags anything added, removed, or changed.
   Run: npm run test:review — nothing leaves this box (mocked vision model
   and mocked Claude). */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const OUT = path.join(mkdtempSync(path.join(os.tmpdir(), "mw-reality-")), "film-review.mjs");
await build({ entryPoints: [path.join(REPO, "app/api/_lib/film-review.ts")], bundle: true, platform: "node", format: "esm", outfile: OUT, logLevel: "warning" });
const lib = await import(pathToFileURL(OUT).href);

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) pass += 1; else fail += 1; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };

const still = (n) => new Uint8Array([n, 9, 9, 9]);
const source = (n) => new Uint8Array([n, 7, 7, 7]);
const stills = [still(1), still(2), still(3)];
const times = [2.5, 7.5, 12.5];
const sources = [source(1), source(2), source(3)];

/* Mock Cloudflare vision. The artifact prompt gets one answer for every
   still; the reality describe step returns a fixed inventory; the reality
   check flags whichever still first-byte the test arms. */
function cfBinding({ artifact = "OK", flagByte = 0 } = {}) {
  const calls = [];
  const AI = {
    run: async (_model, input) => {
      calls.push(input.prompt);
      if (input.prompt.includes("Describe this real-estate photograph")) return { response: "A living room with a grey sofa, wooden floor, white walls, and a large window." };
      if (input.prompt.includes("This is a frame from a real-estate promo video")) return { response: artifact };
      if (input.prompt.includes("Compare the frame")) return { response: input.image[0] === flagByte ? "ISSUE: added a sofa" : "OK" };
      return { response: "OK" };
    },
  };
  return { env: { AI }, calls };
}
const describes = (calls) => calls.filter((prompt) => prompt.includes("Describe this real-estate photograph")).length;

// 1 — Cloudflare flags an added object in one pair
{
  const { env, calls } = cfBinding({ flagByte: 2 });
  const review = await lib.reviewStills(env, stills, times, { cloudflare: true, claude: false }, sources);
  check("1 Cloudflare flags an added object as a reality finding", review.status === "flag" && review.findings.length === 1 && review.findings[0].at === 7.5 && review.findings[0].issue === "Reality: added a sofa", JSON.stringify(review.findings));
  check("2 the source photograph is described once per pair", describes(calls) === 3, `${describes(calls)} describe calls`);
  check("3 the reality pass costs twice the artifact pass", review.costCents === 1.5, `costCents=${review.costCents}`);
  check("4 reality findings are counted separately", review.realityFindings === 1, `realityFindings=${review.realityFindings}`);
}

// 5 — clean pairs pass
{
  const { env } = cfBinding();
  const review = await lib.reviewStills(env, stills, times, { cloudflare: true, claude: false }, sources);
  check("5 clean pairs pass with no findings", review.status === "pass" && review.findings.length === 0 && review.realityFindings === 0, JSON.stringify(review));
}

// 6 — a missing source photo skips just that pair
{
  const { env, calls } = cfBinding();
  const review = await lib.reviewStills(env, stills, times, { cloudflare: true, claude: false }, [sources[0], null, sources[2]]);
  check("6 a missing source skips only its pair", review.status === "pass" && describes(calls) === 2, `${describes(calls)} describe calls`);
}

// 7 — an oversized source photo is skipped, the rest still run
{
  const { env, calls } = cfBinding();
  const big = new Uint8Array(lib.REALITY_SOURCE_MAX_BYTES + 1);
  const review = await lib.reviewStills(env, stills, times, { cloudflare: true, claude: false }, [big, sources[1], sources[2]]);
  check("7 an oversized source is skipped, the rest still run", review.status === "pass" && describes(calls) === 2, `${describes(calls)} describe calls`);
}

// 8 — no sources at all: the artifact check still runs, reality is skipped
{
  const { env, calls } = cfBinding();
  const review = await lib.reviewStills(env, stills, times, { cloudflare: true, claude: false });
  check("8 with no sources the artifact check still runs and reality is skipped", review.status === "pass" && review.costCents === 0.5 && review.realityFindings === 0 && describes(calls) === 0, JSON.stringify(review));
}

// 9 — the artifact check itself is unchanged by the refactor
{
  const { env } = cfBinding({ artifact: "ISSUE: bent wall" });
  const review = await lib.reviewStills(env, stills, times, { cloudflare: true, claude: false }, sources);
  check("9 an artifact flag still works and is not labelled reality", review.status === "flag" && review.findings.some((item) => item.issue === "bent wall"), JSON.stringify(review.findings));
}

// Claude legs (mocked fetch, no network)
const realFetch = globalThis.fetch;
function claudeFetch({ artifactIssues = [], realityIssues = [] }) {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const text = body.messages[0].content.map((part) => part.text || "").join(" ");
    const issues = text.includes("Source photograph") ? realityIssues : artifactIssues;
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify({ issues }) }] }), { status: 200 });
  };
}

// 10 — Claude alone compares pairs when Cloudflare is off
{
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = claudeFetch({ realityIssues: [{ frame: 1, issue: "removed the rug" }] });
  const review = await lib.reviewStills({}, stills, times, { cloudflare: false, claude: true }, sources);
  check("10 Claude alone flags a removed object as a reality finding", review.status === "flag" && review.findings.length === 1 && review.findings[0].at === 2.5 && review.findings[0].issue === "Reality: removed the rug", JSON.stringify(review.findings));
  check("11 Claude-only review costs artifact plus reality", review.costCents === 6, `costCents=${review.costCents}`);
  globalThis.fetch = realFetch;
  delete process.env.ANTHROPIC_API_KEY;
}

// 12 — Claude double-checks what Cloudflare flagged and overrules it
{
  const { env } = cfBinding({ flagByte: 2 });
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = claudeFetch({ realityIssues: [] });
  const review = await lib.reviewStills(env, stills, times, { cloudflare: true, claude: true }, sources);
  check("12 Claude overruling a reality flag clears it", review.status === "pass" && review.findings.length === 0 && review.realityFindings === 0, JSON.stringify(review));
  check("13 both reviewers cost artifact plus reality on each", review.costCents === 4.5, `costCents=${review.costCents}`);
  globalThis.fetch = realFetch;
  delete process.env.ANTHROPIC_API_KEY;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

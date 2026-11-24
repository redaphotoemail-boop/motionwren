/* Reads a film's photos and decides each one's camera movement (the scene
   first, then the story: see movement-plan.ts). Runs once per order when
   production starts. It never fails an order: whatever goes wrong, the film
   falls back to the standard movement order and the reason is recorded.

   Modes (Admin → Engines → Camera movement, platform_settings.movement_mode):
   · off     the standard order, as before.
   · opencv  OpenCV measures each photo in the composer (free).
   · ai      OpenCV's numbers plus an AI reader that looks at every photo
             (Claude when connected, otherwise Cloudflare's vision model). */

import { MOVES, cyclePicks, planSequence, readMode, type Measure, type Move, type MovementMode, type Pick, type Reading } from "./movement-plan";
import { composerBinding, measureMovements } from "./composer";
import { cloudflareRun, reviewersConnected } from "./film-review";

export const MOVEMENT_KEY = "movement_mode";
export const MOVEMENT_LAST_KEY = "movement_last";
const CLAUDE_MODEL = "claude-sonnet-5-5";
const AI_CENTS_CLAUDE = 4; // one call with every photo's small copy: a few cents
const AI_CENTS_CLOUDFLARE = 0.5;

type Env = { DB: D1Database } & Record<string, unknown>;
export type MovementPlan = { mode: MovementMode; used: MovementMode; picks: Pick[]; rooms?: string[]; costCents: number; note?: string; at: number };

const secret = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined) || undefined;

export async function movementMode(env: Env): Promise<MovementMode> {
  try {
    const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind(MOVEMENT_KEY).first<{ value?: string }>();
    return readMode(row?.value);
  } catch { return "opencv"; }
}

export async function movementStatus(env: Env) {
  let last: MovementPlan | null = null;
  try {
    const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind(MOVEMENT_LAST_KEY).first<{ value?: string }>();
    last = row?.value ? JSON.parse(row.value) as MovementPlan : null;
  } catch { last = null; }
  const reader = reviewersConnected(env);
  return { mode: await movementMode(env), reader: { photoReader: Boolean(composerBinding(env)), claude: reader.claude, cloudflare: reader.cloudflare }, last: last ? { at: last.at, mode: last.mode, used: last.used, note: last.note || "", costCents: last.costCents, moves: last.picks.length } : null };
}

const toBytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const moveWord = "push (move in), pull (pull back), slideRight (slide left to right), slideLeft (slide right to left), rise (upward reveal), drop (downward reveal)";
const ASK = `You are choosing the gentle camera movement for each photo of a real-estate video. The camera only moves; the home never changes. For every photo say what it shows (a few words) and which movement suits THAT SCENE best, with one alternative. Choose by the scene itself: depth and lines that lead inwards suit "push"; wide establishing views and outside views suit "pull"; flat walls, long rooms and furniture across the frame suit a slide; tall facades, stairs and tall windows suit "rise"; gardens, pools and surfaces seen from above suit "drop". Movements: ${moveWord}.`;

async function readWithClaude(thumbs: string[], measures: Measure[]): Promise<Reading[]> {
  const content: Record<string, unknown>[] = [];
  thumbs.forEach((thumb, index) => {
    content.push({ type: "text", text: `Photo ${index + 1}${measures[index]?.convergence !== undefined ? ` (lines lead inwards: ${Math.round((measures[index].convergence || 0) * 100)}%)` : ""}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: thumb } });
  });
  content.push({ type: "text", text: `${ASK}\nReply with JSON only: {"photos":[{"photo":<number>,"room":"<2-4 words>","move":"<movement>","alt":"<movement>","why":"<under 10 words>"}]} with one entry per photo, in order.` });
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": secret("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 150 + 60 * thumbs.length, messages: [{ role: "user", content }] }), signal: AbortSignal.timeout(60_000) });
  const data = await response.json().catch(() => null) as { content?: { text?: string }[]; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message || `The AI reader answered HTTP ${response.status}.`);
  const text = data?.content?.map((part) => part.text || "").join("") || "";
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  const parsed = json ? JSON.parse(json) as { photos?: { photo?: number; room?: string; move?: string; alt?: string; why?: string }[] } : {};
  const out: Reading[] = thumbs.map(() => ({}));
  for (const item of parsed.photos || []) {
    const index = Number(item.photo) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= out.length) continue;
    out[index] = { room: String(item.room || "").slice(0, 40), move: MOVES.includes(item.move as Move) ? item.move as Move : undefined, alt: MOVES.includes(item.alt as Move) ? item.alt as Move : undefined, why: String(item.why || "").slice(0, 90) };
  }
  return out;
}

async function readWithCloudflare(env: Env, thumbs: string[]): Promise<Reading[]> {
  const out: Reading[] = [];
  for (const thumb of thumbs) {
    try {
      const text = await cloudflareRun(env, toBytes(thumb), `${ASK} Answer with exactly one line: "<room in 2-4 words> | <movement>" using one of: push, pull, slideRight, slideLeft, rise, drop.`, 30);
      const [room, word] = text.split("|").map((part) => part.trim());
      const move = MOVES.find((candidate) => new RegExp(`\\b${candidate}\\b`, "i").test(word || ""));
      out.push({ room: (room || "").slice(0, 40), move });
    } catch { out.push({}); }
  }
  return out;
}

async function remember(env: Env, plan: MovementPlan) {
  try { await env.DB.prepare("INSERT INTO platform_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(MOVEMENT_LAST_KEY, JSON.stringify(plan), Date.now()).run(); } catch { /* the plan itself is kept with the film */ }
}

/** Plans one movement per photo. `links` are links the composer can open (the provider links of the photos). */
export async function planMovements(env: Env, name: string, links: (string | { data: string })[], mode?: MovementMode, options: { remember?: boolean } = {}): Promise<MovementPlan> {
  const wanted = mode || await movementMode(env);
  const fallback = (note: string): MovementPlan => ({ mode: wanted, used: "off", picks: cyclePicks(links.length), costCents: 0, note, at: Date.now() });
  if (wanted === "off") return fallback("Smart movement is off: the standard order.");
  if (links.length < 1) return fallback("No photos to read.");
  let plan: MovementPlan;
  try {
    const wantAi = wanted === "ai";
    const read = await measureMovements(env, name, links, wantAi);
    const measures = read.photos as Measure[];
    if (measures.length !== links.length) throw new Error("The photo reader returned the wrong number of photos.");
    let readings: Reading[] = [];
    let cents = 0; let note = `OpenCV read ${measures.filter((item) => !item.error).length} of ${links.length} photos.`;
    let used: MovementMode = "opencv";
    if (wantAi) {
      const thumbs = read.photos.map((item) => item.thumb || "");
      const have = thumbs.every(Boolean);
      const connected = reviewersConnected(env);
      try {
        if (!have) throw new Error("Some photos could not be shown to the AI reader.");
        if (connected.claude) { readings = await readWithClaude(thumbs, measures); cents = AI_CENTS_CLAUDE; used = "ai"; note = "The AI reader looked at every photo, with OpenCV's measurements."; }
        else if (connected.cloudflare) { readings = await readWithCloudflare(env, thumbs); cents = AI_CENTS_CLOUDFLARE * links.length; used = "ai"; note = "The AI reader looked at every photo (Cloudflare), with OpenCV's measurements."; }
        else throw new Error("No AI reader is connected.");
      } catch (error) { note = `The AI reader was not used (${String(error instanceof Error ? error.message : error).slice(0, 120)}); OpenCV chose the movements.`; }
    }
    plan = { mode: wanted, used, picks: planSequence(measures, readings), rooms: readings.map((item) => item.room || ""), costCents: Math.round(cents * 10) / 10, note, at: Date.now() };
  } catch (error) {
    plan = fallback(`The photos could not be read (${String(error instanceof Error ? error.message : error).slice(0, 140)}); the standard order was used.`);
  }
  if (options.remember !== false) await remember(env, plan);
  return plan;
}

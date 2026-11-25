/* True to the photo: how a customer film is planned so it never shows a home that isn't there.

   Reda's rule (Nov 25, 2026): a film must never invent space or anything unreal, for good.
   Why films drifted: slides, pull-backs, rises and drops move the camera into space the photo
   never showed, so the video engine had to make that space up. A push-in only ever shows less
   of the photo than the photo itself, so there is nothing to invent.

   For every customer order, when production starts:
   1. Each photo is read once. OpenCV (in the composer, free) finds where the photo's lines lead
      (its focal point). An AI reader names the room (Cloudflare's vision model by default, or
      Claude when Admin chooses it and a key is set; setting `scene_reader`).
   2. The scenes are put in walkthrough order: exterior, entry, living, dining, kitchen, bedroom,
      bathroom, outdoor. Rooms the reader could not name stay next to the scene before them; if
      most can't be named, the customer's own order is kept.
   3. Every scene is a very slow, short push-in toward the photo's focal point, with a frame lock
      that forbids anything beyond the photo's edges.
   Anything that goes wrong falls back to the customer's order and centred push-ins; an order
   never waits on this. The plan and its reasons are saved in the film's manifest. */

import { measureMovements } from "./composer";
import { cloudflareRun, reviewersConnected } from "./film-review";
import { roomIn } from "./room-order";
import { storyOrderIndexes, type Room } from "../../wrencut-fit";
import type { Pick } from "./movement-plan";

export type Focus = "left" | "center" | "right";
export type SceneReader = "cloudflare" | "claude" | "off";
export const SCENE_READER_KEY = "scene_reader";
const CLAUDE_MODEL = "claude-sonnet-5-5";
const CF_CENTS_PER_PHOTO = 0.5;
const CLAUDE_CENTS = 4;

/** The only camera moves a customer film uses: slow, short push-ins that stay inside the photo. */
export const TRUE_MOVE: Record<Focus, string> = {
  center: "A very slow, gentle push-in toward the centre of the photo, travelling only a short distance over the whole shot",
  left: "A very slow, gentle push-in drifting slightly toward the left of the photo, travelling only a short distance over the whole shot",
  right: "A very slow, gentle push-in drifting slightly toward the right of the photo, travelling only a short distance over the whole shot",
};

/** Added after the movement and the baked lock: the camera never leaves the photograph. */
export const FRAME_LOCK = "The camera stays inside the original photograph for the whole shot: it never reveals anything beyond the edges of the photo, never turns, never travels into another room, and never adds rooms, walls, windows, doors, furniture, landscaping or architecture that are not in the photo. Calm, cinematic pace.";

export type TrueToPhotoPlan = {
  order: number[];
  focus: Focus[];
  rooms: (Room | null)[];
  reader: SceneReader | "none";
  ordered: boolean;
  costCents: number;
  note: string;
  at: number;
};

const secret = (name: string) => (typeof process !== "undefined" ? process.env?.[name] : undefined) || undefined;
const toBytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

/** OpenCV's vanishing point → where the push-in leans (only a slight drift; most photos stay centred). */
export function focusFrom(x: number | null | undefined): Focus {
  if (typeof x !== "number" || !Number.isFinite(x)) return "center";
  return x < 0.4 ? "left" : x > 0.6 ? "right" : "center";
}

export async function sceneReader(env: { DB: D1Database }): Promise<SceneReader> {
  try {
    const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = ?1").bind(SCENE_READER_KEY).first<{ value?: string }>();
    const value = String(row?.value || "");
    return value === "claude" || value === "off" ? value : "cloudflare";
  } catch { return "cloudflare"; }
}

const ROOM_QUESTION = "What is the main subject of this real-estate photograph? Answer with exactly one word from this list: exterior, entry, living, dining, kitchen, bedroom, bathroom, outdoor. Use exterior for the front or outside of the house, outdoor for a patio, pool, yard or view.";

async function roomsWithCloudflare(env: unknown, thumbs: string[]): Promise<(Room | null)[]> {
  return Promise.all(thumbs.map(async (thumb) => {
    if (!thumb) return null;
    try {
      const answer = await Promise.race([cloudflareRun(env, toBytes(thumb), ROOM_QUESTION, 8), new Promise<string>((resolve) => setTimeout(() => resolve(""), 12000))]);
      return roomIn(answer);
    } catch { return null; }
  }));
}

async function roomsWithClaude(thumbs: string[]): Promise<(Room | null)[]> {
  const content: Record<string, unknown>[] = [];
  thumbs.forEach((thumb, index) => {
    content.push({ type: "text", text: `Photo ${index + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: thumb } });
  });
  content.push({ type: "text", text: `${ROOM_QUESTION}\nReply with JSON only: {"rooms":["<word>", ...]} with one word per photo, in order.` });
  const response = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": secret("ANTHROPIC_API_KEY") || "", "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 400, messages: [{ role: "user", content }] }), signal: AbortSignal.timeout(40_000) });
  const data = await response.json().catch(() => null) as { content?: { text?: string }[]; error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message || `The AI reader answered HTTP ${response.status}.`);
  const text = data?.content?.map((part) => part.text || "").join("") || "";
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  const rooms = (json ? (JSON.parse(json) as { rooms?: unknown[] }).rooms : []) || [];
  return thumbs.map((_, index) => roomIn(String(rooms[index] ?? "")));
}

/** Plans a customer film so it stays true to the photos. Never throws. */
export async function planTrueToPhoto(env: { DB: D1Database } & Record<string, unknown>, name: string, links: string[]): Promise<TrueToPhotoPlan> {
  const identity = links.map((_, index) => index);
  const base: TrueToPhotoPlan = { order: identity, focus: links.map(() => "center"), rooms: links.map(() => null), reader: "none", ordered: false, costCents: 0, note: "", at: Date.now() };
  if (links.length < 1) return { ...base, note: "No photos to read." };
  const wanted = await sceneReader(env);
  let thumbs: string[] = [];
  try {
    const read = await measureMovements(env, `true-${name}`, links, wanted !== "off");
    if (read.photos.length === links.length) {
      base.focus = read.photos.map((photo) => photo.error ? "center" : focusFrom(photo.vanishing?.x));
      thumbs = read.photos.map((photo) => photo.thumb || "");
      base.note = `OpenCV read ${read.photos.filter((photo) => !photo.error).length} of ${links.length} photos.`;
    } else base.note = "The photo reader returned the wrong number of photos; moves are centred.";
  } catch (error) {
    base.note = `The photos could not be measured (${String(error instanceof Error ? error.message : error).slice(0, 120)}); moves are centred.`;
  }
  if (wanted === "off") return { ...base, note: `${base.note} Scene reading is off: the customer's order is kept.` };
  if (thumbs.length !== links.length || !thumbs.every(Boolean)) return { ...base, note: `${base.note} Photos could not be shown to the AI reader: the customer's order is kept.` };
  const connected = reviewersConnected(env);
  const reader: SceneReader | "none" = wanted === "claude" && connected.claude ? "claude" : connected.cloudflare ? "cloudflare" : "none";
  if (reader === "none") return { ...base, note: `${base.note} No AI reader is connected: the customer's order is kept.` };
  try {
    const rooms = reader === "claude" ? await roomsWithClaude(thumbs) : await roomsWithCloudflare(env, thumbs);
    const order = storyOrderIndexes(rooms);
    const ordered = order.some((value, index) => value !== index);
    const named = rooms.filter(Boolean).length;
    return {
      ...base,
      order,
      rooms,
      reader,
      ordered,
      costCents: reader === "claude" ? CLAUDE_CENTS : CF_CENTS_PER_PHOTO * links.length,
      note: `${base.note} ${reader === "claude" ? "Claude" : "Cloudflare"} named ${named} of ${links.length} rooms${ordered ? "; scenes put in walkthrough order." : named < Math.ceil(links.length / 2) ? "; too few to reorder, the customer's order is kept." : "; already in walkthrough order."}${wanted === "claude" && reader !== "claude" ? " (Claude was chosen but no Anthropic key is set.)" : ""}`,
    };
  } catch (error) {
    return { ...base, note: `${base.note} The AI reader failed (${String(error instanceof Error ? error.message : error).slice(0, 120)}): the customer's order is kept.` };
  }
}

/** The movement plan as the rest of the app records it (History, Edit film): every scene a push-in. */
export function truePicks(plan: TrueToPhotoPlan): Pick[] {
  return plan.order.map((original) => ({ move: "push", why: `${plan.rooms[original] ? `${plan.rooms[original]}: ` : ""}a slow push-in that stays inside the photo${plan.focus[original] !== "center" ? `, leaning ${plan.focus[original]}` : ""}` }));
}

/** The engine prompt for one scene: the true move, the baked lock (unchanged), then the frame lock. */
export function truePrompt(focus: Focus, staticLock: string) {
  return `${TRUE_MOVE[focus]}. ${staticLock} ${FRAME_LOCK}`;
}

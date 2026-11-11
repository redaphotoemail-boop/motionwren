/* The music library. Every track ElevenLabs makes for a film is kept here,
   under the film's style (warm, modern, luxe, bright). Once a style has enough
   tracks, new films take the least-used one instead of paying for a new
   track, so the music varies and the cost stops growing. The manager can also
   add tracks by hand, switch tracks off, or delete them. The table is created
   on first use, so no separate migration has to be run. */

import { MUSIC_TEMPLATES } from "../../music-catalog";

type Env = { DB: D1Database; BUCKET: R2Bucket };
export type LibraryTrack = { id: string; style: string; name: string; seconds: number; source: string; uses: number; active: boolean; createdAt: number };

export const libraryKey = (id: string) => `music-library/${id}.mp3`;
export const DEFAULT_TARGET = 5;

let ready = false;
async function ensure(env: Env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS music_library (id TEXT PRIMARY KEY, style TEXT NOT NULL, name TEXT NOT NULL, r2_key TEXT NOT NULL, seconds REAL NOT NULL, source TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_used_at INTEGER)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS music_library_style_idx ON music_library (style, active)`),
  ]);
  ready = true;
}

/* The style a prompt belongs to (the prompts are the templates'). */
export const styleOfPrompt = (prompt: string) => MUSIC_TEMPLATES.find((template) => template.prompt === prompt)?.id || "";

export async function libraryTarget(env: Env) {
  const row = await env.DB.prepare(`SELECT value FROM platform_settings WHERE key = 'music_library_target'`).first<{ value?: string }>().catch(() => null);
  const value = Number(row?.value);
  return Number.isFinite(value) && value >= 0 && value <= 50 ? Math.floor(value) : DEFAULT_TARGET;
}

export async function setLibraryTarget(env: Env, target: number) {
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('music_library_target', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(String(Math.max(0, Math.min(50, Math.floor(target)))), Date.now()).run();
}

const rowToTrack = (row: Record<string, unknown>): LibraryTrack => ({ id: String(row.id), style: String(row.style), name: String(row.name), seconds: Number(row.seconds), source: String(row.source), uses: Number(row.uses), active: Boolean(row.active), createdAt: Number(row.created_at) });

export async function listTracks(env: Env): Promise<LibraryTrack[]> {
  await ensure(env);
  const { results } = await env.DB.prepare(`SELECT * FROM music_library ORDER BY style, created_at DESC`).all<Record<string, unknown>>();
  return (results || []).map(rowToTrack);
}

/* The library's pick for a film: only once the style holds at least `target`
   usable tracks (long enough, switched on); then the least-used, oldest first. */
export async function pickTrack(env: Env, style: string, seconds: number) {
  if (!style) return null;
  await ensure(env);
  const target = await libraryTarget(env);
  if (target < 1) return null;
  const { results } = await env.DB.prepare(`SELECT * FROM music_library WHERE style = ? AND active = 1 AND seconds >= ? ORDER BY uses ASC, COALESCE(last_used_at, 0) ASC`).bind(style, seconds).all<Record<string, unknown>>();
  const usable = results || [];
  if (usable.length < target) return null;
  const least = usable.filter((row) => Number(row.uses) === Number(usable[0].uses));
  return rowToTrack(least[Math.floor(Math.random() * least.length)]);
}

export async function markUsed(env: Env, id: string) {
  await env.DB.prepare(`UPDATE music_library SET uses = uses + 1, last_used_at = ? WHERE id = ?`).bind(Date.now(), id).run();
}

/* Keeps a track a film just used. `data` is the mp3. */
export async function addTrack(env: Env, input: { style: string; seconds: number; source: string; name?: string; data: ArrayBuffer | Uint8Array }) {
  await ensure(env);
  if (!MUSIC_TEMPLATES.some((template) => template.id === input.style)) throw new Error("Unknown music style.");
  const id = crypto.randomUUID();
  const style = MUSIC_TEMPLATES.find((template) => template.id === input.style)!;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM music_library WHERE style = ?`).bind(input.style).first<{ n: number }>();
  const name = (input.name || "").trim().slice(0, 80) || `${style.name} ${(count?.n || 0) + 1}`;
  await env.BUCKET.put(libraryKey(id), input.data, { httpMetadata: { contentType: "audio/mpeg" } });
  await env.DB.prepare(`INSERT INTO music_library (id, style, name, r2_key, seconds, source, uses, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`).bind(id, input.style, name, libraryKey(id), Math.round(input.seconds * 10) / 10, input.source, input.source === "upload" ? 0 : 1, Date.now()).run();
  return id;
}

export async function updateTrack(env: Env, id: string, patch: { active?: boolean; name?: string }) {
  await ensure(env);
  if (typeof patch.active === "boolean") await env.DB.prepare(`UPDATE music_library SET active = ? WHERE id = ?`).bind(patch.active ? 1 : 0, id).run();
  if (typeof patch.name === "string" && patch.name.trim()) await env.DB.prepare(`UPDATE music_library SET name = ? WHERE id = ?`).bind(patch.name.trim().slice(0, 80), id).run();
}

export async function deleteTrack(env: Env, id: string) {
  await ensure(env);
  await env.DB.prepare(`DELETE FROM music_library WHERE id = ?`).bind(id).run();
  await env.BUCKET.delete(libraryKey(id)).catch(() => undefined);
}

export async function trackAudio(env: Env, id: string) {
  await ensure(env);
  const row = await env.DB.prepare(`SELECT r2_key FROM music_library WHERE id = ?`).bind(id).first<{ r2_key?: string }>();
  return row?.r2_key ? env.BUCKET.get(row.r2_key) : null;
}

/* Any usable track of a style (for a sample preview when none has been made yet). */
export async function anyTrackId(env: Env, style: string) {
  await ensure(env);
  const row = await env.DB.prepare(`SELECT id FROM music_library WHERE style = ? AND active = 1 ORDER BY uses ASC LIMIT 1`).bind(style).first<{ id?: string }>();
  return row?.id || null;
}

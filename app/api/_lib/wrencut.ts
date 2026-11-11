/* WrenCut on the Worker: templates (recipes) in D1, their preview clips in R2,
   and the reading of a reference video through the composer. The table is
   created on first use, so no separate migration has to be run. The reference
   video is never kept: the composer deletes it after reading, and only the
   recipe (numbers) is stored under the name "MotionWren N". */

import { composerBinding } from "./composer";
import { parseRecipe, recipePhotos, recipeSeconds, type WrenRecipe, type WrenTemplate } from "../../wrencut";

type Env = { DB: D1Database; BUCKET: R2Bucket };
type Stub = { fetch(input: string | Request, init?: RequestInit): Promise<Response> };

export const previewKey = (id: string) => `wrencut/${id}/preview.mp4`;
export const referenceKey = (id: string) => `wrencut/ref-${id}.bin`;

let ready = false;
async function ensure(env: Env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wrencut_templates (id TEXT PRIMARY KEY, number INTEGER NOT NULL, name TEXT NOT NULL, recipe TEXT NOT NULL, preview INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`),
    /* One short-lived link per file the composer must fetch (a reference upload or a History video). */
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wrencut_links (id TEXT PRIMARY KEY, token TEXT NOT NULL, r2_key TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS wrencut_reads (job TEXT PRIMARY KEY, status TEXT NOT NULL, template_id TEXT, error TEXT, ref_key TEXT, created_at INTEGER NOT NULL)`),
  ]);
  ready = true;
}

const rowToTemplate = (row: Record<string, unknown>): WrenTemplate | null => {
  const recipe = parseRecipe(row.recipe);
  if (!recipe) return null;
  const preview = Boolean(row.preview);
  return { id: `wren:${row.id}`, name: String(row.name), seconds: recipeSeconds(recipe), photos: recipePhotos(recipe), hasPreview: preview, ...(preview ? { previewUrl: `/api/wrencut/${row.id}/preview` } : {}), active: Boolean(row.active), createdAt: Number(row.created_at) };
};

export async function listTemplates(env: Env, onlyActive = false): Promise<WrenTemplate[]> {
  await ensure(env);
  const { results } = await env.DB.prepare(`SELECT * FROM wrencut_templates ${onlyActive ? "WHERE active = 1" : ""} ORDER BY number DESC`).all<Record<string, unknown>>();
  return (results || []).map(rowToTemplate).filter((item): item is WrenTemplate => Boolean(item));
}

export async function getRecipe(env: Env, wrenId: string): Promise<{ recipe: WrenRecipe; name: string } | null> {
  await ensure(env);
  const id = wrenId.replace(/^wren:/, "");
  const row = await env.DB.prepare(`SELECT recipe, name FROM wrencut_templates WHERE id = ? AND active = 1`).bind(id).first<{ recipe: string; name: string }>();
  const recipe = row ? parseRecipe(row.recipe) : null;
  return row && recipe ? { recipe, name: row.name } : null;
}

/* Stores a recipe as the next "MotionWren N". Nothing about its source is kept. */
export async function saveTemplate(env: Env, recipe: WrenRecipe): Promise<WrenTemplate> {
  await ensure(env);
  const id = crypto.randomUUID();
  const last = await env.DB.prepare(`SELECT MAX(number) AS n FROM wrencut_templates`).first<{ n: number | null }>();
  const number = (last?.n || 0) + 1;
  const clean: WrenRecipe = { version: 1, duration: recipe.duration, fps: recipe.fps, aspect: recipe.aspect, slots: recipe.slots, joins: recipe.joins, ...(recipe.grade ? { grade: recipe.grade } : {}) };
  await env.DB.prepare(`INSERT INTO wrencut_templates (id, number, name, recipe, preview, active, created_at) VALUES (?, ?, ?, ?, 0, 1, ?)`).bind(id, number, `MotionWren ${number}`, JSON.stringify(clean), Date.now()).run();
  return (await listTemplates(env)).find((item) => item.id === `wren:${id}`)!;
}

export async function setActive(env: Env, id: string, active: boolean) {
  await ensure(env);
  await env.DB.prepare(`UPDATE wrencut_templates SET active = ? WHERE id = ?`).bind(active ? 1 : 0, id).run();
}

export async function deleteTemplate(env: Env, id: string) {
  await ensure(env);
  await env.DB.prepare(`DELETE FROM wrencut_templates WHERE id = ?`).bind(id).run();
  await env.BUCKET.delete(previewKey(id)).catch(() => undefined);
}

export async function markPreview(env: Env, id: string) {
  await ensure(env);
  await env.DB.prepare(`UPDATE wrencut_templates SET preview = 1 WHERE id = ?`).bind(id).run();
}

/* A link the composer can fetch for one stored file; it works only with its token. */
export async function fileLink(env: Env, origin: string, r2Key: string) {
  await ensure(env);
  const id = crypto.randomUUID();
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
  await env.DB.prepare(`INSERT INTO wrencut_links (id, token, r2_key, created_at) VALUES (?, ?, ?, ?)`).bind(id, token, r2Key, Date.now()).run();
  await env.DB.prepare(`DELETE FROM wrencut_links WHERE created_at < ?`).bind(Date.now() - 24 * 3600 * 1000).run().catch(() => undefined);
  return `${origin}/api/wrencut/file/${id}?token=${token}`;
}

export async function linkedKey(env: Env, id: string, token: string) {
  await ensure(env);
  const row = await env.DB.prepare(`SELECT r2_key AS key, token FROM wrencut_links WHERE id = ?`).bind(id).first<{ key: string; token: string }>();
  return row && row.token === token ? row.key : null;
}

/* ---------- reading a reference through the composer ---------- */

function stub(env: unknown, name: string): Stub {
  const namespace = composerBinding(env);
  if (!namespace) throw new Error("The editing service is not available.");
  return namespace.getByName ? namespace.getByName(name) : namespace.get(namespace.idFromName(name));
}

export type ReadState = { status: "running" | "done" | "failed" | "unknown"; stage?: string; error?: string; recipe?: WrenRecipe };

export async function startRead(env: Env, job: string, link: string, refKey: string | null = null) {
  await ensure(env);
  const response = await stub(env, `wrencut-${job}`).fetch(`http://composer/analyze/${job}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link }) });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `The editing service refused the video (HTTP ${response.status}).`);
  await env.DB.prepare(`INSERT OR IGNORE INTO wrencut_reads (job, status, ref_key, created_at) VALUES (?, 'running', ?, ?)`).bind(job, refKey, Date.now()).run();
}

/* The uploaded reference is deleted as soon as the reading ends, either way. */
async function dropReference(env: Env, job: string) {
  const row = await env.DB.prepare(`SELECT ref_key AS key FROM wrencut_reads WHERE job = ?`).bind(job).first<{ key: string | null }>();
  if (row?.key) { await env.BUCKET.delete(row.key).catch(() => undefined); await env.DB.prepare(`DELETE FROM wrencut_links WHERE r2_key = ?`).bind(row.key).run().catch(() => undefined); }
}

/* Polls the composer; when the reading is done, makes the template exactly once. */
export async function readState(env: Env, job: string): Promise<{ status: string; stage?: string; error?: string; template?: WrenTemplate }> {
  await ensure(env);
  const saved = await env.DB.prepare(`SELECT status, template_id AS templateId, error FROM wrencut_reads WHERE job = ?`).bind(job).first<{ status: string; templateId: string | null; error: string | null }>();
  if (!saved) return { status: "unknown" };
  if (saved.status === "done" && saved.templateId) return { status: "done", template: (await listTemplates(env)).find((item) => item.id === `wren:${saved.templateId}`) };
  if (saved.status === "failed") return { status: "failed", error: saved.error || "The video could not be read." };
  const response = await stub(env, `wrencut-${job}`).fetch(`http://composer/analyze/${job}`);
  const data = await response.json().catch(() => null) as ReadState | null;
  if (!data || data.status === "unknown") {
    // The reading service restarted before finishing.
    await env.DB.prepare(`UPDATE wrencut_reads SET status = 'failed', error = ? WHERE job = ?`).bind("The reading was interrupted. Try again.", job).run();
    await dropReference(env, job);
    return { status: "failed", error: "The reading was interrupted. Try again." };
  }
  if (data.status === "failed") {
    await env.DB.prepare(`UPDATE wrencut_reads SET status = 'failed', error = ? WHERE job = ?`).bind(data.error || "The video could not be read.", job).run();
    await stub(env, `wrencut-${job}`).fetch(`http://composer/analyze/${job}`, { method: "DELETE" }).catch(() => undefined);
    await dropReference(env, job);
    return { status: "failed", error: data.error || "The video could not be read." };
  }
  if (data.status === "done" && data.recipe) {
    // Claim the result once, so two polls never make two templates.
    const claim = await env.DB.prepare(`UPDATE wrencut_reads SET status = 'saving' WHERE job = ? AND status = 'running'`).bind(job).run();
    if (!claim.meta.changes) return { status: "running", stage: "saving" };
    let template: WrenTemplate;
    try { template = await saveTemplate(env, data.recipe); }
    catch (error) { await env.DB.prepare(`UPDATE wrencut_reads SET status = 'running' WHERE job = ?`).bind(job).run(); throw error; }
    await env.DB.prepare(`UPDATE wrencut_reads SET status = 'done', template_id = ? WHERE job = ?`).bind(template.id.replace(/^wren:/, ""), job).run();
    await stub(env, `wrencut-${job}`).fetch(`http://composer/analyze/${job}`, { method: "DELETE" }).catch(() => undefined);
    await dropReference(env, job);
    return { status: "done", template };
  }
  return { status: "running", stage: data.stage };
}

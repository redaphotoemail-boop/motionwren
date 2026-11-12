/* Builds a template's preview clip from real footage: videos picked from
   History (cut to fit) and/or uploaded photos. POST starts it; GET ?id=…
   checks it and, when finished, stores the clip and shows it on the tile. */
import { jsonError, requireAdmin } from "../../../_lib/account";
import { historyOwnerIds } from "../../../_lib/history-owners";
import { dropEdit, editFile, editKey, editState, startEdit, storeResponse } from "../../../_lib/composer";
import { makeCutEffects, trackKey } from "../../../_lib/film-sound";
import { fileLink, getRecipe, markPreview, previewKey } from "../../../_lib/wrencut";
import { joinTimes, recipeSeconds } from "../../../../wrencut";

const jobOf = (id: string) => `wrenprev-${id}`;
const KEY = (id: string) => editKey(jobOf(id), 1);

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const ownerIds = await historyOwnerIds(env);
    const body = await request.json().catch(() => ({})) as { id?: unknown; history?: unknown; photos?: unknown };
    const id = typeof body.id === "string" ? body.id.replace(/^wren:/, "") : "";
    const found = /^[0-9a-f-]{36}$/.test(id) ? await getRecipe(env, id) : null;
    if (!found) return Response.json({ error: "Unknown template." }, { status: 404 });
    const history = Array.isArray(body.history) ? body.history.filter((item): item is string => typeof item === "string" && /^[0-9a-f-]{36}$/i.test(item)).slice(0, 12) : [];
    const photos = Array.isArray(body.photos) ? body.photos.filter((item): item is string => typeof item === "string" && /^wrencut\/photo-[0-9a-f-]{36}$/.test(item)).slice(0, 12) : [];
    if (!history.length && !photos.length) return Response.json({ error: "Choose at least one video from History or upload photos." }, { status: 400 });
    const origin = new URL(request.url).origin;
    const clips: string[] = [], moves: (string | null)[] = [];
    for (const historyId of history) {
      const row = ownerIds.length ? await env.DB.prepare(`SELECT r2_key AS key FROM generation_history WHERE id = ? AND owner_id IN (${ownerIds.map(() => "?").join(",")}) LIMIT 1`).bind(historyId, ...ownerIds).first<{ key: string }>() : null;
      if (!row) return Response.json({ error: "One of the chosen videos was not found in History." }, { status: 404 });
      clips.push(await fileLink(env, origin, row.key)); moves.push(null);
    }
    for (const key of photos) { clips.push(await fileLink(env, origin, key)); moves.push("push"); }
    const recipe = found.recipe;
    const tall = recipe.aspect === "vertical", square = recipe.aspect === "square";
    const [width, height] = square ? [540, 540] : tall ? [540, 960] : [960, 540];
    const seconds = recipeSeconds(recipe);
    // The recipe's shots decide the length; the clips only fill them.
    // The preview has the template's sound: its music style and the effects on its cuts (best effort; a preview is never held up by them).
    const audio = recipe.audio;
    const layers: { url: string; at: number; gain: number; kind: "voice" | "sfx" }[] = [];
    if (audio?.sfx?.length) {
      try {
        const cutfx = await makeCutEffects(env, jobOf(id), audio, joinTimes(recipe));
        if (cutfx) {
          const links = new Map<string, string>();
          for (const hit of cutfx.hits) {
            if (!links.has(hit.file)) links.set(hit.file, await fileLink(env, origin, trackKey(jobOf(id), hit.file)));
            if (hit.at < seconds - 0.3) layers.push({ url: links.get(hit.file)!, at: Math.round(hit.at * 1000) / 1000, gain: 0.5, kind: "sfx" });
          }
        }
      } catch { /* silent effects */ }
    }
    await dropEdit(env, jobOf(id), KEY(id));
    await startEdit(env, jobOf(id), KEY(id), { clips, width, height, duration: seconds, sceneSeconds: Math.max(2, ...recipe.slots.map((slot) => slot.dur)) + 0.5, crossfade: 0, music: audio?.music ? { prompt: audio.music.prompt, required: false } : null, ...(layers.length ? { layers } : {}), qc: false, recipe, recipeStrength: 0.6, ...(moves.some(Boolean) ? { moves, photoFps: 24 } : {}) } as Parameters<typeof startEdit>[3]);
    return Response.json({ started: true });
  } catch (error) { return jsonError(error); }
}

export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const id = (new URL(request.url).searchParams.get("id") || "").replace(/^wren:/, "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Unknown template." }, { status: 400 });
    const state = await editState(env, jobOf(id), KEY(id));
    if (state.status === "done") {
      const file = await editFile(env, jobOf(id), KEY(id), "output");
      await storeResponse(env.BUCKET, previewKey(id), file, "video/mp4");
      await markPreview(env, id);
      await dropEdit(env, jobOf(id), KEY(id));
      return Response.json({ status: "done", previewUrl: `/api/wrencut/${id}/preview?v=${Date.now()}` });
    }
    return Response.json({ status: state.status, stage: state.stage, error: state.error });
  } catch (error) { return jsonError(error); }
}

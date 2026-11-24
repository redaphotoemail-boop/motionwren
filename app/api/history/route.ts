import { NextResponse } from "next/server";
import { requireAdmin } from "../_lib/account";
import { loadManifest, qualityState, type QualityState } from "../_lib/production";
import { UPSCALE_PER_SECOND, engineUpscales } from "../../engine-catalog";
import { isEngineVideoHost } from "../_lib/engine-hosts";
import { HISTORY_COOKIE as COOKIE, historyOwnerIds, uploadBody } from "../_lib/history-owners";
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function safeVideoUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && isEngineVideoHost(url.hostname) ? url : null;
  } catch { return null; }
}


export async function GET() {
  const { env } = await import("cloudflare:workers");
  const ownerIds = await historyOwnerIds(env);
  if (!ownerIds.length) return NextResponse.json({ items: [] });
  const placeholders = ownerIds.map(() => "?").join(",");
  const result = await env.DB.prepare(`SELECT id, prompt, engine, category, resolution, aspect, duration, cost_cents AS costCents, created_at AS createdAt, (SELECT id FROM render_jobs WHERE history_id = generation_history.id AND kind LIKE 'studio%' LIMIT 1) AS jobId, (SELECT id FROM render_jobs WHERE id = generation_history.id AND kind LIKE 'studio%') AS originJobId, (SELECT created_at FROM render_jobs WHERE (history_id = generation_history.id OR id = generation_history.id) AND kind LIKE 'studio%' LIMIT 1) AS submittedAt FROM generation_history WHERE owner_id IN (${placeholders}) AND engine != 'delivered' AND id NOT IN (SELECT history_id FROM render_jobs WHERE history_id IS NOT NULL AND kind NOT LIKE 'studio%') ORDER BY created_at DESC LIMIT 50`).bind(...ownerIds).all();
  // Which films were made with a template (or from saved clips), so History can say so.
  // Films made before template names were recorded: find the template by its music style (the one thing every film keeps); with a single template, that is it.
  const known = await env.DB.prepare(`SELECT name, recipe FROM wrencut_templates`).all<{ name: string; recipe: string }>().then((r) => (r.results || []).map((row) => { let music = ""; try { music = JSON.parse(row.recipe)?.audio?.music?.prompt || ""; } catch { /* unreadable recipe */ } return { name: row.name, music }; })).catch(() => [] as { name: string; music: string }[]);
  const nameOf = (recipe: { audio?: { music?: { prompt?: string } } } | undefined) => {
    const music = recipe?.audio?.music?.prompt || "";
    const same = music ? known.filter((item) => item.music === music) : [];
    return same.length === 1 ? same[0].name : known.length === 1 ? known[0].name : "Template";
  };
  // Which film each row belongs to, before anything else reads it: the job it came from, the film its
  // versions list names, or — for a "Make versions" output — the film its clips came from (sourceFilmId).
  type Row = Record<string, unknown> & { id: string; createdAt: number; jobId?: string | null; originJobId?: string | null };
  const rows = result.results as Row[];
  const filmOf = new Map<string, string>();
  const order = new Map<string, string[]>();
  const manifests = new Map<string, Awaited<ReturnType<typeof loadManifest>>>();
  await Promise.all(rows.map(async (item) => {
    if (item.jobId) {
      filmOf.set(item.id, item.jobId);
      const manifest = await loadManifest(env, item.jobId).catch(() => null);
      manifests.set(item.jobId, manifest);
      if (manifest?.sourceFilmId) filmOf.set(item.id, manifest.sourceFilmId);
      else if (manifest?.versions?.length) { order.set(item.jobId, manifest.versions); for (const version of manifest.versions) filmOf.set(version, item.jobId); }
    }
    if (item.originJobId) filmOf.set(item.id, item.originJobId);
  }));
  const made = await Promise.all(result.results.map(async (item) => {
    const row = item as { jobId?: string | null; originJobId?: string | null; id: string };
    // The job this card can be edited through: the latest version's job, else the job this row came from,
    // else the film it belongs to. A row with none of these was saved from an upload, not made in Studio.
    const film = filmOf.get(row.id) || null;
    const editJobId = row.jobId || row.originJobId || film;
    let manifest: Awaited<ReturnType<typeof loadManifest>> = null;
    if (editJobId) manifest = manifests.get(editJobId) || await loadManifest(env, editJobId).catch(() => null);
    if (!editJobId) return { template: null as string | null, fromClips: false, quality: null as QualityState | null, upscaleCents: 0, frameRatio: null as number | null, editJobId: null as string | null, editable: false, editBlockedReason: "This video was saved outside Studio, so it can't be edited here.", versionKind: null as "edit" | "version" | null, engine: null as string | null, remadeOn: null as string | null };
    if (!manifest) return { template: null as string | null, fromClips: false, quality: null as QualityState | null, upscaleCents: 0, frameRatio: null as number | null, editJobId, editable: false, editBlockedReason: "This film was made before it could be edited.", versionKind: null as "edit" | "version" | null, engine: null as string | null, remadeOn: null as string | null };
    const template = manifest?.edit?.templateName || (manifest?.edit?.recipe ? nameOf(manifest.edit.recipe as { audio?: { music?: { prompt?: string } } }) : manifest?.edit?.grade === "warm" ? "Library template" : null);
    return { template, fromClips: Boolean(manifest?.fromClips), quality: manifest && !manifest.fromClips ? qualityState(manifest) : null, upscaleCents: manifest?.fromClips && !manifest.upscale && engineUpscales(manifest.engine as never, "1080p") && item.resolution !== "1080p" ? Math.round(UPSCALE_PER_SECOND * Number(item.duration || 0) * 100) : 0, frameRatio: manifest?.frame?.ratio || null, editJobId, editable: true, editBlockedReason: null as string | null, versionKind: (manifest?.sourceFilmId ? "version" : "edit") as "edit" | "version", engine: ((manifest?.startedEngine || manifest?.fix?.firstEngine) || null) as string | null, remadeOn: ((manifest?.startedEngine || manifest?.fix?.firstEngine) && manifest.engine !== (manifest.startedEngine || manifest.fix?.firstEngine) ? manifest.engine : null) as string | null };
  }));
  // Versions of one film: the first (its history id is the job's id) is the original; each edit saved a later one.
  const items = rows.map((item, index) => {
    const film = filmOf.get(item.id) || null;
    const listed = film ? order.get(film) : undefined;
    const siblings = film ? rows.filter((other) => filmOf.get(other.id) === film) : [];
    let version: number | null = null;
    if (film && siblings.length > 1) {
      if (item.id === film) version = 0;
      else if (listed && listed.includes(item.id)) version = listed.indexOf(item.id) + 1;
      else version = siblings.filter((other) => other.id !== film && other.createdAt <= item.createdAt).length;
    }
    return { ...item, engine: made[index].engine || item.engine, remadeOn: made[index].remadeOn, filmId: film, version, versionKind: made[index].versionKind, template: made[index].template, fromClips: made[index].fromClips, quality: made[index].quality, upscaleCents: made[index].upscaleCents, frameRatio: made[index].frameRatio, editJobId: made[index].editJobId, editable: made[index].editable, editBlockedReason: made[index].editBlockedReason, videoUrl: `/api/history/${item.id}/video`, downloadUrl: `/api/history/${item.id}/video?download=1` };
  });
  // Keep every film's versions together: the original first, then its edits in order, placed where the film's newest version is.
  const placed = new Set<string>(); const sorted: typeof items = [];
  for (const item of items) {
    if (!item.filmId || item.version === null) { sorted.push(item); continue; }
    if (placed.has(item.filmId)) continue;
    placed.add(item.filmId);
    sorted.push(...items.filter((other) => other.filmId === item.filmId).sort((a, b) => (a.version ?? 0) - (b.version ?? 0)));
  }
  return NextResponse.json({ items: sorted });
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    const account = await requireAdmin(env);
    const requestType = request.headers.get("content-type") || "";
    const isUpload = requestType.includes("multipart/form-data");
    const isRawVideo = requestType.startsWith("video/");
    let body: Record<string, unknown>; let bytes: ArrayBuffer | ReadableStream; let size = 0; let contentType = "video/mp4";
    if (isRawVideo) {
      // The Studio sends the finished video as the request body, with its
      // details in a header: a form upload over 21 MB is refused before it
      // reaches this route, and streaming avoids holding 100 MB in memory.
      size = Number(request.headers.get("content-length")) || 0;
      if (!size || size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "This video is too large to save in history." }, { status: 413 });
      try { body = JSON.parse(decodeURIComponent(request.headers.get("x-motionwren-meta") || "%7B%7D")) as Record<string, unknown>; } catch { body = {}; }
      contentType = requestType.split(";")[0] || "video/mp4";
      bytes = await uploadBody(request, size);
    } else if (isUpload) {
      const form = await request.formData(); const video = form.get("video");
      if (!(video instanceof File) || !video.type.startsWith("video/")) return NextResponse.json({ error: "The finished video file is not valid." }, { status: 400 });
      bytes = await video.arrayBuffer(); size = bytes.byteLength; contentType = video.type || "video/webm";
      body = Object.fromEntries(["prompt","engine","category","resolution","aspect","duration","costCents"].map((key) => [key, String(form.get(key) || "")]));
    } else {
      body = await request.json() as Record<string, unknown>; const source = safeVideoUrl(body.sourceUrl);
      if (!source) return NextResponse.json({ error: "The generated video source is not valid." }, { status: 400 });
      const upstream = await fetch(source.toString());
      if (!upstream.ok) return NextResponse.json({ error: "The generated video could not be saved." }, { status: 502 });
      bytes = await upstream.arrayBuffer(); size = bytes.byteLength; contentType = upstream.headers.get("content-type") || "video/mp4";
    }
    if (!size || size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "This video is too large to save in history." }, { status: 413 });

    const ownerId = account.id;
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const extension = contentType.includes("webm") ? "webm" : "mp4";
    const r2Key = `generation-history/${ownerId}/${id}.${extension}`;
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType } });

    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 6000) : "";
    const validEngines = new Set(["kling3", "geminiOmni", "veo31Lite", "hailuo23", "kling25", "runway4turbo", "runway45", "wan22", "wan25", "wan27", "wan3", "h3lite", "h3", "vidu3turbo", "luma", "seedance1fast", "upscale", "studio", "fast"]);
    const requestedEngine = typeof body.engine === "string" ? body.engine : "wan3";
    const engine = validEngines.has(requestedEngine) ? requestedEngine : "wan3";
    const category = typeof body.category === "string" ? body.category.slice(0, 40) : "single";
    const resolution = typeof body.resolution === "string" ? body.resolution.slice(0, 20) : "480p";
    const aspect = typeof body.aspect === "string" ? body.aspect.slice(0, 20) : "horizontal";
    const duration = Math.max(1, Math.min(600, Math.round(Number(body.duration) || 5)));
    const costCents = Math.max(0, Math.min(10000, Math.round(Number(body.costCents) || 0)));
    try {
      await env.DB.prepare(`INSERT INTO generation_history (id, owner_id, r2_key, prompt, engine, category, resolution, aspect, duration, cost_cents, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, ownerId, r2Key, prompt, engine, category, resolution, aspect, duration, costCents, size, createdAt).run();
    } catch (error) {
      await env.BUCKET.delete(r2Key);
      throw error;
    }

    const response = NextResponse.json({ item: { id, prompt, engine, category, resolution, aspect, duration, costCents, createdAt, videoUrl: `/api/history/${id}/video`, downloadUrl: `/api/history/${id}/video?download=1` } });
    response.cookies.set(COOKIE, ownerId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return response;
  } catch {
    return NextResponse.json({ error: "The generated video could not be added to history." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { loadManifest } from "../../_lib/production";
import { motionLabel } from "../../../motion-label";

/* Owner only (Studio): the clips already generated for earlier films, newest first, so a new film can be made from them
   without generating again. Films made from saved clips are left out (their clips are copies of these). */
export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    const owner = await requireAdmin(env);
    const rows = await env.DB.prepare(`SELECT id, category, aspect, resolution, duration, created_at AS createdAt FROM render_jobs WHERE owner_id = ? AND kind = 'studio-series' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 24`).bind(owner.id).all<{ id: string; category: string; aspect: string; resolution: string; duration: number; createdAt: number }>();
    const films = [];
    for (const row of rows.results) {
      const manifest = await loadManifest(env, row.id);
      if (!manifest || manifest.fromClips) continue;
      const scenes = manifest.inputs.map((input, index) => ({
        index, move: manifest.photoMoves?.[index] || motionLabel(String(input.prompt || "")) || "",
        photo: `/api/job-frames/${row.id}/scene-${String(index + 1).padStart(2, "0")}.jpg`,
        clip: `/api/job-frames/${row.id}/out-${String(index + 1).padStart(2, "0")}.mp4`,
        stored: Boolean(manifest.saved?.[index]),
      })).filter((scene) => scene.stored);
      if (scenes.length) films.push({ id: row.id, label: row.category.replace(/^Studio · /, ""), aspect: row.aspect, resolution: row.resolution, seconds: manifest.sceneSeconds, createdAt: row.createdAt, scenes });
    }
    return NextResponse.json({ films });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

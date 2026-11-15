import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../_lib/account";
import { loadManifest } from "../../../_lib/production";

/* Owner only: what the quality check flagged on one film, with a preview clip of each flagged scene.
   "earlier" are attempts that were re-made automatically (kept so they can still be seen);
   "delivered" are scenes of the finished film that still carry a flag. */
export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const id = new URL(request.url).pathname.split("/").at(-2) || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid history item." }, { status: 400 });
    const job = await env.DB.prepare(`SELECT id FROM render_jobs WHERE history_id = ? ORDER BY created_at DESC LIMIT 1`).bind(id).first<{ id: string }>();
    if (!job) return NextResponse.json({ rounds: 0, delivered: [], earlier: [] });
    const manifest = await loadManifest(env, job.id);
    const fix = manifest?.fix;
    const clip = (file: string) => `/api/job-frames/${job.id}/${file}`;
    const out = (scene: number) => `out-${String(scene + 1).padStart(2, "0")}.mp4`;
    return NextResponse.json({
      rounds: fix?.round || 0,
      delivered: (fix?.flagged || []).map((item) => ({ scene: item.scene + 1, issues: item.issues, clip: clip(out(item.scene)) })),
      earlier: (fix?.kept || []).map((item) => ({ scene: item.scene + 1, round: item.round, issues: item.issues, clip: clip(item.file) })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

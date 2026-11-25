import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../_lib/account";
import { jobCostLines } from "../../../_lib/film-cost";
import { filmCostLines } from "../../../../cost-model";
import { studioEngine } from "../../../../engine-catalog";

/* Owner only: every cost of one saved film, line by line. The engine line is what production recorded; the rest
   are estimates from list prices (the providers' own billing pages stay the final word). */
export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const id = new URL(request.url).pathname.split("/").at(-2) || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid history item." }, { status: 400 });
    const history = await env.DB.prepare(`SELECT engine, resolution, duration, cost_cents AS costCents FROM generation_history WHERE id = ?`).bind(id).first<{ engine: string; resolution: string; duration: number; costCents: number }>();
    if (!history) return NextResponse.json({ error: "Video not found." }, { status: 404 });
    const job = await env.DB.prepare(`SELECT id, kind, status, cost_cents AS costCents FROM render_jobs WHERE history_id = ? ORDER BY created_at DESC LIMIT 1`).bind(id).first<{ id: string; kind: string; status: string; costCents: number }>();
    const engine = studioEngine(history.engine as never);
    if (!job) {
      const { lines, totalCents } = filmCostLines({ engineName: engine.name, engineCents: history.costCents, scenes: 1, sceneSeconds: history.duration, resolution: history.resolution, upscaled: false, duration: history.duration, edited: false, music: "none", voiceChars: 0, sfxCount: 0, sfxSeconds: 0, reviewCents: 0 });
      return NextResponse.json({ lines, totalCents });
    }
    const { lines, totalCents } = await jobCostLines(env as never, job, history);
    return NextResponse.json({ lines, totalCents });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

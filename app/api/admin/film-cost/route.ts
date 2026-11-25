import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { loadManifest } from "../../_lib/production";
import { jobCostLines } from "../../_lib/film-cost";
import { studioEngine } from "../../../engine-catalog";

/* Manager only: the full cost of ONE film, line by line (Finance → One film). Without an id it lists the latest films to
   choose from. Read-only. The lines are the same ones the Cost tab in History shows. */
export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      const rows = await env.DB.prepare(`SELECT j.id, j.kind, j.status, j.category AS title, j.duration, j.cost_cents AS costCents, j.created_at AS createdAt, u.display_name AS name, u.email AS email
        FROM render_jobs j LEFT JOIN users u ON u.id = j.owner_id WHERE j.kind IN ('customer-series','studio-series','studio-single') ORDER BY j.created_at DESC LIMIT 40`).all<{ id: string; kind: string; status: string; title: string; duration: number; costCents: number; createdAt: number; name: string | null; email: string | null }>();
      return NextResponse.json({ films: rows.results.map((row) => ({ id: row.id, title: String(row.title || "Video").replace(/^Studio · /, ""), segment: row.kind.startsWith("customer") ? "customer" : "studio", status: row.status, duration: row.duration, costCents: row.costCents, createdAt: row.createdAt, owner: row.name || row.email || "" })) });
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid film." }, { status: 400 });
    const job = await env.DB.prepare(`SELECT id, kind, status, category AS title, resolution, duration, cost_cents AS costCents, created_at AS createdAt, history_id AS historyId FROM render_jobs WHERE id = ?`).bind(id).first<{ id: string; kind: string; status: string; title: string; resolution: string; duration: number; costCents: number; createdAt: number; historyId: string | null }>();
    if (!job) return NextResponse.json({ error: "Film not found." }, { status: 404 });
    const manifest = await loadManifest(env, id);
    const engineKey = (manifest?.startedEngine || manifest?.fix?.firstEngine || manifest?.engine || "studio") as string;
    const { lines, totalCents } = await jobCostLines(env as never, job, { engine: engineKey, resolution: job.resolution, duration: job.duration, costCents: job.costCents });
    return NextResponse.json({ title: String(job.title || "Video").replace(/^Studio · /, ""), status: job.status, createdAt: job.createdAt, duration: job.duration, engine: studioEngine(engineKey as never).name, scenes: manifest?.inputs.length || 1, lines, totalCents });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

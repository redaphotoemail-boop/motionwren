import { NextResponse } from "next/server";
import { isOwnerRequest } from "../../../owner-auth";

const STATUSES = new Set(["new", "production", "review", "delivered", "archived"]);

async function loadJob(id: string) {
  const { env } = await import("cloudflare:workers");
  const job = await env.DB.prepare(`SELECT id, client_name AS clientName, client_email AS clientEmail, business_name AS businessName, project_name AS projectName, package_seconds AS packageSeconds, style, notes, status, photo_count AS photoCount, created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt FROM client_jobs WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!job) return null;
  const assets = await env.DB.prepare(`SELECT id, file_name AS fileName, content_type AS contentType, bytes, position FROM job_assets WHERE job_id = ? ORDER BY position`).bind(id).all();
  return { ...job, assets: assets.results.map((asset) => ({ ...asset, url: `/api/jobs/${id}/assets/${asset.id}` })) };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  const { id } = await context.params;
  const job = await loadJob(id);
  return job ? NextResponse.json({ job }) : NextResponse.json({ error: "Project not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  try {
    const { env } = await import("cloudflare:workers");
    const { id } = await context.params;
    const body = await request.json() as { status?: string };
    if (!body.status || !STATUSES.has(body.status)) return NextResponse.json({ error: "Choose a valid production status." }, { status: 400 });
    await env.DB.prepare(`UPDATE client_jobs SET status = ?, updated_at = ? WHERE id = ?`).bind(body.status, Date.now(), id).run();
    return NextResponse.json({ job: await loadJob(id) });
  } catch {
    return NextResponse.json({ error: "The project status could not be updated." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { isOwnerRequest } from "../../../../../owner-auth";

export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  if (!(await isOwnerRequest())) return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  const { env } = await import("cloudflare:workers");
  const { id, assetId } = await context.params;
  const row = await env.DB.prepare(`SELECT r2_key AS r2Key, file_name AS fileName, content_type AS contentType FROM job_assets WHERE id = ? AND job_id = ?`).bind(assetId, id).first<{ r2Key: string; fileName: string; contentType: string }>();
  if (!row) return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  const object = await env.BUCKET.get(row.r2Key);
  if (!object) return NextResponse.json({ error: "Photo file not found." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(object.body, { headers: { "Content-Type": row.contentType, "Content-Length": String(object.size), "Cache-Control": "private, max-age=3600", ...(download ? { "Content-Disposition": `attachment; filename="${row.fileName.replace(/[\"\\\r\n]/g, "_")}"` } : {}) } });
}

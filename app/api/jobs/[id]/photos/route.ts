import { NextResponse } from "next/server";

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PACKAGE_LIMITS: Record<number, number> = { 20: 5, 35: 10, 50: 15 };

async function hashToken(token: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { env } = await import("cloudflare:workers");
    const { id } = await context.params;
    const token = request.headers.get("x-upload-token") || "";
    const job = await env.DB.prepare(`SELECT upload_token_hash AS uploadTokenHash, package_seconds AS packageSeconds, status FROM client_jobs WHERE id = ?`).bind(id).first<Record<string, unknown>>();
    if (!job || !token || await hashToken(token) !== job.uploadTokenHash) return NextResponse.json({ error: "This upload session is no longer valid." }, { status: 403 });
    if (job.status !== "uploading") return NextResponse.json({ error: "This project has already been submitted." }, { status: 409 });
    const form = await request.formData();
    const file = form.get("file");
    const position = Number(form.get("position"));
    const limit = PACKAGE_LIMITS[Number(job.packageSeconds)] || 0;
    if (!(file instanceof File) || !Number.isInteger(position) || position < 0 || position >= limit) return NextResponse.json({ error: "This photo could not be added." }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type) || !file.size || file.size > MAX_BYTES) return NextResponse.json({ error: "Use a JPG, PNG or WebP image under 12 MB." }, { status: 415 });
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const assetId = crypto.randomUUID();
    const r2Key = `client-jobs/${id}/${String(position + 1).padStart(2, "0")}-${assetId}.${extension}`;
    const previous = await env.DB.prepare(`SELECT id, r2_key AS r2Key FROM job_assets WHERE job_id = ? AND position = ?`).bind(id, position).first<{ id: string; r2Key: string }>();
    const bytes = await file.arrayBuffer();
    await env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: file.type } });
    try {
      if (previous) {
        await env.DB.prepare(`UPDATE job_assets SET id = ?, r2_key = ?, file_name = ?, content_type = ?, bytes = ?, created_at = ? WHERE job_id = ? AND position = ?`).bind(assetId, r2Key, file.name.slice(0, 220), file.type, file.size, Date.now(), id, position).run();
        await env.BUCKET.delete(previous.r2Key);
      } else {
        await env.DB.prepare(`INSERT INTO job_assets (id, job_id, r2_key, file_name, content_type, bytes, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(assetId, id, r2Key, file.name.slice(0, 220), file.type, file.size, position, Date.now()).run();
      }
      const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM job_assets WHERE job_id = ?`).bind(id).first<{ total: number }>();
      await env.DB.prepare(`UPDATE client_jobs SET photo_count = ?, updated_at = ? WHERE id = ?`).bind(Number(count?.total || 0), Date.now(), id).run();
    } catch (error) {
      await env.BUCKET.delete(r2Key);
      throw error;
    }
    return NextResponse.json({ ok: true, position, photoCount: Number((await env.DB.prepare(`SELECT COUNT(*) AS total FROM job_assets WHERE job_id = ?`).bind(id).first<{ total: number }>())?.total || 0) });
  } catch {
    return NextResponse.json({ error: "This photo could not be uploaded. Please try again." }, { status: 500 });
  }
}

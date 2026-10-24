import { NextResponse } from "next/server";

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
    if (job.status !== "uploading") return NextResponse.json({ ok: true, id });
    const expected = PACKAGE_LIMITS[Number(job.packageSeconds)] || 0;
    const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM job_assets WHERE job_id = ?`).bind(id).first<{ total: number }>();
    if (Number(count?.total || 0) !== expected) return NextResponse.json({ error: `Add all ${expected} photos before sending your project.` }, { status: 400 });
    const now = Date.now();
    await env.DB.prepare(`UPDATE client_jobs SET status = 'new', photo_count = ?, completed_at = ?, updated_at = ? WHERE id = ?`).bind(expected, now, now, id).run();
    return NextResponse.json({ ok: true, id });
  } catch {
    return NextResponse.json({ error: "Your photos uploaded, but the project could not be finalized. Please try again." }, { status: 500 });
  }
}

import { audit, enforceRateLimit, jsonError, requireAccount } from "../../../_lib/account";

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await context.params; const { env } = await import("cloudflare:workers"); const account = await requireAccount(env);
    // 120 an hour: a full package uploads up to 20 photos once plus a few per extra video,
    // so several listings in one sitting still fit. Generation keeps its own, tighter limit.
    await enforceRateLimit(env, account.id, "asset-upload", 120, 60 * 60 * 1000);
    const project = await env.DB.prepare(`SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`).bind(projectId, account.id).first();
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });
    const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File) || !ALLOWED_TYPES.has(file.type)) return Response.json({ error: "Upload a JPG, PNG or WebP image." }, { status: 400 });
    if (!file.size || file.size > MAX_ASSET_BYTES) return Response.json({ error: "Each image must be smaller than 20 MB." }, { status: 413 });
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM project_assets WHERE project_id = ? AND owner_id = ?`).bind(projectId, account.id).first<{ count: number }>();
    if ((count?.count || 0) >= 20) return Response.json({ error: "A project can contain up to 20 uploaded assets." }, { status: 409 });
    const assetId = crypto.randomUUID(); const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const r2Key = `project-assets/${account.id}/${projectId}/${assetId}.${extension}`; const now = Date.now(); const sortOrder = count?.count || 0;
    await env.BUCKET.put(r2Key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type }, customMetadata: { ownerId: account.id, projectId, originalName: file.name.slice(0, 120) } });
    try {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO project_assets (id, project_id, owner_id, kind, r2_key, file_name, content_type, size_bytes, sort_order, expires_at, created_at) VALUES (?, ?, ?, 'source_image', ?, ?, ?, ?, ?, ?, ?)`).bind(assetId, projectId, account.id, r2Key, file.name.slice(0, 180), file.type, file.size, sortOrder, now + 30 * 24 * 60 * 60 * 1000, now),
        env.DB.prepare(`UPDATE projects SET updated_at = ? WHERE id = ? AND owner_id = ?`).bind(now, projectId, account.id),
      ]);
    } catch (error) { await env.BUCKET.delete(r2Key); throw error; }
    await audit(env, account.id, "asset.uploaded", "project", projectId, { assetId, sizeBytes: file.size });
    return Response.json({ asset: { id: assetId, fileName: file.name, contentType: file.type, sizeBytes: file.size, sortOrder, createdAt: now } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}

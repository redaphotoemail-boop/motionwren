import { audit, jsonError, requireAccount } from "../../../../_lib/account";

async function assetForOwner(env: { DB: D1Database }, projectId: string, assetId: string, ownerId: string) {
  return env.DB.prepare(`SELECT id, r2_key AS r2Key, file_name AS fileName, content_type AS contentType FROM project_assets WHERE id = ? AND project_id = ? AND owner_id = ? LIMIT 1`).bind(assetId, projectId, ownerId).first<{ id: string; r2Key: string; fileName: string; contentType: string }>();
}

export async function GET(_: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params; const { env } = await import("cloudflare:workers"); const account = await requireAccount(env); const asset = await assetForOwner(env, id, assetId, account.id);
    if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });
    const object = await env.BUCKET.get(asset.r2Key); if (!object?.body) return Response.json({ error: "Stored asset not found." }, { status: 404 });
    return new Response(object.body, { headers: { "Content-Type": asset.contentType, "Cache-Control": "private, no-store", "Content-Disposition": `inline; filename="${asset.fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}"` } });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params; const { env } = await import("cloudflare:workers"); const account = await requireAccount(env); const asset = await assetForOwner(env, id, assetId, account.id);
    if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });
    await env.BUCKET.delete(asset.r2Key); await env.DB.prepare(`DELETE FROM project_assets WHERE id = ? AND project_id = ? AND owner_id = ?`).bind(assetId, id, account.id).run();
    await audit(env, account.id, "asset.deleted", "project", id, { assetId });
    return Response.json({ ok: true });
  } catch (error) { return jsonError(error); }
}

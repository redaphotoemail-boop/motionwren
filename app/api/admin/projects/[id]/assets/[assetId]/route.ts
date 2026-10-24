import { jsonError, requireAdmin } from "../../../../../_lib/account";

export async function GET(request: Request, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { id, assetId } = await context.params;
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const asset = await env.DB.prepare(`SELECT r2_key AS r2Key, file_name AS fileName, content_type AS contentType FROM project_assets WHERE project_id = ? AND id = ? LIMIT 1`).bind(id, assetId).first<{ r2Key: string; fileName: string; contentType: string }>();
    if (!asset) return Response.json({ error: "Asset not found." }, { status: 404 });
    const object = await env.BUCKET.get(asset.r2Key);
    if (!object?.body) return Response.json({ error: "Stored asset not found." }, { status: 404 });
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(object.body, { headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asset.fileName.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
    } });
  } catch (error) { return jsonError(error); }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid history item." }, { status: 400 });
  const ownerId = (await cookies()).get("fm_history_id")?.value;
  if (!ownerId) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const row = await env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id = ? LIMIT 1`).bind(id, ownerId).first<{ r2Key: string }>();
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const object = await env.BUCKET.get(row.r2Key);
  if (!object) return NextResponse.json({ error: "Video file not found." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(object.body, { headers: {
    "Content-Type": object.httpMetadata?.contentType || "video/mp4",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="frame-motion-${id.slice(0, 8)}.mp4"`,
    "Cache-Control": "private, max-age=3600",
  } });
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  const ownerId = (await cookies()).get("fm_history_id")?.value;
  if (!ownerId || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const row = await env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id = ? LIMIT 1`).bind(id, ownerId).first<{ r2Key: string }>();
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  await env.BUCKET.delete(row.r2Key);
  await env.DB.prepare(`DELETE FROM generation_history WHERE id = ? AND owner_id = ?`).bind(id, ownerId).run();
  return NextResponse.json({ deleted: true });
}

import { NextResponse } from "next/server";
import { historyOwnerIds } from "../../../_lib/history-owners";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid history item." }, { status: 400 });
  const ownerIds = await historyOwnerIds(env);
  if (!ownerIds.length) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const placeholders = ownerIds.map(() => "?").join(",");
  const row = await env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id IN (${placeholders}) LIMIT 1`).bind(id, ...ownerIds).first<{ r2Key: string }>();
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  // Byte ranges let the dashboard player stream and seek; iPhone Safari will
  // not play an MP4 without them.
  const ranged = Boolean(request.headers.get("range"));
  const object = ranged ? await env.BUCKET.get(row.r2Key, { range: request.headers }) : await env.BUCKET.get(row.r2Key);
  if (!object) return NextResponse.json({ error: "Video file not found." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const contentType = object.httpMetadata?.contentType || "video/mp4";
  const extension = contentType.includes("webm") ? "webm" : "mp4";
  const responseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="motionwren-${id.slice(0, 8)}.${extension}"`,
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };
  const range = ranged ? (object as { range?: { offset?: number; length?: number; suffix?: number } }).range : undefined;
  if (range && object.size) {
    const start = range.suffix !== undefined ? Math.max(0, object.size - range.suffix) : range.offset || 0;
    const length = range.suffix !== undefined ? object.size - start : range.length ?? object.size - start;
    const end = Math.min(object.size - 1, start + length - 1);
    responseHeaders["Content-Range"] = `bytes ${start}-${end}/${object.size}`;
    responseHeaders["Content-Length"] = String(end - start + 1);
    return new NextResponse(object.body, { status: 206, headers: responseHeaders });
  }
  responseHeaders["Content-Length"] = String(object.size);
  return new NextResponse(object.body, { headers: responseHeaders });
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  const ownerIds = await historyOwnerIds(env);
  if (!ownerIds.length || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const placeholders = ownerIds.map(() => "?").join(",");
  const row = await env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id IN (${placeholders}) LIMIT 1`).bind(id, ...ownerIds).first<{ r2Key: string }>();
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  await env.BUCKET.delete(row.r2Key);
  await env.DB.prepare(`DELETE FROM generation_history WHERE id = ? AND owner_id IN (${placeholders})`).bind(id, ...ownerIds).run();
  return NextResponse.json({ deleted: true });
}

import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";

async function owners() {
  const authenticatedId = (await headers()).get("oai-authenticated-user-id");
  const legacyId = (await cookies()).get("fm_history_id")?.value;
  return [...new Set([authenticatedId, legacyId].filter((value): value is string => Boolean(value)))];
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid history item." }, { status: 400 });
  const ownerIds = await owners();
  if (!ownerIds.length) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const placeholders = ownerIds.map(() => "?").join(",");
  const row = await env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id IN (${placeholders}) LIMIT 1`).bind(id, ...ownerIds).first<{ r2Key: string }>();
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const object = await env.BUCKET.get(row.r2Key);
  if (!object) return NextResponse.json({ error: "Video file not found." }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const contentType = object.httpMetadata?.contentType || "video/mp4";
  const extension = contentType.includes("webm") ? "webm" : "mp4";
  return new NextResponse(object.body, { headers: {
    "Content-Type": contentType,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="frame-motion-${id.slice(0, 8)}.${extension}"`,
    "Cache-Control": "private, max-age=3600",
  } });
}

export async function DELETE(request: Request) {
  const { env } = await import("cloudflare:workers");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  const ownerIds = await owners();
  if (!ownerIds.length || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  const placeholders = ownerIds.map(() => "?").join(",");
  const row = await env.DB.prepare(`SELECT r2_key AS r2Key FROM generation_history WHERE id = ? AND owner_id IN (${placeholders}) LIMIT 1`).bind(id, ...ownerIds).first<{ r2Key: string }>();
  if (!row) return NextResponse.json({ error: "Video not found." }, { status: 404 });
  await env.BUCKET.delete(row.r2Key);
  await env.DB.prepare(`DELETE FROM generation_history WHERE id = ? AND owner_id IN (${placeholders})`).bind(id, ...ownerIds).run();
  return NextResponse.json({ deleted: true });
}

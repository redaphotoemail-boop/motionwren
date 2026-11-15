import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { readStyle } from "../../_lib/style-suggest";

/* Reads the photos (small data URLs) and reports each one's room and style, so Studio can suggest an edit.
   Owner-only. Nothing is charged or stored. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { images?: unknown };
    if (!Array.isArray(body.images) || body.images.length < 1 || body.images.length > 12) return NextResponse.json({ error: "Send between 1 and 12 photos." }, { status: 400 });
    const images: Uint8Array[] = [];
    for (const item of body.images) {
      const match = typeof item === "string" ? /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(item) : null;
      if (!match || match[1].length > 900_000) return NextResponse.json({ error: "A photo could not be read." }, { status: 400 });
      images.push(Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0)));
    }
    const result = await readStyle(env, images);
    if (!result.connected) return NextResponse.json({ error: "The photo reader is not connected.", fix: "cloudflare-ai" }, { status: 503 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

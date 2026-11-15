import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { dataUrlBytes, readSocialPhotos } from "../../_lib/social-read";
import { checkSocialPhotos, type PhotoFacts } from "../../../social-check";
import { socialSpec } from "../../../social-templates";

/* Reads the uploaded photos (small copies) and checks them against a social template: the order, the story, the movement and
   the plain photo faults. Owner-only. Nothing is charged or stored. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { template?: unknown; photos?: unknown };
    const spec = socialSpec(body.template);
    if (!spec) return NextResponse.json({ error: "That template is not a social template." }, { status: 400 });
    const list = Array.isArray(body.photos) ? body.photos as Record<string, unknown>[] : [];
    if (list.length < 1 || list.length > 12) return NextResponse.json({ error: "Send between 1 and 12 photos." }, { status: 400 });
    const num = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
    const bytes = list.map((item) => dataUrlBytes(item.image));
    const read = await readSocialPhotos(env, bytes);
    const photos: PhotoFacts[] = list.map((item, index) => ({
      name: typeof item.name === "string" ? item.name.replace(/[\u0000-\u001f]/g, " ").slice(0, 60) : undefined,
      w: num(item.w, 20000) || 0, h: num(item.h, 20000) || 0,
      sharp: num(item.sharp, 1e7), bright: num(item.bright, 255), hash: typeof item.hash === "string" && /^[0-9a-f]{16}$/.test(item.hash) ? item.hash : undefined,
      ...read.facts[index],
    }));
    return NextResponse.json({ connected: read.connected, check: checkSocialPhotos(spec, photos) });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

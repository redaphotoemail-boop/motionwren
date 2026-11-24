import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../_lib/account";
import { planMovements } from "../../_lib/movement-read";
import { MOVE_NAME } from "../../_lib/movement-plan";

/* Owner only (Studio): reads the photos (small data URLs) and suggests a camera movement for each one, the same way
   customer films choose theirs. Nothing is charged for the movement choice by OpenCV, nothing is stored, and the
   "last film" note in Admin is left alone. Studio shows the suggestion and only applies it when the owner taps Apply. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { images?: unknown };
    if (!Array.isArray(body.images) || body.images.length < 2 || body.images.length > 12) return NextResponse.json({ error: "Send between 2 and 12 photos." }, { status: 400 });
    const photos: { data: string }[] = [];
    for (const item of body.images) {
      const match = typeof item === "string" ? /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(item) : null;
      if (!match || match[1].length > 1_500_000) return NextResponse.json({ error: "A photo could not be read." }, { status: 400 });
      photos.push({ data: match[1] });
    }
    const plan = await planMovements(env as never, `studio-${Date.now()}`, photos, undefined, { remember: false });
    return NextResponse.json({
      picks: plan.picks.map((pick) => ({ move: pick.move, name: MOVE_NAME[pick.move], why: pick.why })),
      smart: plan.used !== "off",
      note: plan.note || "",
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

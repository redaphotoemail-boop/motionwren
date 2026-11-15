import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "../../../../_lib/account";
import { loadManifest } from "../../../../_lib/production";

/* Owner only: what the quality check flagged on a film that is still being made (or was just delivered), by its job id,
   with a preview clip of every flagged scene. Same shape as History's Quality tab. */
export async function GET(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const id = new URL(request.url).pathname.split("/").at(-2) || "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid film." }, { status: 400 });
    const manifest = await loadManifest(env, id);
    const fix = manifest?.fix;
    const clip = (file: string) => `/api/job-frames/${id}/${file}`;
    const out = (scene: number) => `out-${String(scene + 1).padStart(2, "0")}.mp4`;
    return NextResponse.json({
      rounds: fix?.round || 0,
      delivered: (fix?.flagged || []).map((item) => ({ scene: item.scene + 1, issues: item.issues, clip: clip(out(item.scene)) })),
      earlier: (fix?.kept || []).map((item) => ({ scene: item.scene + 1, round: item.round, issues: item.issues, clip: clip(item.file) })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    return jsonError(error);
  }
}

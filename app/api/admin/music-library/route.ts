import { jsonError, requireAdmin } from "../../_lib/account";
import { deleteTrack, libraryTarget, listTracks, setLibraryTarget, updateTrack } from "../../_lib/music-library";

/* The music library: every track kept for reuse. Admin only. */
export async function GET() {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    return Response.json({ tracks: await listTracks(env), target: await libraryTarget(env) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const body = await request.json().catch(() => ({})) as { action?: unknown; id?: unknown; active?: unknown; name?: unknown; target?: unknown };
    const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
    if (body.action === "target") {
      const target = Number(body.target);
      if (!Number.isFinite(target) || target < 0 || target > 50) return Response.json({ error: "Choose a number from 0 to 50." }, { status: 400 });
      await setLibraryTarget(env, target);
    } else if (!id) return Response.json({ error: "Unknown track." }, { status: 400 });
    else if (body.action === "delete") await deleteTrack(env, id);
    else if (body.action === "update") await updateTrack(env, id, { active: typeof body.active === "boolean" ? body.active : undefined, name: typeof body.name === "string" ? body.name : undefined });
    else return Response.json({ error: "Unknown action." }, { status: 400 });
    return Response.json({ tracks: await listTracks(env), target: await libraryTarget(env) });
  } catch (error) { return jsonError(error); }
}

import { jsonError, requireAdmin } from "../../../_lib/account";
import { addTrack, listTracks, libraryTarget } from "../../../_lib/music-library";

/* Adds a track the manager already has (any licensed instrumental). The page
   sends the mp3 itself as the body and its length in the address. */
export async function POST(request: Request) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const url = new URL(request.url);
    const style = url.searchParams.get("style") || "";
    const seconds = Number(url.searchParams.get("seconds"));
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 600) return Response.json({ error: "The track's length could not be read (10 s to 10 min)." }, { status: 400 });
    const data = await request.arrayBuffer();
    if (data.byteLength < 10_000 || data.byteLength > 15_000_000) return Response.json({ error: "Choose an mp3 under 15 MB." }, { status: 400 });
    try { await addTrack(env, { style, seconds, source: "upload", name: url.searchParams.get("name") || "", data }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "The track could not be added." }, { status: 400 }); }
    return Response.json({ tracks: await listTracks(env), target: await libraryTarget(env) });
  } catch (error) { return jsonError(error); }
}

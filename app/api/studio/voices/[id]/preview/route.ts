import { requireAdmin } from "../../../../_lib/account";
import { ElevenLabsMissingKey, listVoices } from "../../../../_lib/elevenlabs";

/* A voice's sample, played from our own address. The page's security policy
   only lets audio come from this site, so ElevenLabs' sample link can't be
   played directly. Free: it is ElevenLabs' stored sample, nothing is made. */
let cache: { at: number; urls: Map<string, string> } | null = null;

async function previewUrl(id: string) {
  if (!cache || Date.now() - cache.at > 10 * 60 * 1000 || !cache.urls.has(id)) {
    cache = { at: Date.now(), urls: new Map((await listVoices()).map((voice) => [voice.voiceId, voice.previewUrl])) };
  }
  return cache.urls.get(id) || "";
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { env } = await import("cloudflare:workers");
    await requireAdmin(env);
    const { id } = await context.params;
    if (!/^[A-Za-z0-9]{8,40}$/.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
    const url = await previewUrl(id);
    if (!/^https:\/\//.test(url)) return Response.json({ error: "This voice has no sample." }, { status: 404 });
    const upstream = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!upstream.ok) return Response.json({ error: "The sample could not be loaded." }, { status: 502 });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const headers: Record<string, string> = { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=86400" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
    if (range && (range[1] || range[2])) {
      const total = bytes.length;
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(total - 1, Number(range[2])) : total - 1;
      if (start > end || start >= total) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
      return new Response(bytes.slice(start, end + 1), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(bytes, { headers: { ...headers, "Content-Length": String(bytes.length) } });
  } catch (error) {
    if (error instanceof ElevenLabsMissingKey) return Response.json({ error: "The ElevenLabs key is not added yet." }, { status: 503 });
    if (error instanceof Response) return error;
    return Response.json({ error: error instanceof Error ? error.message : "The sample could not be loaded." }, { status: 500 });
  }
}
